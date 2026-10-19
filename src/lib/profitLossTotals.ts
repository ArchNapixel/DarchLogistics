// profitLossTotals: the pure math behind Accounting -> Profit & Loss (no
// Supabase here, so it can be self-checked with
// `node scripts/check-profit-loss-totals.ts`). Loading is in profitLoss.ts.
//
// One month, accrual basis (earned / incurred in the month, not when the
// cash moved):
//   REVENUE  trip revenue (delivered trips x rate) + adjustments (client
//            damage, discounts, advance billing) -- same as Revenue
//            Reconciliation.
//   COSTS    payroll gross + employer contributions (payslips whose period
//            ends in the month; driver commission is inside gross), diesel
//            the crew LOGGED on the month's delivered trips, other trip
//            expenses, damage charged to the company, maintenance parts
//            USED, and Bills Payable by category (bill date in the month).
// Not counted, to avoid counting the same money twice:
//   - "Parts" bills: buying parts fills the inventory; they become a cost
//     when used on a work order (the maintenance line). Shown as a memo.
//   - "Fuel" bills (bulk depot diesel): diesel is already counted per trip
//     above and bulk buying isn't tied to trips yet. Still recorded under
//     Bills Payable; shown as a memo.
//   - Driver commission from the trip calculator: it's already in payroll.

export type ProfitLossInput = {
  tripRevenue: number
  adjustments: number
  payrollGross: number
  employerShares: number
  draftPayroll: number // part of payroll still on draft payslips (memo)
  dieselLogged: number
  dieselEstimated: number // already inside the diesel line; kept for the breakdown
  otherTripExpenses: number
  companyDamage: number
  maintenanceParts: number
  billsByCategory: Map<string, number>
  collected: number // memo: cash actually received this month
}

export type PlLine = { label: string; amount: number }

// Round to cents so sums don't show 1234.5600000001.
const cents = (v: number) => Math.round(v * 100) / 100

export function buildProfitLoss(input: ProfitLossInput) {
  const revenue: PlLine[] = [
    { label: 'Trip revenue', amount: input.tripRevenue },
    { label: 'Adjustments (damage charges, discounts, advance billing)', amount: input.adjustments },
  ]

  const bills = Array.from(input.billsByCategory)
    .filter(([category, amount]) => category !== 'Parts' && category !== 'Fuel' && amount !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({ label: `Bills: ${category}`, amount }))

  const costs: PlLine[] = [
    { label: 'Payroll (gross pay)', amount: input.payrollGross },
    { label: 'Employer contributions (SSS, PhilHealth, Pag-IBIG)', amount: input.employerShares },
    { label: 'Diesel on delivered trips', amount: input.dieselLogged + input.dieselEstimated },
    { label: 'Other trip expenses (tolls, parking...)', amount: input.otherTripExpenses },
    { label: 'Damage charged to the company', amount: input.companyDamage },
    { label: 'Maintenance parts used', amount: input.maintenanceParts },
    ...bills,
  ].filter((line) => line.amount !== 0)

  const sum = (lines: PlLine[]) => cents(lines.reduce((s, l) => s + l.amount, 0))
  const totalRevenue = sum(revenue)
  const totalCosts = sum(costs)
  const net = cents(totalRevenue - totalCosts)

  return {
    revenue: revenue.map((l) => ({ ...l, amount: cents(l.amount) })),
    costs: costs.map((l) => ({ ...l, amount: cents(l.amount) })),
    totalRevenue,
    totalCosts,
    net,
    marginPct: totalRevenue > 0 ? Math.round((net / totalRevenue) * 1000) / 10 : null,
    memo: {
      partsBought: cents(input.billsByCategory.get('Parts') ?? 0),
      fuelBought: cents(input.billsByCategory.get('Fuel') ?? 0),
      draftPayroll: cents(input.draftPayroll),
      collected: cents(input.collected),
    },
  }
}
