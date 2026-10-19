// bookingPayments: how payments are saved. Every payment (and refund) is one
// row in booking_payments, written ONLY through the database function
// record_booking_payment() -- that inserts the row (and, when asked, locks
// bookings.amount_to_pay) in one transaction, and a trigger then keeps
// bookings.amount_paid equal to the sum of the non-voided rows. So nothing
// in the app writes amount_paid directly any more.
// A refund is a row with a NEGATIVE amount and method 'Refund'.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'

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
