// Self-check for src/lib/governmentContributions.ts -- run with:
//   node scripts/check-government-contributions.ts
// Prints "ok" or throws on the first wrong number. Expected values are
// worked out by hand from the published 2026 tables. R is the same rate set
// the government_rates migration (20261119020000) seeds -- keep them equal.
import assert from 'node:assert/strict'
import {
  sssMonthly,
  philhealthMonthly,
  pagibigMonthly,
  weeklyWithholdingTax,
  payslipsInMonth,
  computeWeeklyContributions,
  ratesFor,
  type GovernmentRates,
} from '../src/lib/governmentContributions.ts'

const R: GovernmentRates = {
  effective_from: '2025-01-01',
  sss_msc_min: 5_000, sss_msc_max: 35_000, sss_msc_step: 500, sss_ee_rate: 5, sss_er_rate: 10,
  sss_ec_threshold: 15_000, sss_ec_low: 10, sss_ec_high: 30,
  philhealth_floor: 10_000, philhealth_ceiling: 100_000, philhealth_ee_rate: 2.5, philhealth_er_rate: 2.5,
  pagibig_salary_cap: 10_000, pagibig_low_salary: 1_500, pagibig_ee_rate_low: 1, pagibig_ee_rate: 2, pagibig_er_rate: 2,
  // Lowest first on purpose: the code must not depend on the stored order.
  weekly_tax_brackets: [
    { over: 4_808, fixed: 0, rate: 15 },
    { over: 7_692, fixed: 432.6, rate: 20 },
    { over: 15_385, fixed: 1_971.2, rate: 25 },
    { over: 38_462, fixed: 7_740.45, rate: 30 },
    { over: 153_846, fixed: 42_355.65, rate: 35 },
  ],
}

// Picking the rate set in force on a date
const later = { ...R, effective_from: '2027-01-01', sss_ee_rate: 6 }
assert.equal(ratesFor([R, later], '2026-12-26'), R)
assert.equal(ratesFor([later, R], '2027-01-02'), later)
assert.equal(ratesFor([R, later], '2027-01-01'), later)
assert.equal(ratesFor([R], '2024-12-31'), null)
assert.equal(sssMonthly(20_000, later).ee, 1_200) // new rate is really used

// SSS brackets, floor, ceiling, EC switch
assert.deepEqual(sssMonthly(4_000, R), { msc: 5_000, ee: 250, er: 500, ec: 10 })
assert.equal(sssMonthly(5_249.99, R).msc, 5_000)
assert.equal(sssMonthly(5_250, R).msc, 5_500)
assert.equal(sssMonthly(14_749, R).msc, 14_500)
assert.deepEqual(sssMonthly(14_750, R), { msc: 15_000, ee: 750, er: 1_500, ec: 30 })
assert.deepEqual(sssMonthly(80_000, R), { msc: 35_000, ee: 1_750, er: 3_500, ec: 30 })

// PhilHealth floor / middle / ceiling
assert.deepEqual(philhealthMonthly(8_000, R), { ee: 250, er: 250 })
assert.deepEqual(philhealthMonthly(24_000, R), { ee: 600, er: 600 })
assert.deepEqual(philhealthMonthly(150_000, R), { ee: 2_500, er: 2_500 })

// Pag-IBIG low-salary 1%, normal 2%, ₱200 cap
assert.deepEqual(pagibigMonthly(1_500, R), { ee: 15, er: 30 })
assert.deepEqual(pagibigMonthly(8_000, R), { ee: 160, er: 160 })
assert.deepEqual(pagibigMonthly(50_000, R), { ee: 200, er: 200 })

// BIR weekly table, incl. bracket edges
assert.equal(weeklyWithholdingTax(4_808, R), 0)
assert.equal(weeklyWithholdingTax(6_000, R), 178.8)
assert.equal(weeklyWithholdingTax(7_692, R), 432.6)
assert.equal(weeklyWithholdingTax(10_000, R), 894.2)
assert.equal(weeklyWithholdingTax(200_000, R), 58_509.55)

// Sept 2026 has 4 Saturdays, Aug 2026 has 5
assert.equal(payslipsInMonth('2026-09-26'), 4)
assert.equal(payslipsInMonth('2026-08-29'), 5)

// Driver example: ₱6,000 x 3 weeks, then ₱12,000 -> month is exact
const empty = { sss_ee: 0, sss_er: 0, sss_ec: 0, philhealth_ee: 0, philhealth_er: 0, pagibig_ee: 0, pagibig_er: 0 }
const earlier: (typeof empty & { gross_pay: number })[] = []
const weeks = [6_000, 6_000, 6_000, 12_000]
const ends = ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']
for (let i = 0; i < 4; i++) {
  const result = computeWeeklyContributions(weeks[i], ends[i], earlier, R)
  if (i < 3) assert.equal(result.sss_ee, 300) // 24,000 projected -> 1,200 / 4
  earlier.push({ ...empty, ...result, gross_pay: weeks[i] })
}
const monthTotal = (key: keyof typeof empty) => earlier.reduce((sum, p) => sum + p[key], 0)
assert.equal(earlier[3].sss_ee, 600) // 1,500 - 900 already deducted
assert.equal(monthTotal('sss_ee'), sssMonthly(30_000, R).ee)
assert.equal(monthTotal('sss_ec'), 30)
assert.equal(monthTotal('philhealth_er'), philhealthMonthly(30_000, R).er)
assert.equal(monthTotal('pagibig_ee'), 200)

console.log('ok')
