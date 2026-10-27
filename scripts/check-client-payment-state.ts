// Self-check for src/lib/clientPaymentState.ts -- run with:
//   node scripts/check-client-payment-state.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { clientPaymentState } from '../src/lib/clientPaymentState.ts'

const dpOpen = { required: 11009.9, paid: 2000, missing: 9009.9, met: false, waived: false }
const dpMet = { required: 11009.9, paid: 11009.9, missing: 0, met: true, waived: false }
const dpWaived = { ...dpOpen, waived: true }
const row = (o: Partial<{ balance_due: number; total_trips: number; completed_trips: number; due_date: string | null; days_until_due: number | null }>) => ({
  balance_due: 0,
  total_trips: 2,
  completed_trips: 2,
  due_date: null,
  days_until_due: null,
  ...o,
})

// Downpayment still owed wins over everything else.
assert.equal(clientPaymentState(row({ balance_due: 0 }), dpOpen).key, 'downpaymentDue')
assert.match(clientPaymentState(undefined, dpOpen).detail, /₱9,009\.90/)
// Waived downpayment doesn't block.
assert.equal(clientPaymentState(row({}), dpWaived).key, 'paid')
// Everything delivered and nothing owed.
assert.equal(clientPaymentState(row({}), null).label, 'Paid in full')
// Paid ahead with trips still to come is not "paid in full".
const ahead = clientPaymentState(row({ completed_trips: 1 }), dpMet)
assert.equal(ahead.key, 'due')
assert.equal(ahead.label, 'Downpayment paid')
// Owed and past due.
const late = clientPaymentState(row({ balance_due: 5000, due_date: '2026-10-20', days_until_due: -3 }), dpMet)
assert.equal(late.key, 'overdue')
assert.match(late.detail, /3 days late/)
// Owed, not due yet.
const due = clientPaymentState(row({ balance_due: 5000, due_date: '2026-10-30', days_until_due: 3 }), null)
assert.equal(due.label, 'Payment due')
assert.match(due.detail, /Rest ₱5,000\.00 due/)
// Not in the report at all.
assert.equal(clientPaymentState(undefined, null).key, 'none')

console.log('ok')
