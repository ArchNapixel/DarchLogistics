// capacity: the "Capacity Check" rules -- can we run a quote's trips with
// the drivers, trucks and trailers we have, and if not, what is the earliest
// start we can? Plain functions (no Supabase) so the staff Review Quote card,
// the client quote form and the self-check (scripts/check-capacity.ts) all
// use the same logic.
//
// A resource (driver / truck / trailer) is free for a slot when none of its
// busy windows overlap it. Busy windows come from the loader: other trips'
// slots (an overdue trip on the road stays busy until delivered), approved
// leave, open work orders / maintenance due, and tentative holds for quotes
// already offered but not accepted yet. Back-to-back is fine (one window
// ending 12 NN, the next starting 12 NN).
//
// A quote's trips run back to back ('chain', one after another from the
// start) or as many at once as we have the people / vehicles for ('parallel',
// storage-deadline bookings: the rest wait for a free one -- waves -- and
// the quote only runs late if the last trip ends after the deadline). Each
// trip needs one driver, one truck and one trailer of its type (Skeletal /
// Flatbed; null = any; a container may also use the other of the two, see
// trailerRules.ts). Helpers are optional and not counted. In a chain
// the same driver / truck / trailer are kept from trip to trip when free,
// otherwise any free one is used.
//
// Times are epoch ms. Advisory only: staff can still send an offer that
// doesn't fit.
//
// 2026-10-31: planTrips() at the bottom is the new time-window rule (every
// trip as early as possible, many drivers at once, fairness by pesos, truck
// follows the driver, one-hop swaps). The chain / parallel functions above it
// still drive the screens until they switch over (Phase 2), then go.

import { trailerAllowed, trailerRank } from './trailerRules.ts'
import { hoursLate, manilaWeek } from './tripSchedule.ts'

export type ResourceKind = 'Driver' | 'Truck' | 'Trailer'

export type BusyWindow = {
  start: number
  end: number
  // Why it's busy, for the staff card ("Trip #97", "On leave", "Held by Quote #61").
  reason: string
  // A quote that was offered but not accepted yet.
  tentative?: boolean
  // Set when the window is a booked trip (planTrips reads those from PlanWorld.booked instead).
  tripId?: number | null
}

export type Resource = {
  id: string
  kind: ResourceKind
  // Name or plate (staff only -- the client RPC sends anonymous ids).
  label: string
  // Trailers only: 'Skeletal' / 'Flatbed'.
  trailerType?: string | null
  // Drivers only: the id of his assigned truck (employees.assigned_plate_number), if any.
  truckId?: string | null
  busy: BusyWindow[]
}

// cargoType ('Container' / 'Loose') decides which trailers may stand in for
// the asked type (lib/trailerRules.ts). rate = the trip's own rate, for the
// driver's earnings (planTrips fairness); left out = only the per-trip fee counts.
export type TripNeed = { hours: number; trailerType: string | null; cargoType?: string | null; rate?: number | null }

export type Demand = {
  trips: TripNeed[]
  mode: 'chain' | 'parallel'
  // The start the client asked for (pickup date + default start, or now).
  requestedStart: number
  // End of the deadline day (when the client needs the cargo), or null.
  deadlineEnd: number | null
  // Offers carry a pickup DATE and trips start at the default start time that
  // day. Set this (minutes after midnight, Manila) and later starts are tried
  // once per day at that time; leave it out to try every 30 minutes.
  dayStartMinutes?: number
}

export type Placement = {
  start: number
  end: number
  driver: Resource
  truck: Resource
  trailer: Resource
}

export type Shortage = { kind: ResourceKind; trailerType: string | null; tripIndex: number }

export type CapacityResult =
  // Runs as asked.
  | { status: 'fits'; start: number; placements: Placement[] }
  // Runs, but from a later start: before the deadline ('later') or after it ('late').
  | { status: 'later' | 'late'; start: number; placements: Placement[]; shortageAtRequested: Shortage }
  // Nothing free in the whole search window.
  | { status: 'none'; shortageAtRequested: Shortage }

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
// Start times are tried every 30 minutes.
export const STEP_MS = 30 * 60_000
// How far past the deadline (or the requested start, if no deadline) to look.
export const SEARCH_DAYS_PAST_DEADLINE = 14

