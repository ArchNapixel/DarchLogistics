// Self-check for src/lib/payslipPeriod.ts -- run with:
//   node scripts/check-payslip-period.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { deliveryDatesInPeriod, tripKey, tripsToPay } from '../src/lib/payslipPeriod.ts'

const START = '2026-11-01'
const END = '2026-11-07'

// Inside the period, both edges included; outside it, left out.
const dates = deliveryDatesInPeriod(
  [
    { itinerary_id: 1, date: '2026-10-31' }, // day before
    { itinerary_id: 2, date: '2026-11-01' }, // first day
    { itinerary_id: 3, date: '2026-11-07' }, // last day
    { itinerary_id: 4, date: '2026-11-08' }, // day after
    // Delivered in the period, then again after it: the latest one counts.
    { itinerary_id: 5, date: '2026-11-03' },
    { itinerary_id: 5, date: '2026-11-09' },
    // Delivered before the period, then again inside it: counts, on the new date.
    { itinerary_id: 6, date: '2026-10-20' },
    { itinerary_id: 6, date: '2026-11-04' },
  ],
  START,
  END,
)
assert.deepEqual([...dates.entries()], [[2, '2026-11-01'], [3, '2026-11-07'], [6, '2026-11-04']])

const trips = [{ itinerary_id: 10 }, { itinerary_id: 11 }, { itinerary_id: 12 }]
const crew = new Set([tripKey(1, 10), tripKey(1, 11), tripKey(2, 11)])

// Only the employee's own trips.
assert.deepEqual(tripsToPay(1, trips, crew, new Set()).map((t) => t.itinerary_id), [10, 11])
// Someone not on any crew gets nothing.
assert.deepEqual(tripsToPay(3, trips, crew, new Set()), [])
// A trip on their own payslip is never paid twice.
assert.deepEqual(tripsToPay(1, trips, crew, new Set([tripKey(1, 10)])).map((t) => t.itinerary_id), [11])
// Paid to employee 1 doesn't stop employee 2 being paid for the same trip.
assert.deepEqual(tripsToPay(2, trips, crew, new Set([tripKey(1, 11)])).map((t) => t.itinerary_id), [11])

console.log('ok')
