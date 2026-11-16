// Self-check for src/lib/cashAdvanceLedgerTotals.ts -- run with:
//   node scripts/check-cash-advance-ledger.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { buildEmployeeLedger, maxRepayment } from '../src/lib/cashAdvanceLedgerTotals.ts'

const ledger = buildEmployeeLedger([
  // Given out of order on purpose -- the log sorts by date.
  { kind: 'deducted', id: 7, date: '2026-11-08', amount: 450.1, label: 'Payslip' },
  { kind: 'issued', id: 1, date: '2026-11-02', amount: 3000, label: 'Advance' },
  { kind: 'repaid', id: 3, date: '2026-11-10', amount: 500, label: 'Cash' },
  // Voided: stays in the log, doesn't move the balance.
  { kind: 'repaid', id: 4, date: '2026-11-11', amount: 999, label: 'Oops', voided: true },
  // Same day as a deduction: the advance goes first.
  { kind: 'deducted', id: 8, date: '2026-11-15', amount: 200, label: 'Payslip' },
  { kind: 'issued', id: 2, date: '2026-11-15', amount: 1000, label: 'Advance' },
])

assert.deepEqual(
  ledger.lines.map((l) => [l.kind, l.id, l.balance]),
  [
    ['issued', 1, 3000],
    ['deducted', 7, 2549.9],
    ['repaid', 3, 2049.9],
    ['repaid', 4, 2049.9],
    ['issued', 2, 3049.9],
    ['deducted', 8, 2849.9],
  ],
)
assert.equal(ledger.issued, 4000)
assert.equal(ledger.deducted, 650.1)
assert.equal(ledger.repaid, 500)
assert.equal(ledger.outstanding, 2849.9)
assert.equal(ledger.lastDate, '2026-11-15')

assert.deepEqual(buildEmployeeLedger([]), { lines: [], issued: 0, deducted: 0, repaid: 0, outstanding: 0, lastDate: null })

// Draft deductions come off what can be paid back; never below zero.
assert.equal(maxRepayment(3000, 450), 2550)
assert.equal(maxRepayment(100, 450), 0)

console.log('ok')
