// Self-check for src/lib/remittanceTotals.ts -- run with:
//   node scripts/check-remittance-totals.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { agencyAmounts, nextMonthStart, summarizeRemittances } from '../src/lib/remittanceTotals.ts'

const base = {
  cash_advance_deducted: 0,
  net_pay: 0,
  sss_ee: 0,
  sss_er: 0,
  sss_ec: 0,
  philhealth_ee: 0,
  philhealth_er: 0,
  pagibig_ee: 0,
  pagibig_er: 0,
  withholding_tax: 0,
}

const { employees, totals } = summarizeRemittances(
  [
    // Two weekly payslips for Ana in the month (one with string numbers
    // and a null, like the DB can return).
    { ...base, employee_id: 2, gross_pay: 5_000, sss_ee: 250, sss_er: 500, sss_ec: 10, philhealth_ee: 62.5, philhealth_er: 62.5, pagibig_ee: 50, pagibig_er: 100, withholding_tax: 0.1, net_pay: 4_000 },
    { ...base, employee_id: 2, gross_pay: '5000', sss_ee: '250', sss_er: 500, sss_ec: 10, philhealth_ee: 62.5, philhealth_er: null, pagibig_ee: 50, pagibig_er: 100, withholding_tax: 0.2, cash_advance_deducted: 300, net_pay: 3_700 },
    { ...base, employee_id: 1, gross_pay: 1_000, sss_er: 100 },
  ],
  new Map([[2, 'Ana'], [1, 'Ben']]),
)

// Sorted by name; Ana has 2 payslips, Ben 1.
assert.deepEqual(employees.map((e) => [e.name, e.payslips]), [['Ana', 2], ['Ben', 1]])

// Float drift is rounded away (0.1 + 0.2).
assert.equal(employees[0].withholding_tax, 0.3)
// Employer shares = SSS ER+EC, PhilHealth ER (null = 0), Pag-IBIG ER.
assert.equal(employees[0].employer_shares, 500 + 10 + 62.5 + 100 + 500 + 10 + 0 + 100)
assert.equal(employees[0].company_cost, 10_000 + employees[0].employer_shares)
assert.equal(employees[0].cash_advance_deducted, 300)

// Grand total includes everyone.
assert.equal(totals.payslips, 3)
assert.equal(totals.gross, 11_000)
assert.equal(totals.sss_er, 1_100)

assert.deepEqual(agencyAmounts(employees[0]), {
  SSS: 250 + 250 + 500 + 500 + 10 + 10,
  PhilHealth: 62.5 + 62.5 + 62.5,
  'Pag-IBIG': 50 + 50 + 100 + 100,
  'BIR (withholding tax)': 0.3,
})

assert.equal(nextMonthStart('2026-10'), '2026-11-01')
assert.equal(nextMonthStart('2026-12'), '2027-01-01')

console.log('ok')
