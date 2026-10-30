// Self-check for src/lib/capacity.ts -- run with:
//   node scripts/check-capacity.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import {
  DAY_MS,
  HOUR_MS,
  availabilityBreakdown,
  checkCapacity,
  isFree,
  placeAt,
  planTrips,
  shortageLabel,
  tripSlots,
  withPlannedHolds,
  withTentativeHolds,
  withUnassignedTrips,
  type BookedTrip,
  type Demand,
  type PlanDemand,
  type PlanWorld,
  type Resource,
} from '../src/lib/capacity.ts'

const at = (s: string) => new Date(s).getTime()
const oct24 = at('2026-10-24T06:00:00+08:00')
const oct25 = at('2026-10-25T06:00:00+08:00')
const deadline26 = at('2026-10-26T23:59:00+08:00')

const driver = (id: string, busy: Resource['busy'] = []): Resource => ({ id, kind: 'Driver', label: id, busy })
const truck = (id: string, busy: Resource['busy'] = []): Resource => ({ id, kind: 'Truck', label: id, busy })
const trailer = (id: string, type: string, busy: Resource['busy'] = []): Resource => ({
  id,
  kind: 'Trailer',
  label: id,
  trailerType: type,
  busy,
})
// 5 trips x 6 h, back to back from 6 AM Oct 24 -> ends 12 NN Oct 25.
const fiveTrips: Demand = {
  trips: Array.from({ length: 5 }, () => ({ hours: 6, trailerType: 'Flatbed' })),
  mode: 'chain',
  requestedStart: oct24,
  deadlineEnd: deadline26,
}
const booking = (reason: string) => [{ start: oct24, end: oct24 + 30 * HOUR_MS, reason }]

// Slots: chain runs back to back, parallel all at once.
assert.deepEqual(tripSlots({ trips: [{ hours: 6, trailerType: null }, { hours: 2, trailerType: null }], mode: 'chain' }, 0), [
  { start: 0, end: 6 * HOUR_MS },
  { start: 6 * HOUR_MS, end: 8 * HOUR_MS },
])
assert.deepEqual(tripSlots({ trips: [{ hours: 6, trailerType: null }, { hours: 6, trailerType: null }], mode: 'parallel' }, 0), [
  { start: 0, end: 6 * HOUR_MS },
  { start: 0, end: 6 * HOUR_MS },
])

// Back-to-back windows don't clash.
assert.equal(isFree(driver('d', [{ start: 0, end: 10, reason: '' }]), 10, 20), true)
assert.equal(isFree(driver('d', [{ start: 0, end: 10, reason: '' }]), 9, 20), false)

// Plenty free -> fits as asked, same driver/truck/trailer kept down the chain.
const fleet = [truck('T1'), truck('T2'), truck('T3'), trailer('F1', 'Flatbed'), trailer('F2', 'Flatbed'), trailer('F3', 'Flatbed')]
const ok = checkCapacity(fiveTrips, [driver('D1'), ...fleet])
assert.equal(ok.status, 'fits')
if (ok.status === 'fits') assert.ok(ok.placements.every((p) => p.driver.id === 'D1' && p.truck.id === 'T1'))

// The user's scenario: Driver1 and Driver2 on bookings 1-2 (Oct 24 6 AM to
// Oct 25 12 NN), Driver3 on leave all of Oct 24 -> booking 3 starts when
// Driver3's leave ends, 12 MN Oct 25 (before the deadline -> 'later').
// With the default start time (6 AM), the suggestion lands on Oct 25 6 AM.
const leaveOct24 = [{ start: at('2026-10-24T00:00:00+08:00'), end: at('2026-10-25T00:00:00+08:00'), reason: 'On leave' }]
const scenario = checkCapacity(fiveTrips, [driver('D1', booking('Trip #1')), driver('D2', booking('Trip #6')), driver('D3', leaveOct24), ...fleet])
assert.equal(scenario.status, 'later')
if (scenario.status === 'later') {
  assert.equal(scenario.start, at('2026-10-25T00:00:00+08:00'))
  assert.equal(scenario.placements[0].driver.id, 'D3')
  assert.equal(shortageLabel(scenario.shortageAtRequested), 'No driver free')
}

