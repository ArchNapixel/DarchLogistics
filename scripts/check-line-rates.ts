// Self-check for src/lib/lineRates.ts -- run with:
//   node scripts/check-line-rates.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import {
  averageRate,
  contractTotal,
  estimateLineCosts,
  expandLineRates,
  lineRateError,
  parseLineRates,
  rateLabel,
  ratesDiffer,
} from '../src/lib/lineRates.ts'
import { estimateTripCosts } from '../src/lib/tripCost.ts'

const lines = [{ quantity: 2 }, { quantity: 3 }]

// 2 x 5,000 + 3 x 6,000 = 28,000 over 5 trips = 5,600 average.
assert.equal(contractTotal(lines, [5000, 6000]), 28000)
assert.equal(averageRate(lines, [5000, 6000]), 5600)
assert.deepEqual(expandLineRates(lines, [5000, 6000]), [5000, 5000, 6000, 6000, 6000])
// The average is rounded to centavos (same as quote_average_rate in SQL).
assert.equal(averageRate([{ quantity: 1 }, { quantity: 2 }], [1000, 1000.01]), 1000.01)

// Old quote: one saved rate on every line; saved arrays win; junk = not priced.
assert.deepEqual(parseLineRates(null, 2, 5500), [5500, 5500])
assert.deepEqual(parseLineRates([5000, 6000], 2, 5500), [5000, 6000])
assert.deepEqual(parseLineRates([5000], 2, null), [5000, 0])
assert.deepEqual(parseLineRates('x', 2, null), [0, 0])

assert.equal(ratesDiffer([5000, 5000]), false)
assert.equal(ratesDiffer([5000, 6000]), true)
assert.equal(rateLabel([5000, 5000]), '₱5,000.00')
assert.equal(rateLabel([6000, 5000]), '₱5,000.00 – ₱6,000.00')
assert.equal(rateLabel([]), '—')

assert.equal(lineRateError('', 1, 1), 'enter a rate greater than 0.')
assert.equal(lineRateError('0', 2, 3), 'Line 2: enter a rate greater than 0.')
assert.equal(lineRateError('10.555', 1, 1), 'the rate can have 2 decimals at most.')
assert.equal(lineRateError('5500.5', 1, 2), null)

// Same rate everywhere = the old whole-quote formula; mixed rates only move commission.
const settings = { dieselPricePerLiter: 70, driverCommissionRate: 10, driverPerTripFee: 500 }
assert.deepEqual(estimateLineCosts(settings, lines, [5000, 5000], 100), estimateTripCosts(settings, 5000, 100, 5))
const mixed = estimateLineCosts(settings, lines, [5000, 6000], 100)
assert.equal(mixed.diesel, 70 * 100 * 5)
assert.equal(mixed.commission, 0.1 * 28000)
assert.equal(mixed.total, mixed.diesel + mixed.commission + mixed.perTripFee)

console.log('ok')
