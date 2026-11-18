// capacityLoad: gets what the Capacity Check (lib/capacity.ts) needs from the
// database and turns a quote into the "demand" it checks. One read-only
// database function does the reading for everyone, staff and clients alike
// (get_capacity_inputs, SQL given in chat): busy windows and booked trips --
// names, plates, reasons and trip rates are filled in for staff only, so a
// client's browser never learns who is booked or what they earn.
import { supabase } from './supabaseClient'
import { manilaTimestamp } from './format'
import { DEFAULT_OFFER_EXPIRY_DAYS, offerTiming } from './offerTiming'
import { toManilaDate } from './payslip'
import { earliestStart } from './tripSchedule'
import { expandCargoLines, parseCargoLines } from './quoteRequest'
import {
  DAY_MS,
  HOUR_MS,
  SEARCH_DAYS_PAST_DEADLINE,
  STEP_MS,
  isAtRisk,
  manilaMidnight,
  replanTrips,
  withPlannedHolds,
  type BookedTrip,
  type BusyWindow,
  type Demand,
  type PlanWorld,
  type Replan,
  type Resource,
  type TripPlan,
} from './capacity'

// trip_id: the window is a booked trip (planTrips reads those from `trips` instead).
type RawBusy = { start: number; end: number; reason: string | null; trip_id?: number | null }
// truck: drivers only, his assigned_plate_number.
// trailer_size: trailers only, once get_capacity_inputs returns it (2026-11-13 SQL).
type RawResource = {
  id: string | number
  label: string | null
  trailer_type?: string | null
  trailer_size?: string | null
  truck?: string | null
  busy: RawBusy[]
}
type RawTrip = {
  itinerary_id: number
  status: string
  start: number
  end: number
  driver_id: number | null
  truck: string | null
  trailer_id: number | null
  trailer_type: string | null
  // The trip's asked size (itineraries.container_type), once the SQL returns it.
  container_type?: string | null
  // itineraries.exact_trailer_size, once the SQL returns it.
  exact_trailer_size?: boolean | null
  cargo_type: string | null
  // Staff only.
  rate: number | null
}
type RawOffer = {
  quote_id: number
  label: string
  pickup_date: string
  hours: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cargo_lines: any
}
type RawInputs = {
  drivers: RawResource[]
  trucks: RawResource[]
  trailers: RawResource[]
  offers: RawOffer[]
  default_start_minutes: number
  // Every trip not Cancelled from the start of the window's first payroll week
  // (delivered ones too -- they count toward the week's earnings).
  trips?: RawTrip[]
  // Staff only: driver_commission_rate (%) and driver_per_trip_fee.
  pay?: { commission_rate: number | null; per_trip_fee: number | null } | null
}

// Settings' default trip start (8 AM) when the row can't be read -- the same
// fallback as create_booking_from_quote.
const FALLBACK_START_MINUTES = 480

export type CapacityInputs = {
  // Everyone / everything that could take a trip and the trips already booked,
  // with offers waiting for an answer held (withPlannedHolds).
  world: PlanWorld
  defaultStartMinutes: number
}

// What the quote needs. `hours` is the booking's hours per trip (staff
// enter it; a client's estimate assumes Settings ->
// availability_hours_per_trip, see QuoteAvailabilityNote).
// ponytail: new trips carry no rate, so within one quote fairness counts only
// the per-trip fee for them -- pass the line rates if that ever matters.

export function buildDemand(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cargoLines: any
  hours: number
  pickupDate: string
  deadlineDate: string | null
  defaultStartMinutes: number
  now?: number
}): Demand {
  const now = args.now ?? Date.now()
  const trips = expandCargoLines(parseCargoLines(args.cargoLines)).map((t) => ({
    hours: args.hours,
    trailerType: t.trailer_type,
    trailerSize: t.container_type,
    exactSize: t.exact_trailer_size,
    cargoType: t.cargo_type,
  }))
  const dayStart = new Date(manilaTimestamp(args.pickupDate, args.defaultStartMinutes)).getTime()
  // Pickup today and the start time already passed: start from the next half hour.
  const requestedStart = dayStart < now ? Math.ceil(now / STEP_MS) * STEP_MS : dayStart
  return {
    trips,
    requestedStart,
    deadlineEnd: args.deadlineDate ? new Date(manilaTimestamp(args.deadlineDate, 24 * 60)).getTime() - 1 : null,
  }
}