// Is the resource free for the whole of [start, end)?
export function isFree(resource: Resource, start: number, end: number): boolean {
  return resource.busy.every((w) => w.end <= start || w.start >= end)
}

// Each trip's slot for a given start.
export function tripSlots(demand: Pick<Demand, 'trips' | 'mode'>, start: number): { start: number; end: number }[] {
  let at = start
  return demand.trips.map((trip) => {
    const length = trip.hours * HOUR_MS
    const slot = { start: demand.mode === 'parallel' ? start : at, end: (demand.mode === 'parallel' ? start : at) + length }
    at += length
    return slot
  })
}

// Try to cover every trip starting at `start`. Returns the placements, or
// the first thing that ran out. In parallel mode a trip that finds nothing
// free at the start waits for the next wave (when one of this demand's own
// earlier trips ends) -- `delayed` is what first held it back.
export function placeAt(
  demand: Pick<Demand, 'trips' | 'mode'>,
  resources: Resource[],
  start: number,
): { placements: Placement[]; delayed?: Shortage } | { shortage: Shortage } {
  const slots = tripSlots(demand, start)
  // Windows taken by this demand's own earlier trips (parallel trips can't share).
  const taken = new Map<string, { start: number; end: number }[]>()
  const freeHere = (r: Resource, s: number, e: number) =>
    isFree(r, s, e) && (taken.get(r.id) ?? []).every((w) => w.end <= s || w.start >= e)
  const pick = (
    kind: ResourceKind,
    s: number,
    e: number,
    previous: Resource | undefined,
    trailerType: string | null = null,
    cargoType: string | null = null,
  ) => {
    const fits = (r: Resource) =>
      r.kind === kind && (kind !== 'Trailer' || trailerAllowed(cargoType, trailerType, r.trailerType)) && freeHere(r, s, e)
    if (previous && fits(previous)) return previous
    const free = resources.filter(fits)
    // Trailers: the preferred type first (a container goes on a Skeletal before a Flatbed).
    if (kind === 'Trailer') free.sort((a, b) => trailerRank(cargoType, a.trailerType) - trailerRank(cargoType, b.trailerType))
    return free[0]
  }

  const placements: Placement[] = []
  let delayed: Shortage | undefined
  for (let i = 0; i < slots.length; i++) {
    const { trailerType, cargoType, hours } = demand.trips[i]
    const prev = demand.mode === 'chain' ? placements[i - 1] : undefined
    // Chain: its one slot. Parallel: the start, then each time an earlier trip ends.
    const tryStarts =
      demand.mode === 'parallel' ? [...new Set([start, ...placements.map((p) => p.end)])].sort((a, b) => a - b) : [slots[i].start]
    let shortage: Shortage | undefined
    let placed = false
    for (const s of tryStarts) {
      const e = s + hours * HOUR_MS
      const driver = pick('Driver', s, e, prev?.driver)
      const truck = driver && pick('Truck', s, e, prev?.truck)
      const trailer = truck && pick('Trailer', s, e, prev?.trailer, trailerType, cargoType ?? null)
      if (!driver || !truck || !trailer) {
        shortage ??= !driver
          ? { kind: 'Driver', trailerType: null, tripIndex: i }
          : !truck
            ? { kind: 'Truck', trailerType: null, tripIndex: i }
            : { kind: 'Trailer', trailerType, tripIndex: i }
        continue
      }
      for (const r of [driver, truck, trailer]) taken.set(r.id, [...(taken.get(r.id) ?? []), { start: s, end: e }])
      placements.push({ start: s, end: e, driver, truck, trailer })
      if (s !== start) delayed ??= shortage
      placed = true
      break
    }
    if (!placed) return { shortage: shortage! }
  }
  return { placements, delayed }
}

const MANILA_OFFSET_MS = 8 * HOUR_MS

// Manila midnight of the day `at` falls on.
export const manilaMidnight = (at: number) => Math.floor((at + MANILA_OFFSET_MS) / DAY_MS) * DAY_MS - MANILA_OFFSET_MS

