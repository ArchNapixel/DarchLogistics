// tripRetime: saves the cascade (reflow() in tripSchedule.ts) when a trip's
// slot changes, for three screens:
//   - Mark Delivered (retimeAfterDelivery): the trip's slot ends at the real
//     delivery time; e.g. a 6 AM-12 NN trip delivered at 9:32 AM becomes
//     6 AM-9:32 AM. One run and delivered before its slot even started
//     (dispatched early) gets its slot moved to when it really ran.
//   - Edit time (EditTripTimeModal): the trip's new start / end.
//   - Hours per trip (BookingDetailModal): every Awaiting trip of the booking
//     gets the new length.
// The trips after it in its driver's, truck's and trailer's lines (any
// booking) then start the moment the one before them ends -- earlier or
// later than planned -- never before their booking's pickup date + default
// start and never inside leave / shop time. Trips past Awaiting never move.
//
// It never fails the caller's own save: it returns a warning (or null), the
// trip it stopped at, and a "will be late" message for every booking whose
// last trip now ends after its delivery-by date (the quote's Deadline date).
// Reads what it needs through get_capacity_inputs (trips with their driver /
// truck / trailer, leave and shop windows).
import { supabase } from './supabaseClient'
import { manilaTimestamp } from './format'
import { DAY_MS } from './capacity'
import { hoursLate, reflow, type ReflowTrip } from './tripSchedule'

const MINUTE_MS = 60_000

export type RetimeResult = {
  warning: string | null
  late: string[]
  // The trip the database refused (nothing after it in the save order was saved).
  failedTripId: number | null
}

type Slot = { start: number; end: number }
type RawTrip = { itinerary_id: number; status: string; start: number; end: number; driver_id: number | null; truck: string | null; trailer_id: number | null }
type RawResource = { id: string | number; busy: { start: number; end: number; trip_id?: number | null }[] }
type RawInputs = { drivers: RawResource[]; trucks: RawResource[]; trailers: RawResource[]; trips?: RawTrip[]; default_start_minutes: number }

const ms = (value: string) => new Date(value).getTime()

