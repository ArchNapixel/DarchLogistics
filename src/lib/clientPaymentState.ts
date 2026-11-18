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
  // The part of the balance already past its own due date (paymentDue.ts);
  // left out = treat the whole balance as overdue once due_date has passed.
  overdue_amount?: number
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
    // Only the overdue part is late; a newer trip may not be due yet.
    const lateAmount = row.overdue_amount !== undefined && row.overdue_amount > 0 ? Math.min(row.overdue_amount, balance) : balance
    const rest = Math.round((balance - lateAmount) * 100) / 100
    return {
      key: 'overdue',
      label: 'Overdue',
      detail:
        `${formatMoney(lateAmount)} was due ${row.due_date ? formatDate(row.due_date) : ''} · ${late} ${late === 1 ? 'day' : 'days'} late` +
        (rest > 0 ? ` · ${formatMoney(rest)} not due yet` : ''),
    }
  }
  if (balance <= 0) {
    // No live trips left (every trip cancelled) and nothing owed: it's settled,
    // there is no "rest to be billed", so it belongs with the paid ones.
    if (row.total_trips === 0) return { key: 'paid', label: 'Nothing to pay', detail: 'All trips cancelled · nothing due' }
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