const sixAm = { ...fiveTrips, dayStartMinutes: 360 }
const snapped = checkCapacity(sixAm, [driver('D1', booking('Trip #1')), driver('D2', booking('Trip #6')), driver('D3', leaveOct24), ...fleet])
assert.equal(snapped.status, 'later')
if (snapped.status === 'later') assert.equal(snapped.start, oct25)

// Nobody until after the deadline -> 'late' with the earliest start.
const awayTillOct28 = [{ start: oct24 - DAY_MS, end: at('2026-10-28T06:00:00+08:00'), reason: 'On leave' }]
const late = checkCapacity(fiveTrips, [driver('D1', awayTillOct28), ...fleet])
assert.equal(late.status, 'late')
if (late.status === 'late') assert.equal(late.start, at('2026-10-28T06:00:00+08:00'))

// Nobody at all in the search window -> 'none'.
const never = [{ start: 0, end: oct24 + 60 * DAY_MS, reason: 'Terminated' }]
assert.equal(checkCapacity(fiveTrips, [driver('D1', never), ...fleet]).status, 'none')

// Trailer type is the bottleneck: drivers free, but only a Skeletal trailer.
const noFlatbed = checkCapacity({ ...fiveTrips, trips: [{ hours: 6, trailerType: 'Flatbed' }] }, [driver('D1'), truck('T1'), trailer('S1', 'Skeletal')])
assert.equal(noFlatbed.status, 'none')
if (noFlatbed.status === 'none') assert.equal(shortageLabel(noFlatbed.shortageAtRequested), 'No Flatbed trailer free')

// A chain can hand over to another driver mid-way when the first one is busy.
const d1BusyAfterTrip2 = [{ start: oct24 + 12 * HOUR_MS, end: oct24 + 40 * HOUR_MS, reason: 'Trip #9' }]
const handover = placeAt(fiveTrips, [driver('D1', d1BusyAfterTrip2), driver('D2'), ...fleet], oct24)
assert.ok('placements' in handover)
if ('placements' in handover) assert.deepEqual(handover.placements.map((p) => p.driver.id), ['D1', 'D1', 'D2', 'D2', 'D2'])

// Parallel (storage-deadline): 2 trips at once need 2 drivers.
const parallel: Demand = { trips: [{ hours: 6, trailerType: null }, { hours: 6, trailerType: null }], mode: 'parallel', requestedStart: oct24, deadlineEnd: null }
assert.equal(checkCapacity(parallel, [driver('D1'), driver('D2'), ...fleet]).status, 'fits')
// ...with only 1 driver the 2nd trip waits for the 1st (a wave), still 'fits' with no deadline.
const oneDriver = placeAt(parallel, [driver('D1'), ...fleet], oct24)
assert.ok('placements' in oneDriver)
if ('placements' in oneDriver) assert.deepEqual(oneDriver.placements.map((p) => p.start), [oct24, oct24 + 6 * HOUR_MS])

// The 2-trips / 1-Flatbed case: waves fit before a deadline that leaves room...
const oneFlatbed = [driver('D1'), driver('D2'), truck('T1'), truck('T2'), trailer('F1', 'Flatbed')]
const twoLoose: Demand = {
  trips: [{ hours: 6, trailerType: 'Flatbed', cargoType: 'Loose' }, { hours: 6, trailerType: 'Flatbed', cargoType: 'Loose' }],
  mode: 'parallel',
  requestedStart: oct24,
  deadlineEnd: deadline26,
}
assert.equal(checkCapacity(twoLoose, oneFlatbed).status, 'fits')
// ...but not when the deadline is the end of the first trip's day (2nd trip would end 6 PM).
const tight = checkCapacity({ ...twoLoose, deadlineEnd: oct24 + 8 * HOUR_MS }, oneFlatbed)
assert.equal(tight.status, 'late')
if (tight.status === 'late') assert.equal(tight.start, oct24)