// The starts to try after the requested one, earliest first.
function* laterStarts(demand: Demand, searchUntil: number): Generator<number> {
  if (demand.dayStartMinutes === undefined) {
    for (let start = demand.requestedStart + STEP_MS; start <= searchUntil; start += STEP_MS) yield start
    return
  }
  const first = manilaMidnight(demand.requestedStart) + demand.dayStartMinutes * 60_000
  for (let start = first; start <= searchUntil; start += DAY_MS) if (start > demand.requestedStart) yield start
}

// The Capacity Check: run as asked, or the earliest start that works.
export function checkCapacity(demand: Demand, resources: Resource[]): CapacityResult {
  if (demand.trips.length === 0) return { status: 'fits', start: demand.requestedStart, placements: [] }
  const atRequested = placeAt(demand, resources, demand.requestedStart)
  const lastEnd = (ps: Placement[]) => Math.max(...ps.map((p) => p.end))
  const inTime = (ps: Placement[]) => demand.deadlineEnd === null || lastEnd(ps) <= demand.deadlineEnd
  // Trips that had to wait for a free trailer / truck / driver (waves) still
  // fit as long as the last one ends by the deadline.
  if ('placements' in atRequested && (!atRequested.delayed || inTime(atRequested.placements))) {
    return { status: 'fits', start: demand.requestedStart, placements: atRequested.placements }
  }
  const shortage = 'shortage' in atRequested ? atRequested.shortage : atRequested.delayed!

  const searchUntil = (demand.deadlineEnd ?? demand.requestedStart) + SEARCH_DAYS_PAST_DEADLINE * DAY_MS
  for (const start of laterStarts(demand, searchUntil)) {
    const tried = placeAt(demand, resources, start)
    if ('placements' in tried) {
      const ok = inTime(tried.placements)
      // A later start that is still late is no better than waves from the requested one.
      if (!ok && 'placements' in atRequested) continue
      return { status: ok ? 'later' : 'late', start, placements: tried.placements, shortageAtRequested: shortage }
    }
  }
  // Waves from the requested start finish after the deadline: still the earliest.
  if ('placements' in atRequested) {
    return { status: 'late', start: demand.requestedStart, placements: atRequested.placements, shortageAtRequested: shortage }
  }
  return { status: 'none', shortageAtRequested: shortage }
}

// "No driver free", "No Skeletal trailer free" -- for the card and the client.
export function shortageLabel(shortage: Shortage): string {
  if (shortage.kind === 'Trailer') return `No ${shortage.trailerType ? `${shortage.trailerType} ` : ''}trailer free`
  return `No ${shortage.kind.toLowerCase()} free`
}

// Tentative holds: place quotes that were offered but not accepted yet,
// oldest first, and mark what they would use as busy (tentative). A quote
// that can't be placed holds nothing.
export function withTentativeHolds(
  resources: Resource[],
  offers: { label: string; demand: Pick<Demand, 'trips' | 'mode'>; start: number }[],
): Resource[] {
  let current = resources
  for (const offer of offers) {
    const placed = placeAt(offer.demand, current, offer.start)
    if (!('placements' in placed)) continue
    const holds = new Map<string, BusyWindow[]>()
    for (const p of placed.placements) {
      for (const r of [p.driver, p.truck, p.trailer]) {
        holds.set(r.id, [...(holds.get(r.id) ?? []), { start: p.start, end: p.end, reason: `Held by ${offer.label}`, tentative: true }])
      }
    }
    current = current.map((r) => (holds.has(r.id) ? { ...r, busy: [...r.busy, ...holds.get(r.id)!] } : r))
  }
  return current
}

// Booked trips that don't have their driver / truck / trailer picked yet
// still need one each for their slot. Give each such trip one free resource
// of every kind it's missing (the right trailer type), earliest trip first,
// and mark it busy -- otherwise a new quote would look like it fits on
// trucks that are already spoken for.
export type UnassignedTrip = {
  itinerary_id: number
  start: number
  end: number
  trailerType: string | null
  cargoType?: string | null
  needs: ResourceKind[]
}

