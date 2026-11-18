// cashFlow: loads one month's Money in / Money out for Financial Summary
// (math: buildCashFlow in lib/moneySummary.ts). Manila calendar month.
// What each line reads:
//   Client payments / refunds  booking_payments, non-voided, by paid_on
//   Cash advances paid back    cash_advance_repayments, non-voided, by paid_on
//   Salaries                   net pay of payslips marked Paid, by paid_at
//                              (Manila); Paid before paid_at existed ->
//                              payroll_period_end
//   Government remittances     government_remittances, non-voided, by paid_on
//                              (2026-11-18: what was really sent to SSS /
//                              PhilHealth / Pag-IBIG / BIR -- the shares
//                              withheld from pay stay in our cash until then)
//   Cash advances given        cash_advances Approved, by issued_at
//   Diesel                     distance x diesel price of trips delivered this
//                              month (loadTripProfitReport's dieselEstimate --
//                              the same estimate Profit & Loss counts)
//   Trip expenses              itinerary_expenses, by created_at -- includes the
//                              Fuel top-ups drivers log ON TOP of the estimate
//   Parts / stock bought       inventory_movements 'receive', qty x unit_cost
//   Damage we paid for         the company's share, by decision month
//                              (loadCompanyDamageCost): Company in full,
//                              Insurance = cost - what the insurer covers
//                              (all of it if Denied). The insurer pays the
//                              client / repair shop directly -- that money
//                              never passes through us.
// Left out: the stock that was there before the app ('opening').
import { supabase } from './supabaseClient'
import { fetchAll, loadCompanyDamageCost } from './dashboardExpenses'
import { loadTripProfitReport } from './tripProfit'
import { nextMonthStart } from './remittanceTotals'
import { buildCashFlow, type CashFlow } from './moneySummary'

type PaidPayslip = { net_pay: number }
const PAYSLIP_COLUMNS = 'net_pay'

const sum = <T,>(rows: T[], pick: (row: T) => number) => rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0)

export async function loadCashFlow(month: string): Promise<{ data: CashFlow | null; error: string | null }> {
  const from = `${month}-01`
  const to = nextMonthStart(month)
  const fromTs = `${from}T00:00:00+08:00`
  const toTs = `${to}T00:00:00+08:00`

  const [payments, repayments, paidNow, paidBefore, advances, expenses, received, trips, damage, remitted] = await Promise.all([
    fetchAll<{ amount: number }>((a, b) =>
      supabase.from('booking_payments').select('amount').is('voided_at', null).gte('paid_on', from).lt('paid_on', to).order('payment_id').range(a, b),
    ),
    fetchAll<{ amount: number }>((a, b) =>
      supabase.from('cash_advance_repayments').select('amount').is('voided_at', null).gte('paid_on', from).lt('paid_on', to).order('repayment_id').range(a, b),
    ),
    fetchAll<PaidPayslip>((a, b) =>
      supabase.from('payroll_payslips').select(PAYSLIP_COLUMNS).eq('payslip_status', 'Paid').gte('paid_at', fromTs).lt('paid_at', toTs).order('payroll_id').range(a, b),
    ),
    fetchAll<PaidPayslip>((a, b) =>
      supabase
        .from('payroll_payslips')
        .select(PAYSLIP_COLUMNS)
        .eq('payslip_status', 'Paid')
        .is('paid_at', null)
        .gte('payroll_period_end', from)
        .lt('payroll_period_end', to)
        .order('payroll_id')
        .range(a, b),
    ),
    fetchAll<{ amount: number }>((a, b) =>
      supabase.from('cash_advances').select('amount').eq('status', 'Approved').gte('issued_at', from).lt('issued_at', to).order('cash_advance_id').range(a, b),
    ),
    fetchAll<{ amount: number }>((a, b) =>
      supabase.from('itinerary_expenses').select('amount').gte('created_at', fromTs).lt('created_at', toTs).order('expense_id').range(a, b),
    ),
    fetchAll<{ qty_change: number; unit_cost: number | null }>((a, b) =>
      supabase
        .from('inventory_movements')
        .select('qty_change, unit_cost')
        .eq('reason', 'receive')
        .gte('created_at', fromTs)
        .lt('created_at', toTs)
        .order('movement_id')
        .range(a, b),
    ),
    loadTripProfitReport(month),
    loadCompanyDamageCost(fromTs, toTs),
    fetchAll<{ amount: number }>((a, b) =>
      supabase
        .from('government_remittances')
        .select('amount')
        .is('voided_at', null)
        .gte('paid_on', from)
        .lt('paid_on', to)
        .order('remittance_id')
        .range(a, b),
    ),
  ])
  const error =
    payments.error ?? repayments.error ?? paidNow.error ?? paidBefore.error ?? advances.error ?? expenses.error ?? received.error ??
    trips.error ?? damage.error ?? remitted.error
  if (error) return { data: null, error }

  const paid = [...paidNow.rows, ...paidBefore.rows]
  return {
    data: buildCashFlow({
      clientPayments: sum(payments.rows.filter((p) => Number(p.amount) > 0), (p) => p.amount),
      refunds: -sum(payments.rows.filter((p) => Number(p.amount) < 0), (p) => p.amount),
      repayments: sum(repayments.rows, (r) => r.amount),
      salariesPaid: sum(paid, (p) => p.net_pay),
      remittances: sum(remitted.rows, (r) => r.amount),
      advancesGiven: sum(advances.rows, (a) => a.amount),
      dieselEstimated: sum(trips.rows, (t) => t.dieselEstimate),
      tripExpenses: sum(expenses.rows, (e) => e.amount),
      companyDamage: damage.total,
      // A price-less receive (needs price) counts as ₱0 until it's priced.
      stockBought: sum(received.rows, (m) => Number(m.qty_change) * Number(m.unit_cost ?? 0)),
    }),
    error: null,
  }
}
