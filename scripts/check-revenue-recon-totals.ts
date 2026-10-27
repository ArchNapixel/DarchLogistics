// Self-check for src/lib/revenueReconTotals.ts -- run with:
//   node scripts/check-revenue-recon-totals.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { gapByReason, reconcileRevenue } from '../src/lib/revenueReconTotals.ts'
import { buildStatement } from '../src/lib/statementTotals.ts'

// Same ledger as the statement check: October 2026 for three bookings.
const input = {
  bookings: [
    { booking_id: 1, booking_date: '2026-09-01', route: 'A -> B', billable_amount: 21_500 },
    { booking_id: 2, booking_date: '2026-09-10', route: 'C -> D', billable_amount: 4_000 },
    { booking_id: 3, booking_date: '2026-10-05', route: 'E -> F', billable_amount: 8_000 },
  ],
  trips: [
    { itinerary_id: 11, booking_id: 1, delivered_on: '2026-09-05', rate: 10_000 },
    { itinerary_id: 12, booking_id: 1, delivered_on: '2026-10-03', rate: 10_000 },
    { itinerary_id: 21, booking_id: 2, delivered_on: '2026-09-15', rate: 5_000 },
  ],
  payments: [
    { payment_id: 1, booking_id: 1, amount: 10_000, paid_on: '2026-09-20', method: 'Cash', reference_no: null, or_number: null },
    { payment_id: 2, booking_id: 3, amount: 8_000, paid_on: '2026-10-06', method: 'GCash', reference_no: null, or_number: null },
    { payment_id: 3, booking_id: 3, amount: -500, paid_on: '2026-10-10', method: 'Refund', reference_no: null, or_number: null },
  ],
}
const statement = buildStatement(input, '2026-10-01', '2026-10-31')

const meta = new Map([
  // Booking 1: 21,500 billable, 10,000 paid -> still owes.
  [1, { client_name: 'Ana', balance_due: 11_500, total_trips: 2, completed_trips: 2 }],
  [2, { client_name: 'Ben', balance_due: 0, total_trips: 1, completed_trips: 1 }],
  // Booking 3: paid in advance, nothing delivered yet.
  [3, { client_name: 'Cara', balance_due: 500, total_trips: 1, completed_trips: 0 }],
])
const recon = reconcileRevenue(statement.lines, meta)

// Only October's lines count: booking 2 had no October activity.
assert.deepEqual(recon.rows.map((r) => r.booking_id), [1, 3])

const b1 = recon.rows.find((r) => r.booking_id === 1)!
assert.equal(b1.trip_revenue, 10_000)
assert.equal(b1.adjustments, 1_500)
assert.equal(b1.collected, 0)
assert.equal(b1.difference, 11_500)
assert.equal(b1.reason, 'Not fully paid yet')

// Booking 3: advance billing 8,000, paid 8,000, then 500 refunded -> collected 7,500.
const b3 = recon.rows.find((r) => r.booking_id === 3)!
assert.equal(b3.adjustments, 8_000)
assert.equal(b3.collected, 7_500)
assert.equal(b3.difference, 500)

assert.equal(recon.tripRevenue, 10_000)
assert.equal(recon.adjustments, 9_500)
assert.equal(recon.collected, 7_500)

// The identity the page promises: opening + billed - collected = closing.
assert.equal(statement.opening + recon.tripRevenue + recon.adjustments - recon.collected, statement.closing)

// Paid ahead of delivery / paying earlier months (collected more than billed).
const ahead = reconcileRevenue(
  [{ date: '2026-10-02', kind: 'Payment', booking_id: 9, description: '', amount: -5_000, balance: 0 }],
  new Map([[9, { client_name: 'Dan', balance_due: 0, total_trips: 2, completed_trips: 1 }]]),
)
assert.equal(ahead.rows[0].reason, 'Paid ahead of delivery')
const earlier = reconcileRevenue(
  [{ date: '2026-10-02', kind: 'Payment', booking_id: 9, description: '', amount: -5_000, balance: 0 }],
  new Map([[9, { client_name: 'Dan', balance_due: 0, total_trips: 1, completed_trips: 1 }]]),
)
assert.equal(earlier.rows[0].reason, 'Paying earlier months')

// Money Summary card: gap per tag. Booking 1 billed 11,500 more than it
// collected and booking 3 billed 500 more -> both "Not fully paid yet".
assert.deepEqual(gapByReason(recon.rows), [{ reason: 'Not fully paid yet', amount: -12_000, bookings: 2 }])
assert.equal(gapByReason(ahead.rows)[0].amount, 5_000)
assert.deepEqual(gapByReason([]), [])

console.log('ok')
