// bookingPayments: how payments are saved. Every payment (and refund) is one
// row in booking_payments, written ONLY through the database function
// record_booking_payment() -- that inserts the row (and, when asked, locks
// bookings.amount_to_pay) in one transaction, and a trigger then keeps
// bookings.amount_paid equal to the sum of the non-voided rows. So nothing
// in the app writes amount_paid directly any more.
// A refund is a row with a NEGATIVE amount and method 'Refund'.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'
import { csvField } from './inventoryReport'
import { fetchAll, fetchIn } from './dashboardExpenses'

// What staff can pick when money comes in ('Refund' is only used by the
// Mark Refunded action).
export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'GCash', 'Check', 'Other'] as const

export type PaymentDetails = {
  method: (typeof PAYMENT_METHODS)[number] | 'Refund'
  paidOn: string // YYYY-MM-DD, '' = today
  referenceNo: string
  orNumber: string
  note: string
}

export function emptyPaymentDetails(): PaymentDetails {
  return { method: 'Cash', paidOn: toManilaDate(new Date()), referenceNo: '', orNumber: '', note: '' }
}

// Error text for a bad "date received", or null when it's fine.
export function paymentDateError(paidOn: string): string | null {
  if (paidOn && paidOn > toManilaDate(new Date())) return "Date received can't be in the future."
  return null
}

// ---- Collections page (every payment, newest first) ----

export type PaymentRow = {
  payment_id: number
  booking_id: number
  amount: number
  paid_on: string
  method: string
  reference_no: string | null
  or_number: string | null
  note: string | null
  created_at: string
  voided_at: string | null
  void_reason: string | null
  client_id: number
  client_name: string
  invoice_number: string | null
  recorded_by_name: string
  voided_by_name: string | null
}

type RawPayment = Omit<
  PaymentRow,
  'client_id' | 'client_name' | 'invoice_number' | 'recorded_by_name' | 'voided_by_name'
> & { recorded_by: number | null; voided_by: number | null }

// Payments whose "date received" falls between from and to (YYYY-MM-DD,
// both included), voided ones too -- the page decides whether to show them.
export async function loadPayments(
  from: string,
  to: string,
): Promise<{ rows: PaymentRow[]; error: string | null }> {
  const payments = await fetchAll<RawPayment>((a, b) =>
    supabase
      .from('booking_payments')
      .select(
        'payment_id, booking_id, amount, paid_on, method, reference_no, or_number, note, recorded_by, created_at, voided_at, voided_by, void_reason',
      )
      .gte('paid_on', from)
      .lte('paid_on', to)
      .order('paid_on', { ascending: false })
      .order('payment_id', { ascending: false })
      .range(a, b),
  )
  if (payments.error) return { rows: [], error: payments.error }

  const bookingIds = Array.from(new Set(payments.rows.map((p) => p.booking_id)))
  const bookings = await fetchIn<{ booking_id: number; client_id: number; invoice_number: string | null }>(
    bookingIds,
    (chunk, a, b) =>
      supabase
        .from('bookings')
        .select('booking_id, client_id, invoice_number')
        .in('booking_id', chunk)
        .range(a, b),
  )
  if (bookings.error) return { rows: [], error: bookings.error }

  const clientIds = Array.from(new Set(bookings.rows.map((b) => b.client_id)))
  const employeeIds = Array.from(
    new Set(
      payments.rows
        .flatMap((p) => [p.recorded_by, p.voided_by])
        .filter((id): id is number => id !== null),
    ),
  )
  const [clients, employees] = await Promise.all([
    fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, a, b) =>
      supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(a, b),
    ),
    fetchIn<{ employee_id: number; full_name: string | null }>(employeeIds, (chunk, a, b) =>
      supabase.from('employees').select('employee_id, full_name').in('employee_id', chunk).range(a, b),
    ),
  ])
  if (clients.error) return { rows: [], error: clients.error }
  if (employees.error) return { rows: [], error: employees.error }

  const bookingById = new Map(bookings.rows.map((b) => [b.booking_id, b]))
  const clientNameById = new Map(clients.rows.map((c) => [c.client_id, c.client_name]))
  const employeeNameById = new Map(employees.rows.map((e) => [e.employee_id, e.full_name ?? `Employee #${e.employee_id}`]))

  const rows: PaymentRow[] = payments.rows.map(({ recorded_by, voided_by, ...p }) => {
    const booking = bookingById.get(p.booking_id)
    return {
      ...p,
      amount: Number(p.amount),
      client_id: booking?.client_id ?? 0,
      client_name: booking ? (clientNameById.get(booking.client_id) ?? '—') : '—',
      invoice_number: booking?.invoice_number ?? null,
      // An admin with no employees row linked shows as a dash (see CLAUDE.md).
      recorded_by_name: recorded_by !== null ? (employeeNameById.get(recorded_by) ?? '—') : '—',
      voided_by_name: voided_by !== null ? (employeeNameById.get(voided_by) ?? '—') : null,
    }
  })
  return { rows, error: null }
}

// Voids one payment (the row stays, with the reason). Returns an error
// message, or null when done.
export async function voidBookingPayment(paymentId: number, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('void_booking_payment', {
    p_payment_id: paymentId,
    p_reason: reason,
  })
  return error ? error.message : null
}

// Plain numbers so the CSV opens as numbers in Excel.
export function buildCollectionsCsv(from: string, to: string, rows: PaymentRow[]): string {
  const header = [
    'Payment #', 'Date Received', 'Booking #', 'Client', 'Invoice No.', 'Method', 'Amount',
    'Reference No.', 'OR Number', 'Note', 'Recorded By', 'Status', 'Void Reason',
  ]
  const lines = rows.map((r) => [
    r.payment_id, r.paid_on, r.booking_id, r.client_name, r.invoice_number ?? '', r.method, r.amount,
    r.reference_no ?? '', r.or_number ?? '', r.note ?? '', r.recorded_by_name,
    r.voided_at ? 'Voided' : 'Counted', r.void_reason ?? '',
  ])
  return [`Collections - ${from} to ${to}`, '', header, ...lines]
    .map((cells) => (Array.isArray(cells) ? cells.map(csvField).join(',') : cells))
    .join('\n')
}

// Returns an error message, or null when saved.
export async function recordBookingPayment(args: {
  bookingId: number
  amount: number // positive = payment received, negative = refund
  details: PaymentDetails
  // Lock the booking's delivery amount in the same transaction (Paid Full /
  // Partial Payment do this -- see FinancialSection.getDeliveryTarget).
  setAmountToPay?: number
}): Promise<string | null> {
  const { error } = await supabase.rpc('record_booking_payment', {
    p_booking_id: args.bookingId,
    p_amount: args.amount,
    p_method: args.details.method,
    p_paid_on: args.details.paidOn || null,
    p_reference_no: args.details.referenceNo || null,
    p_or_number: args.details.orNumber || null,
    p_note: args.details.note || null,
    p_set_amount_to_pay: args.setAmountToPay ?? null,
  })
  return error ? error.message : null
}
