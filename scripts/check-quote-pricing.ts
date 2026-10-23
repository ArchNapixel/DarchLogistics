// Self-check for src/lib/quotePricing.ts -- run with:
//   node scripts/check-quote-pricing.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { rateForCostShare } from '../src/lib/quotePricing.ts'
import { estimateTripCosts } from '../src/lib/tripCost.ts'

const settings = { dieselPricePerLiter: 70, driverCommissionRate: 10, driverPerTripFee: 500 }

// 100 km: diesel 7,000 + fee 500 = 7,500 fixed. Commission 10%.
// Break-even: 7,500 / 0.9 = 8,333.33 -> 8,334.  50% line: 7,500 / 0.4 = 18,750.
assert.equal(rateForCostShare(settings, 100, 1), 8334)
assert.equal(rateForCostShare(settings, 100, 0.5), 18750)

// At those rates the real cost formula agrees: costs <= rate (break-even)
// and costs <= 50% of the rate, and one peso less would cross the line.
const breakEven = rateForCostShare(settings, 100, 1)!
assert.ok(estimateTripCosts(settings, breakEven, 100, 1).total <= breakEven)
assert.ok(estimateTripCosts(settings, breakEven - 1, 100, 1).total > breakEven - 1)
const fifty = rateForCostShare(settings, 100, 0.5)!
assert.ok(estimateTripCosts(settings, fifty, 100, 1).total <= fifty * 0.5)
assert.ok(estimateTripCosts(settings, fifty - 1, 100, 1).total > (fifty - 1) * 0.5)

// Commission alone eats the share: no rate can reach it.
assert.equal(rateForCostShare({ ...settings, driverCommissionRate: 50 }, 100, 0.5), null)

console.log('ok')