// Containers may use a Skeletal (tried first) or a Flatbed; loose cargo only a Flatbed.
const container = { hours: 6, trailerType: 'Flatbed', cargoType: 'Container' }
const both = [driver('D1'), truck('T1'), trailer('F1', 'Flatbed'), trailer('S1', 'Skeletal')]
const onSkeletal = placeAt({ trips: [container], mode: 'chain' }, both, oct24)
assert.ok('placements' in onSkeletal)
if ('placements' in onSkeletal) assert.equal(onSkeletal.placements[0].trailer.id, 'S1')
const skeletalOnlyFleet = [driver('D1'), truck('T1'), trailer('S1', 'Skeletal')]
assert.equal(checkCapacity({ trips: [container], mode: 'chain', requestedStart: oct24, deadlineEnd: null }, skeletalOnlyFleet).status, 'fits')
assert.equal(
  checkCapacity({ trips: [{ ...container, cargoType: 'Loose' }], mode: 'chain', requestedStart: oct24, deadlineEnd: null }, skeletalOnlyFleet).status,
  'none',
)
// Two containers at once on 1 Flatbed + 1 Skeletal: one each, no wave needed.
const twoBoxes = placeAt({ trips: [container, container], mode: 'parallel' }, [driver('D1'), driver('D2'), truck('T1'), truck('T2'), trailer('F1', 'Flatbed'), trailer('S1', 'Skeletal')], oct24)
assert.ok('placements' in twoBoxes)
if ('placements' in twoBoxes) assert.deepEqual(twoBoxes.placements.map((p) => p.start), [oct24, oct24])

// Tentative hold: an offered quote takes D1 on Oct 24, so a new quote for
// the same time gets D2 -- or has to wait when there is no D2.
const held = withTentativeHolds([driver('D1'), ...fleet], [{ label: 'Quote #61', demand: fiveTrips, start: oct24 }])
assert.equal(held.find((r) => r.id === 'D1')!.busy[0].reason, 'Held by Quote #61')
assert.equal(held.find((r) => r.id === 'D1')!.busy[0].tentative, true)
const afterHold = checkCapacity(fiveTrips, held)
assert.equal(afterHold.status, 'later')
if (afterHold.status === 'later') assert.equal(afterHold.start, oct25 + 6 * HOUR_MS) // 12 NN Oct 25, when the held chain ends

// The bug of 2026-10-24: booking #52's trip (6-11 AM) had a driver but no
// truck/trailer yet, and booking #53 was let through for 6 AM the same day
// on the only truck. Unassigned trips now hold a truck/trailer too.
const oneTruck = [driver('D1'), driver('D2'), truck('T1'), trailer('F1', 'Flatbed')]
const morning = { itinerary_id: 105, start: oct25, end: oct25 + 5 * HOUR_MS, trailerType: 'Flatbed', needs: ['Truck', 'Trailer'] as Resource['kind'][] }
const withBooked = withUnassignedTrips(oneTruck, [morning])
assert.equal(withBooked.find((r) => r.id === 'T1')!.busy.length, 1)
assert.equal(withBooked.find((r) => r.id === 'D1')!.busy.length, 0) // driver wasn't missing
const oneTripAt6: Demand = { trips: [{ hours: 3, trailerType: 'Flatbed' }], mode: 'chain', requestedStart: oct25, deadlineEnd: null }
assert.equal(checkCapacity(oneTripAt6, oneTruck).status, 'fits')
assert.notEqual(checkCapacity(oneTripAt6, withBooked).status, 'fits')
// A trailer of the wrong type isn't taken by it.
const skeletalOnly = withUnassignedTrips([trailer('S1', 'Skeletal')], [{ ...morning, needs: ['Trailer'] }])
assert.equal(skeletalOnly[0].busy.length, 0)

