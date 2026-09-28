// Self-check for src/lib/governmentContributions.ts -- run with:
//   node scripts/check-government-contributions.ts
// Prints "ok" or throws on the first wrong number. Expected values are
// worked out by hand from the published 2026 tables.
import assert from 'node:assert/strict'
import {
  sssMonthly,
  philhealthMonthly,
  pagibigMonthly,
  weeklyWithholdingTax,
  payslipsInMonth,
  computeWeeklyContributions,
} from '../src/lib/governmentContributions.ts'

// SSS brackets, floor, ceiling, EC switch
assert.deepEqual(sssMonthly(4_000), { msc: 5_000, ee: 250, er: 500, ec: 10 })
assert.equal(sssMonthly(5_249.99).msc, 5_000)
assert.equal(sssMonthly(5_250).msc, 5_500)
assert.equal(sssMonthly(14_749).msc, 14_500)
assert.deepEqual(sssMonthly(14_750), { msc: 15_000, ee: 750, er: 1_500, ec: 30 })
assert.deepEqual(sssMonthly(80_000), { msc: 35_000, ee: 1_750, er: 3_500, ec: 30 })

// PhilHealth floor / middle / ceiling
assert.deepEqual(philhealthMonthly(8_000), { ee: 250, er: 250 })
assert.deepEqual(philhealthMonthly(24_000), { ee: 600, er: 600 })
assert.deepEqual(philhealthMonthly(150_000), { ee: 2_500, er: 2_500 })

// Pag-IBIG low-salary 1%, normal 2%, ₱200 cap
assert.deepEqual(pagibigMonthly(1_500), { ee: 15, er: 30 })
assert.deepEqual(pagibigMonthly(8_000), { ee: 160, er: 160 })
assert.deepEqual(pagibigMonthly(50_000), { ee: 200, er: 200 })

// BIR weekly table, incl. bracket edges
assert.equal(weeklyWithholdingTax(4_808), 0)
assert.equal(weeklyWithholdingTax(6_000), 178.8)
assert.equal(weeklyWithholdingTax(7_692), 432.6)
assert.equal(weeklyWithholdingTax(10_000), 894.2)
assert.equal(weeklyWithholdingTax(200_000), 58_509.55)

// Sept 2026 has 4 Saturdays, Aug 2026 has 5
assert.equal(payslipsInMonth('2026-09-26'), 4)
assert.equal(payslipsInMonth('2026-08-29'), 5)

// Driver example: ₱6,000 x 3 weeks, then ₱12,000 -> month is exact
const empty = { sss_ee: 0, sss_er: 0, sss_ec: 0, philhealth_ee: 0, philhealth_er: 0, pagibig_ee: 0, pagibig_er: 0 }
const earlier: (typeof empty & { gross_pay: number })[] = []
const weeks = [6_000, 6_000, 6_000, 12_000]
const ends = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']
for (let i = 0; i < 4; i++) {
  const result = computeWeeklyContributions(weeks[i], ends[i], earlier)
  if (i < 3) assert.equal(result.sss_ee, 300) // 24,000 projected -> 1,200 / 4
  earlier.push({ ...empty, ...result, gross_pay: weeks[i] })
}
const monthTotal = (key: keyof typeof empty) => earlier.reduce((sum, p) => sum + p[key], 0)
assert.equal(earlier[3].sss_ee, 600) // 1,500 - 900 already deducted
assert.equal(monthTotal('sss_ee'), sssMonthly(30_000).ee)
assert.equal(monthTotal('sss_ec'), 30)
assert.equal(monthTotal('philhealth_er'), philhealthMonthly(30_000).er)
assert.equal(monthTotal('pagibig_ee'), 200)

console.log('ok')