// Change these trips' slots (fixed) or lengths, cascade, save. `around` = the
// earliest time involved (where to start reading).
export async function retimeTrips(seeds: { fixed?: Map<number, Slot>; lengths?: Map<number, number> }, around: number): Promise<RetimeResult> {
  const fail = (warning: string): RetimeResult => ({ warning, late: [], failedTripId: null })
  const { data, error } = await supabase.rpc('get_capacity_inputs', {
    p_from: new Date(around - DAY_MS).toISOString(),
    p_to: new Date(around + 60 * DAY_MS).toISOString(),
    p_exclude_quote: null,
  })
  if (error || !data) return fail(`Couldn't re-time the later trips: ${error?.message ?? 'no data'}`)
  const raw = data as RawInputs
  if (!raw.trips) return fail("Couldn't re-time the later trips: the database function needs updating (get_capacity_inputs has no trips list).")

  const trips: ReflowTrip[] = raw.trips.map((t) => ({
    itinerary_id: t.itinerary_id,
    status: t.status,
    start: t.start,
    end: t.end,
    driver: t.driver_id === null ? null : `D${t.driver_id}`,
    truck: t.truck === null ? null : `T${t.truck}`,
    trailer: t.trailer_id === null ? null : `R${t.trailer_id}`,
  }))
  // Leave, shop, licence expiry per line key (trip windows come from `trips`).
  const busy = new Map<string, Slot[]>()
  const addBusy = (prefix: string) => (r: RawResource) =>
    busy.set(`${prefix}${r.id}`, r.busy.filter((b) => b.trip_id == null).map((b) => ({ start: b.start, end: b.end })))
  raw.drivers.forEach(addBusy('D'))
  raw.trucks.forEach(addBusy('T'))
  raw.trailers.forEach(addBusy('R'))

  // Bookings, pickup floors and delivery-by dates of the Awaiting trips.
  const awaitingIds = trips.filter((t) => t.status === 'Awaiting').map((t) => t.itinerary_id)
  const bookingOf = new Map<number, number>()
  const quoteOf = new Map<number, number>()
  const datesOf = new Map<number, { pickup: string | null; deadline: string | null }>()
  if (awaitingIds.length > 0) {
    const { data: rows, error: rowsError } = await supabase.from('itineraries').select('itinerary_id, booking_id').in('itinerary_id', awaitingIds)
    if (rowsError) return fail(`Couldn't re-time the later trips: ${rowsError.message}`)
    for (const r of rows ?? []) bookingOf.set(r.itinerary_id, r.booking_id)
    const bookingIds = [...new Set(bookingOf.values())]
    const { data: bookings, error: bookingsError } = await supabase.from('bookings').select('booking_id, quote_request_id').in('booking_id', bookingIds)
    if (bookingsError) return fail(`Couldn't re-time the later trips: ${bookingsError.message}`)
    for (const b of bookings ?? []) if (b.quote_request_id !== null) quoteOf.set(b.booking_id, b.quote_request_id)
    const quoteIds = [...new Set(quoteOf.values())]
    if (quoteIds.length > 0) {
      const { data: quotes, error: quotesError } = await supabase
        .from('quote_requests')
        .select('quote_request_id, preferred_pickup_date, preferred_delivery_date')
        .in('quote_request_id', quoteIds)
      if (quotesError) return fail(`Couldn't re-time the later trips: ${quotesError.message}`)
      for (const q of quotes ?? []) datesOf.set(q.quote_request_id, { pickup: q.preferred_pickup_date, deadline: q.preferred_delivery_date })
    }
  }
  const datesForTrip = (id: number) => datesOf.get(quoteOf.get(bookingOf.get(id) ?? -1) ?? -1)
  const defaultStart = Number(raw.default_start_minutes) || 480
  const floors = new Map<number, number>()
  for (const id of awaitingIds) {
    const pickup = datesForTrip(id)?.pickup
    if (pickup) floors.set(id, ms(manilaTimestamp(pickup, defaultStart)))
  }

  const slots = reflow(trips, seeds, floors, busy)
  const fixed = seeds.fixed ?? new Map<number, Slot>()
  const before = new Map(trips.map((t) => [t.itinerary_id, t]))

  // Save. Moving earlier goes first trip first, moving later last trip first,
  // so a moved trip never overlaps a neighbour on the same driver / truck /
  // trailer mid-way (the database refuses that). Stops at the first refusal.
  const changes = [...slots].map(([id, slot]) => ({ id, slot, was: before.get(id) ?? { start: slot.start, end: slot.end } }))
  const earlier = changes.filter((c) => c.slot.start < c.was.start).sort((a, b) => a.slot.start - b.slot.start)
  const later = changes.filter((c) => c.slot.start >= c.was.start).sort((a, b) => b.slot.start - a.slot.start)
  const saved = new Map<number, Slot>()
  for (const { id, slot } of [...earlier, ...later]) {
    let query = supabase
      .from('itineraries')
      .update({ trip_start_at: new Date(slot.start).toISOString(), trip_end_at: new Date(slot.end).toISOString() })
      .eq('itinerary_id', id)
    // Trips moved by the cascade: only while still Awaiting.
    if (!fixed.has(id)) query = query.eq('itinerary_status', 'Awaiting')
    const { data: moved, error: moveError } = await query.select('itinerary_id').maybeSingle()
    if (moveError || !moved) {
      const why = moveError ? moveError.message : fixed.has(id) ? 'it was not found' : 'no longer Awaiting'
      return {
        warning: `Trip #${id} couldn't move to ${new Date(slot.start).toLocaleString('en-US', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} (${why}).${
          saved.size > 0 ? ' Some trips were already moved; the rest kept their old time -- fix this one on the Dispatch Board.' : ''
        }`,
        late: [],
        failedTripId: id,
      }
    }
    saved.set(id, slot)
  }

  // Will any booking now finish after its delivery-by date? Its last Awaiting trip, as saved.
  const lastEndByBooking = new Map<number, number>()
  for (const id of awaitingIds) {
    const booking = bookingOf.get(id)
    if (booking === undefined) continue
    const end = saved.get(id)?.end ?? before.get(id)!.end
    lastEndByBooking.set(booking, Math.max(lastEndByBooking.get(booking) ?? -Infinity, end))
  }
  const touched = new Set([...saved.keys()].flatMap((id) => (bookingOf.has(id) ? [bookingOf.get(id)!] : [])))
  const late: string[] = []
  for (const booking of touched) {
    const deadline = datesOf.get(quoteOf.get(booking) ?? -1)?.deadline
    if (!deadline) continue
    const hours = hoursLate(lastEndByBooking.get(booking)!, ms(manilaTimestamp(deadline, 24 * 60)) - 1)
    if (hours > 0) late.push(`Booking #${booking} will be late by ${hours} h at the current pace (delivery-by ${deadline}).`)
  }
  return { warning: null, late, failedTripId: null }
}

// Mark Delivered: the trip's slot ends at the real delivery time, the trips after it follow.
export async function retimeAfterDelivery(itineraryId: number, deliveredAt = Date.now()): Promise<RetimeResult> {
  const none: RetimeResult = { warning: null, late: [], failedTripId: null }
  const { data: trip, error } = await supabase
    .from('itineraries')
    .select('itinerary_id, trip_start_at, trip_end_at')
    .eq('itinerary_id', itineraryId)
    .maybeSingle()
  if (error) return { ...none, warning: `Couldn't re-time the later trips: ${error.message}` }
  // Trips from before time slots existed have nothing to adjust.
  if (!trip?.trip_start_at || !trip.trip_end_at) return none
  let start = ms(trip.trip_start_at)
  // On time (within a minute): leave as is.
  if (Math.abs(deliveredAt - ms(trip.trip_end_at)) < MINUTE_MS) return none

  // Run (and delivered) before its slot even started: the slot starts when it
  // really left -- its first status change out of Awaiting (else an hour before delivery).
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
    start = leftAt < deliveredAt ? leftAt : deliveredAt - 60 * MINUTE_MS
  }
  return retimeTrips({ fixed: new Map([[itineraryId, { start, end: deliveredAt }]]) }, start)
}
