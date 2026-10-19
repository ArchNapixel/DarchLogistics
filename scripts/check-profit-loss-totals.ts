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
  billsByCategory: new Map([
    ['Utilities', 3_000],
    ['Parts', 12_000], // inventory purchase: memo only, NOT a cost
    ['Fuel', 20_000], // bulk diesel: memo only, diesel is counted per trip
  ]),
  collected: 280_000,
})

assert.equal(pl.totalRevenue, 309_500.1)
// Costs: 120,000 + 8,000.2 + 55,000 diesel (40,000 logged + 15,000 estimated)
// + 2,500 + 5,200 + 3,000 utilities. Fuel bills are NOT added.
assert.equal(pl.totalCosts, 193_700.2)
assert.equal(pl.net, 115_799.9) // rounded to cents, no float drift
assert.equal(pl.marginPct, 37.4)

// Parts bills and estimated diesel never reach the cost lines.
assert.ok(!pl.costs.some((l) => l.label.includes('Parts') && l.label.startsWith('Bills')))
assert.ok(!pl.costs.some((l) => l.label === 'Bills: Fuel'))
assert.equal(pl.costs.find((l) => l.label === 'Diesel on delivered trips')?.amount, 55_000)
assert.ok(!pl.costs.some((l) => l.label.startsWith('Damage')))
assert.deepEqual(pl.memo, { partsBought: 12_000, fuelBought: 20_000, draftPayroll: 30_000, collected: 280_000 })

// Bills lines come biggest first.
assert.deepEqual(
  pl.costs.filter((l) => l.label.startsWith('Bills')).map((l) => l.label),
  ['Bills: Utilities'],
)

// A month with no revenue has no margin (not NaN / Infinity).
const empty = buildProfitLoss({
  tripRevenue: 0, adjustments: 0, payrollGross: 1_000, employerShares: 0, draftPayroll: 0,
  dieselLogged: 0, dieselEstimated: 0, otherTripExpenses: 0, companyDamage: 0,
  maintenanceParts: 0, billsByCategory: new Map(), collected: 0,
})
assert.equal(empty.marginPct, null)
assert.equal(empty.net, -1_000)

console.log('ok')
