// Self-check for src/lib/capacity.ts (planTrips, the time-window rule) -- run with:
//   node scripts/check-capacity.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import {
  DAY_MS,
  HOUR_MS,
  planTrips,
  shortageLabel,
  withPlannedHolds,
  type BookedTrip,
  type Demand,
  type PlanWorld,
  type Resource,
} from '../src/lib/capacity.ts'

const at = (s: string) => new Date(s).getTime()
const oct24 = at('2026-10-24T06:00:00+08:00')

const driver = (id: string, busy: Resource['busy'] = []): Resource => ({ id, kind: 'Driver', label: id, busy })
const truck = (id: string, busy: Resource['busy'] = []): Resource => ({ id, kind: 'Truck', label: id, busy })
const trailer = (id: string, type: string, busy: Resource['busy'] = []): Resource => ({
  id,
  kind: 'Trailer',
  label: id,
  trailerType: type,
  busy,
})

const horizon = oct24 + 30 * DAY_MS
const own = (id: string, truckId: string | null, busy: Resource['busy'] = []): Resource => ({ ...driver(id, busy), truckId })
const world = (resources: Resource[], booked: BookedTrip[] = [], pay: PlanWorld['pay'] = null): PlanWorld => ({ resources, booked, pay, horizon })
const trips = (n: number, hours = 6, more: Partial<Demand> = {}): Demand => ({
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

// Labels for the card.
assert.equal(shortageLabel({ kind: 'Trailer', trailerType: 'Flatbed', tripIndex: 0 }), 'No Flatbed trailer free')
assert.equal(shortageLabel({ kind: 'Driver', trailerType: null, tripIndex: 0 }), 'No driver free')

console.log('ok')
