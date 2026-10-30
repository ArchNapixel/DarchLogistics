// capacity: the "Capacity Check" rules -- can we run a quote's trips with
// the drivers, trucks and trailers we have, and when would the last one end?
// Plain functions (no Supabase) so the staff Review Quote card, the client
// quote form and the self-check (scripts/check-capacity.ts) all use the same
// logic. The loading is in capacityLoad.ts.
//
// Rule (2026-10-31, replaced the old chain / parallel check): each trip needs
// one driver (with his truck) and one trailer of an allowed type for its
// hours, and the same driver can do the next trip as soon as this one ends --
// a 10-trip booking needs 10 trip slots, not 10 drivers. planTrips() below
// has the details. Busy windows come from the loader: approved leave, licence
// expiry, the shop / work orders / service due, and tentative holds for
// offers not answered yet; booked trips come separately (PlanWorld.booked).
// Back-to-back is fine (one window ending 12 NN, the next starting 12 NN).
//
// Times are epoch ms. Advisory only: staff can still send an offer that
// doesn't fit.

import { trailerAllowed, trailerRank } from './trailerRules.ts'
import { hoursLate, manilaWeek } from './tripSchedule.ts'

export type ResourceKind = 'Driver' | 'Truck' | 'Trailer'

export type BusyWindow = {
  start: number
  end: number
  // Why it's busy, for staff ("Trip #97", "On leave", "Held by Quote #61").
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
  // The first moment a trip may start (pickup date + default start, or the
  // next half hour when that has passed).
  requestedStart: number
  // End of the deadline day (11:59 PM), or null.
  deadlineEnd: number | null
}

export type Shortage = { kind: ResourceKind; trailerType: string | null; tripIndex: number }

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
// "Now" is rounded up to the next half hour.
export const STEP_MS = 30 * 60_000
// How far past the deadline (or the requested start, if no deadline) to look.
export const SEARCH_DAYS_PAST_DEADLINE = 14

const MANILA_OFFSET_MS = 8 * HOUR_MS

// Manila midnight of the day `at` falls on.
export const manilaMidnight = (at: number) => Math.floor((at + MANILA_OFFSET_MS) / DAY_MS) * DAY_MS - MANILA_OFFSET_MS

// "No driver free", "No Skeletal trailer free" -- for the card and the client.
export function shortageLabel(shortage: Shortage): string {
  if (shortage.kind === 'Trailer') return `No ${shortage.trailerType ? `${shortage.trailerType} ` : ''}trailer free`
  return `No ${shortage.kind.toLowerCase()} free`
}

// The Capacity card's result, passed up to Review Quote: the plan plus its
// driver changes in words ("Trip #130: Juan -> Pedro").
export type CapacityCheck = { plan: TripPlan; swapLines: string[] }

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
// missing kind first, earliest trip first, so a new quote never looks like it
// fits on trucks that are already spoken for.
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

export function planTrips(demand: Demand, world: PlanWorld, opts: { swaps?: boolean } = {}): TripPlan {
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
export function withPlannedHolds(world: PlanWorld, offers: { label: string; demand: Demand }[]): PlanWorld {
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