// Breakdown: with D1 booked 6 AM-12 NN Oct 24 and D2 free, 1 driver is
// needed and 1 of 2 is free; the only Flatbed is busy until 9 AM.
const busyMorning = [{ start: oct24, end: oct24 + 3 * HOUR_MS, reason: 'Trip #1' }]
const breakdown = availabilityBreakdown(
  { trips: [{ hours: 2, trailerType: 'Flatbed' }], mode: 'chain', requestedStart: oct24, deadlineEnd: null },
  [driver('D1', booking('Trip #1')), driver('D2'), truck('T1'), trailer('F1', 'Flatbed', busyMorning), trailer('S1', 'Skeletal')],
)
assert.deepEqual(
  breakdown.map((b) => [b.kind, b.trailerType, b.need, b.have, b.freeAtRequested]),
  [
    ['Driver', null, 1, 2, 1],
    ['Truck', null, 1, 1, 1],
    ['Trailer', 'Flatbed', 1, 1, 0],
  ],
)
assert.equal(breakdown[2].earliestFree, oct24 + 3 * HOUR_MS)
// Fleet too small: 3 Skeletal trips side by side, only 2 Skeletal trailers.
const tooSmall = availabilityBreakdown(
  { trips: Array.from({ length: 3 }, () => ({ hours: 6, trailerType: 'Skeletal' })), mode: 'parallel', requestedStart: oct24, deadlineEnd: null },
  [driver('D1'), driver('D2'), driver('D3'), truck('T1'), truck('T2'), truck('T3'), trailer('S1', 'Skeletal'), trailer('S2', 'Skeletal')],
)
const skeletal = tooSmall.find((b) => b.kind === 'Trailer')!
assert.equal(skeletal.need, 3)
assert.equal(skeletal.have, 2)
assert.equal(skeletal.earliestFree, null)
// Container trips pool Flatbeds and Skeletals together.
const boxPool = availabilityBreakdown(
  { trips: [container, container], mode: 'parallel', requestedStart: oct24, deadlineEnd: null },
  [driver('D1'), truck('T1'), trailer('F1', 'Flatbed'), trailer('S1', 'Skeletal')],
).find((b) => b.kind === 'Trailer')!
assert.deepEqual([boxPool.trailerType, boxPool.need, boxPool.have], ['Flatbed or Skeletal', 2, 2])

// ---- planTrips: the time-window rule ----
const horizon = oct24 + 30 * DAY_MS
const own = (id: string, truckId: string | null, busy: Resource['busy'] = []): Resource => ({ ...driver(id, busy), truckId })
const world = (resources: Resource[], booked: BookedTrip[] = [], pay: PlanWorld['pay'] = null): PlanWorld => ({ resources, booked, pay, horizon })
const trips = (n: number, hours = 6, more: Partial<PlanDemand> = {}): PlanDemand => ({
  trips: Array.from({ length: n }, () => ({ hours, trailerType: 'Flatbed', cargoType: 'Loose' })),
  requestedStart: oct24,
  deadlineEnd: null,
  ...more,
})
const bookedTrip = (id: number, start: number, hours: number, more: Partial<BookedTrip> = {}): BookedTrip => ({
  id,
  status: 'Awaiting',
  start,
  end: start + hours * HOUR_MS,
  driverId: null,
  truckId: null,
  trailerId: null,
  trailerType: 'Flatbed',
  cargoType: 'Loose',
  rate: null,
  ...more,
})

