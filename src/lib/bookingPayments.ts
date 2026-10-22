// bookingPayments: how payments are saved. Every payment (and refund) is one
// row in booking_payments, written ONLY through the database function
// record_booking_payment() -- that inserts the row (and, when asked, locks
// bookings.amount_to_pay) in one transaction, and a trigger then keeps
// bookings.amount_paid equal to the sum of the non-voided rows. So nothing
// in the app writes amount_paid directly any more.
// A refund is a row with a NEGATIVE amount and method 'Refund'.
//
// Payment tracking (#12): GCash / Bank Transfer / Check payments need a
// reference no. (the database refuses them without one too --
// booking_payments_reference_required). A screenshot/PDF of the transfer
// can be attached: it's uploaded to the private Storage bucket
// `payment-proofs` at <booking_id>/<file>, then linked to the saved row
// (booking_payments.proof_path) by attach_payment_proof() -- Admin only.
import { supabase } from './supabaseClient'
import { showToast } from '../components/Toast'
import { confirmDialog } from '../components/ConfirmDialog'
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
  // Optional screenshot/PDF of the transfer.
  proof: File | null
}

export function emptyPaymentDetails(): PaymentDetails {
  return { method: 'Cash', paidOn: toManilaDate(new Date()), referenceNo: '', orNumber: '', note: '', proof: null }
}

// Amount boxes: see lib/amountInput.ts (re-exported for the payment forms).
export { cents, filterAmountInput, parseAmount } from './amountInput'

// Methods that must carry a reference no. (check no. for a Check).
export const REFERENCE_REQUIRED_METHODS: PaymentDetails['method'][] = ['GCash', 'Bank Transfer', 'Check']
export const referenceRequired = (method: PaymentDetails['method']) => REFERENCE_REQUIRED_METHODS.includes(method)

export const PROOF_BUCKET = 'payment-proofs'
const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const PROOF_ACCEPT = PROOF_TYPES.join(',')
const PROOF_MAX_BYTES = 5 * 1024 * 1024

// Problem with the attached proof file, or null when fine / none attached.
export function proofFileError(file: File | null): string | null {
  if (!file) return null
  // iPhone photos are HEIC by default; browsers can't show them.
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    return "iPhone HEIC photos aren't supported -- take a screenshot (PNG) or export the photo as JPG."
  }
  if (!PROOF_TYPES.includes(file.type)) return 'Proof must be a JPG, PNG, WEBP or PDF file.'
  if (file.size > PROOF_MAX_BYTES) return 'Proof file is too big (max 5 MB).'
  return null
}

// First problem with the payment details (date, reference, proof), or null.
// `earliest` (YYYY-MM-DD) = the day the booking was created, if known.
export function paymentDetailsError(details: PaymentDetails, earliest?: string): string | null {
  return (
    paymentDateError(details.paidOn, earliest) ??
    (referenceRequired(details.method) && !details.referenceNo.trim()
      ? `Enter the reference no. for this ${details.method} payment.`
      : null) ??
    proofFileError(details.proof)
  )
}

// Opens an attached proof in a new tab (signed link, valid 1 minute).
export async function openPaymentProof(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 60)
  if (error || !data) return error?.message ?? 'Could not open the proof.'
  window.open(data.signedUrl, '_blank', 'noopener')
  return null
}

// Error text for a bad "date received", or null when it's fine.
export function paymentDateError(paidOn: string, earliest?: string): string | null {
  if (paidOn && paidOn > toManilaDate(new Date())) return "Date received can't be in the future."
  if (paidOn && earliest && paidOn < earliest) return "Date received can't be before the booking was made."
  return null
}

// A non-voided payment already carrying this reference no. (case and
// spaces ignored), or null. One GCash/bank reference = one transfer, so a
// repeat usually means the same money is being recorded twice.
export async function findPaymentWithReference(
  referenceNo: string,
): Promise<{ payment_id: number; booking_id: number } | null> {
  const ref = referenceNo.trim()
  if (!ref) return null
  const { data } = await supabase
    .from('booking_payments')
    .select('payment_id, booking_id')
    .ilike('reference_no', ref.replace(/[%_\\]/g, (c) => `\\${c}`))
    .is('voided_at', null)
    .limit(1)
    .maybeSingle()
  return data ?? null
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
  // Storage path of the attached transfer screenshot/PDF, if any.
  proof_path: string | null
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
        'payment_id, booking_id, amount, paid_on, method, reference_no, or_number, note, proof_path, recorded_by, created_at, voided_at, voided_by, void_reason',
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
  // The day the booking was created (YYYY-MM-DD): no payment before it.
  earliest?: string
}): Promise<string | null> {
  const problem = paymentDetailsError(args.details, args.earliest)
  if (problem) return problem

  // Same reference already recorded? Ask before saving it twice.
  const duplicate = await findPaymentWithReference(args.details.referenceNo)
  if (
    duplicate &&
    !(await confirmDialog({
      title: 'Reference already used',
      message:
        `Reference "${args.details.referenceNo.trim()}" is already on payment #${duplicate.payment_id} ` +
        `(Booking #${duplicate.booking_id}). Record this payment anyway?`,
      confirmLabel: 'Record anyway',
      danger: true,
    }))
  ) {
    return 'Not recorded -- that reference no. is already on another payment.'
  }

  // 1. Upload the proof first, so a failed upload saves nothing.
  const proof = args.details.proof
  let proofPath: string | null = null
  if (proof) {
    const safeName = proof.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80)
    proofPath = `${args.bookingId}/${Date.now()}-${safeName}`
    const { error: uploadError } = await supabase.storage
      .from(PROOF_BUCKET)
      .upload(proofPath, proof, { contentType: proof.type })
    if (uploadError) return `The proof couldn't be uploaded (${uploadError.message}). Nothing was saved.`
  }

  // 2. Save the payment.
  const { error } = await supabase.rpc('record_booking_payment', {
    p_booking_id: args.bookingId,
    p_amount: args.amount,
    p_method: args.details.method,
    p_paid_on: args.details.paidOn || null,
    p_reference_no: args.details.referenceNo.trim() || null,
    p_or_number: args.details.orNumber.trim() || null,
    p_note: args.details.note.trim() || null,
    p_set_amount_to_pay: args.setAmountToPay ?? null,
  })
  if (error) {
    if (proofPath) await supabase.storage.from(PROOF_BUCKET).remove([proofPath])
    return error.message
  }

  // 3. Link the proof to the row just saved: the newest matching payment
  // on this booking that has no proof yet. The payment itself is already
  // saved, so a failure here is only a warning -- never an error (an
  // error makes the form keep the amount, and saving again would record
  // the payment twice).
  if (proofPath) {
    // ponytail: "newest matching row" -- two admins saving the same amount
    // on the same booking in the same instant could swap proofs; have
    // record_booking_payment return the new id if that ever matters.
    const { data: saved } = await supabase
      .from('booking_payments')
      .select('payment_id')
      .eq('booking_id', args.bookingId)
      .eq('amount', args.amount)
      .is('proof_path', null)
      .is('voided_at', null)
      .order('payment_id', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { error: attachError } = saved
      ? await supabase.rpc('attach_payment_proof', { p_payment_id: saved.payment_id, p_path: proofPath })
      : { error: { message: 'saved payment not found' } }
    if (attachError) {
      await supabase.storage.from(PROOF_BUCKET).remove([proofPath])
      showToast(`Payment saved, but the proof wasn't attached (${attachError.message}).`, 'error')
    }
  }
  return null
}
