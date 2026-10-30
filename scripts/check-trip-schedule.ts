// Self-check for src/lib/tripSchedule.ts -- run with:
//   node scripts/check-trip-schedule.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import {
  busyUntil,
  hoursLate,
  findClash,
  isOutNow,
  isOverdue,
  lateEarlierTrip,
  manilaWeek,
  rankCandidates,
  reflow,
  tripOnRoad,
  tripsClash,
  type ScheduledTrip,
} from '../src/lib/tripSchedule.ts'

const at = (s: string) => new Date(s).getTime()
const trip = (id: number, start: string | null, end: string | null, status = 'Awaiting'): ScheduledTrip => ({
  itinerary_id: id,
  booking_id: 1,
  status,
  trip_start_at: start,
  trip_end_at: end,
})

const now = at('2026-10-22T09:00:00+08:00')
const morning = trip(1, '2026-10-22T06:00:00+08:00', '2026-10-22T12:00:00+08:00')
const noonOn = trip(2, '2026-10-22T12:00:00+08:00', '2026-10-22T18:00:00+08:00')
const overlap = trip(3, '2026-10-22T10:00:00+08:00', '2026-10-22T16:00:00+08:00')

// Overlap rules: back-to-back is fine, overlapping isn't.
assert.equal(tripsClash(morning, noonOn, now), false)
assert.equal(tripsClash(morning, overlap, now), true)
assert.equal(tripsClash(morning, morning, now), false) // same trip
assert.equal(findClash(overlap, [noonOn, morning], now)?.itinerary_id, 2) // first clash in list order

// Delivered/Cancelled/no-start trips never block.
assert.equal(busyUntil(trip(4, morning.trip_start_at, morning.trip_end_at, 'Delivered'), now), null)
assert.equal(busyUntil(trip(5, null, null), now), null)
assert.equal(tripsClash(trip(6, null, null), morning, now), false)

// Running late: a started trip past its end stays busy until now.
const lateNow = at('2026-10-22T14:00:00+08:00')
const lateTrip = trip(7, '2026-10-22T06:00:00+08:00', '2026-10-22T12:00:00+08:00', 'InTransit')
assert.equal(busyUntil(lateTrip, lateNow), lateNow)
assert.equal(isOverdue(lateTrip, lateNow), true)
assert.equal(tripsClash(lateTrip, noonOn, lateNow), true) // 12 NN trip now clashes
// ...but an Awaiting trip past its slot only blocks its own slot.
assert.equal(tripsClash(trip(8, morning.trip_start_at, morning.trip_end_at), noonOn, lateNow), false)
assert.equal(isOverdue(trip(8, morning.trip_start_at, morning.trip_end_at), lateNow), true)

// Late earlier trip flags the later one.
assert.equal(lateEarlierTrip(noonOn, [lateTrip], lateNow)?.itinerary_id, 7)
assert.equal(lateEarlierTrip(noonOn, [morning], now), null) // not late yet

// Manila week = Sunday 00:00 to next Sunday (Oct 22, 2026 is a Thursday).
const week = manilaWeek(now)
assert.equal(week.from, at('2026-10-18T00:00:00+08:00'))
assert.equal(week.to, at('2026-10-25T00:00:00+08:00'))
// Saturday night still belongs to that week; Sunday 00:00 starts the next.
assert.equal(manilaWeek(at('2026-10-24T23:30:00+08:00')).from, week.from)
assert.equal(manilaWeek(at('2026-10-25T00:00:00+08:00')).from, week.to)
// Just after midnight Manila (still the previous day in UTC) is the right day.
assert.equal(manilaWeek(at('2026-10-18T00:30:00+08:00')).from, week.from)

// Ranking: free first, then longest since their last trip ended.
const target = trip(10, '2026-10-23T06:00:00+08:00', '2026-10-23T12:00:00+08:00')
const tripsOf: Record<number, ScheduledTrip[]> = {
  1: [trip(11, '2026-10-23T08:00:00+08:00', '2026-10-23T10:00:00+08:00')], // clashes
  2: [trip(12, '2026-10-20T06:00:00+08:00', '2026-10-20T18:00:00+08:00', 'Delivered')], // 12 h
  3: [trip(13, '2026-10-21T06:00:00+08:00', '2026-10-21T12:00:00+08:00', 'Delivered')], // 6 h
  4: [trip(14, '2026-10-19T06:00:00+08:00', '2026-10-19T12:00:00+08:00', 'Delivered')], // 6 h, earlier
}
const ranked = rankCandidates(
  target,
  [1, 2, 3, 4].map((id) => ({ employee_id: id, full_name: `P${id}` })),
  (id) => tripsOf[id] ?? [],
  now,
  (c) => `busy (trip #${c.itinerary_id})`,
)
// Last trips ended: P4 Oct 19, P2 Oct 20, P3 Oct 21 -> P4 rested longest.
assert.deepEqual(ranked.map((r) => r.employee_id), [4, 2, 3, 1])
assert.equal(ranked[3].blockedBy, 'busy (trip #11)')
// Never worked beats everyone free.
const fresh = rankCandidates(target, [{ employee_id: 4, full_name: 'P4' }, { employee_id: 9, full_name: 'P9' }], (id) => tripsOf[id] ?? [], now, () => '')
assert.deepEqual(fresh.map((r) => r.employee_id), [9, 4])

// extraBlock (e.g. leave) also counts as blocked.
const withLeave = rankCandidates(target, [{ employee_id: 4, full_name: 'P4' }], (id) => tripsOf[id] ?? [], now, () => '', () => 'on leave')
assert.equal(withLeave[0].blockedBy, 'on leave')

const H = 3_600_000

