// statement: loads one client's billing + payments for Accounting ->
// Statements of Account and hands them to buildStatement()
// (statementTotals.ts, self-checked) to make the dated ledger.
//
// Per-booking billable amounts come from loadPaymentDueReport() with
// includeSettled -- the exact same numbers Bills Receivable, AR Aging and
// the client portal use, so the statement can't disagree with them.
// A delivered trip's date is its latest Delivered row in
// dispatch_status_logs (Manila time), same as payroll / Payments Due.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'
import { loadPaymentDueReport } from './paymentDue'
import { fetchIn } from './dashboardExpenses'
import { buildStatement, type StatementPayment, type StatementTrip } from './statementTotals'

export type Statement = ReturnType<typeof buildStatement>

export async function loadStatement(
  clientId: number,
  from: string,
  to: string,
): Promise<{ statement: Statement | null; error: string | null }> {
  const report = await loadPaymentDueReport(clientId, { includeSettled: true })
  if (report.error) return { statement: null, error: report.error }

  const bookingIds = report.rows.map((r) => r.booking_id)
  const bookings = report.rows.map((r) => ({
    booking_id: r.booking_id,
    booking_date: r.booking_date,
    route: `${r.pickup_place_name} → ${r.delivery_place_name}`,
    rate: r.rate_per_trip ?? 0,
    billable_amount: r.billable_amount,
  }))
  const bookingDateById = new Map(bookings.map((b) => [b.booking_id, b.booking_date]))

  const [trips, payments] = await Promise.all([
    fetchIn<{ itinerary_id: number; booking_id: number }>(bookingIds, (chunk, a, b) =>
      supabase
        .from('itineraries')
        .select('itinerary_id, booking_id')
        .in('booking_id', chunk)
        .eq('itinerary_status', 'Delivered')
        .range(a, b),
    ),
    fetchIn<StatementPayment>(bookingIds, (chunk, a, b) =>
      supabase
        .from('booking_payments')
        .select('payment_id, booking_id, amount, paid_on, method, reference_no, or_number')
        .in('booking_id', chunk)
        .is('voided_at', null)
        .range(a, b),
    ),
  ])
  if (trips.error) return { statement: null, error: trips.error }
  if (payments.error) return { statement: null, error: payments.error }

  const logs = await fetchIn<{ itinerary_id: number; status_changed_at: string }>(
    trips.rows.map((t) => t.itinerary_id),
    (chunk, a, b) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .in('itinerary_id', chunk)
        .eq('new_status', 'Delivered')
        .range(a, b),
  )
  if (logs.error) return { statement: null, error: logs.error }

  const deliveredOn = new Map<number, string>()
  logs.rows.forEach((l) => {
    const date = toManilaDate(l.status_changed_at)
    if (date > (deliveredOn.get(l.itinerary_id) ?? '')) deliveredOn.set(l.itinerary_id, date)
  })

  const statementTrips: StatementTrip[] = trips.rows.map((t) => ({
    ...t,
    // A delivered trip with no Delivered log (shouldn't happen) is dated
    // its booking's date rather than dropped.
    delivered_on: deliveredOn.get(t.itinerary_id) ?? bookingDateById.get(t.booking_id) ?? from,
  }))

  return {
    statement: buildStatement(
      {
        bookings,
        trips: statementTrips,
        payments: payments.rows.map((p) => ({ ...p, amount: Number(p.amount) })),
      },
      from,
      to,
    ),
    error: null,
  }
}
