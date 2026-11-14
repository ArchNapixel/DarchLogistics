// Self-check for src/lib/tripCost.ts -- run with:
//   node scripts/check-trip-cost.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import { estimateTripCosts, dieselForTrip, tripDistanceKm } from '../src/lib/tripCost.ts'

const settings = { dieselPricePerLiter: 60, driverCommissionRate: 5, driverPerTripFee: 300 }

// 2 trips of 100 km at a 10,000 rate:
//   diesel 60*100*2 = 12,000; commission 5% * 10,000 * 2 = 1,000; fee 300*2 = 600
assert.deepEqual(estimateTripCosts(settings, 10_000, 100, 2), {
  diesel: 12_000,
  commission: 1_000,
  perTripFee: 600,
  total: 13_600,
})

// Actual fuel wins over the estimate; no fuel logged falls back to it.
assert.deepEqual(dieselForTrip(4_500, 6_000), { amount: 4_500, estimated: false })
assert.deepEqual(dieselForTrip(0, 6_000), { amount: 6_000, estimated: true })

// Trip km for diesel: the return leg only on a trip that brings the container back.
assert.equal(tripDistanceKm({ estimated_distance_km: '80', return_distance_km: 30 }, true), 110)
assert.equal(tripDistanceKm({ estimated_distance_km: 80, return_distance_km: 30 }, false), 80)
assert.equal(tripDistanceKm({ estimated_distance_km: 80, return_distance_km: null }, true), 80)
assert.equal(tripDistanceKm({ estimated_distance_km: null }, false), 0)

console.log('ok')
