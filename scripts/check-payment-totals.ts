// Self-check for src/lib/paymentTotals.ts -- run with:
//   node scripts/check-payment-totals.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { summarizePayments } from '../src/lib/paymentTotals.ts'

const s = summarizePayments([
  { amount: 1_000.1, method: 'Cash', voided_at: null },
  { amount: 2_000.2, method: 'Cash', voided_at: null },
  { amount: 5_000, method: 'GCash', voided_at: null },
  // Voided payments are ignored everywhere.
  { amount: 9_999, method: 'Cash', voided_at: '2026-10-19T00:00:00Z' },
  // A refund is negative: counts as refunded and lowers net.
  { amount: -500, method: 'Refund', voided_at: null },
])

assert.equal(s.count, 4)
assert.equal(s.received, 8_000.3) // 1000.1 + 2000.2 + 5000, float drift rounded away
assert.equal(s.refunded, 500)
assert.equal(s.net, 7_500.3)
assert.deepEqual(s.byMethod, [
  { method: 'GCash', amount: 5_000 },
  { method: 'Cash', amount: 3_000.3 },
  { method: 'Refund', amount: -500 },
])

assert.deepEqual(summarizePayments([]), { received: 0, refunded: 0, net: 0, count: 0, byMethod: [] })

console.log('ok')
