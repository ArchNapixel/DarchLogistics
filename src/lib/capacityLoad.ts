// capacityLoad: gets what the Capacity Check (lib/capacity.ts) needs from the
// database and turns a quote into the "demand" it checks. One read-only
// database function does the reading for everyone, staff and clients alike
// (get_capacity_inputs, SQL given in chat): it returns only busy windows --
// names, plates and reasons are filled in for staff only, so a client's
// browser never learns who or what is booked.
import { supabase } from './supabaseClient'
import { manilaTimestamp } from './format'
import { offerTiming } from './offerTiming'
import { toManilaDate } from './payslip'
import { expandCargoLines, parseCargoLines } from './quoteRequest'
import {
  DAY_MS,
  HOUR_MS,
  SEARCH_DAYS_PAST_DEADLINE,
  STEP_MS,
  manilaMidnight,
  withPlannedHolds,
  withTentativeHolds,
  withUnassignedTrips,
  type BookedTrip,
  type BusyWindow,
  type Demand,
  type PlanWorld,
  type Resource,
} from './capacity'

// trip_id: the window is a booked trip (planTrips reads those from `trips` instead).
type RawBusy = { start: number; end: number; reason: string | null; trip_id?: number | null }
// truck: drivers only, his assigned_plate_number.
type RawResource = { id: string | number; label: string | null; trailer_type?: string | null; truck?: string | null; busy: RawBusy[] }
type RawTrip = {
  itinerary_id: number
  status: string
  start: number
  end: number
  driver_id: number | null
  truck: string | null
  trailer_id: number | null
  trailer_type: string | null
  cargo_type: string | null
  // Staff only.
  rate: number | null
}
type RawOffer = {
  quote_id: number
  label: string
  pickup_date: string
  hours: number
  storage: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cargo_lines: any
}
type RawInputs = {
  drivers: RawResource[]
  trucks: RawResource[]
  trailers: RawResource[]
  offers: RawOffer[]
  // Booked trips still missing a driver / truck / trailer.
  // cargo_type: only if the SQL function returns it (else a container trip is held to its asked trailer type).
  unassigned?: { itinerary_id: number; start: number; end: number; trailer_type: string | null; cargo_type?: string | null; needs: Resource['kind'][] }[]
  default_start_minutes: number
  // Every trip not Cancelled from the start of the window's first payroll week
  // (delivered ones too -- they count toward the week's earnings). Optional
  // until the SQL that adds it is run.
  trips?: RawTrip[]
  // Staff only: driver_commission_rate (%) and driver_per_trip_fee.
  pay?: { commission_rate: number | null; per_trip_fee: number | null } | null
}

// Settings' default trip start (8 AM) when the row can't be read -- the same
// fallback as create_booking_from_quote.
const FALLBACK_START_MINUTES = 480

export type CapacityInputs = {
  // Everyone / everything that could take a trip, tentative holds included.
  resources: Resource[]
  // The same for planTrips (lib/capacity.ts): booked trips kept apart from busy
  // windows so the planner knows which ones it may swap. Offers held, unassigned
  // trips are handled inside planTrips.
  world: PlanWorld
  defaultStartMinutes: number
}

// What the quote needs. `hours` is the booking's hours per trip (staff
// enter it; a client's estimate assumes DEFAULT_HOURS_PER_TRIP).
// ponytail: a client's estimate assumes 6 h per trip because the real
// figure comes from staff pricing; the staff card uses the entered hours.
export const DEFAULT_HOURS_PER_TRIP = 6