export function withUnassignedTrips(resources: Resource[], trips: UnassignedTrip[]): Resource[] {
  const current = resources.map((r) => ({ ...r, busy: [...r.busy] }))
  for (const trip of [...trips].sort((a, b) => a.start - b.start)) {
    for (const kind of trip.needs) {
      const free = current.find(
        (r) =>
          r.kind === kind &&
          (kind !== 'Trailer' || trailerAllowed(trip.cargoType, trip.trailerType, r.trailerType)) &&
          isFree(r, trip.start, trip.end),
      )
      // Nothing free: that trip is already short (the board shows it) -- holds nothing.
      if (free) free.busy.push({ start: trip.start, end: trip.end, reason: `Trip #${trip.itinerary_id} (not assigned yet)` })
    }
  }
  return current
}

// The Capacity card's breakdown: for drivers, trucks and each trailer type
// the quote needs -- how many it needs at once, how many we have, how many
// are free at the requested time, and (when short) the earliest start from
// which enough are free. need > have = the fleet is too small for this
// quote on ANY date (e.g. 3 side-by-side trips, 2 Skeletal trailers).
export type KindAvailability = {
  kind: ResourceKind
  trailerType: string | null
  need: number
  have: number
  freeAtRequested: number
  earliestFree: number | null
}

export function availabilityBreakdown(demand: Demand, resources: Resource[]): KindAvailability[] {
  if (demand.trips.length === 0) return []
  const slots = tripSlots(demand, demand.requestedStart)
  const groups: { kind: ResourceKind; trailerType: string | null; cargoType?: string | null; tripIndexes: number[] }[] = [
    { kind: 'Driver', trailerType: null, tripIndexes: demand.trips.map((_, i) => i) },
    { kind: 'Truck', trailerType: null, tripIndexes: demand.trips.map((_, i) => i) },
  ]
  // Containers share one Flatbed-or-Skeletal pool; loose cargo asks for its own type.
  const trailerGroup = (t: TripNeed) => (t.cargoType === 'Container' ? 'Flatbed or Skeletal' : t.trailerType)
  for (const type of [...new Set(demand.trips.map(trailerGroup))]) {
    const tripIndexes = demand.trips.flatMap((t, i) => (trailerGroup(t) === type ? [i] : []))
    groups.push({ kind: 'Trailer', trailerType: type, cargoType: demand.trips[tripIndexes[0]].cargoType, tripIndexes })
  }
  const searchUntil = (demand.deadlineEnd ?? demand.requestedStart) + SEARCH_DAYS_PAST_DEADLINE * DAY_MS
  return groups.map((g) => {
    const pool = resources.filter(
      (r) =>
        r.kind === g.kind &&
        (g.kind !== 'Trailer' ||
          (g.trailerType === 'Flatbed or Skeletal'
            ? trailerAllowed('Container', 'Flatbed', r.trailerType)
            : trailerAllowed(g.cargoType, g.trailerType, r.trailerType))),
    )
    // Side by side, every trip needs its own; back to back, one at a time.
    const need = demand.mode === 'parallel' ? g.tripIndexes.length : 1
    // This group's first trip: its slot relative to the start.
    const first = slots[g.tripIndexes[0]]
    const offset = first.start - demand.requestedStart
    const length = first.end - first.start
    const freeAt = (start: number) => pool.filter((r) => isFree(r, start + offset, start + offset + length)).length
    const freeAtRequested = freeAt(demand.requestedStart)
    let earliestFree: number | null = freeAtRequested >= need ? demand.requestedStart : null
    if (earliestFree === null && need <= pool.length) {
      for (let start = demand.requestedStart + STEP_MS; start <= searchUntil; start += STEP_MS) {
        if (freeAt(start) >= need) {
          earliestFree = start + offset
          break
        }
      }
    }
    return { kind: g.kind, trailerType: g.trailerType, need, have: pool.length, freeAtRequested, earliestFree }
  })
}