// The plan as send_quote_offer / accept_quote_counter save it
// (quote_requests.trip_plan, one entry per trip in cargo-line order);
// create_booking_from_quote books the trips and makes the swaps from it.
// Resource ids are "D12" / "TABC 1234" / "R3" (see toResource).
export function tripPlanForDb(plan: TripPlan) {
  const rest = (id: string) => id.slice(1)
  return {
    trips: plan.trips.map((t) => ({
      start: new Date(t.start).toISOString(),
      end: new Date(t.end).toISOString(),
      driver_id: Number(rest(t.driverId)),
      plate_number: rest(t.truckId),
      trailer_id: Number(rest(t.trailerId)),
    })),
    swaps: plan.swaps.map((s) => ({ itinerary_id: s.itineraryId, driver_id: Number(rest(s.toDriverId)), plate_number: rest(s.toTruckId) })),
  }
}

// How far the busy windows have to reach for this demand.
function windowFor(demand: Demand) {
  const hours = demand.trips.reduce((sum, t) => sum + t.hours, 0)
  const searchUntil = (demand.deadlineEnd ?? demand.requestedStart) + SEARCH_DAYS_PAST_DEADLINE * DAY_MS
  return { from: manilaMidnight(demand.requestedStart), to: searchUntil + hours * HOUR_MS + DAY_MS }
}

const toResource = (kind: Resource['kind'], prefix: string, fallback: string) => (r: RawResource): Resource => ({
  id: `${prefix}${r.id}`,
  kind,
  label: r.label ?? fallback,
  trailerType: r.trailer_type ?? null,
  trailerSize: r.trailer_size ?? null,
  truckId: r.truck ? `T${r.truck}` : null,
  busy: r.busy.map((b): BusyWindow => ({ start: b.start, end: b.end, reason: b.reason ?? 'Busy', tripId: b.trip_id ?? null })),
})

// Load what planTrips needs for a demand. `excludeQuoteId` leaves out that
// quote's own tentative hold (the quote being looked at shouldn't block
// itself). Resolves to an error message instead of throwing.
export async function loadCapacityInputs(
  demand: Demand,
  excludeQuoteId: number | null,
): Promise<{ inputs: CapacityInputs | null; error: string | null }> {
  const { from, to } = windowFor(demand)
  const { data, error } = await supabase.rpc('get_capacity_inputs', {
    p_from: new Date(from).toISOString(),
    p_to: new Date(to).toISOString(),
    p_exclude_quote: excludeQuoteId,
  })
  if (error || !data) return { inputs: null, error: error?.message ?? 'No data' }
  const raw = data as RawInputs
  if (!raw.trips) return { inputs: null, error: 'the database function needs updating (get_capacity_inputs has no trips list)' }
  const defaultStartMinutes = Number(raw.default_start_minutes) || FALLBACK_START_MINUTES
  // Busy windows without the booked trips -- those come from `trips`, so the
  // planner knows which ones it may swap.
  // Deactivated trucks / trailers (is_active = false) are not part of the fleet.
  // get_capacity_inputs still lists them, so they're dropped here. Clients can't
  // read these tables (empty answer = nothing dropped) -- their note is advisory.
  const [offTrucks, offTrailers] = await Promise.all([
    supabase.from('truck_profiles').select('plate_number').eq('is_active', false),
    supabase.from('trailers').select('trailer_id').eq('is_active', false),
  ])
  const off = new Set([
    ...(offTrucks.data ?? []).map((t) => `T${t.plate_number}`),
    ...(offTrailers.data ?? []).map((t) => `R${t.trailer_id}`),
  ])
  const resources = [
    ...raw.drivers.map(toResource('Driver', 'D', 'A driver')),
    ...raw.trucks.map(toResource('Truck', 'T', 'A truck')),
    ...raw.trailers.map(toResource('Trailer', 'R', 'A trailer')),
  ]
    .filter((r) => !off.has(r.id))
    .map((r) => ({ ...r, busy: r.busy.filter((b) => b.tripId == null) }))
  const booked: BookedTrip[] = raw.trips.map((t) => ({
    id: t.itinerary_id,
    status: t.status,
    start: t.start,
    end: t.end,
    driverId: t.driver_id === null ? null : `D${t.driver_id}`,
    truckId: t.truck === null ? null : `T${t.truck}`,
    trailerId: t.trailer_id === null ? null : `R${t.trailer_id}`,
    trailerType: t.trailer_type,
    trailerSize: t.container_type ?? null,
    exactSize: t.exact_trailer_size ?? false,
    cargoType: t.cargo_type,
    rate: t.rate,
  }))
  const pay = raw.pay ? { commissionRate: Number(raw.pay.commission_rate) || 0, perTripFee: Number(raw.pay.per_trip_fee) || 0 } : null

  // Offers sent but not accepted yet hold their slots, oldest first.
  const today = toManilaDate(new Date())
  const holds = raw.offers
    // An offer past its pickup date can't be accepted any more -- it holds
    // nothing. ('open' doesn't depend on the expiry days.)
    .filter((o) => offerTiming(o.pickup_date, today, DEFAULT_OFFER_EXPIRY_DAYS) === 'open')
    .map((o) => ({
      label: o.label,
      demand: {
        trips: expandCargoLines(parseCargoLines(o.cargo_lines)).map((t) => ({ hours: o.hours, trailerType: t.trailer_type, trailerSize: t.container_type, exactSize: t.exact_trailer_size, cargoType: t.cargo_type })),
        requestedStart: new Date(manilaTimestamp(o.pickup_date, defaultStartMinutes)).getTime(),
        deadlineEnd: null,
      },
    }))
    .filter((o) => o.demand.trips.length > 0)

  const world = withPlannedHolds({ resources, booked, pay, horizon: to }, holds)
  return { inputs: { world, defaultStartMinutes }, error: null }
}

