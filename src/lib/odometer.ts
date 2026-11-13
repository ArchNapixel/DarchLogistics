// odometer: the truck odometer log (truck_odometer_log) -- what PMS counts
// on. Rules (legs, which trips are still uncounted) live in
// lib/odometerRules.ts; this file loads, routes and saves.
//
// Writes go ONLY through two SQL functions (the table has no write
// policies):
//  - record_trip_km (Admin/Dispatcher): adds one delivered trip's km.
//    Called by MarkDeliveredModal right after a delivery, and from Truck
//    Monitoring for any trip that wasn't counted.
//  - record_odometer_reading (Admin): the real reading off the dashboard.
// Any other change to truck_profiles.current_odometer (e.g. a mechanic's
// reading at work order completion) is logged by a DB trigger as 'edit'.
import { supabase } from './supabaseClient'
import { fetchAll } from './dashboardExpenses'
import { fetchDrivingDistanceKm, geocodePlace } from './geocoding'
import { goesHome, tripLegs, uncountedTrips, type DeliveredTrip } from './odometerRules'
import { DEFAULT_PMS_DUE_SOON_KM, DEFAULT_PMS_INTERVAL_KM, type PmsSettings } from './pms'

// The two PMS settings (Settings page); defaults if a row is missing --
// the same fallbacks the pms_auto_schedule trigger uses.
export async function loadPmsSettings(): Promise<PmsSettings> {
  const { data } = await supabase
    .from('app_settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['pms_interval_km', 'pms_due_soon_km'])
  const value = (key: string) => data?.find((row) => row.setting_key === key)?.setting_value
  return {
    intervalKm: Number(value('pms_interval_km') ?? DEFAULT_PMS_INTERVAL_KM),
    dueSoonKm: Number(value('pms_due_soon_km') ?? DEFAULT_PMS_DUE_SOON_KM),
  }
}

// Where every truck starts and ends its day.
const BASE = { city: 'Panabo City', barangay: 'J.P. Laurel' }

type Stop = { placeId: number | null; city: string | null; barangay: string | null; lat: number | null; lng: number | null }

async function pointOf(stop: Stop): Promise<{ lat: number; lon: number } | null> {
  if (typeof stop.lat === 'number' && typeof stop.lng === 'number') return { lat: stop.lat, lon: stop.lng }
  if (!stop.city || !stop.barangay) return null
  return geocodePlace(`Barangay ${stop.barangay}, ${stop.city}, Philippines`)
}

// Driving km between two stops: a route_cache distance for the barangay
// pair if there is one, else routed (pin, or barangay centre). Null when
// it can't be worked out.
async function legKm(a: Stop, b: Stop): Promise<number | null> {
  if (a.placeId !== null && b.placeId !== null) {
    if (a.placeId === b.placeId && a.lat === null && b.lat === null) return 0
    const [low, high] = [a.placeId, b.placeId].sort((x, y) => x - y)
    const { data: cached } = await supabase
      .from('route_cache')
      .select('distance_km')
      .eq('place_id_a', low)
      .eq('place_id_b', high)
      .maybeSingle()
    if (cached?.distance_km != null) return Number(cached.distance_km)
  }
  try {
    const from = await pointOf(a)
    const to = from ? await pointOf(b) : null
    if (!from || !to) return null
    return await fetchDrivingDistanceKm(from, to)
  } catch {
    return null
  }
}

type BookingStops = {
  booking_id: number
  estimated_distance_km: number | null
  place_of_pickup_id: number | null
  pickup_lat: number | null
  pickup_lng: number | null
  place_of_delivery_id: number | null
  delivery_lat: number | null
  delivery_lng: number | null
}

export type TripKmEstimate = { plate: string; out: number; trip: number; back: number; total: number; notes: string[] }

// Works out one delivered trip's km (see odometerRules for the rule).
export async function estimateTripKm(itineraryId: number): Promise<TripKmEstimate | { error: string }> {
  const { data: trip, error: tripError } = await supabase
    .from('itineraries')
    .select('itinerary_id, booking_id, plate_number')
    .eq('itinerary_id', itineraryId)
    .maybeSingle()
  if (tripError) return { error: tripError.message }
  if (!trip?.plate_number) return { error: `Trip #${itineraryId} has no truck.` }
  const plate: string = trip.plate_number

  const [deliveredResult, prevResult, othersResult, baseResult] = await Promise.all([
    supabase
      .from('dispatch_status_logs')
      .select('status_changed_at')
      .eq('itinerary_id', itineraryId)
      .eq('new_status', 'Delivered')
      .order('status_changed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The truck's previous counted trip: did it end away from base?
    supabase
      .from('truck_odometer_log')
      .select('itinerary_id, back_km')
      .eq('plate_number', plate)
      .eq('source', 'trip')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The truck's open trips: is it going straight on to one?
    supabase
      .from('itineraries')
      .select('trip_start_at')
      .eq('plate_number', plate)
      .neq('itinerary_id', itineraryId)
      .not('itinerary_status', 'in', '(Delivered,Cancelled)')
      .not('trip_start_at', 'is', null),
    supabase.from('places').select('place_id').ilike('city', BASE.city).ilike('barangay', BASE.barangay).maybeSingle(),
  ])
  const loadError = deliveredResult.error ?? prevResult.error ?? othersResult.error ?? baseResult.error
  if (loadError) return { error: loadError.message }

  const deliveredMs = deliveredResult.data ? Date.parse(deliveredResult.data.status_changed_at) : Date.now()
  const prev = prevResult.data && Number(prevResult.data.back_km) === 0 ? prevResult.data : null

  // This trip's booking, plus the previous trip's when the drive out starts there.
  let prevBookingId: number | null = null
  if (prev?.itinerary_id) {
    const { data } = await supabase.from('itineraries').select('booking_id').eq('itinerary_id', prev.itinerary_id).maybeSingle()
    prevBookingId = data?.booking_id ?? null
  }
  const { data: bookings, error: bookingError } = await supabase
    .from('bookings')
    .select('booking_id, estimated_distance_km, place_of_pickup_id, pickup_lat, pickup_lng, place_of_delivery_id, delivery_lat, delivery_lng')
    .in('booking_id', prevBookingId !== null ? [trip.booking_id, prevBookingId] : [trip.booking_id])
  if (bookingError) return { error: bookingError.message }
  const byId = new Map((bookings as BookingStops[]).map((b) => [b.booking_id, b]))
  const booking = byId.get(trip.booking_id)
  const tripKm = Number(booking?.estimated_distance_km ?? 0)
  if (!booking || !tripKm) {
    return { error: `Booking #${trip.booking_id} has no trip distance. Enter a real reading for ${plate} instead.` }
  }
  const prevBooking = prevBookingId !== null ? byId.get(prevBookingId) : undefined

  const placeIds = [booking.place_of_pickup_id, booking.place_of_delivery_id, prevBooking?.place_of_delivery_id ?? null].filter(
    (id): id is number => id !== null,
  )
  const { data: places } = await supabase.from('places').select('place_id, city, barangay').in('place_id', placeIds)
  const placeById = new Map((places ?? []).map((p) => [p.place_id, p]))
  const stop = (placeId: number | null, lat: number | null, lng: number | null): Stop => ({
    placeId,
    city: placeId !== null ? (placeById.get(placeId)?.city ?? null) : null,
    barangay: placeId !== null ? (placeById.get(placeId)?.barangay ?? null) : null,
    lat,
    lng,
  })
  const base: Stop = { placeId: baseResult.data?.place_id ?? null, city: BASE.city, barangay: BASE.barangay, lat: null, lng: null }
  const pickup = stop(booking.place_of_pickup_id, booking.pickup_lat, booking.pickup_lng)
  const delivery = stop(booking.place_of_delivery_id, booking.delivery_lat, booking.delivery_lng)
  const from = prevBooking ? stop(prevBooking.place_of_delivery_id, prevBooking.delivery_lat, prevBooking.delivery_lng) : base

  const home = goesHome(
    deliveredMs,
    (othersResult.data ?? []).map((t) => Date.parse(t.trip_start_at as string)),
  )
  const outKm = await legKm(from, pickup)
  const backKm = home ? await legKm(delivery, base) : null
  const legs = tripLegs({ outKm, tripKm, backKm, home })
  if (prevBooking) legs.notes.unshift(`From trip #${prev!.itinerary_id}'s delivery spot`)
  return { plate, ...legs }
}

// Estimates a delivered trip's km and adds them to its truck's odometer.
export async function recordTripKm(
  itineraryId: number,
): Promise<(TripKmEstimate & { reading: number }) | { error: string }> {
  const estimate = await estimateTripKm(itineraryId)
  if ('error' in estimate) return estimate
  const { data, error } = await supabase.rpc('record_trip_km', {
    p_itinerary_id: itineraryId,
    p_out_km: estimate.out,
    p_trip_km: estimate.trip,
    p_back_km: estimate.back,
    p_note: estimate.notes.join('; ') || null,
  })
  if (error) return { error: error.message }
  return { ...estimate, reading: Number(data) }
}

// The real reading off the truck's dashboard (Admin). Can be lower than
// the estimate, never lower than the last real reading.
export async function recordOdometerReading(plate: string, reading: number, note: string): Promise<string | null> {
  const { error } = await supabase.rpc('record_odometer_reading', {
    p_plate_number: plate,
    p_reading: reading,
    p_note: note.trim() || null,
  })
  return error?.message ?? null
}

// Delivered trips not on the odometer yet, oldest first.
export async function loadUncountedTrips(): Promise<{ trips: DeliveredTrip[]; error: string | null }> {
  const log = await fetchAll<{ plate_number: string; source: string; itinerary_id: number | null; recorded_at: string }>(
    (from, to) =>
      supabase
        .from('truck_odometer_log')
        .select('plate_number, source, itinerary_id, recorded_at')
        .order('log_id', { ascending: true })
        .range(from, to),
  )
  if (log.error) return { trips: [], error: log.error }
  const realTimes = log.rows.filter((e) => e.source !== 'trip').map((e) => e.recorded_at).sort()
  if (realTimes.length === 0) return { trips: [], error: null }

  const [itineraries, deliveries] = await Promise.all([
    fetchAll<{ itinerary_id: number; plate_number: string }>((from, to) =>
      supabase
        .from('itineraries')
        .select('itinerary_id, plate_number')
        .eq('itinerary_status', 'Delivered')
        .not('plate_number', 'is', null)
        .order('itinerary_id', { ascending: true })
        .range(from, to),
    ),
    // Only deliveries since the oldest starting reading can still count.
    fetchAll<{ itinerary_id: number; status_changed_at: string }>((from, to) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .eq('new_status', 'Delivered')
        .gte('status_changed_at', realTimes[0])
        .order('status_changed_at', { ascending: true })
        .order('itinerary_id', { ascending: true })
        .range(from, to),
    ),
  ])
  const loadError = itineraries.error ?? deliveries.error
  if (loadError) return { trips: [], error: loadError }

  // Oldest first, so the map keeps each trip's LATEST delivery time.
  const deliveredAt = new Map(deliveries.rows.map((d) => [d.itinerary_id, d.status_changed_at]))
  const trips = itineraries.rows.flatMap((t) => {
    const at = deliveredAt.get(t.itinerary_id)
    return at ? [{ itinerary_id: t.itinerary_id, plate_number: t.plate_number, delivered_at: at }] : []
  })
  return { trips: uncountedTrips(trips, log.rows), error: null }
}

export type OdometerLogEntry = {
  log_id: number
  plate_number: string
  source: 'opening' | 'trip' | 'reading' | 'edit'
  reading: number
  km_added: number | null
  itinerary_id: number | null
  out_km: number | null
  trip_km: number | null
  back_km: number | null
  note: string | null
  recorded_at: string
}

export const ODOMETER_SOURCE_LABELS: Record<OdometerLogEntry['source'], string> = {
  opening: 'Starting reading',
  trip: 'Trip',
  reading: 'Real reading',
  edit: 'Changed elsewhere',
}

export async function loadOdometerLog(limit = 50): Promise<{ entries: OdometerLogEntry[]; error: string | null }> {
  const { data, error } = await supabase
    .from('truck_odometer_log')
    .select('log_id, plate_number, source, reading, km_added, itinerary_id, out_km, trip_km, back_km, note, recorded_at')
    .order('recorded_at', { ascending: false })
    .order('log_id', { ascending: false })
    .limit(limit)
  if (error) return { entries: [], error: error.message }
  return {
    entries: (data ?? []).map((e) => ({
      ...e,
      reading: Number(e.reading),
      km_added: e.km_added === null ? null : Number(e.km_added),
      out_km: e.out_km === null ? null : Number(e.out_km),
      trip_km: e.trip_km === null ? null : Number(e.trip_km),
      back_km: e.back_km === null ? null : Number(e.back_km),
    })) as OdometerLogEntry[],
    error: null,
  }
}