// ---------------------------------------------------------------------------
// planTrips: the time-window rule (2026-10-31).
//
// Each trip, in order, goes to the earliest moment from the start when a
// driver, a truck for him and a trailer of an allowed type are all free for
// the trip's hours. Several drivers can run trips at the same time; a trip
// can fill a gap between other bookings. Among the drivers free at that
// moment the one who has earned least that Sun-Sat week (driver commission %
// x trip rate + per-trip fee, the payslip.ts formula; delivered, on the road
// and planned trips) gets it -- fewer trips, then name, break a tie.
//
// Truck follows the driver: his own (Resource.truckId) when it's free, else
// a spare (a truck no driver has) -- never another driver's truck.
//
// Swaps: when no driver is free at a moment the trailer is, a driver whose
// only clash is ONE booked trip still Awaiting may take the new trip while
// that trip goes to another free driver. Only used when it lets the new trip
// start sooner, and a booked trip is swapped at most once.
// ponytail: one-hop swaps only (no chains), drivers only (trailers aren't
// swapped) -- search deeper if it ever misses a real fit.
//
// Booked trips with no driver / truck / trailer yet hold one free of each
// missing kind first, earliest trip first (same idea as withUnassignedTrips).
// ---------------------------------------------------------------------------

// A booked trip from the database. Awaiting ones may be swapped; the rest are
// fixed. Delivered ones only count toward earnings.
export type BookedTrip = {
  id: number
  status: string
  start: number
  end: number
  driverId: string | null
  truckId: string | null
  trailerId: string | null
  trailerType: string | null
  cargoType: string | null
  // Staff only (null for clients).
  rate: number | null
}

export type PayRule = { commissionRate: number; perTripFee: number }

export type PlanWorld = {
  // Drivers (with truckId), trucks, trailers. Busy = leave, shop, holds -- not booked trips.
  resources: Resource[]
  booked: BookedTrip[]
  // null (clients): fairness falls back to trip count.
  pay: PayRule | null
  // Nothing is known past this (end of the loaded window): no trip may end after it.
  horizon: number
}

export type PlanDemand = { trips: TripNeed[]; requestedStart: number; deadlineEnd: number | null }

export type PlannedTrip = { start: number; end: number; driverId: string; truckId: string; spareTruck: boolean; trailerId: string }

// Booked trip `itineraryId` moves from one driver (and his truck) to another.
export type PlanSwap = { itineraryId: number; fromDriverId: string; toDriverId: string; fromTruckId: string | null; toTruckId: string }

export type TripPlan = {
  // fits = last trip ends by the deadline (or no deadline); late = after it;
  // none = some trip can't be placed before the horizon (trips = the ones that could).
  status: 'fits' | 'late' | 'none'
  trips: PlannedTrip[]
  swaps: PlanSwap[]
  lastEnd: number | null
  hoursLate: number
  doneByDeadline: number
  driversUsed: number
  // 'none' only: what ran out at the requested start; missing = we own none at all.
  shortage: (Shortage & { missing: boolean }) | null
}

type Taken = { start: number; end: number; tripId?: number | null }