// Re-plan waiting trips (Booking Detail, Schedule Overview): where the
// planner puts the booking's Awaiting trips now (replanTrips). scope
// 'blocked' = only trips whose driver / truck / trailer is blocked (isAtRisk);
// 'all' = every waiting trip, spread again over whoever is free -- e.g. after
// a truck comes back from the shop. Earliest start = the next half hour, never
// before the booking's pickup date + default start; deadline = the quote's
// delivery-by date. Staff only.
export type ReplanScope = 'blocked' | 'all'
export type ReplanLoad = {
  // One plan per scope, so switching is instant.
  replans: Record<ReplanScope, Replan>
  labels: Map<string, string>
  deadlineEnd: number | null
  waiting: number
  blocked: number
}

export async function loadReplan(
  bookingId: number,
  now = Date.now(),
): Promise<{ data: ReplanLoad | null; error: string | null }> {
  const fail = (error: string) => ({ data: null, error })
  const [tripsResult, bookingResult] = await Promise.all([
    supabase
      .from('itineraries')
      .select('itinerary_id, trip_start_at, trip_end_at')
      .eq('booking_id', bookingId)
      .eq('itinerary_status', 'Awaiting')
      .not('trip_start_at', 'is', null),
    supabase.from('bookings').select('quote_request_id, early_start_allowed_at').eq('booking_id', bookingId).maybeSingle(),
  ])
  if (tripsResult.error) return fail(tripsResult.error.message)
  if (bookingResult.error) return fail(bookingResult.error.message)
  const tripRows = tripsResult.data ?? []
  let pickup: string | null = null
  let deadline: string | null = null
  if (bookingResult.data?.quote_request_id != null) {
    const { data: quote, error } = await supabase
      .from('quote_requests')
      .select('preferred_pickup_date, preferred_delivery_date')
      .eq('quote_request_id', bookingResult.data.quote_request_id)
      .maybeSingle()
    if (error) return fail(error.message)
    pickup = quote?.preferred_pickup_date ?? null
    deadline = quote?.preferred_delivery_date ?? null
  }
  const deadlineEnd = deadline ? new Date(manilaTimestamp(deadline, 24 * 60)).getTime() - 1 : null
  const nextHalfHour = Math.ceil(now / STEP_MS) * STEP_MS
  // How far to read: from the next half hour (or the first trip, if earlier)
  // to past the deadline or the last trip.
  const starts = tripRows.map((t) => Date.parse(t.trip_start_at!))
  const ends = tripRows.map((t) => Date.parse(t.trip_end_at!))
  const reach: Demand = {
    trips: tripRows.map((t) => ({ hours: (Date.parse(t.trip_end_at!) - Date.parse(t.trip_start_at!)) / HOUR_MS, trailerType: null })),
    requestedStart: Math.min(nextHalfHour, ...starts),
    deadlineEnd: Math.max(deadlineEnd ?? 0, ...ends),
  }
  const { inputs, error } = await loadCapacityInputs(reach, null)
  if (!inputs) return fail(error ?? 'No data')
  // Not before the start date (pickup date + default start), unless an Admin allowed an early start.
  const from = earliestStart(now, pickup, inputs.defaultStartMinutes, bookingResult.data?.early_start_allowed_at != null)
  const ids = new Set(tripRows.map((t) => t.itinerary_id))
  const waiting = inputs.world.booked.filter((t) => ids.has(t.id) && t.status === 'Awaiting')
  const blocked = waiting.filter((t) => isAtRisk(t, inputs.world.resources))
  return {
    data: {
      replans: {
        blocked: replanTrips(inputs.world, blocked, from, deadlineEnd),
        all: replanTrips(inputs.world, waiting, from, deadlineEnd),
      },
      labels: new Map(inputs.world.resources.map((r) => [r.id, r.label])),
      deadlineEnd,
      waiting: waiting.length,
      blocked: blocked.length,
    },
    error: null,
  }
}

