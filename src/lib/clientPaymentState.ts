// clientPaymentState: where a booking's payment stands, in the client's
// words -- the state chip and the "what's due" line on the client portal's
// Payments cards and the Payment column on My Bookings (the canvas's Client
// Payments boards). Pure (self-check: node scripts/check-client-payment-state.ts).
//
// Reads what's already worked out elsewhere: the balance and due date from
// lib/paymentDue.ts, the downpayment from lib/downpayment.ts. Nothing new
// is calculated here, it only picks the words.
import type { DownpaymentStatus } from './downpayment.ts'
import { formatDate, formatMoney } from './format.ts'

// The bits of a PaymentDueRow this needs (kept small so it stays pure).
export type DueInfo = {
  balance_due: number
  total_trips: number
  completed_trips: number
  due_date: string | null
  days_until_due: number | null
}

export type PaymentStateKey = 'downpaymentDue' | 'due' | 'overdue' | 'paid' | 'none'

export type PaymentState = { key: PaymentStateKey; label: string; detail: string }

// Chip colours per state (same tones as StatusBadge).
export const PAYMENT_STATE_STYLES: Record<PaymentStateKey, { chip: string; foot: string }> = {
  downpaymentDue: { chip: 'bg-amber-100 text-amber-900', foot: 'bg-amber-50 text-amber-900' },
  due: { chip: 'bg-primary-soft text-primary', foot: 'bg-primary-soft text-primary' },
  overdue: { chip: 'bg-red-100 text-red-800', foot: 'bg-red-50 text-red-800' },
  paid: { chip: 'bg-green-100 text-green-800', foot: 'bg-green-50 text-green-800' },
  none: { chip: 'bg-slate-200 text-ink-secondary', foot: 'bg-slate-50 text-ink-secondary' },
}

export function clientPaymentState(row: DueInfo | undefined, downpayment: DownpaymentStatus | null): PaymentState {
  // Before any trip can start, the downpayment is what matters.
  if (downpayment && !downpayment.met && !downpayment.waived) {
    return {
      key: 'downpaymentDue',
      label: 'Downpayment due',
      detail: `Downpayment ${formatMoney(downpayment.missing)} due before the first trip`,
    }
  }
  // Not in the payment report: nothing billed (e.g. cancelled before any delivery).
  if (!row) return { key: 'none', label: 'Nothing billed', detail: 'Nothing due' }

  const balance = row.balance_due
  if (balance > 0 && row.days_until_due !== null && row.days_until_due < 0) {
    const late = Math.abs(row.days_until_due)
    return {
      key: 'overdue',
      label: 'Overdue',
      detail: `${formatMoney(balance)} was due ${row.due_date ? formatDate(row.due_date) : ''} · ${late} ${late === 1 ? 'day' : 'days'} late`,
    }
  }
  if (balance <= 0) {
    return row.completed_trips >= row.total_trips && row.total_trips > 0
      ? { key: 'paid', label: 'Paid in full', detail: 'Nothing due' }
      : {
          key: 'due',
          label: downpayment ? 'Downpayment paid' : 'Paid so far',
          detail: 'Nothing due yet. The rest is billed as trips are delivered.',
        }
  }
  return {
    key: 'due',
    label: downpayment ? 'Downpayment paid' : 'Payment due',
    detail: row.due_date
      ? `Rest ${formatMoney(balance)} due ${formatDate(row.due_date)}`
      : `${formatMoney(balance)} · the due date starts when a trip is delivered`,
  }
}