export function planTrips(demand: PlanDemand, world: PlanWorld, opts: { swaps?: boolean } = {}): TripPlan {
  const allowSwaps = opts.swaps ?? true
  const drivers = world.resources.filter((r) => r.kind === 'Driver')
  const trucks = world.resources.filter((r) => r.kind === 'Truck')
  const trailers = world.resources.filter((r) => r.kind === 'Trailer')
  const ownedTrucks = new Set(drivers.flatMap((d) => (d.truckId ? [d.truckId] : [])))
  const spares = trucks.filter((t) => !ownedTrucks.has(t.id))
  const truckById = new Map(trucks.map((t) => [t.id, t]))

  // Every window each resource is taken: its busy windows + booked trips.
  const taken = new Map<string, Taken[]>()
  const take = (id: string | null, w: Taken) => {
    if (id) taken.set(id, [...(taken.get(id) ?? []), w])
  }
  const release = (id: string | null, tripId: number) => {
    if (id) taken.set(id, (taken.get(id) ?? []).filter((w) => w.tripId !== tripId))
  }
  for (const r of world.resources) for (const b of r.busy) take(r.id, { start: b.start, end: b.end })
  const booked = world.booked.map((t) => ({ ...t }))
  const live = booked.filter((t) => t.status !== 'Delivered')
  for (const t of live) for (const id of [t.driverId, t.truckId, t.trailerId]) take(id, { start: t.start, end: t.end, tripId: t.id })

  // Free for [s, e), optionally not counting one booked trip.
  const free = (id: string, s: number, e: number, ignoreTrip?: number) =>
    (taken.get(id) ?? []).every((w) => w.end <= s || w.start >= e || (ignoreTrip !== undefined && w.tripId === ignoreTrip))
  const truckFor = (d: Resource, s: number, e: number, ignoreTrip?: number) => {
    const own = d.truckId ? truckById.get(d.truckId) : undefined
    if (own && free(own.id, s, e, ignoreTrip)) return { truck: own, spare: false }
    const spare = spares.find((t) => free(t.id, s, e))
    return spare ? { truck: spare, spare: true } : null
  }
  const trailerFor = (s: number, e: number, trailerType: string | null, cargoType: string | null) =>
    trailers
      .filter((r) => trailerAllowed(cargoType, trailerType, r.trailerType) && free(r.id, s, e))
      .sort((a, b) => trailerRank(cargoType, a.trailerType) - trailerRank(cargoType, b.trailerType))[0]

  // Booked trips missing a driver / truck / trailer hold one free of each.
  for (const t of [...live].sort((a, b) => a.start - b.start)) {
    const hold = { start: t.start, end: t.end }
    const driver = t.driverId ? undefined : drivers.find((d) => free(d.id, t.start, t.end))
    if (driver) take(driver.id, hold)
    if (!t.truckId) {
      // The (held or assigned) driver's truck, else a spare.
      const withDriver = driver ?? drivers.find((d) => d.id === t.driverId)
      const truck = withDriver ? truckFor(withDriver, t.start, t.end)?.truck : spares.find((r) => free(r.id, t.start, t.end))
      if (truck) take(truck.id, hold)
    }
    if (!t.trailerId) {
      const trailer = trailerFor(t.start, t.end, t.trailerType, t.cargoType)
      if (trailer) take(trailer.id, hold)
    }
  }

  // Earnings per driver per week (key "driverId|week start").
  const pay = (rate: number | null | undefined) => (world.pay ? (world.pay.commissionRate / 100) * (rate ?? 0) + world.pay.perTripFee : 0)
  const earned = new Map<string, { pesos: number; trips: number }>()
  const earnedBy = (driverId: string, at: number) => earned.get(`${driverId}|${manilaWeek(at).from}`) ?? { pesos: 0, trips: 0 }
  const addEarning = (driverId: string, at: number, rate: number | null | undefined, sign = 1) => {
    const was = earnedBy(driverId, at)
    earned.set(`${driverId}|${manilaWeek(at).from}`, { pesos: was.pesos + sign * pay(rate), trips: was.trips + sign })
  }
  for (const t of booked) if (t.driverId) addEarning(t.driverId, t.start, t.rate)
  const fairest = (at: number) => (a: Resource, b: Resource) => {
    const ea = earnedBy(a.id, at)
    const eb = earnedBy(b.id, at)
    return ea.pesos - eb.pesos || ea.trips - eb.trips || a.label.localeCompare(b.label)
  }

  const placed: PlannedTrip[] = []
  const swaps: PlanSwap[] = []
  let shortage: TripPlan['shortage'] = null

  for (let i = 0; i < demand.trips.length; i++) {
    const need = demand.trips[i]
    const length = need.hours * HOUR_MS
    const cargoType = need.cargoType ?? null
    // Moments worth trying: the start, and every time something frees up.
    const ends = [...taken.values()].flat().map((w) => w.end)
    const moments = [...new Set([demand.requestedStart, ...ends.filter((end) => end > demand.requestedStart)])].sort((a, b) => a - b)

    let done = false
    for (const s of moments) {
      const e = s + length
      if (e > world.horizon) break
      const trailer = trailerFor(s, e, need.trailerType, cargoType)
      if (!trailer) continue
      let driver: Resource | undefined = drivers.filter((d) => free(d.id, s, e) && truckFor(d, s, e)).sort(fairest(s))[0]

      if (!driver && allowSwaps) {
        // A driver blocked only by one Awaiting booked trip, which another driver can take.
        for (const d of [...drivers].sort(fairest(s))) {
          const clashes = (taken.get(d.id) ?? []).filter((w) => w.start < e && w.end > s)
          const trip = clashes.length === 1 ? live.find((t) => t.id === clashes[0].tripId) : undefined
          if (!trip || trip.status !== 'Awaiting' || swaps.some((w) => w.itineraryId === trip.id)) continue
          if (!truckFor(d, s, e, trip.id)) continue
          const other = drivers
            .filter((o) => o.id !== d.id && free(o.id, trip.start, trip.end) && truckFor(o, trip.start, trip.end))
            .sort(fairest(trip.start))[0]
          if (!other) continue
          const otherTruck = truckFor(other, trip.start, trip.end)!.truck
          // Move the booked trip to the other driver (and his truck).
          release(d.id, trip.id)
          release(trip.truckId, trip.id)
          take(other.id, { start: trip.start, end: trip.end, tripId: trip.id })
          take(otherTruck.id, { start: trip.start, end: trip.end, tripId: trip.id })
          addEarning(d.id, trip.start, trip.rate, -1)
          addEarning(other.id, trip.start, trip.rate)
          swaps.push({ itineraryId: trip.id, fromDriverId: d.id, toDriverId: other.id, fromTruckId: trip.truckId, toTruckId: otherTruck.id })
          trip.driverId = other.id
          trip.truckId = otherTruck.id
          driver = d
          break
        }
      }
      const unit = driver ? truckFor(driver, s, e) : null
      if (!driver || !unit) continue

      const slot = { start: s, end: e }
      take(driver.id, slot)
      take(unit.truck.id, slot)
      take(trailer.id, slot)
      addEarning(driver.id, s, need.rate)
      placed.push({ ...slot, driverId: driver.id, truckId: unit.truck.id, spareTruck: unit.spare, trailerId: trailer.id })
      done = true
      break
    }

    if (!done) {
      const s = demand.requestedStart
      const e = s + length
      const kind: ResourceKind = !drivers.some((d) => free(d.id, s, e))
        ? 'Driver'
        : !drivers.some((d) => free(d.id, s, e) && truckFor(d, s, e))
          ? 'Truck'
          : 'Trailer'
      const missing =
        kind === 'Driver'
          ? drivers.length === 0
          : kind === 'Truck'
            ? trucks.length === 0
            : !trailers.some((r) => trailerAllowed(cargoType, need.trailerType, r.trailerType))
      shortage = { kind, trailerType: kind === 'Trailer' ? need.trailerType : null, tripIndex: i, missing }
      break
    }
  }

  const lastEnd = placed.length ? Math.max(...placed.map((p) => p.end)) : null
  const late = lastEnd !== null ? hoursLate(lastEnd, demand.deadlineEnd) : 0
  return {
    status: shortage ? 'none' : late > 0 ? 'late' : 'fits',
    trips: placed,
    swaps,
    lastEnd,
    hoursLate: late,
    doneByDeadline: placed.filter((p) => demand.deadlineEnd === null || p.end <= demand.deadlineEnd).length,
    driversUsed: new Set(placed.map((p) => p.driverId)).size,
    shortage,
  }
}

// Offers waiting for the client's answer hold what planTrips would give them
// (oldest first, no swaps -- those are only made on Accept): their drivers,
// trucks and trailers get tentative busy windows.
export function withPlannedHolds(world: PlanWorld, offers: { label: string; demand: PlanDemand }[]): PlanWorld {
  let current = world
  for (const offer of offers) {
    const plan = planTrips(offer.demand, current, { swaps: false })
    const holds = new Map<string, BusyWindow[]>()
    for (const p of plan.trips) {
      for (const id of [p.driverId, p.truckId, p.trailerId]) {
        holds.set(id, [...(holds.get(id) ?? []), { start: p.start, end: p.end, reason: `Held by ${offer.label}`, tentative: true }])
      }
    }
    current = { ...current, resources: current.resources.map((r) => (holds.has(r.id) ? { ...r, busy: [...r.busy, ...holds.get(r.id)!] } : r)) }
  }
  return current
}
