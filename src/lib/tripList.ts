// tripList: every trip (itinerary) with what the Trips tab on Bookings &
// Trips needs to list and search it -- booking, client, route, active
// crew, vehicles, document count and the booking's storage deadline.
// One row per trip; the page groups them by booking. Read-only.
// Every query pages past Supabase's 1000-row cap (fetchAll / fetchIn).
import { supabase } from './supabaseClient'
import { fetchAll, fetchIn } from './dashboardExpenses'

export const TRIP_STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked up',
  InTransit: 'In transit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
}

export type TripListRow = {
  itinerary_id: number
  booking_id: number
  booking_status: string
  client_name: string
  pickup: string
  delivery: string
  status: string
  trip_date_from: string | null
  trip_start_at: string | null
  trip_end_at: string | null
  plate_number: string | null
  trailer_plate: string | null
  driver: string | null
  helper: string | null
  document_count: number
  // bookings.storage_deadline -- picked up by 11:59 PM that day (lib/storageDeadline.ts).
  storage_deadline: string | null
}

type TripRow = {
  itinerary_id: number
  booking_id: number
  itinerary_status: string | null
  trip_date_from: string | null
  trip_start_at: string | null
  trip_end_at: string | null
  plate_number: string | null
  trailer_id: number | null
  place_of_pickup_id: number
  place_of_delivery_id: number
}

export async function loadTripList(): Promise<{ rows: TripListRow[]; error: string | null }> {
  const trips = await fetchAll<TripRow>((from, to) =>
    supabase
      .from('itineraries')
      .select(
        'itinerary_id, booking_id, itinerary_status, trip_date_from, trip_start_at, trip_end_at, plate_number, trailer_id, place_of_pickup_id, place_of_delivery_id',
      )
      .order('itinerary_id', { ascending: false })
      .range(from, to),
  )
  if (trips.error) return { rows: [], error: trips.error }

  const tripIds = trips.rows.map((t) => t.itinerary_id)
  const bookingIds = Array.from(new Set(trips.rows.map((t) => t.booking_id)))
  const placeIds = Array.from(new Set(trips.rows.flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])))
  const trailerIds = Array.from(
    new Set(trips.rows.map((t) => t.trailer_id).filter((id): id is number => id !== null)),
  )

  const [bookings, places, trailers, crews, documents] = await Promise.all([
    fetchIn<{ booking_id: number; client_id: number; booking_status: string | null; storage_deadline: string | null }>(
      bookingIds,
      (chunk, from, to) =>
        supabase
          .from('bookings')
          .select('booking_id, client_id, booking_status, storage_deadline')
          .in('booking_id', chunk)
          .range(from, to),
    ),
    fetchIn<{ place_id: number; place_name: string }>(placeIds, (chunk, from, to) =>
      supabase.from('places').select('place_id, place_name').in('place_id', chunk).range(from, to),
    ),
    fetchIn<{ trailer_id: number; plate_number: string | null }>(trailerIds, (chunk, from, to) =>
      supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', chunk).range(from, to),
    ),
    fetchIn<{ itinerary_id: number; employee_id: number; crew_role: string }>(tripIds, (chunk, from, to) =>
      supabase
        .from('itinerary_crews')
        .select('itinerary_id, employee_id, crew_role')
        .in('itinerary_id', chunk)
        .eq('is_active', true)
        .range(from, to),
    ),
    fetchIn<{ itinerary_id: number }>(tripIds, (chunk, from, to) =>
      supabase.from('itinerary_documents').select('itinerary_id').in('itinerary_id', chunk).range(from, to),
    ),
  ])
  const firstError = bookings.error ?? places.error ?? trailers.error ?? crews.error ?? documents.error
  if (firstError) return { rows: [], error: firstError }

  const clientIds = Array.from(new Set(bookings.rows.map((b) => b.client_id)))
  const employeeIds = Array.from(new Set(crews.rows.map((c) => c.employee_id)))
  const [clients, employees] = await Promise.all([
    fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, from, to) =>
      supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(from, to),
    ),
    fetchIn<{ employee_id: number; full_name: string | null }>(employeeIds, (chunk, from, to) =>
      supabase.from('employees').select('employee_id, full_name').in('employee_id', chunk).range(from, to),
    ),
  ])
  const secondError = clients.error ?? employees.error
  if (secondError) return { rows: [], error: secondError }

  const bookingById = new Map(bookings.rows.map((b) => [b.booking_id, b]))
  const clientName = new Map(clients.rows.map((c) => [c.client_id, c.client_name]))
  const placeName = new Map(places.rows.map((p) => [p.place_id, p.place_name]))
  const trailerPlate = new Map(trailers.rows.map((t) => [t.trailer_id, t.plate_number]))
  const employeeName = new Map(employees.rows.map((e) => [e.employee_id, e.full_name ?? `Employee #${e.employee_id}`]))
  // "tripId|role" -> employee_id of the active crew member.
  const crewByTripRole = new Map(crews.rows.map((c) => [`${c.itinerary_id}|${c.crew_role}`, c.employee_id]))
  const crewName = (tripId: number, role: string) => {
    const id = crewByTripRole.get(`${tripId}|${role}`)
    return id !== undefined ? (employeeName.get(id) ?? `Employee #${id}`) : null
  }
  const docCount = new Map<number, number>()
  for (const d of documents.rows) docCount.set(d.itinerary_id, (docCount.get(d.itinerary_id) ?? 0) + 1)

  return {
    rows: trips.rows.map((t) => {
      const booking = bookingById.get(t.booking_id)
      return {
        itinerary_id: t.itinerary_id,
        booking_id: t.booking_id,
        booking_status: booking?.booking_status ?? 'Draft',
        client_name: booking ? (clientName.get(booking.client_id) ?? '—') : '—',
        pickup: placeName.get(t.place_of_pickup_id) ?? '—',
        delivery: placeName.get(t.place_of_delivery_id) ?? '—',
        status: t.itinerary_status ?? 'Awaiting',
        trip_date_from: t.trip_date_from,
        trip_start_at: t.trip_start_at,
        trip_end_at: t.trip_end_at,
        plate_number: t.plate_number,
        trailer_plate: t.trailer_id !== null ? (trailerPlate.get(t.trailer_id) ?? `Trailer #${t.trailer_id}`) : null,
        driver: crewName(t.itinerary_id, 'Driver'),
        helper: crewName(t.itinerary_id, 'Helper'),
        document_count: docCount.get(t.itinerary_id) ?? 0,
        storage_deadline: booking?.storage_deadline ?? null,
      }
    }),
    error: null,
  }
}