// 10 trips, 1 driver / truck / trailer: one after another, never "needs 10 drivers".
const solo = planTrips(trips(10, 6, { deadlineEnd: oct24 + 3 * DAY_MS }), world([own('D1', 'T1'), truck('T1'), trailer('F1', 'Flatbed')]))
assert.equal(solo.status, 'fits')
assert.equal(solo.driversUsed, 1)
assert.deepEqual(solo.trips.map((t) => t.start), Array.from({ length: 10 }, (_, i) => oct24 + i * 6 * HOUR_MS))
assert.equal(solo.lastEnd, oct24 + 60 * HOUR_MS)

// 3 drivers free: trips run 3 at a time and spread 4 / 3 / 3.
const three = planTrips(
  trips(10),
  world([own('D1', 'T1'), own('D2', 'T2'), own('D3', 'T3'), truck('T1'), truck('T2'), truck('T3'), trailer('F1', 'Flatbed'), trailer('F2', 'Flatbed'), trailer('F3', 'Flatbed')]),
)
assert.equal(three.driversUsed, 3)
assert.deepEqual(['D1', 'D2', 'D3'].map((d) => three.trips.filter((t) => t.driverId === d).length), [4, 3, 3])
assert.equal(three.lastEnd, oct24 + 4 * 6 * HOUR_MS)
// Truck follows the driver.
assert.ok(three.trips.every((t) => t.truckId === `T${t.driverId.slice(1)}` && !t.spareTruck))

// Fairness by pesos: D1 already earned more this week -> the new trip goes to D2.
const pay = { commissionRate: 10, perTripFee: 100 }
const delivered = (id: number, driverId: string, rate: number) =>
  bookedTrip(id, oct24 - 20 * HOUR_MS, 4, { status: 'Delivered', driverId, truckId: `T${driverId.slice(1)}`, trailerId: 'F1', rate })
const fair = planTrips(
  trips(1),
  world([own('D1', 'T1'), own('D2', 'T2'), truck('T1'), truck('T2'), trailer('F1', 'Flatbed')], [delivered(1, 'D1', 10000), delivered(2, 'D2', 1000)], pay),
)
assert.equal(fair.trips[0].driverId, 'D2')
// ...and a delivered trip doesn't block anyone.
assert.equal(fair.trips[0].start, oct24)

// A gap between other bookings is used: D1 has trip #50 at 12 NN-6 PM.
const busyNoon = bookedTrip(50, oct24 + 6 * HOUR_MS, 6, { driverId: 'D1', truckId: 'T1', trailerId: 'F1' })
const gap = planTrips(trips(2), world([own('D1', 'T1'), truck('T1'), trailer('F1', 'Flatbed')], [busyNoon]))
assert.deepEqual(gap.trips.map((t) => t.start), [oct24, oct24 + 12 * HOUR_MS])
assert.equal(gap.swaps.length, 0)

// Own truck in the shop -> a spare truck (one no driver has).
const shop = [{ start: oct24 - DAY_MS, end: oct24 + DAY_MS, reason: 'In the shop' }]
const spare = planTrips(trips(1), world([own('D1', 'T1'), truck('T1', shop), truck('T9'), trailer('F1', 'Flatbed')]))
assert.equal(spare.trips[0].truckId, 'T9')
assert.equal(spare.trips[0].spareTruck, true)
// ...but never another driver's truck, even when that driver is on leave.
const away = [{ start: oct24 - DAY_MS, end: oct24 + 10 * DAY_MS, reason: 'On leave' }]
const noSpare = planTrips(
  trips(1),
  { ...world([own('D1', 'T1'), own('D2', 'T2', away), truck('T1', shop), truck('T2'), trailer('F1', 'Flatbed')]), horizon: oct24 + 20 * HOUR_MS },
)
assert.equal(noSpare.status, 'none')
assert.deepEqual([noSpare.shortage?.kind, noSpare.shortage?.missing], ['Truck', false])

