// tripCost.ts: the one place the trip cost formula lives. Used by the
// quote calculator (QuoteReviewModal's profitability panel) and by the
// Admin dashboard's Operational Expenses card, so the two can never
// disagree.
//
// Per trip the calculator costs three things:
//   diesel      = diesel_price_per_liter x distance km
//   commission  = driver_commission_rate % x trip rate
//   per-trip fee = driver_per_trip_fee
// Commission and the per-trip fee are paid through payroll (payslip.ts
// puts them in the driver's gross_pay), so the dashboard counts those
// from payslips and must NOT add them again from here. Only diesel has
// no payroll equivalent -- see dieselForTrip().

export type CostSettings = {
  dieselPricePerLiter: number
  driverCommissionRate: number // percent, e.g. 5 means 5%
  driverPerTripFee: number
}

export type TripCosts = {
  diesel: number
  commission: number
  perTripFee: number
  total: number
}

// Estimated cost of `tripCount` trips that each have the same rate and
// distance (a booking with several delivery orders = several trips).
export function estimateTripCosts(
  settings: CostSettings,
  ratePerTrip: number,
  distanceKm: number,
  tripCount: number,
): TripCosts {
  const diesel = settings.dieselPricePerLiter * distanceKm * tripCount
  const commission = (settings.driverCommissionRate / 100) * ratePerTrip * tripCount
  const perTripFee = settings.driverPerTripFee * tripCount
  return { diesel, commission, perTripFee, total: diesel + commission + perTripFee }
}

// The diesel figure for ONE delivered trip on the dashboard: what the crew
// actually logged as Fuel if anything, otherwise the calculator's estimate.
// Exactly one of the two is ever used, so diesel is never counted twice.
// ponytail: one logged fill-up on a two-fill trip counts as the whole
// trip's fuel; add a km/L check if that matters.
export function dieselForTrip(
  actualFuelLogged: number,
  estimatedDiesel: number,
): { amount: number; estimated: boolean } {
  return actualFuelLogged > 0
    ? { amount: actualFuelLogged, estimated: false }
    : { amount: estimatedDiesel, estimated: true }
}
