// tripNotifications: a driver's / helper's trip notifications (table
// `notifications`, written by database triggers when they're assigned to a
// trip, removed from one, or its time slot changes). Used by the header
// bell (components/TripNotifications.tsx) and My Schedule's "Trip updates".
// Each person can only read and mark their own (RLS).
import { supabase } from './supabaseClient'
import { formatSlot } from './format'

export type TripNotification = {
  notification_id: number
  kind: 'assigned' | 'removed' | 'rescheduled'
  itinerary_id: number | null
  created_at: string
  read_at: string | null
  // Filled in when the trip is still readable (they're still on it).
  slot: string | null
  route: string | null
}

const LIMIT = 20

export async function fetchNotifications(employeeId: number): Promise<TripNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('notification_id, kind, itinerary_id, created_at, read_at')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(LIMIT)
  if (error) throw new Error(error.message)

  const tripIds = Array.from(new Set(data.map((n) => n.itinerary_id).filter((id): id is number => id !== null)))
  const { data: trips } = tripIds.length
    ? await supabase
        .from('itineraries')
        .select('itinerary_id, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id')
        .in('itinerary_id', tripIds)
    : { data: [] as { itinerary_id: number; trip_start_at: string | null; trip_end_at: string | null; place_of_pickup_id: number; place_of_delivery_id: number }[] }
  const placeIds = Array.from(new Set((trips ?? []).flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])))
  const { data: places } = placeIds.length
    ? await supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
    : { data: [] as { place_id: number; place_name: string }[] }
  const placeName = new Map((places ?? []).map((p) => [p.place_id, p.place_name]))
  const tripById = new Map((trips ?? []).map((t) => [t.itinerary_id, t]))

  return data.map((n) => {
    const trip = n.itinerary_id !== null ? tripById.get(n.itinerary_id) : undefined
    return {
      ...n,
      slot: trip?.trip_start_at ? formatSlot(trip.trip_start_at, trip.trip_end_at) : null,
      route: trip
        ? `${placeName.get(trip.place_of_pickup_id) ?? '—'} → ${placeName.get(trip.place_of_delivery_id) ?? '—'}`
        : null,
    }
  })
}

export function message(n: TripNotification): string {
  const trip = n.itinerary_id !== null ? `trip #${n.itinerary_id}` : 'a trip'
  const details = [n.slot, n.route].filter(Boolean).join(', ')
  if (n.kind === 'assigned') return `You've been assigned ${trip}${details ? ` — ${details}` : ''}`
  if (n.kind === 'removed') return `You were removed from ${trip}`
  return `${trip.charAt(0).toUpperCase()}${trip.slice(1)} moved${n.slot ? ` to ${n.slot}` : ''}`
}