// Swap: the new 10 h trip at 6 AM fits on D1 only if D1's trip #60 (10 AM-2 PM)
// goes to D2, who is on leave from 2 PM. Without it the trip would wait till 2 PM.
const d2LeaveFrom2 = [{ start: oct24 + 8 * HOUR_MS, end: oct24 + 20 * HOUR_MS, reason: 'On leave' }]
const swapFleet = [own('D1', 'T1'), own('D2', 'T2', d2LeaveFrom2), truck('T1'), truck('T2'), trailer('F1', 'Flatbed'), trailer('F2', 'Flatbed')]
const trip60 = bookedTrip(60, oct24 + 4 * HOUR_MS, 4, { driverId: 'D1', truckId: 'T1', trailerId: 'F2' })
const swapped = planTrips(trips(1, 10), world(swapFleet, [trip60]))
assert.equal(swapped.trips[0].start, oct24)
assert.equal(swapped.trips[0].driverId, 'D1')
assert.deepEqual(swapped.swaps, [{ itineraryId: 60, fromDriverId: 'D1', toDriverId: 'D2', fromTruckId: 'T1', toTruckId: 'T2' }])
// Swaps turned off (offers on hold): it waits for D1 instead.
assert.equal(planTrips(trips(1, 10), world(swapFleet, [trip60]), { swaps: false }).trips[0].start, oct24 + 8 * HOUR_MS)
// A trip already on the road is never swapped.
const onRoad = planTrips(trips(1, 10), world(swapFleet, [{ ...trip60, status: 'InTransit' }]))
assert.equal(onRoad.swaps.length, 0)
// No swap when someone is simply free.
assert.equal(planTrips(trips(1, 10), world([...swapFleet, own('D3', 'T3'), truck('T3')], [trip60])).swaps.length, 0)

// Deadline missed: 10 x 6 h from 6 AM on one set, deadline end of Oct 24 -> 2 of 10 in time.
const missed = planTrips(trips(10, 6, { deadlineEnd: oct24 + 18 * HOUR_MS - 1 }), world([own('D1', 'T1'), truck('T1'), trailer('F1', 'Flatbed')]))
assert.equal(missed.status, 'late')
assert.equal(missed.doneByDeadline, 2)
assert.equal(missed.hoursLate, 43)

// Containers still go on a Skeletal before a Flatbed.
const box = planTrips(
  { trips: [{ hours: 6, trailerType: 'Flatbed', cargoType: 'Container' }], requestedStart: oct24, deadlineEnd: null },
  world([own('D1', 'T1'), truck('T1'), trailer('F1', 'Flatbed'), trailer('S1', 'Skeletal')]),
)
assert.equal(box.trips[0].trailerId, 'S1')

// A booked trip with no truck / trailer yet still holds one: the new trip waits for it.
const unpicked = bookedTrip(105, oct24, 5, { driverId: 'D1' })
const waits = planTrips(trips(1, 3), world([own('D1', null), own('D2', null), truck('T1'), trailer('F1', 'Flatbed')], [unpicked]))
assert.equal(waits.trips[0].start, oct24 + 5 * HOUR_MS)

// Fleet too small: loose cargo and no Flatbed at all.
const noFlat = planTrips(trips(1), world([own('D1', 'T1'), truck('T1'), trailer('S1', 'Skeletal')]))
assert.equal(noFlat.status, 'none')
assert.deepEqual([noFlat.shortage?.kind, noFlat.shortage?.missing], ['Trailer', true])

// An offer on hold takes D1's time; a new quote then goes to D2.
const held2 = withPlannedHolds(world([own('D1', 'T1'), own('D2', 'T2'), truck('T1'), truck('T2'), trailer('F1', 'Flatbed'), trailer('F2', 'Flatbed')]), [
  { label: 'Quote #61', demand: trips(1) },
])
assert.equal(held2.resources.find((r) => r.id === 'D1')!.busy[0].reason, 'Held by Quote #61')
assert.equal(planTrips(trips(1), held2).trips[0].driverId, 'D2')

console.log('ok')