export function buildDemand(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cargoLines: any
  hours: number
  pickupDate: string
  deadlineDate: string | null
  // Last free storage day: all trips at the same time.
  storage: boolean
  defaultStartMinutes: number
  now?: number
}): Demand {
  const now = args.now ?? Date.now()
  const trips = expandCargoLines(parseCargoLines(args.cargoLines)).map((t) => ({
    hours: args.hours,
    trailerType: t.trailer_type,
    cargoType: t.cargo_type,
  }))
  const dayStart = new Date(manilaTimestamp(args.pickupDate, args.defaultStartMinutes)).getTime()
  // Pickup today and the start time already passed: start from the next half hour.
  const requestedStart = dayStart < now ? Math.ceil(now / STEP_MS) * STEP_MS : dayStart
  return {
    trips,
    mode: args.storage ? 'parallel' : 'chain',
    requestedStart,
    deadlineEnd: args.deadlineDate ? new Date(manilaTimestamp(args.deadlineDate, 24 * 60)).getTime() - 1 : null,
    dayStartMinutes: args.defaultStartMinutes,
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
  truckId: r.truck ? `T${r.truck}` : null,
  busy: r.busy.map((b): BusyWindow => ({ start: b.start, end: b.end, reason: b.reason ?? 'Busy', tripId: b.trip_id ?? null })),
})

// Load the resources for a demand. `excludeQuoteId` leaves out that quote's
// own tentative hold (the quote being looked at shouldn't block itself).
// Resolves to an error message instead of throwing.
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
  const defaultStartMinutes = Number(raw.default_start_minutes) || FALLBACK_START_MINUTES
  const resources = [
    ...raw.drivers.map(toResource('Driver', 'D', 'A driver')),
    ...raw.trucks.map(toResource('Truck', 'T', 'A truck')),
    ...raw.trailers.map(toResource('Trailer', 'R', 'A trailer')),
  ]
  // Offers sent but not accepted yet hold their slot, oldest first.
  const today = toManilaDate(new Date())
  const holds = raw.offers
    // An offer past its pickup date can't be accepted any more -- it holds nothing.
    .filter((o) => offerTiming(o.pickup_date, today) === 'open')
    .map((o) => {
      const trips = expandCargoLines(parseCargoLines(o.cargo_lines)).map((t) => ({ hours: o.hours, trailerType: t.trailer_type, cargoType: t.cargo_type }))
      return {
        label: o.label,
        demand: { trips, mode: (o.storage ? 'parallel' : 'chain') as Demand['mode'] },
        start: new Date(manilaTimestamp(o.pickup_date, defaultStartMinutes)).getTime(),
      }
    })
    .filter((o) => o.demand.trips.length > 0)
  // Booked trips with nothing picked yet hold one first, then the offers.
  const booked = withUnassignedTrips(
    resources,
    (raw.unassigned ?? []).map((t) => ({ itinerary_id: t.itinerary_id, start: t.start, end: t.end, trailerType: t.trailer_type, cargoType: t.cargo_type, needs: t.needs })),
  )

  // planTrips' view: busy windows without the booked trips (those come from
  // `trips`, so the planner knows which it may swap), offers held as planned.
  const trips: BookedTrip[] = (raw.trips ?? []).map((t) => ({
    id: t.itinerary_id,
    status: t.status,
    start: t.start,
    end: t.end,
    driverId: t.driver_id === null ? null : `D${t.driver_id}`,
    truckId: t.truck === null ? null : `T${t.truck}`,
    trailerId: t.trailer_id === null ? null : `R${t.trailer_id}`,
    trailerType: t.trailer_type,
    cargoType: t.cargo_type,
    rate: t.rate,
  }))
  const pay = raw.pay ? { commissionRate: Number(raw.pay.commission_rate) || 0, perTripFee: Number(raw.pay.per_trip_fee) || 0 } : null
  const world = withPlannedHolds(
    {
      resources: resources.map((r) => ({ ...r, busy: r.busy.filter((b) => b.tripId == null) })),
      booked: trips,
      pay,
      horizon: to,
    },
    holds.map((o) => ({ label: o.label, demand: { trips: o.demand.trips, requestedStart: o.start, deadlineEnd: null } })),
  )
  return { inputs: { resources: withTentativeHolds(booked, holds), world, defaultStartMinutes }, error: null }
}
