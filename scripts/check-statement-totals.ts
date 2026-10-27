// Self-check for src/lib/statementTotals.ts -- run with:
//   node scripts/check-statement-totals.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { buildStatement } from '../src/lib/statementTotals.ts'

const input = {
  bookings: [
    // 2 trips delivered at 10,000, +1,500 client damage on top: billable 21,500.
    { booking_id: 1, booking_date: '2026-09-01', route: 'A -> B', billable_amount: 21_500 },
    // 1 trip delivered at 5,000 but a discount override of 4,000: adjustment -1,000.
    { booking_id: 2, booking_date: '2026-09-10', route: 'C -> D', billable_amount: 4_000 },
    // Nothing delivered, but paid in full in advance (locked at 8,000): adjustment on the booking date.
    { booking_id: 3, booking_date: '2026-10-05', route: 'E -> F', billable_amount: 8_000 },
  ],
  trips: [
    { itinerary_id: 11, booking_id: 1, delivered_on: '2026-09-05', rate: 10_000 },
    { itinerary_id: 12, booking_id: 1, delivered_on: '2026-10-03', rate: 10_000 },
    { itinerary_id: 21, booking_id: 2, delivered_on: '2026-09-15', rate: 5_000 },
  ],
  payments: [
    { payment_id: 1, booking_id: 1, amount: 10_000, paid_on: '2026-09-20', method: 'Cash', reference_no: null, or_number: 'OR-1' },
    { payment_id: 2, booking_id: 3, amount: 8_000, paid_on: '2026-10-06', method: 'GCash', reference_no: 'G123', or_number: null },
    // A refund is negative and adds back to what the client "owes".
    { payment_id: 3, booking_id: 3, amount: -500, paid_on: '2026-10-10', method: 'Refund', reference_no: null, or_number: null },
    // Dated after the period: ignored.
    { payment_id: 4, booking_id: 1, amount: 99, paid_on: '2026-11-01', method: 'Cash', reference_no: null, or_number: null },
  ],
}

// Period = October 2026.
const oct = buildStatement(input, '2026-10-01', '2026-10-31')
// Before October: trip 11 (10,000) + booking 2's trip (5,000) - 1,000 discount - 10,000 payment = 4,000.
assert.equal(oct.opening, 4_000)
// October lines: trip 12 (+10,000), adjustment on booking 1 (+1,500, dated its last delivery 10-03),
// booking 3 advance (+8,000 on 10-05), payment -8,000, refund +500.
assert.deepEqual(
  oct.lines.map((l) => [l.date, l.kind, l.amount, l.balance]),
  [
    ['2026-10-03', 'Trip', 10_000, 14_000],
    ['2026-10-03', 'Adjustment', 1_500, 15_500],
    ['2026-10-05', 'Adjustment', 8_000, 23_500],
    ['2026-10-06', 'Payment', -8_000, 15_500],
    ['2026-10-10', 'Payment', 500, 16_000],
  ],
)
// "Billed" = lines that raise the balance (the refund counts here), "paid" = lines that lower it.
assert.equal(oct.billed, 20_000)
assert.equal(oct.paid, 8_000)
assert.equal(oct.closing, 4_000 + 20_000 - 8_000)
assert.equal(oct.closing, oct.lines[oct.lines.length - 1].balance)

// Whole ledger up to the end: closing = total billable - total paid, i.e.
// what Bills Receivable shows as balance due across these bookings.
const all = buildStatement(input, '2000-01-01', '2026-12-31')
assert.equal(all.opening, 0)
assert.equal(all.closing, 21_500 + 4_000 + 8_000 - (10_000 + 8_000 - 500 + 99))

// A period with nothing in it keeps the opening balance as the closing one.
const quiet = buildStatement(input, '2026-12-01', '2026-12-31')
assert.equal(quiet.lines.length, 0)
assert.equal(quiet.closing, quiet.opening)

// Cargo lines priced differently: each delivered trip bills its OWN rate and
// the billable amount (5,500 + 8,000) leaves no adjustment.
const mixed = buildStatement(
  {
    bookings: [{ booking_id: 9, booking_date: '2026-10-01', route: 'G -> H', billable_amount: 13_500 }],
    trips: [
      { itinerary_id: 91, booking_id: 9, delivered_on: '2026-10-02', rate: 5_500 },
      { itinerary_id: 92, booking_id: 9, delivered_on: '2026-10-03', rate: 8_000 },
    ],
    payments: [],
  },
  '2026-10-01',
  '2026-10-31',
)
assert.deepEqual(mixed.lines.map((l) => [l.kind, l.amount]), [['Trip', 5_500], ['Trip', 8_000]])
assert.equal(mixed.closing, 13_500)

console.log('ok')
