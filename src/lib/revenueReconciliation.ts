// revenueReconciliation: loads one month for Accounting -> Revenue
// Reconciliation. It reuses the Statement of Account ledger (statement.ts /
// statementTotals.ts) for ALL clients at once, so billed and collected here
// are the same numbers as on every statement; the splitting and the
// per-booking "why do they differ" is in revenueReconTotals.ts.
// Read by Financial Summary (through profitLoss.ts); its own page was removed.
import { supabase } from './supabaseClient'
import { loadLedgerInputs } from './statement'
import { buildStatement } from './statementTotals'
import { reconcileRevenue, unpaidAtMonthStart, type BookingMeta, type ReconRow } from './revenueReconTotals'
import { fetchIn } from './dashboardExpenses'
import { toManilaDate } from './payslip'
import { DELIVERED_STATUSES } from './tripStatusFlow'

// Last day of "YYYY-MM" as YYYY-MM-DD.
function lastDayOfMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10)
}

export async function loadRevenueReconciliation(month: string) {
  const from = `${month}-01`
  const to = lastDayOfMonth(month)

  const ledger = await loadLedgerInputs()
  if (ledger.error) return { data: null, error: ledger.error }

  const statement = buildStatement(ledger.input, from, to)
  const meta = new Map<number, BookingMeta>(
    ledger.rows.map((r) => [
      r.booking_id,
      {
        client_id: r.client_id,
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
    },
    error: null,
  }
}

// ---- The trips behind two of the "why" lines (Financial Summary) ----
// "Paid ahead"            -> the booking's trips not delivered yet
// "Paid for earlier months" -> trips delivered before the month that were
//                           still unpaid when it started (unpaidAtMonthStart)
export type GapTrip = {
  itinerary_id: number
  date: string | null // delivered on / planned for (Manila)
  note: string // "delivered", "not delivered yet (Awaiting)"
  amount: number // the trip's price, or what was still unpaid on it
}
export type GapBooking = { booking_id: number; client_name: string; amount: number; trips: GapTrip[] }

export async function loadGapTrips(
  month: string,
  rows: ReconRow[],
): Promise<{ ahead: GapBooking[]; earlier: GapBooking[]; error: string | null }> {
  const from = `${month}-01`
  const aheadRows = rows.filter((r) => r.reason === 'Paid ahead of delivery')
  const earlierRows = rows.filter((r) => r.reason === 'Paying earlier months')

  // Paid ahead: the trips still to be delivered.
  const waiting = await fetchIn<{
    itinerary_id: number
    booking_id: number
    itinerary_status: string | null
    trip_start_at: string | null
    trip_date_from: string | null
    trip_rate: number | string | null
  }>(
    aheadRows.map((r) => r.booking_id),
    (chunk, a, b) =>
      supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, itinerary_status, trip_start_at, trip_date_from, trip_rate')
        .in('booking_id', chunk)
        .order('itinerary_id')
        .range(a, b),
  )
  if (waiting.error) return { ahead: [], earlier: [], error: waiting.error }
  const ahead: GapBooking[] = aheadRows.map((r) => ({
    booking_id: r.booking_id,
    client_name: r.client_name,
    amount: -r.difference,
    trips: waiting.rows
      .filter(
        (t) =>
          t.booking_id === r.booking_id && t.itinerary_status !== 'Cancelled' && !DELIVERED_STATUSES.includes(t.itinerary_status ?? ''),
      )
      .map((t) => ({
        itinerary_id: t.itinerary_id,
        date: t.trip_start_at ? toManilaDate(t.trip_start_at) : t.trip_date_from,
        note: `not delivered yet (${t.itinerary_status ?? 'Awaiting'})`,
        amount: Number(t.trip_rate ?? 0),
      })),
  }))

  // Earlier months: the same ledger the statement uses (kept a few seconds).
  if (earlierRows.length === 0) return { ahead, earlier: [], error: null }
  const ledger = await loadLedgerInputs()
  if (ledger.error) return { ahead, earlier: [], error: ledger.error }
  const earlier: GapBooking[] = earlierRows.map((r) => {
    const own = <T extends { booking_id: number }>(list: T[]) => list.filter((x) => x.booking_id === r.booking_id)
    const paidBefore = own(ledger.input.payments)
      .filter((p) => p.paid_on < from)
      .reduce((sum, p) => sum + p.amount, 0)
    const unpaid = unpaidAtMonthStart(
      own(ledger.input.trips).map((t) => ({ id: t.itinerary_id, date: t.delivered_on, amount: t.rate })),
      own(ledger.input.charges ?? []).map((c) => ({ id: c.id, date: c.date, amount: c.amount })),
      paidBefore,
      from,
    )
    return {
      booking_id: r.booking_id,
      client_name: r.client_name,
      amount: -r.difference,
      trips: unpaid.map((t) => ({
        itinerary_id: t.id,
        date: t.date,
        note: t.unpaid < t.amount ? `delivered · ₱${t.amount.toLocaleString()} trip, rest unpaid` : 'delivered',
        amount: t.unpaid,
      })),
    }
  })
  return { ahead, earlier, error: null }
}

