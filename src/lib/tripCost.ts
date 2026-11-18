// tripCost.ts: the one place the trip cost formula lives. Used by the
// quote calculator (QuoteReviewModal's profitability panel) and by the
// Admin dashboard's Operational Expenses card, so the two can never
// disagree.
//
// Per trip the calculator costs three things:
//   diesel      = diesel_price_per_liter x distance km / diesel_km_per_liter
//                 (km per litre: Settings, 2026-11-18; missing or 0 = 1, the
//                 old "1 litre per km" estimate, so nothing changes until set)
//   commission  = driver_commission_rate % x trip rate
//   per-trip fee = driver_per_trip_fee
// Commission and the per-trip fee are paid through payroll (payslip.ts
// puts them in the driver's gross_pay), so the dashboard counts those
// from payslips and must NOT add them again from here. Only diesel has
// no payroll equivalent -- see dieselForTrip().

// The km a trip drives for the diesel estimate: the booking's trip distance,
// plus the empty-container return leg (delivery -> return place) on a trip
// that brings the container back (itineraries.return_container).
// costedKm = itineraries.costed_distance_km: the km a DELIVERED trip was
// costed with, saved when the booking's distance is edited later (Booking
// Detail -> Edit) so a closed month's diesel doesn't change. Wins when set.
export function tripDistanceKm(
  booking: { estimated_distance_km: number | string | null; return_distance_km?: number | string | null },
  returnContainer: boolean,
  costedKm?: number | string | null,
): number {
  if (costedKm !== undefined && costedKm !== null) return Number(costedKm)
  return Number(booking.estimated_distance_km ?? 0) + (returnContainer ? Number(booking.return_distance_km ?? 0) : 0)
}

export type CostSettings = {
  dieselPricePerLiter: number
  // How many km a truck drives on 1 litre (app_settings.diesel_km_per_liter).
  // Left out / 0 = 1 km per litre.
  kmPerLiter?: number
  driverCommissionRate: number // percent, e.g. 5 means 5%
  driverPerTripFee: number
}

export type TripCosts = {
  diesel: number
  commission: number
  perTripFee: number
  total: number
}

// Diesel cost of driving 1 km.
export function dieselPerKm(settings: Pick<CostSettings, 'dieselPricePerLiter' | 'kmPerLiter'>): number {
  const kmPerLiter = settings.kmPerLiter && settings.kmPerLiter > 0 ? settings.kmPerLiter : 1
  return settings.dieselPricePerLiter / kmPerLiter
}

// Estimated cost of `tripCount` trips that each have the same rate and
// distance (a booking with several delivery orders = several trips).
export function estimateTripCosts(
  settings: CostSettings,
  ratePerTrip: number,
  distanceKm: number,
  tripCount: number,
): TripCosts {
  const diesel = dieselPerKm(settings) * distanceKm * tripCount
  const commission = (settings.driverCommissionRate / 100) * ratePerTrip * tripCount
  const perTripFee = settings.driverPerTripFee * tripCount
  return { diesel, commission, perTripFee, total: diesel + commission + perTripFee }
}

// The diesel figure for ONE delivered trip: the calculator's estimate PLUS
// any Fuel the crew logged. Logged fuel is an extra top-up on the road
// (e.g. "nakulang diesel"), not a replacement for the trip's normal fuel.
export function dieselForTrip(
  actualFuelLogged: number,
  estimatedDiesel: number,
): { amount: number; logged: number; estimate: number } {
  return {
    amount: actualFuelLogged + estimatedDiesel,
    logged: actualFuelLogged,
    estimate: estimatedDiesel,
  }
}
