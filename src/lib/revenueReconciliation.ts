// revenueReconciliation: loads one month for Accounting -> Revenue
// Reconciliation. It reuses the Statement of Account ledger (statement.ts /
// statementTotals.ts) for ALL clients at once, so billed and collected here
// are the same numbers as on every statement; the splitting and the
// per-booking "why do they differ" is in revenueReconTotals.ts.
//
// It also computes what the Admin dashboard's "Total Revenue (collected)"
// card would show for the same month, so the two can be compared:
// bookings created in the month (not Cancelled), their amount_paid to date.
import { supabase } from './supabaseClient'
import { loadLedgerInputs } from './statement'
import { buildStatement } from './statementTotals'
import { reconcileRevenue, type BookingMeta } from './revenueReconTotals'
import { nextMonthStart } from './remittanceTotals'

// Last day of "YYYY-MM" as YYYY-MM-DD.
function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10)
}

export async function loadRevenueReconciliation(month: string) {
  const from = `${month}-01`
  const to = lastDayOfMonth(month)

  const [ledger, dashboard] = await Promise.all([
    loadLedgerInputs(),
    supabase
      .from('bookings')
      .select('amount_paid')
      .neq('booking_status', 'Cancelled')
      .gte('booking_date', from)
      .lt('booking_date', nextMonthStart(month)),
  ])
  if (ledger.error) return { data: null, error: ledger.error }
  if (dashboard.error) return { data: null, error: dashboard.error.message }

  const statement = buildStatement(ledger.input, from, to)
  const meta = new Map<number, BookingMeta>(
    ledger.rows.map((r) => [
      r.booking_id,
      {
        client_name: r.client_name,
        balance_due: r.balance_due,
        total_trips: r.total_trips,
        completed_trips: r.completed_trips,
      },
    ]),
  )

  return {
    data: {
      ...reconcileRevenue(statement.lines, meta),
      opening: statement.opening,
      closing: statement.closing,
      dashboardCard: dashboard.data.reduce((s, b) => s + Number(b.amount_paid ?? 0), 0),
    },
    error: null,
  }
}