// On the road: a person with a Dispatched / Picked Up / In Transit trip can't
// start another; Awaiting, Delivered and Cancelled ones don't count.
const mine = [
  { itinerary_id: 97, status: 'Dispatched' },
  { itinerary_id: 98, status: 'Awaiting' },
]
assert.equal(tripOnRoad(mine, 98)?.itinerary_id, 97)
assert.equal(tripOnRoad(mine, 97), null) // the trip itself doesn't block itself
assert.equal(tripOnRoad([{ itinerary_id: 1, status: 'InTransit' }], 2)?.itinerary_id, 1)
assert.equal(tripOnRoad([{ itinerary_id: 1, status: 'Delivered' }, { itinerary_id: 3, status: 'Cancelled' }], 2), null)

// Out right now: Picked Up / In Transit always; Dispatched only once its slot has started.
const t0 = Date.parse('2026-10-27T10:00:00+08:00')
const slot = (start: string) => ({ trip_start_at: start })
assert.equal(isOutNow({ status: 'InTransit', ...slot('2026-10-29T08:00:00+08:00') }, t0), true)
assert.equal(isOutNow({ status: 'Dispatched', ...slot('2026-10-29T08:00:00+08:00') }, t0), false) // dispatched 2 days early
assert.equal(isOutNow({ status: 'Dispatched', ...slot('2026-10-27T08:00:00+08:00') }, t0), true) // slot started
assert.equal(isOutNow({ status: 'Dispatched', trip_start_at: null }, t0), true) // no slot to judge by
assert.equal(isOutNow({ status: 'Awaiting', ...slot('2026-10-27T08:00:00+08:00') }, t0), false)
assert.equal(isOutNow({ status: 'Delivered', ...slot('2026-10-27T08:00:00+08:00') }, t0), false)

// The cascade (reflow): times in hours from a base. Trip = id, status, slot, driver / truck / trailer.
const base = new Date('2026-10-28T00:00:00+08:00').getTime()
const hr = (h: number) => base + h * H
const rt = (id: number, from: number, to: number, driver: string | null, trailer: string | null = null, status = 'Awaiting') => ({
  itinerary_id: id, status, start: hr(from), end: hr(to), driver, truck: driver ? `T${driver}` : null, trailer,
})
const slotsOf = (m: Map<number, { start: number; end: number }>) =>
  [...m].sort((a, b) => a[0] - b[0]).map(([id, s]) => [id, (s.start - base) / H, (s.end - base) / H])
const delivered = (id: number, from: number, to: number) => ({ fixed: new Map([[id, { start: hr(from), end: hr(to) }]]) })
// Trip 1 (6-12) delivered at 9: the driver's next trips pull earlier, each keeping its length.
const juan = [rt(1, 6, 12, 'D1', null, 'Delivered'), rt(2, 12, 18, 'D1'), rt(3, 18, 24, 'D1')]
assert.deepEqual(slotsOf(reflow(juan, delivered(1, 6, 9))), [[1, 6, 9], [2, 9, 15], [3, 15, 21]])
// Delivered late (at 14): they push later.
assert.deepEqual(slotsOf(reflow(juan, delivered(1, 6, 14))), [[1, 6, 14], [2, 14, 20], [3, 20, 26]])
// Two drivers on one booking are two lines: Pedro's trip doesn't move.
assert.deepEqual(slotsOf(reflow([...juan, rt(4, 12, 18, 'D2')], delivered(1, 6, 9))), [[1, 6, 9], [2, 9, 15], [3, 15, 21]])
// Same trailer, another driver: follows the trailer, but not before its own driver is free (10).
const shared = [rt(1, 6, 12, 'D1', 'R1', 'Delivered'), rt(5, 4, 10, 'D2'), rt(6, 12, 18, 'D2', 'R1')]
assert.deepEqual(slotsOf(reflow(shared, delivered(1, 6, 9))), [[1, 6, 9], [6, 10, 16]])
// Never before its pickup floor (11)...
assert.deepEqual(slotsOf(reflow(juan, delivered(1, 6, 9), new Map([[2, hr(11)]]))), [[1, 6, 9], [2, 11, 17], [3, 17, 23]])
// ...nor inside the driver's leave (9-10).
assert.deepEqual(slotsOf(reflow(juan, delivered(1, 6, 9), new Map(), new Map([['D1', [{ start: hr(9), end: hr(10) }]]]))), [
  [1, 6, 9], [2, 10, 16], [3, 16, 22],
])
// A trip on the road never moves, and what comes after it keeps its time.
const onRoad = [rt(1, 6, 12, 'D1', null, 'Delivered'), rt(2, 12, 18, 'D1', null, 'InTransit'), rt(3, 20, 26, 'D1')]
assert.deepEqual(slotsOf(reflow(onRoad, delivered(1, 6, 9))), [[1, 6, 9]])
// A gap nothing changed before stays (trip 3 waits for its own reasons).
assert.deepEqual(slotsOf(reflow([rt(2, 12, 18, 'D1'), rt(3, 30, 36, 'D2')], delivered(2, 12, 15))), [[2, 12, 15]])
// Hours per trip changed to 4: every trip of the booking gets the new length, back to back from the first.
const hours = { lengths: new Map([[2, 4 * H], [3, 4 * H]]) }
assert.deepEqual(slotsOf(reflow(juan, hours)), [[2, 12, 16], [3, 16, 20]])
// Time edited to start later: the trips after it are pushed.
assert.deepEqual(slotsOf(reflow(juan, delivered(2, 13, 19))), [[2, 13, 19], [3, 19, 25]])
// Late against the delivery-by date: 3 h past the end of the deadline day.
assert.equal(hoursLate(hr(27), hr(24)), 3)
assert.equal(hoursLate(hr(20), hr(24)), 0)
assert.equal(hoursLate(hr(99), null), 0)

console.log('ok')
