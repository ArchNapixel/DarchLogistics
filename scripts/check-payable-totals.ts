// Self-check for src/lib/payableTotals.ts -- run with:
//   node scripts/check-payable-totals.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { billRemaining, billStatus, isOverdue, summarizeOpenBills } from '../src/lib/payableTotals.ts'

const today = '2026-10-19'
const bill = (amount: number, paid: number, due: string | null, voided = false) => ({
  amount,
  amount_paid: paid,
  due_date: due,
  voided_at: voided ? '2026-10-01T00:00:00Z' : null,
})

assert.equal(billStatus(bill(1_000, 0, null)), 'Unpaid')
assert.equal(billStatus(bill(1_000, 400, null)), 'Partial')
assert.equal(billStatus(bill(1_000, 1_000, null)), 'Paid')
assert.equal(billStatus(bill(1_000, 0, null, true)), 'Voided')
// The DB can return numbers as strings.
assert.equal(billStatus({ amount: '1000', amount_paid: '1000', due_date: null, voided_at: null }), 'Paid')
assert.equal(billRemaining(bill(1_000.3, 0.1, null)), 1_000.2)

// Overdue = still owed and due before today; due today is not overdue.
assert.equal(isOverdue(bill(1_000, 0, '2026-10-18'), today), true)
assert.equal(isOverdue(bill(1_000, 0, today), today), false)
assert.equal(isOverdue(bill(1_000, 1_000, '2026-10-01'), today), false)
assert.equal(isOverdue(bill(1_000, 0, '2026-10-01', true), today), false)
assert.equal(isOverdue(bill(1_000, 0, null), today), false)

const s = summarizeOpenBills(
  [
    bill(1_000, 0, '2026-10-10'), // overdue 1,000
    bill(2_000, 500, '2026-10-22'), // due within a week: 1,500
    bill(3_000, 0, '2026-11-30'), // later: only in open
    bill(4_000, 0, null), // no due date: only in open
    bill(9_999, 9_999, '2026-10-01'), // paid: not counted
    bill(9_999, 0, '2026-10-01', true), // voided: not counted
  ],
  today,
)
assert.deepEqual(s, { count: 4, open: 1_000 + 1_500 + 3_000 + 4_000, overdue: 1_000, dueSoon: 1_500 })

console.log('ok')
