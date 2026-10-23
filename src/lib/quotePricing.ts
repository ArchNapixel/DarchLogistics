// quotePricing: helps staff pick the rate per trip they offer a client
// (QuoteReviewModal's profitability panel). Same cost formula as
// tripCost.ts -- per trip:
//   cost(rate) = diesel (price x km) + per-trip fee + commission% x rate
// Commission grows with the rate, so "the rate where costs are X% of it"
// is solved for, not just costs / X:
//   rate = (diesel + fee) / (X - commission%)
// Self-check: node scripts/check-quote-pricing.ts
import type { CostSettings } from './tripCost'

// Lowest rate per trip where one trip's costs are at most `share` of the
// rate (1 = break-even, 0.5 = the panel's 50% warning line). Rounded UP to
// the whole peso so the costs stay at or under that share. Null when it
// can't be reached (commission alone is already that share of the rate).
export function rateForCostShare(settings: CostSettings, distanceKm: number, share: number): number | null {
  const fixed = settings.dieselPricePerLiter * distanceKm + settings.driverPerTripFee
  const room = share - settings.driverCommissionRate / 100
  if (room <= 0) return null
  return Math.ceil(fixed / room)
}
