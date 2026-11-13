// Self-check for src/lib/odometerRules.ts -- run with:
//   node scripts/check-odometer-rules.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { goesHome, tripLegs, uncountedTrips } from '../src/lib/odometerRules.ts'

const H = 3_600_000
const t0 = Date.parse('2026-11-13T08:00:00Z')

// Going home
assert.equal(goesHome(t0, []), true) // nothing next
assert.equal(goesHome(t0, [t0 + 13 * H]), true) // next trip tomorrow-ish
assert.equal(goesHome(t0, [t0 + 12 * H]), false) // exactly 12 h -> straight on
assert.equal(goesHome(t0, [t0 + 2 * H]), false)
assert.equal(goesHome(t0, [t0 - 5 * H]), false) // overdue next trip waiting for this truck

// Legs
assert.deepEqual(tripLegs({ outKm: 12.345, tripKm: 80, backKm: 70.1, home: true }), {
  out: 12.35,
  trip: 80,
  back: 70.1,
  total: 162.45,
  notes: [],
})
const noRoute = tripLegs({ outKm: null, tripKm: 80, backKm: null, home: true })
assert.equal(noRoute.out, 0)
assert.equal(noRoute.back, 80) // same road back
assert.equal(noRoute.total, 160)
assert.equal(noRoute.notes.length, 2)
const straightOn = tripLegs({ outKm: 10, tripKm: 80, backKm: 70, home: false })
assert.equal(straightOn.back, 0) // routed back ignored: truck didn't go home
assert.equal(straightOn.total, 90)

// Uncounted trips
const log = [
  { plate_number: 'AAA 111', source: 'opening', itinerary_id: null, recorded_at: '2026-11-01T00:00:00Z' },
  { plate_number: 'AAA 111', source: 'trip', itinerary_id: 5, recorded_at: '2026-11-03T00:00:00Z' },
  { plate_number: 'BBB 222', source: 'opening', itinerary_id: null, recorded_at: '2026-11-01T00:00:00Z' },
  { plate_number: 'BBB 222', source: 'reading', itinerary_id: null, recorded_at: '2026-11-10T00:00:00Z' },
]
const trips = [
  { itinerary_id: 4, plate_number: 'AAA 111', delivered_at: '2026-10-30T00:00:00Z' }, // before opening
  { itinerary_id: 5, plate_number: 'AAA 111', delivered_at: '2026-11-02T00:00:00Z' }, // counted
  { itinerary_id: 7, plate_number: 'AAA 111', delivered_at: '2026-11-06T00:00:00Z' },
  { itinerary_id: 6, plate_number: 'AAA 111', delivered_at: '2026-11-04T00:00:00Z' },
  { itinerary_id: 8, plate_number: 'BBB 222', delivered_at: '2026-11-09T00:00:00Z' }, // inside the real reading
  { itinerary_id: 9, plate_number: 'BBB 222', delivered_at: '2026-11-11T00:00:00Z' },
  { itinerary_id: 10, plate_number: 'CCC 333', delivered_at: '2026-11-11T00:00:00Z' }, // no log for truck
]
assert.deepEqual(
  uncountedTrips(trips, log).map((t) => t.itinerary_id),
  [6, 7, 9], // oldest first
)

console.log('ok')
