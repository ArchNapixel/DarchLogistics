// Self-check for src/lib/tripProfitTotals.ts -- run with:
//   node scripts/check-trip-profit-totals.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { summarizeTrips, tripProfit } from '../src/lib/tripProfitTotals.ts'

// 5% commission, ₱200 per-trip fee, ₱60/L diesel.
const settings = { dieselPricePerLiter: 60, driverCommissionRate: 5, driverPerTripFee: 200 }

// No Fuel logged: diesel is estimated = 60 x 100 km = 6,000.
// Driver pay = 5% of 20,000 + 200 = 1,200. Cost = 1,200 + 6,000 + 500 + 300.
const estimated = tripProfit(settings, {
  ratePerTrip: 20_000,
  distanceKm: 100,
  fuelLogged: 0,
  otherExpenses: 500,
  companyDamage: 300,
})
assert.equal(estimated.driverPay, 1_200)
assert.equal(estimated.diesel, 6_000)
assert.equal(estimated.dieselEstimated, true)
assert.equal(estimated.totalCost, 8_000)
assert.equal(estimated.profit, 12_000)
assert.equal(estimated.marginPct, 60)

// Fuel logged wins over the estimate, and is never added on top of it.
const actual = tripProfit(settings, {
  ratePerTrip: 20_000,
  distanceKm: 100,
  fuelLogged: 4_500,
  otherExpenses: 0,
  companyDamage: 0,
})
assert.equal(actual.diesel, 4_500)
assert.equal(actual.dieselEstimated, false)
assert.equal(actual.profit, 20_000 - 1_200 - 4_500)

// A losing trip gives a negative profit and margin.
const loss = tripProfit(settings, {
  ratePerTrip: 5_000,
  distanceKm: 100,
  fuelLogged: 0,
  otherExpenses: 0,
  companyDamage: 0,
})
assert.equal(loss.profit, 5_000 - 450 - 6_000)
assert.ok(loss.marginPct! < 0)

// No rate -> no margin to divide by (not NaN / Infinity).
assert.equal(
  tripProfit(settings, { ratePerTrip: 0, distanceKm: 0, fuelLogged: 0, otherExpenses: 0, companyDamage: 0 })
    .marginPct,
  null,
)

// Totals: margin is total profit / total revenue, not an average of margins.
const total = summarizeTrips([estimated, actual])
assert.equal(total.trips, 2)
assert.equal(total.revenue, 40_000)
assert.equal(total.profit, 12_000 + 14_300)
assert.equal(total.marginPct, 65.8)
assert.equal(summarizeTrips([]).marginPct, null)

console.log('ok')
