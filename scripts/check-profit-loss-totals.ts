// Self-check for src/lib/profitLossTotals.ts -- run with:
//   node scripts/check-profit-loss-totals.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { buildProfitLoss } from '../src/lib/profitLossTotals.ts'

const pl = buildProfitLoss({
  tripRevenue: 300_000,
  adjustments: 9_500.1,
  payrollGross: 120_000,
  employerShares: 8_000.2,
  draftPayroll: 30_000,
  dieselLogged: 40_000,
  dieselEstimated: 15_000,
  otherTripExpenses: 2_500,
  companyDamage: 0, // zero lines are left out
  maintenanceParts: 5_200,
  collected: 280_000,
})

assert.equal(pl.totalRevenue, 309_500.1)
// Costs: 120,000 + 8,000.2 + 55,000 diesel (40,000 logged + 15,000 estimated)
// + 2,500 + 5,200.
assert.equal(pl.totalCosts, 190_700.2)
assert.equal(pl.net, 118_799.9) // rounded to cents, no float drift
assert.equal(pl.marginPct, 38.4)

assert.equal(pl.costs.find((l) => l.label === 'Diesel on delivered trips')?.amount, 55_000)
assert.ok(!pl.costs.some((l) => l.label.startsWith('Damage')))
assert.deepEqual(pl.memo, { draftPayroll: 30_000, collected: 280_000 })

// A month with no revenue has no margin (not NaN / Infinity).
const empty = buildProfitLoss({
  tripRevenue: 0, adjustments: 0, payrollGross: 1_000, employerShares: 0, draftPayroll: 0,
  dieselLogged: 0, dieselEstimated: 0, otherTripExpenses: 0, companyDamage: 0,
  maintenanceParts: 0, collected: 0,
})
assert.equal(empty.marginPct, null)
assert.equal(empty.net, -1_000)

console.log('ok')
