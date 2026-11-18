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
import { DELIVERED_STATUSES } from './tripStatusFlow'
import { cached } from './shortCache'
import { loadTripPriceChanges, originalRate, priceChangeText } from './tripPriceChanges'

export type Statement = ReturnType<typeof buildStatement>
type LedgerInput = Parameters<typeof buildStatement>[0]

type LedgerResult = {
  input: LedgerInput
  rows: Awaited<ReturnType<typeof loadPaymentDueReport>>['rows']
  error: string | null
}

// Everything buildStatement() needs for one client, or for ALL clients
// when clientId is left out (Financial Summary). `rows` are the matching
// loadPaymentDueReport rows (balances, trip counts). bookingId narrows it to
// one booking (the Billing page). The all-clients ledger is kept for a few
// seconds (lib/shortCache.ts) -- Financial Summary asks for it many times.
export function loadLedgerInputs(clientId?: number, bookingId?: number): Promise<LedgerResult> {
  if (clientId === undefined && bookingId === undefined) return cached('ledger:all', () => readLedgerInputs())
  return readLedgerInputs(clientId, bookingId)
}

async function readLedgerInputs(clientId?: number, bookingId?: number): Promise<LedgerResult> {
  const empty = { input: { bookings: [], trips: [], payments: [], charges: [] }, rows: [] }
  const report = await loadPaymentDueReport(clientId, { includeSettled: true, bookingId })
  if (report.error) return { ...empty, error: report.error }

  const bookingIds = report.rows.map((r) => r.booking_id)
  const bookings = report.rows.map((r) => ({
    booking_id: r.booking_id,
    booking_date: r.booking_date,
    route: `${r.pickup_place_name} → ${r.delivery_place_name}`,
    billable_amount: r.billable_amount,
  }))
  const bookingDateById = new Map(bookings.map((b) => [b.booking_id, b.booking_date]))
  // A trip saved without its own rate bills the booking's.
  const bookingRateById = new Map(report.rows.map((r) => [r.booking_id, r.rate_per_trip ?? 0]))

  const [trips, payments] = await Promise.all([
    fetchIn<{ itinerary_id: number; booking_id: number; trip_rate: number | string | null }>(bookingIds, (chunk, a, b) =>
      supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, trip_rate')
        .in('booking_id', chunk)
        .in('itinerary_status', DELIVERED_STATUSES)
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
  if (trips.error) return { ...empty, error: trips.error }
  if (payments.error) return { ...empty, error: payments.error }

  const tripIds = trips.rows.map((t) => t.itinerary_id)
  const [logs, priceChanges] = await Promise.all([
    fetchIn<{ itinerary_id: number; status_changed_at: string }>(tripIds, (chunk, a, b) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .in('itinerary_id', chunk)
        .eq('new_status', 'Delivered')
        .range(a, b),
    ),
    // A delivered trip repriced later: kept at its original price on its
    // delivery date, each change its own dated line (lib/tripPriceChanges.ts).
    loadTripPriceChanges(tripIds),
  ])
  if (logs.error) return { ...empty, error: logs.error }
  if (priceChanges.error) return { ...empty, error: priceChanges.error }
  const changesByTrip = new Map<number, typeof priceChanges.rows>()
  for (const c of priceChanges.rows) changesByTrip.set(c.itinerary_id, [...(changesByTrip.get(c.itinerary_id) ?? []), c])

  const deliveredOn = new Map<number, string>()
  logs.rows.forEach((l) => {
    const date = toManilaDate(l.status_changed_at)
    if (date > (deliveredOn.get(l.itinerary_id) ?? '')) deliveredOn.set(l.itinerary_id, date)
  })

  const statementTrips: StatementTrip[] = trips.rows.map((t) => ({
    itinerary_id: t.itinerary_id,
    booking_id: t.booking_id,
    rate: originalRate(Number(t.trip_rate ?? bookingRateById.get(t.booking_id) ?? 0), changesByTrip.get(t.itinerary_id) ?? []),
    // A delivered trip with no Delivered log (shouldn't happen) is dated
    // its booking's date rather than dropped.
    delivered_on: deliveredOn.get(t.itinerary_id) ?? bookingDateById.get(t.booking_id) ?? '',
  }))

  return {
    input: {
      bookings,
      trips: statementTrips,
      payments: payments.rows.map((p) => ({ ...p, amount: Number(p.amount) })),
      // Damage / added charges, one line each (same items as the balance),
      // plus each delivered trip's later price changes.
      charges: [
        ...report.rows.flatMap((r) => r.extra_items),
        ...priceChanges.rows.map((c) => ({
          id: c.change_id,
          booking_id: c.booking_id,
          date: c.date,
          description: priceChangeText(c),
          amount: Math.round((c.new_rate - c.old_rate) * 100) / 100,
        })),
      ],
    },
    rows: report.rows,
    error: null,
  }
}

export async function loadStatement(
  clientId: number,
  from: string,
  to: string,
): Promise<{ statement: Statement | null; error: string | null }> {
  const ledger = await loadLedgerInputs(clientId)
  if (ledger.error) return { statement: null, error: ledger.error }
  return { statement: buildStatement(ledger.input, from, to), error: null }
}
