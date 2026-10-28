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

import { trailerAllowed, trailerRank } from './trailerRules.ts'

export type ResourceKind = 'Driver' | 'Truck' | 'Trailer'

export type BusyWindow = {
  start: number
  end: number
  // Why it's busy, for the staff card ("Trip #97", "On leave", "Held by Quote #61").
  reason: string
  // A quote that was offered but not accepted yet.
  tentative?: boolean
}

export type Resource = {
  id: string
  kind: ResourceKind
  // Name or plate (staff only -- the client RPC sends anonymous ids).
  label: string
  // Trailers only: 'Skeletal' / 'Flatbed'.
  trailerType?: string | null
  busy: BusyWindow[]
}

// cargoType ('Container' / 'Loose') decides which trailers may stand in for
// the asked type (lib/trailerRules.ts).
export type TripNeed = { hours: number; trailerType: string | null; cargoType?: string | null }

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
