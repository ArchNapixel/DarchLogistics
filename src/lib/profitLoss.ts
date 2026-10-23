// profitLoss: loads one month for Accounting -> Profit & Loss. Every figure
// comes from a loader another page already uses, so the P&L can't disagree
// with them:
//   revenue / collected  -> loadRevenueReconciliation (Revenue Reconciliation)
//   diesel / trip costs  -> loadTripProfitReport      (Trip Profitability)
//   maintenance parts    -> loadMaintenanceCostReport (Maintenance cost report)
//   payroll              -> payroll_payslips by payroll_period_end (drafts too)
//   bills                -> bills by bill_date, not voided (Accounts Payable)
// What is and isn't counted (and why) is in profitLossTotals.ts.
import { supabase } from './supabaseClient'
import { fetchAll } from './dashboardExpenses'
import { payslipCost, type PayslipCostRow } from './expenseTotals'
import { loadRevenueReconciliation } from './revenueReconciliation'
import { loadTripProfitReport } from './tripProfit'
import { loadMaintenanceCostReport } from './maintenanceCostReport'
import { nextMonthStart } from './remittanceTotals'
import { buildProfitLoss } from './profitLossTotals'

// Also returned (for the Money Summary tab): the month's delivered trip
// count and the plain cost amounts before they become P&L lines.
export type ProfitLoss = ReturnType<typeof buildProfitLoss> & {
  tripCount: number
  // Each booking's revenue this month (trips + adjustments), with its client.
  revenueRows: { client_name: string; amount: number }[]
  parts: {
    payroll: number // gross + employer shares
    diesel: number // logged + estimated
    dieselEstimated: number // part of diesel that is the calculator's estimate
    dieselEstimatedTrips: number // trips with no fuel logged
    tripExpenses: number
    companyDamage: number
    maintenanceParts: number
  }
}

export async function loadProfitLoss(
  month: string,
): Promise<{ data: ProfitLoss | null; error: string | null }> {
  const from = `${month}-01`
  const to = nextMonthStart(month)

  const [recon, trips, maintenance, payslips, bills] = await Promise.all([
    loadRevenueReconciliation(month),
    loadTripProfitReport(month),
    loadMaintenanceCostReport(month),
    fetchAll<PayslipCostRow & { finalized_at: string | null }>((a, b) =>
      supabase
        .from('payroll_payslips')
        .select('finalized_at, gross_pay, sss_er, sss_ec, philhealth_er, pagibig_er')
        .gte('payroll_period_end', from)
        .lt('payroll_period_end', to)
        .range(a, b),
    ),
    fetchAll<{ category: string; amount: number | string }>((a, b) =>
      supabase
        .from('bills')
        .select('category, amount')
        .gte('bill_date', from)
        .lt('bill_date', to)
        .is('voided_at', null)
        .range(a, b),
    ),
  ])

  const firstError =
    recon.error ?? trips.error ?? maintenance.error ?? payslips.error ?? bills.error
  if (firstError || !recon.data) return { data: null, error: firstError ?? 'Could not load revenue.' }

  let payrollGross = 0
  let employerShares = 0
  let draftPayroll = 0
  payslips.rows.forEach((row) => {
    const cost = payslipCost(row)
    payrollGross += cost.gross
    employerShares += cost.employerShares
    if (!row.finalized_at) draftPayroll += cost.total
  })

  let dieselLogged = 0
  let dieselEstimated = 0
  let dieselEstimatedTrips = 0
  let otherTripExpenses = 0
  let companyDamage = 0
  trips.rows.forEach((t) => {
    if (t.dieselEstimated) {
      dieselEstimated += t.diesel
      dieselEstimatedTrips += 1
    } else dieselLogged += t.diesel
    otherTripExpenses += t.otherExpenses
    companyDamage += t.companyDamage
  })

  const billsByCategory = new Map<string, number>()
  bills.rows.forEach((b) =>
    billsByCategory.set(b.category, (billsByCategory.get(b.category) ?? 0) + Number(b.amount)),
  )

  const maintenanceParts = maintenance.workOrders.reduce((s, w) => s + w.total, 0)

  return {
    data: {
      ...buildProfitLoss({
      tripRevenue: recon.data.tripRevenue,
      adjustments: recon.data.adjustments,
      payrollGross,
      employerShares,
      draftPayroll,
      dieselLogged,
      dieselEstimated,
      otherTripExpenses,
      companyDamage,
      maintenanceParts,
      billsByCategory,
      collected: recon.data.collected,
      }),
      tripCount: trips.rows.length,
      revenueRows: recon.data.rows.map((r) => ({
        client_name: r.client_name,
        amount: r.trip_revenue + r.adjustments,
      })),
      parts: {
        payroll: payrollGross + employerShares,
        diesel: dieselLogged + dieselEstimated,
        // The part of diesel that is the calculator's estimate (trips with
        // no fuel logged), and how many trips -- Money Summary notes it.
        dieselEstimated,
        dieselEstimatedTrips,
        tripExpenses: otherTripExpenses,
        companyDamage,
        maintenanceParts,
      },
    },
    error: null,
  }
}
