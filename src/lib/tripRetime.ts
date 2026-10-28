// tripRetime: when a trip is Delivered earlier (or later) than planned, its
// slot ends at the real delivery time and the DRIVER's next trips follow
// straight after it -- across all his bookings, see flowAfterDelivery() in
// tripSchedule.ts for the rules (a trip whose pickup date hasn't come yet is
// skipped, a trip that runs into it pushes it later). The booking's own later
// trips (any crew) stay back to back, each keeping its own length (the "# of
// hours"). E.g. a 6 AM-12 NN trip delivered at 9:32 AM becomes 6 AM-9:32 AM,
// and the driver's next trip becomes 9:32 AM-3:32 PM. A trip run and
// delivered before its slot even started (dispatched early) gets its slot
// moved to when it really ran.
//
// Called after the Delivered status is saved. It never fails the delivery:
// it returns a warning message (or null) for the caller to show, plus a
// "will be late" message for every booking whose last trip now ends after
// its delivery-by date (the quote's Deadline date). Trips already on the road
// or delivered never move; a last-free-storage-day booking runs its trips side
// by side, so its other trips are left alone.
import { supabase } from './supabaseClient'
import { manilaTimestamp } from './format'
import { manilaMidnight } from './capacity'
import { flowAfterDelivery, hoursLate, type FlowTrip } from './tripSchedule'

const MINUTE_MS = 60_000
const ON_ROAD = ['Dispatched', 'PickedUp', 'InTransit']

export type RetimeResult = { warning: string | null; late: string[] }

type TripRow = {
  itinerary_id: number
  booking_id: number
  itinerary_status: string | null
  trip_start_at: string | null
  trip_end_at: string | null
}

const ms = (value: string) => new Date(value).getTime()

