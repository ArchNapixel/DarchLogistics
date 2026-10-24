// tripRetime: when a trip is Delivered earlier (or later) than planned, its
// slot ends at the real delivery time and the booking's later trips that
// are still Awaiting follow straight after it -- same back-to-back rule as
// EditTripTimeModal, each trip keeping its own length (the "# of hours").
// E.g. a 6 AM-12 NN trip delivered at 9:32 AM becomes 6 AM-9:32 AM, and the
// next 6-hour trip becomes 9:32 AM-3:32 PM.
//
// Called after the Delivered status is saved. It never fails the delivery:
// it returns a warning message (or null) for the caller to show. Trips
// already on the road or delivered never move; a last-free-storage-day
// booking runs its trips side by side, so its other trips are left alone.
import { supabase } from './supabaseClient'
import { chainSlots } from './tripSchedule'

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

export async function retimeAfterDelivery(itineraryId: number, deliveredAt = Date.now()): Promise<string | null> {
  const { data: trip, error } = await supabase
    .from('itineraries')
    .select('itinerary_id, booking_id, trip_start_at, trip_end_at')
    .eq('itinerary_id', itineraryId)
    .maybeSingle()
  if (error) return `Couldn't re-time the later trips: ${error.message}`
  // Trips from before time slots existed have nothing to adjust.
  if (!trip?.trip_start_at || !trip.trip_end_at) return null
  const start = new Date(trip.trip_start_at).getTime()
  const plannedEnd = new Date(trip.trip_end_at).getTime()
  // On time (within a minute), or "delivered" before it was due to start: leave as is.
  if (deliveredAt <= start || Math.abs(deliveredAt - plannedEnd) < MINUTE_MS) return null

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('hours_per_trip, storage_deadline')
    .eq('booking_id', trip.booking_id)
    .maybeSingle()
  if (bookingError) return `Couldn't re-time the later trips: ${bookingError.message}`

  // This trip's slot now ends when it was really delivered.
  const { error: endError } = await supabase
    .from('itineraries')
    .update({ trip_end_at: new Date(deliveredAt).toISOString() })
    .eq('itinerary_id', itineraryId)
  if (endError) return `Delivered, but its time slot wasn't shortened: ${endError.message}`
  if (booking?.storage_deadline) return null

  // The booking's later trips still Awaiting, in trip order.
  const { data: siblings, error: siblingsError } = await supabase
    .from('itineraries')
    .select('itinerary_id, trip_start_at, trip_end_at')
    .eq('booking_id', trip.booking_id)
    .eq('itinerary_status', 'Awaiting')
    .neq('itinerary_id', itineraryId)
  if (siblingsError) return `Delivered, but the later trips weren't moved: ${siblingsError.message}`
  const later = (siblings ?? [])
    .filter((t) => !t.trip_start_at || new Date(t.trip_start_at).getTime() >= plannedEnd - MINUTE_MS)
    .sort((a, b) => (a.trip_start_at ?? '9999').localeCompare(b.trip_start_at ?? '9999') || a.itinerary_id - b.itinerary_id)
  if (later.length === 0) return null

  const fallbackLength = (booking?.hours_per_trip ?? plannedEnd - start) * (booking?.hours_per_trip ? HOUR_MS : 1)
  const slots = chainSlots(
    deliveredAt,
    later.map((t) =>
      t.trip_start_at && t.trip_end_at ? new Date(t.trip_end_at).getTime() - new Date(t.trip_start_at).getTime() : fallbackLength,
    ),
  )
  const failures: string[] = []
  for (let i = 0; i < later.length; i++) {
    // Only while still Awaiting, and check a row really changed.
    const { data: moved, error: moveError } = await supabase
      .from('itineraries')
      .update({
        trip_start_at: new Date(slots[i].start).toISOString(),
        trip_end_at: new Date(slots[i].end).toISOString(),
      })
      .eq('itinerary_id', later[i].itinerary_id)
      .eq('itinerary_status', 'Awaiting')
      .select('itinerary_id')
      .maybeSingle()
    if (moveError) failures.push(`#${later[i].itinerary_id}: ${moveError.message}`)
    else if (!moved) failures.push(`#${later[i].itinerary_id}: no longer Awaiting`)
  }
  return failures.length ? `Delivered, but these later trips kept their old time -- ${failures.join('; ')}` : null
}
