// Self-check for src/lib/arAging.ts -- run with:
//   node scripts/check-ar-aging.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { agingBucket, summarizeAging } from '../src/lib/arAging.ts'

// Bucket edges: days_until_due is negative when overdue.
assert.equal(agingBucket(5), 'Current')
assert.equal(agingBucket(0), 'Current')
assert.equal(agingBucket(-1), '1–30')
assert.equal(agingBucket(-30), '1–30')
assert.equal(agingBucket(-31), '31–60')
assert.equal(agingBucket(-60), '31–60')
assert.equal(agingBucket(-61), '61–90')
assert.equal(agingBucket(-90), '61–90')
assert.equal(agingBucket(-91), '90+')
assert.equal(agingBucket(null), 'No due date')

const { clients, totals, grandTotal } = summarizeAging([
  { booking_id: 1, client_id: 10, client_name: 'A', balance_due: 1_000, days_until_due: 3 },
  { booking_id: 2, client_id: 10, client_name: 'A', balance_due: 4_000, days_until_due: -45 },
  { booking_id: 3, client_id: 20, client_name: 'B', balance_due: 2_000, days_until_due: -100 },
  // Paid in full and overpaid (refund) bookings don't count.
  { booking_id: 4, client_id: 20, client_name: 'B', balance_due: 0, days_until_due: -10 },
  { booking_id: 5, client_id: 30, client_name: 'C', balance_due: -500, days_until_due: -10 },
  { booking_id: 6, client_id: 20, client_name: 'B', balance_due: 700, days_until_due: null },
])

assert.equal(grandTotal, 7_700)
assert.equal(totals['Current'], 1_000)
assert.equal(totals['31–60'], 4_000)
assert.equal(totals['90+'], 2_000)
assert.equal(totals['No due date'], 700)
assert.equal(totals['1–30'], 0)

// Biggest total first; client C (refund only) left out.
assert.deepEqual(
  clients.map((c) => [c.client_name, c.total]),
  [['A', 5_000], ['B', 2_700]],
)
// Most overdue booking first, no-date last.
assert.deepEqual(clients[0].bookings.map((b) => b.booking_id), [2, 1])
assert.deepEqual(clients[1].bookings.map((b) => b.booking_id), [3, 6])

console.log('ok')