// Saves a re-plan in one transaction (replan_booking_trips): new time, driver,
// truck and trailer per moved trip. Returns the error message, or null.
export async function saveReplan(bookingId: number, moves: Replan['moves']): Promise<string | null> {
  const rest = (id: string) => id.slice(1)
  const { error } = await supabase.rpc('replan_booking_trips', {
    p_booking_id: bookingId,
    p_trips: moves.map(({ trip, to }) => ({
      itinerary_id: trip.id,
      start: new Date(to.start).toISOString(),
      end: new Date(to.end).toISOString(),
      driver_id: Number(rest(to.driverId)),
      plate_number: rest(to.truckId),
      trailer_id: Number(rest(to.trailerId)),
    })),
  })
  return error?.message ?? null
}

// Schedule Overview's Re-plan picker: every booking with waiting (Awaiting)
// trips, and how many of them are blocked (isAtRisk -- driver on leave /
// licence expired, truck or trailer in the shop until solved).
export type WaitingBooking = { bookingId: number; waiting: number; blocked: number }

export async function loadWaitingBookings(): Promise<{ data: WaitingBooking[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('itineraries')
    .select('itinerary_id, booking_id, trip_start_at, trip_end_at')
    .eq('itinerary_status', 'Awaiting')
    .not('trip_start_at', 'is', null)
    .not('trip_end_at', 'is', null)
  if (error) return { data: [], error: error.message }
  if (!rows || rows.length === 0) return { data: [], error: null }
  const bookingOf = new Map(rows.map((r) => [r.itinerary_id, r.booking_id]))
  // Read from the first trip's day to past the last one.
  const reach: Demand = {
    trips: [],
    requestedStart: Math.min(...rows.map((r) => Date.parse(r.trip_start_at!))),
    deadlineEnd: Math.max(...rows.map((r) => Date.parse(r.trip_end_at!))),
  }
  const { inputs, error: loadError } = await loadCapacityInputs(reach, null)
  if (!inputs) return { data: [], error: loadError ?? 'No data' }
  const byBooking = new Map<number, WaitingBooking>()
  for (const t of inputs.world.booked) {
    const bookingId = bookingOf.get(t.id)
    if (bookingId === undefined || t.status !== 'Awaiting') continue
    const entry = byBooking.get(bookingId) ?? { bookingId, waiting: 0, blocked: 0 }
    entry.waiting++
    if (isAtRisk(t, inputs.world.resources)) entry.blocked++
    byBooking.set(bookingId, entry)
  }
  return { data: [...byBooking.values()].sort((x, y) => x.bookingId - y.bookingId), error: null }
}