export async function retimeAfterDelivery(itineraryId: number, deliveredAt = Date.now()): Promise<RetimeResult> {
  const fail = (warning: string): RetimeResult => ({ warning, late: [] })
  const { data: trip, error } = await supabase
    .from('itineraries')
    .select('itinerary_id, booking_id, trip_start_at, trip_end_at')
    .eq('itinerary_id', itineraryId)
    .maybeSingle()
  if (error) return fail(`Couldn't re-time the later trips: ${error.message}`)
  // Trips from before time slots existed have nothing to adjust.
  if (!trip?.trip_start_at || !trip.trip_end_at) return { warning: null, late: [] }
  const start = ms(trip.trip_start_at)
  const plannedEnd = ms(trip.trip_end_at)
  // On time (within a minute): leave as is.
  if (Math.abs(deliveredAt - plannedEnd) < MINUTE_MS) return { warning: null, late: [] }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('storage_deadline')
    .eq('booking_id', trip.booking_id)
    .maybeSingle()
  if (bookingError) return fail(`Couldn't re-time the later trips: ${bookingError.message}`)

  // Run (and delivered) before its slot even started: the slot now starts
  // when it really left -- its first status change out of Awaiting in
  // dispatch_status_logs (else an hour before delivery). Saved on its own
  // first, because changing the start alone moves the end with it
  // (itinerary_slot_defaults); the end is set right after.
  if (deliveredAt <= start) {
    const { data: firstMove } = await supabase
      .from('dispatch_status_logs')
      .select('status_changed_at')
      .eq('itinerary_id', itineraryId)
      .eq('previous_status', 'Awaiting')
      .order('status_changed_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const leftAt = firstMove?.status_changed_at ? ms(firstMove.status_changed_at) : NaN
    const actualStart = leftAt < deliveredAt ? leftAt : deliveredAt - 60 * MINUTE_MS
    const { error: startError } = await supabase
      .from('itineraries')
      .update({ trip_start_at: new Date(actualStart).toISOString() })
      .eq('itinerary_id', itineraryId)
    if (startError) return fail(`Delivered, but its time slot wasn't moved: ${startError.message}`)
  }

  // This trip's slot now ends when it was really delivered.
  const { error: endError } = await supabase
    .from('itineraries')
    .update({ trip_end_at: new Date(deliveredAt).toISOString() })
    .eq('itinerary_id', itineraryId)
  if (endError) return fail(`Delivered, but its time slot wasn't shortened: ${endError.message}`)
  if (booking?.storage_deadline) return { warning: null, late: [] }

  // The driver's other trips still to start (any booking).
  const { data: crew } = await supabase
    .from('itinerary_crews')
    .select('employee_id')
    .eq('itinerary_id', itineraryId)
    .eq('crew_role', 'Driver')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  const driverId = crew?.employee_id ?? null
  let mineIds = new Set<number>()
  let mineRows: TripRow[] = []
  if (driverId !== null) {
    const { data: theirCrews, error: crewsError } = await supabase
      .from('itinerary_crews')
      .select('itinerary_id')
      .eq('employee_id', driverId)
      .eq('crew_role', 'Driver')
      .eq('is_active', true)
    if (crewsError) return fail(`Delivered, but the driver's later trips weren't moved: ${crewsError.message}`)
    const ids = (theirCrews ?? []).map((c) => c.itinerary_id).filter((id) => id !== itineraryId)
    if (ids.length > 0) {
      const { data, error: mineError } = await supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, itinerary_status, trip_start_at, trip_end_at')
        .in('itinerary_id', ids)
        .eq('itinerary_status', 'Awaiting')
        .not('trip_start_at', 'is', null)
      if (mineError) return fail(`Delivered, but the driver's later trips weren't moved: ${mineError.message}`)
      mineRows = (data ?? []) as TripRow[]
      mineIds = new Set(mineRows.map((t) => t.itinerary_id))
    }
  }

  // Every trip of the affected bookings: the later ones follow the chain, the
  // done / on-the-road ones say when each booking's earlier trips are over.
  const bookingIds = [...new Set([trip.booking_id, ...mineRows.map((t) => t.booking_id)])]
  const [tripsResult, bookingsResult] = await Promise.all([
    supabase
      .from('itineraries')
      .select('itinerary_id, booking_id, itinerary_status, trip_start_at, trip_end_at')
      .in('booking_id', bookingIds),
    supabase.from('bookings').select('booking_id, storage_deadline, quote_request_id').in('booking_id', bookingIds),
  ])
  if (tripsResult.error) return fail(`Delivered, but the later trips weren't moved: ${tripsResult.error.message}`)
  if (bookingsResult.error) return fail(`Delivered, but the later trips weren't moved: ${bookingsResult.error.message}`)
  const bookings = bookingsResult.data ?? []
  const quoteIds = bookings.flatMap((b) => (b.quote_request_id === null ? [] : [b.quote_request_id as number]))
  const quotesResult = quoteIds.length
    ? await supabase.from('quote_requests').select('quote_request_id, preferred_pickup_date, preferred_delivery_date').in('quote_request_id', quoteIds)
    : { data: [], error: null }
  if (quotesResult.error) return fail(`Delivered, but the later trips weren't moved: ${quotesResult.error.message}`)
  const quoteById = new Map((quotesResult.data ?? []).map((q) => [q.quote_request_id as number, q]))
  const bookingById = new Map(bookings.map((b) => [b.booking_id as number, b]))
  // A storage-deadline booking runs side by side -- its trips are never moved.
  const isStorage = (bookingId: number) => !!bookingById.get(bookingId)?.storage_deadline
  const allTrips = ((tripsResult.data ?? []) as TripRow[]).filter((t) => t.itinerary_status !== 'Cancelled' && !isStorage(t.booking_id))
  const now = Date.now()

  const pickupFloor = (t: TripRow) => {
    const pickup = quoteById.get(bookingById.get(t.booking_id)?.quote_request_id ?? -1)?.preferred_pickup_date
    // No quote on record: never earlier than the day the trip is planned for.
    return pickup ? ms(manilaTimestamp(pickup, 0)) : manilaMidnight(ms(t.trip_start_at!))
  }
  // Trips that may move: the driver's, plus the later Awaiting trips of those bookings.
  const movable = allTrips.filter((t) => {
    if (t.itinerary_status !== 'Awaiting' || !t.trip_start_at || !t.trip_end_at) return false
    if (mineIds.has(t.itinerary_id)) return true
    // Same booking as the delivered trip: only the ones after it in order.
    return t.booking_id !== trip.booking_id || ms(t.trip_start_at) >= plannedEnd - MINUTE_MS
  })
  const flowTrips: FlowTrip[] = movable.map((t) => ({
    itinerary_id: t.itinerary_id,
    booking_id: t.booking_id,
    start: ms(t.trip_start_at!),
    end: ms(t.trip_end_at!),
    notBefore: pickupFloor(t),
    mine: mineIds.has(t.itinerary_id),
  }))
  // When each booking's earlier trips are over (delivered, or still on the road).
  const bookingFloor = new Map<number, number>()
  for (const t of allTrips) {
    if (t.itinerary_status === 'Awaiting' || !t.trip_end_at || t.itinerary_id === itineraryId) continue
    const over = ON_ROAD.includes(t.itinerary_status ?? '') ? Math.max(ms(t.trip_end_at), now) : ms(t.trip_end_at)
    bookingFloor.set(t.booking_id, Math.max(bookingFloor.get(t.booking_id) ?? -Infinity, over))
  }
  const slots = flowAfterDelivery(deliveredAt, trip.booking_id, flowTrips, bookingFloor)

  // Save the ones that changed. Moving earlier goes first trip first, moving
  // later last trip first, so a moved trip never overlaps a neighbour of its own
  // on the same driver / truck (the database refuses that). Stops at the first
  // refusal and says which trip and why.
  const changes = movable
    .map((t) => ({ t, slot: slots.get(t.itinerary_id)! }))
    .filter(({ t, slot }) => Math.abs(slot.start - ms(t.trip_start_at!)) >= MINUTE_MS || Math.abs(slot.end - ms(t.trip_end_at!)) >= MINUTE_MS)
  const earlier = changes.filter(({ t, slot }) => slot.start < ms(t.trip_start_at!)).sort((a, b) => a.slot.start - b.slot.start)
  const later = changes.filter(({ t, slot }) => slot.start >= ms(t.trip_start_at!)).sort((a, b) => b.slot.start - a.slot.start)
  let warning: string | null = null
  const saved = new Map<number, { start: number; end: number }>()
  for (const { t, slot } of [...earlier, ...later]) {
    // Only while still Awaiting, and check a row really changed.
    const { data: moved, error: moveError } = await supabase
      .from('itineraries')
      .update({ trip_start_at: new Date(slot.start).toISOString(), trip_end_at: new Date(slot.end).toISOString() })
      .eq('itinerary_id', t.itinerary_id)
      .eq('itinerary_status', 'Awaiting')
      .select('itinerary_id')
      .maybeSingle()
    if (moveError || !moved) {
      warning = `Delivered, but trip #${t.itinerary_id} couldn't move to its new time (${moveError ? moveError.message : 'no longer Awaiting'}). The trips after it kept their old time -- fix this one on the Dispatch Board.`
      break
    }
    saved.set(t.itinerary_id, slot)
  }

  // Will any booking now finish after its delivery-by date? Counted on what
  // is really saved, over every trip still to run.
  const late: string[] = []
  for (const bookingId of bookingIds) {
    const quote = quoteById.get(bookingById.get(bookingId)?.quote_request_id ?? -1)
    if (!quote?.preferred_delivery_date) continue
    const ends = allTrips
      .filter((t) => t.booking_id === bookingId && t.trip_end_at)
      .map((t) => saved.get(t.itinerary_id)?.end ?? ms(t.trip_end_at!))
    const hours = hoursLate(Math.max(...ends), ms(manilaTimestamp(quote.preferred_delivery_date, 24 * 60)) - 1)
    if (hours > 0) late.push(`Booking #${bookingId} will be late by ${hours} h at the current pace (delivery-by ${quote.preferred_delivery_date}). Speed up the remaining trips.`)
  }
  return { warning, late }
}
