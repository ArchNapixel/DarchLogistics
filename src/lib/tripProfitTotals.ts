// tripProfitTotals: the pure math behind Accounting -> Trip Profitability
// (no Supabase here, so it can be self-checked with
// `node scripts/check-trip-profit-totals.ts`). Data loading is in
// tripProfit.ts.
//
// Per DELIVERED trip:
//   revenue   = the booking's rate per trip
//   driver pay = commission % x rate + per-trip fee (what payslip.ts pays
//                the driver; today's rates -- see ponytail note in tripProfit.ts)
//   diesel    = Fuel the crew logged, else distance x diesel price
//               (same rule as the dashboard, tripCost.ts dieselForTrip)
//   other     = logged Toll / Parking / Other expenses
//   damage    = approved damage charged to the Company
//   profit    = revenue - all of the above
// Helpers are on a weekly salary and trucks' maintenance isn't split per
// trip, so neither is in here -- this is the trip's direct margin.
import { dieselForTrip, estimateTripCosts, type CostSettings } from './tripCost.ts'

export type TripProfitInput = {
  ratePerTrip: number
  distanceKm: number
  fuelLogged: number
  otherExpenses: number
  companyDamage: number
}

export type TripProfit = {
  revenue: number
  driverPay: number
  diesel: number
  dieselEstimated: boolean
  otherExpenses: number
  companyDamage: number
  totalCost: number
  profit: number
  // Profit as a % of revenue; null when the trip had no revenue to divide by.
  marginPct: number | null
}

// Round to cents so sums don't show 1234.5600000001.
const cents = (v: number) => Math.round(v * 100) / 100

export function tripProfit(settings: CostSettings, trip: TripProfitInput): TripProfit {
  const estimate = estimateTripCosts(settings, trip.ratePerTrip, trip.distanceKm, 1)
  const diesel = dieselForTrip(trip.fuelLogged, estimate.diesel)
  const driverPay = estimate.commission + estimate.perTripFee
  const totalCost = driverPay + diesel.amount + trip.otherExpenses + trip.companyDamage
  const profit = trip.ratePerTrip - totalCost

  return {
    revenue: cents(trip.ratePerTrip),
    driverPay: cents(driverPay),
    diesel: cents(diesel.amount),
    dieselEstimated: diesel.estimated,
    otherExpenses: cents(trip.otherExpenses),
    companyDamage: cents(trip.companyDamage),
    totalCost: cents(totalCost),
    profit: cents(profit),
    marginPct: trip.ratePerTrip > 0 ? Math.round((profit / trip.ratePerTrip) * 1000) / 10 : null,
  }
}

export type Summable = Pick<
  TripProfit,
  'revenue' | 'driverPay' | 'diesel' | 'otherExpenses' | 'companyDamage' | 'totalCost' | 'profit'
>

// Adds up a list of trips (e.g. whatever the filters leave on screen).
export function summarizeTrips(trips: Summable[]) {
  const sum = (pick: (t: Summable) => number) => cents(trips.reduce((s, t) => s + pick(t), 0))
  const revenue = sum((t) => t.revenue)
  const profit = sum((t) => t.profit)
  return {
    trips: trips.length,
    revenue,
    driverPay: sum((t) => t.driverPay),
    diesel: sum((t) => t.diesel),
    otherExpenses: sum((t) => t.otherExpenses),
    companyDamage: sum((t) => t.companyDamage),
    totalCost: sum((t) => t.totalCost),
    profit,
    marginPct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
  }
}
