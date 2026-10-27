// Self-check for src/lib/downpayment.ts -- run with:
//   node scripts/check-downpayment.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { downpaymentFor, downpaymentForContract, downpaymentStatus, tripsMayStart } from '../src/lib/downpayment.ts'

// The example agreed with the owner: 4 trips x ₱5,000, cost ₱2,003.30/trip.
// cost 8,013.20 + 25% x (20,000 - 8,013.20 = 11,986.80) = 8,013.20 + 2,996.70
assert.equal(downpaymentFor(5000, 2003.3, 4), 11009.9)
// One trip: 2,003.30 + 25% x 2,996.70 = 2,752.475 -> 2,752.48
assert.equal(downpaymentFor(5000, 2003.3, 1), 2752.48)
// Cost above the rate: nothing "remaining" to add 25% of.
assert.equal(downpaymentFor(1000, 1500, 2), 3000)
// No trips left (all cancelled) -> nothing to pay.
assert.equal(downpaymentFor(5000, 2003.3, 0), 0)
// Old booking without a saved cost -> no requirement.
assert.equal(downpaymentFor(5000, null, 4), null)

// Lines priced differently: the contract is the sum of the trips' own rates.
// 2 x 5,000 + 2 x 5,000 = 20,000 -> same as 4 trips at 5,000.
assert.equal(downpaymentForContract(20000, 2003.3, 4), 11009.9)
// 2 x 4,000 + 2 x 6,000 = 20,000 too (the average is what matters, not the split).
assert.equal(downpaymentForContract(4000 * 2 + 6000 * 2, 2003.3, 4), 11009.9)
assert.equal(downpaymentForContract(null, 2003.3, 4), null)

const base = { contract: 20000, costPerTrip: 2003.3, trips: 4, waivedAt: null }
const partly = downpaymentStatus({ ...base, amountPaid: 2000 })!
assert.equal(partly.missing, 9009.9)
assert.equal(partly.met, false)
assert.equal(tripsMayStart(partly), false)

const paid = downpaymentStatus({ ...base, amountPaid: 11009.9 })!
assert.equal(paid.met, true)
assert.equal(paid.missing, 0)
assert.equal(tripsMayStart(paid), true)

// Paying more than required is fine.
assert.equal(downpaymentStatus({ ...base, amountPaid: 20000 })!.met, true)
// Admin waiver lets trips start without payment.
assert.equal(tripsMayStart(downpaymentStatus({ ...base, amountPaid: 0, waivedAt: '2026-10-22T00:00:00Z' })), true)
// No requirement at all.
assert.equal(downpaymentStatus({ ...base, costPerTrip: null, amountPaid: 0 }), null)
assert.equal(tripsMayStart(null), true)

console.log('ok')
