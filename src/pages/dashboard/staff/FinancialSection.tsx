// FinancialSection: where payments actually get recorded. Reuses the
// same Booking type/loading logic as BookingsSection.tsx (rate is per
// trip, so billable_amount = amount_to_pay override if staff has set
// one, otherwise computed_billable_amount = rate x trips Delivered so
// far -- plus approved Client damage charges on top, see
// BookingsSection.tsx / src/lib/paymentDue.ts / src/lib/damageCharges.ts
// for the full rule). amount_to_pay is only ever the DELIVERY amount --
// damage is never written into it. This page is the one place that WRITES amount_to_pay
// and records payments: each payment/refund is a booking_payments row saved
// through lib/bookingPayments.ts (a DB trigger then keeps bookings.amount_paid
// = the sum of non-voided rows -- never write amount_paid directly). The
// Payments Due panel/tab (Bookings page, Reports page) and the client portal
// are read-only views of the same numbers.
//
// Downpayment (#10/#11): bookings with a saved cost_per_trip need a
// downpayment before any trip can start (lib/downpayment.ts). The
// Downpayment column shows what's still missing, and its button records a
// payment WITHOUT locking amount_to_pay -- so billing still follows the
// delivered trips and the payment terms count from delivery, just with
// less left to pay. Paid ahead of delivery shows as "Paid ahead", not
// "Refund".
import { useEffect, useRef, useState } from 'react'
import { usePaged } from '../../../lib/usePaged'
import { Link, useSearchParams } from 'react-router-dom'
import type { Booking } from './BookingsSection'
import StatusBadge from '../../../components/StatusBadge'
import { supabase } from '../../../lib/supabaseClient'
import { loadExtraChargesByBooking } from '../../../lib/bookingCharges'
import { confirmDialog } from '../../../components/ConfirmDialog'
import {
  PAYMENT_METHODS,
  PROOF_ACCEPT,
  cents,
  emptyPaymentDetails,
  filterAmountInput,
  parseAmount,
  paymentDateError,
  paymentDetailsError,
  proofFileError,
  recordBookingPayment,
  referenceRequired,
  type PaymentDetails,
} from '../../../lib/bookingPayments'
import { toManilaDate } from '../../../lib/payslip'
import PageHeader from '../../../components/PageHeader'
import { formatDate, formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import { downpaymentStatus, type DownpaymentStatus } from '../../../lib/downpayment'
import { bookingRateLabel, groupTripRates, sumRates } from '../../../lib/lineRates'
import { deliveryAmountFor, loadPaymentDueReport, type PaymentDueRow } from '../../../lib/paymentDue'
import { fetchAll, fetchIn } from '../../../lib/dashboardExpenses'

// One row of the bookings query in loadBookings().
type ReceivableBookingRow = {
  booking_id: number
  client_id: number
  place_of_pickup_id: number
  place_of_delivery_id: number
  booking_date: string
  booking_status: string | null
  rate_of_delivery_service: number | null
  amount_to_pay: number | null
  amount_paid: number | null
  invoice_number: string | null
  cost_per_trip: number | null
  downpayment_waived_at: string | null
  created_at: string
  cancelled_at: string | null
}

// PaymentDetailsFields: method / date received / reference / OR number /
// note / optional proof file, shown under the amount in every payment form.
// Controlled by the parent. GCash / Bank Transfer / Check need a reference
// no. (referenceRequired); the parent blocks Save via paymentDetailsError.
function PaymentDetailsFields({
  details,
  onChange,
  earliest,
}: {
  details: PaymentDetails
  onChange: (details: PaymentDetails) => void
  // Earliest allowed "date received" (YYYY-MM-DD): the booking's creation day.
  earliest?: string
}) {
  const set = (patch: Partial<PaymentDetails>) => onChange({ ...details, ...patch })
  const fileRef = useRef<HTMLInputElement>(null)
  const input = 'mt-1 w-full border border-line-control bg-white px-3 py-2 text-sm text-slate-900 rounded-[2px] min-h-11 focus:border-primary'
  const label = 'block text-xs font-medium text-slate-600'

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div>
        <label className={label} htmlFor="pay-method">Payment method</label>
        <select
          id="pay-method"
          value={details.method}
          onChange={(e) => set({ method: e.target.value as PaymentDetails['method'] })}
          className={input}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>{method}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="pay-date">Date received</label>
        <input
          id="pay-date"
          type="date"
          value={details.paidOn}
          min={earliest}
          max={toManilaDate(new Date())}
          onChange={(e) => set({ paidOn: e.target.value })}
          className={input}
        />
      </div>
      <div>
        <label className={label} htmlFor="pay-ref">
          {details.method === 'Check' ? 'Check no.' : 'Reference no.'}{' '}
          {referenceRequired(details.method) ? <span className="text-red-700">(required)</span> : '(optional)'}
        </label>
        <input
          id="pay-ref"
          type="text"
          maxLength={50}
          value={details.referenceNo}
          onChange={(e) => set({ referenceNo: e.target.value })}
          aria-invalid={referenceRequired(details.method) && !details.referenceNo.trim() ? true : undefined}
          className={`${input} ${referenceRequired(details.method) && !details.referenceNo.trim() ? 'border-red-400' : ''}`}
        />
      </div>
      <div>
        <label className={label} htmlFor="pay-or">OR number (optional)</label>
        <input id="pay-or" type="text" maxLength={50} value={details.orNumber} onChange={(e) => set({ orNumber: e.target.value })} className={input} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="pay-note">Note (optional)</label>
        <input id="pay-note" type="text" maxLength={200} value={details.note} onChange={(e) => set({ note: e.target.value })} className={input} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="pay-proof">Proof of payment (optional): screenshot or PDF, max 5 MB</label>
        {/* Native file box hidden behind our own button so the chosen file can be removed again. */}
        <input
          ref={fileRef}
          id="pay-proof"
          type="file"
          accept={PROOF_ACCEPT}
          onChange={(e) => set({ proof: e.target.files?.[0] ?? null })}
          className="sr-only"
        />
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="border border-line-control bg-white px-3 py-1.5 font-medium text-ink-metric hover:bg-slate-50 rounded-[2px]"
          >
            {details.proof ? 'Change file' : 'Choose file'}
          </button>
          {details.proof ? (
            <>
              <span className="max-w-56 truncate text-slate-700">{details.proof.name}</span>
              <button
                type="button"
                onClick={() => {
                  set({ proof: null })
                  if (fileRef.current) fileRef.current.value = ''
                }}
                className="text-xs font-medium text-red-700 underline"
              >
                Remove
              </button>
            </>
          ) : (
            <span className="text-slate-400">No file chosen</span>
          )}
        </div>
        {proofFileError(details.proof) && (
          <p className="mt-1 text-xs text-red-700">{proofFileError(details.proof)}</p>
        )}
      </div>
    </div>
  )
}

// PartialPaymentModal: opened by the "Record payment" button. Shows what's
// owed, takes the amount received (typed in, or "Full remaining") and previews
// the balance that will be left before anything is saved.
function PartialPaymentModal({
  booking,
  target,
  deliveryTarget,
  onClose,
  onSaved,
}: {
  booking: Booking
  target: number // delivery + damage
  deliveryTarget: number // delivery only -- what amount_to_pay gets locked to
  onClose: () => void
  onSaved: () => void
}) {
  // Everything in centavos, so a float leftover can't make "Full remaining" look too big.
  const remaining = cents(target - booking.amount_paid)
  const earliest = booking.created_at ? toManilaDate(booking.created_at) : undefined
  const [amountText, setAmountText] = useState('')
  const [details, setDetails] = useState(emptyPaymentDetails)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Shown live as the user types (empty box = no message yet).
  const parsed = parseAmount(amountText)
  const amount = parsed.value ?? 0
  const inputError =
    parsed.error ??
    (parsed.value !== null && parsed.value > remaining
      ? `Can't exceed the remaining balance (${formatMoney(remaining)}).`
      : null)
  const dateError = paymentDateError(details.paidOn, earliest)
  const canSave = parsed.value !== null && !inputError && !paymentDetailsError(details, earliest) && !saving

  function fill(value: number) {
    setAmountText(String(cents(value)))
  }

  async function save() {
    setSaving(true)
    setSaveError(null)

    // Saves the payment row and locks amount_to_pay in one transaction.
    const recordError = await recordBookingPayment({
      bookingId: booking.booking_id,
      amount,
      details,
      setAmountToPay: deliveryTarget,
      earliest,
    })

    setSaving(false)

    if (recordError) {
      setSaveError(recordError)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">
              Record payment
            </p>
            <h3 className="text-lg font-bold text-slate-900">
              Booking #{booking.booking_id} · {booking.client_name}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[13px] text-ink-muted">Total due</p>
            <p className="font-semibold text-slate-900">{formatMoney(target)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Paid so far</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.amount_paid)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Remaining</p>
            <p className="font-semibold text-slate-900">{formatMoney(remaining)}</p>
          </div>
        </div>

        <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="partial-amount">
          Amount received (₱)
        </label>
        <input
          id="partial-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={amountText}
          // Plain text box (no spinner / scroll-wheel changes); filterAmountInput keeps
          // digits and one dot, max 2 decimals.
          onChange={(e) => setAmountText(filterAmountInput(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && canSave && save()}
          className="mt-1 w-full border border-line-control bg-white px-3 py-2 text-slate-900 rounded-[2px] min-h-11 focus:border-primary"
        />
        {inputError && <p className="mt-1 text-xs text-red-700">{inputError}</p>}

        {/* Quick-fill: the whole remaining balance (no % presets -- staff type the amount received). */}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => fill(remaining)}
            className="border border-line-control px-3 py-1 text-xs font-medium text-ink-metric hover:bg-slate-50 rounded-[2px]"
          >
            Full remaining
          </button>
        </div>

        <PaymentDetailsFields details={details} onChange={setDetails} earliest={earliest} />
        {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}

        {/* Preview of what the balance becomes */}
        {amountText !== '' && !inputError && (
          <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Balance after this payment:{' '}
            <span className="font-semibold text-slate-900">{formatMoney(cents(remaining - amount))}</span>
            {cents(remaining - amount) === 0 && ' (fully paid)'}
          </p>
        )}

        {saveError && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="border border-line-control px-4 py-2 text-sm font-medium text-ink-metric hover:bg-slate-100 rounded-[2px]">Cancel</button>
          <button onClick={save} disabled={!canSave} className="btn-primary px-4 py-2 text-sm font-medium">{saving ? 'Saving...' : 'Record payment'}</button>
        </div>
      </div>
    </div>
  )
}

// DownpaymentModal: records the client's downpayment (or part of it).
// Starts with what's still missing; saved as a normal payment row but
// without locking amount_to_pay (see the header comment).
function DownpaymentModal({
  booking,
  status,
  onClose,
  onSaved,
}: {
  booking: Booking
  status: DownpaymentStatus
  onClose: () => void
  onSaved: () => void
}) {
  const [amountText, setAmountText] = useState(String(status.missing))
  const [details, setDetails] = useState(() => ({ ...emptyPaymentDetails(), note: 'Downpayment' }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const earliest = booking.created_at ? toManilaDate(booking.created_at) : undefined
  // A downpayment can't be more than what's left of the whole contract.
  const maxAmount = cents(Math.max(booking.total_contract_value - booking.amount_paid, 0))
  const parsed = parseAmount(amountText)
  const amount = parsed.value ?? 0
  const amountError =
    parsed.error ??
    (parsed.value !== null && parsed.value > maxAmount
      ? `Can't exceed the rest of the contract (${formatMoney(maxAmount)}).`
      : null)
  const dateError = paymentDateError(details.paidOn, earliest)
  const canSave = parsed.value !== null && !amountError && !paymentDetailsError(details, earliest) && !saving
  const stillMissing = Math.max(Math.round((status.missing - (amount || 0)) * 100) / 100, 0)

  async function save() {
    setSaving(true)
    setSaveError(null)
    const recordError = await recordBookingPayment({ bookingId: booking.booking_id, amount, details, earliest })
    setSaving(false)
    if (recordError) {
      setSaveError(recordError)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Downpayment</p>
            <h3 className="text-lg font-bold text-slate-900">
              Booking #{booking.booking_id} · {booking.client_name}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[13px] text-ink-muted">Required</p>
            <p className="font-semibold text-slate-900">{formatMoney(status.required)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Paid so far</p>
            <p className="font-semibold text-slate-900">{formatMoney(status.paid)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Still missing</p>
            <p className="font-semibold text-slate-900">{formatMoney(status.missing)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Trip cost + 25% of the rest of the contract. No trip can start until it's paid.
        </p>

        <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="downpayment-amount">
          Amount received (₱)
        </label>
        <input
          id="downpayment-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={amountText}
          onChange={(e) => setAmountText(filterAmountInput(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && canSave && save()}
          className="mt-1 w-full border border-line-control bg-white px-3 py-2 text-slate-900 rounded-[2px] min-h-11 focus:border-primary"
        />
        {amountError && <p className="mt-1 text-xs text-red-700">{amountError}</p>}

        <PaymentDetailsFields details={details} onChange={setDetails} earliest={earliest} />
        {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}

        {amountText !== '' && !amountError && (
          <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {stillMissing === 0 ? (
              <span className="font-semibold text-green-700">Downpayment met -- trips can start.</span>
            ) : (
              <>
                Still missing after this: <span className="font-semibold text-slate-900">{formatMoney(stillMissing)}</span>
              </>
            )}
          </p>
        )}

        {saveError && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={save} disabled={!canSave} className="btn-primary px-4 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Record downpayment'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FinancialActionModal({
  booking,
  onClose,
  onUpdated,
}: {
  booking: Booking
  onClose: () => void
  onUpdated: (booking: Booking) => void
}) {
  // The override is the delivery amount only (damage is added on top).
  const [overrideAmount, setOverrideAmount] = useState(
    String(booking.billable_amount - booking.damage_charges),
  )
  const [invoiceText, setInvoiceText] = useState(booking.invoice_number ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(
    databaseValues: Record<string, number | string | null>,
    nextBooking: Partial<Booking>,
  ) {
    setSaving(true)
    setError(null)

    // .select() so a blocked update (RLS) shows as an error, not success.
    const { data: updated, error: updateError } = await supabase
      .from('bookings')
      .update(databaseValues)
      .eq('booking_id', booking.booking_id)
      .select('booking_id')
      .maybeSingle()

    setSaving(false)

    if (updateError || !updated) {
      setError(updateError?.message ?? 'The booking was not updated (no permission, or it no longer exists).')
      return
    }

    onUpdated({ ...booking, ...nextBooking })
  }

  // Saves one booking_payments row; the database trigger updates
  // bookings.amount_paid, here we just mirror it on screen.
  async function addPayment(amount: number, details: PaymentDetails) {
    setSaving(true)
    setError(null)

    const recordError = await recordBookingPayment({
      bookingId: booking.booking_id,
      amount,
      details,
      earliest: booking.created_at ? toManilaDate(booking.created_at) : undefined,
    })

    setSaving(false)

    if (recordError) {
      setError(recordError)
      return false
    }

    const nextPaid = booking.amount_paid + amount
    onUpdated({
      ...booking,
      amount_paid: nextPaid,
      balance_due: booking.billable_amount - nextPaid,
    })
    return true
  }

  // Overpaid (e.g. cancelled before delivery): hand the extra back. Saved as
  // a negative payment (method Refund) so it shows in the payment history
  // and brings amount_paid down to what's actually owed.
  async function refundOverpayment() {
    // The balance on screen is from when the page loaded. If anyone
    // recorded a payment or refund since, this one would be wrong (or a
    // second refund) -- re-read the amount paid first.
    const { data: fresh, error: freshError } = await supabase
      .from('bookings')
      .select('amount_paid')
      .eq('booking_id', booking.booking_id)
      .maybeSingle()
    if (freshError || !fresh) {
      setError(freshError?.message ?? 'Could not re-check this booking.')
      return
    }
    if (cents(Number(fresh.amount_paid ?? 0)) !== cents(booking.amount_paid)) {
      setError('Payments on this booking changed since this page loaded. Close this and reload Bills Receivable before refunding.')
      return
    }

    const refund = -booking.balance_due
    if (
      !(await confirmDialog({
        message: `Record a refund of ${formatMoney(refund)} to ${booking.client_name}? This lowers "Amount paid" to ${formatMoney(booking.billable_amount)}.`,
        confirmLabel: 'Mark refunded',
      }))
    ) {
      return
    }
    // booking.balance_due is already negative here -- that's the refund row.
    await addPayment(booking.balance_due, { ...emptyPaymentDetails(), method: 'Refund' })
  }

  function saveOverride() {
    const total = Number(overrideAmount)

    if (overrideAmount.trim() === '' || !Number.isFinite(total) || total < 0) {
      setError('Amount to pay must be zero or greater.')
      return
    }
    // Same 2-decimal rule as every other amount box (lib/amountInput.ts).
    if (cents(total) !== total) {
      setError('Amount to pay can have at most 2 decimal places.')
      return
    }
    if (total + booking.damage_charges < booking.amount_paid) {
      setError(
        `Amount to pay (plus extra charges) can't be less than what's already been paid (${formatMoney(booking.amount_paid)}).`,
      )
      return
    }

    save(
      { amount_to_pay: total },
      {
        amount_to_pay: total,
        billable_amount: total + booking.damage_charges,
        balance_due: total + booking.damage_charges - booking.amount_paid,
      },
    )
  }

  // Invoice number from the printed booklet; blank clears it.
  function saveInvoice() {
    const invoice = invoiceText.trim() || null
    save({ invoice_number: invoice }, { invoice_number: invoice })
  }

  function resetOverride() {
    setOverrideAmount(String(booking.computed_billable_amount))
    save(
      { amount_to_pay: null },
      {
        amount_to_pay: null,
        billable_amount: booking.computed_billable_amount + booking.damage_charges,
        balance_due: booking.computed_billable_amount + booking.damage_charges - booking.amount_paid,
      },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-2xl bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">
              Financial record
            </p>
            <h3 className="text-lg font-bold text-slate-900">
              Booking #{booking.booking_id} · {booking.client_name}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[13px] text-ink-muted">Rate / trip</p>
            <p className="font-semibold text-slate-900">{bookingRateLabel(booking.trip_rates, booking.rate)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Trips completed</p>
            <p className="font-semibold text-slate-900">
              {booking.completed_trips}/{booking.total_trips}
            </p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Contract value</p>
            <p className="font-semibold text-slate-900">
              {formatMoney(booking.total_contract_value)}
            </p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Amount to pay</p>
            <p className="font-semibold text-slate-900">
              {formatMoney(booking.billable_amount)}
              {booking.amount_to_pay !== null && (
                <span className="ml-1 text-xs font-normal text-slate-400">
                  (override)
                </span>
              )}
            </p>
            {booking.damage_charges > 0 && (
              <p className="text-xs text-slate-500">
                incl. {formatMoney(booking.damage_charges)} extra charges (damage, added charges)
              </p>
            )}
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Amount paid</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.amount_paid)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Balance due</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.balance_due)}</p>
          </div>
        </div>

        {booking.balance_due < 0 && (
          <div className="mt-6 bg-amber-50 p-4">
            <h4 className="font-medium text-amber-900">
              Refund due: {formatMoney(-booking.balance_due)}
            </h4>
            <p className="mt-1 text-xs text-amber-800">
              The client has paid more than what's owed. Click once the money has been given back.
            </p>
            <button onClick={refundOverpayment} disabled={saving} className="btn-primary mt-3 px-4 py-2 text-sm font-medium">{saving ? 'Saving...' : 'Mark Refunded'}</button>
          </div>
        )}

        {/* Payments are recorded with the row's "Record payment" button
            (it locks the amount to pay the same way every time), not here. */}
        <div className="mt-6 bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Override amount to pay</h4>
          <p className="mt-1 text-xs text-slate-500">
            Defaults to rate x trips completed ({formatMoney(booking.computed_billable_amount)}).
            This is the delivery amount only -- extra charges (approved damage, added charges)
            ({formatMoney(booking.damage_charges)}) are always added on top.
            Override this for a discount or special arrangement -- it stays
            fixed at your override even as more trips complete, until you
            reset it.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="number" min="0" step="0.01" value={overrideAmount} onChange={(e) => setOverrideAmount(e.target.value)} className="w-full border border-line-control bg-white px-3 py-2 text-slate-900 rounded-[2px] min-h-11 focus:border-primary" />
            <button onClick={saveOverride} disabled={saving} className="border border-line-control px-4 py-2 text-sm font-medium text-ink-metric hover:bg-white disabled:opacity-50 rounded-[2px]">{saving ? 'Saving...' : 'Save Override'}</button>
            {booking.amount_to_pay !== null && (
              <button onClick={resetOverride} disabled={saving} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">Reset to computed</button>
            )}
          </div>
        </div>

        <div className="mt-4 bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Invoice number</h4>
          <p className="mt-1 text-xs text-slate-500">
            The number printed on this booking's invoice. Leave blank to clear it.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="text" maxLength={50} value={invoiceText} onChange={(e) => setInvoiceText(e.target.value)} className="w-full border border-line-control bg-white px-3 py-2 text-slate-900 rounded-[2px] min-h-11 focus:border-primary" />
            <button onClick={saveInvoice} disabled={saving} className="border border-line-control px-4 py-2 text-sm font-medium text-ink-metric hover:bg-white disabled:opacity-50 rounded-[2px]">{saving ? 'Saving...' : 'Save Invoice No.'}</button>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="border border-line-control px-4 py-2 text-sm font-medium text-ink-metric hover:bg-slate-100 rounded-[2px]">Close</button>
        </div>
      </div>
    </div>
  )
}

// "Record payment" tracks against the FULL contract
// value (rate x all trips) plus damage charges, not just trips completed so far -- a client
// can pay in advance before delivery finishes. The first such payment
// locks in amount_to_pay at that target (the existing override if
// staff already set a discount via Manage, otherwise the full contract
// value), so the rest of the app's "amount due" for this booking
// switches from trip-based to full-contract-based from then on --
// consistent everywhere, since every view already reads the same
// amount_to_pay override (see paymentDue.ts).
// Delivery part only -- this is what gets written to amount_to_pay.
function getDeliveryTarget(booking: Booking): number {
  // A booking with any cancellation is only ever billed for the trips
  // actually delivered -- an earlier lock at the full contract value is capped.
  if (booking.status === 'Cancelled' || booking.cancelled_at) {
    return Math.min(booking.amount_to_pay ?? Infinity, booking.computed_billable_amount)
  }
  return booking.amount_to_pay ?? booking.total_contract_value
}

type Tab = 'ongoing' | 'completed' | 'cancelled'

// Which tab a booking lives in: Cancelled; Completed = delivered and fully
// paid; everything else is still waiting on trips and/or payment.
function getTab(booking: Booking): Tab {
  if (booking.status === 'Cancelled') return 'cancelled'
  if (booking.status === 'Delivered' && booking.balance_due <= 0) return 'completed'
  return 'ongoing'
}

// Payment terms as staff read them, and when each falls due (the side panel).
const TERMS_LABELS: Record<string, string> = { Cash: 'Cash trip', '7Days': '7 days', '14Days': '14 days', '30Days': '30 days' }
const DUE_RULES: [string, string][] = [
  ['Cash trip', 'Due on delivery'],
  ['7 days', '7 days after delivery'],
  ['14 days', '14 days after delivery'],
  ['30 days', '30 days after delivery'],
]

const TAB_LABELS: Record<Tab, string> = {
  ongoing: 'Ongoing (awaiting payment)',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// Everything the client owes in total: delivery + extra charges (damage, added charges).
function getPaymentTarget(booking: Booking): number {
  return getDeliveryTarget(booking) + booking.damage_charges
}

// Row action buttons: one primary (the next step) + matching secondaries.
const primaryAction = 'btn-primary px-3 py-1.5 text-xs font-medium'
const secondaryAction =
  'inline-flex items-center border border-line-control bg-white px-3 py-1.5 text-xs font-medium text-ink-metric hover:bg-slate-50 rounded-[2px]'

function FinancialSection() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [partialBooking, setPartialBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Due dates / terms per booking (Payments Due rules) for the tiles and columns.
  const [dueRows, setDueRows] = useState<PaymentDueRow[]>([])
  const [clientFilter, setClientFilter] = useState('')
  const [termsFilter, setTermsFilter] = useState('')
  const dueByBooking = new Map(dueRows.map((r) => [r.booking_id, r]))
  useEffect(() => {
    let cancelled = false
    loadPaymentDueReport(undefined, { includeSettled: true }).then(({ rows, error: dueError }) => {
      if (cancelled) return
      if (dueError) setActionError(`Couldn't load due dates (${dueError}).`)
      else setDueRows(rows)
    })
    return () => {
      cancelled = true
    }
  }, [bookings])
  const [tab, setTab] = useState<Tab>('ongoing')
  // Downpayment per booking (null = no requirement) and the one being recorded.
  const [downpaymentById, setDownpaymentById] = useState<Map<number, DownpaymentStatus | null>>(new Map())
  const [downpaymentBooking, setDownpaymentBooking] = useState<Booking | null>(null)

  useEffect(() => {
    loadBookings()
  }, [])

  // Deep link from a booking's "downpayment due" banner (?downpayment=ID):
  // once the rows are loaded, open that booking's Record downpayment form,
  // then drop the param so closing the form doesn't reopen it.
  // ?pay=ID (the "Record Payment" button on Bookings & Trips) opens that
  // booking's Record payment form the same way.
  const [searchParams, setSearchParams] = useSearchParams()
  const downpaymentParam = Number(searchParams.get('downpayment'))
  const payParam = Number(searchParams.get('pay'))
  // Opened while rendering (React's "adjust state when a prop changes"
  // pattern) -- once per link; the effect below only clears the URL.
  const linkKey = downpaymentParam || payParam ? `${downpaymentParam}|${payParam}` : null
  const [openedLink, setOpenedLink] = useState<string | null>(null)
  if (linkKey && linkKey !== openedLink && !loading) {
    setOpenedLink(linkKey)
    const booking = bookings.find((b) => b.booking_id === (downpaymentParam || payParam))
    if (booking && downpaymentParam && downpaymentById.get(booking.booking_id)) setDownpaymentBooking(booking)
    if (booking && payParam) setPartialBooking(booking)
  }
  useEffect(() => {
    if (linkKey && !loading) setSearchParams({}, { replace: true })
  }, [linkKey, loading, setSearchParams])

  async function loadBookings() {
    setLoading(true)

    // Every page / id chunk (fetchAll, fetchIn) -- Supabase stops at 1000
    // rows, and one long id list makes the request URL too big.
    const { rows: bookingRows, error: bookingsError } = await fetchAll<ReceivableBookingRow>((from, to) =>
      supabase
        .from('bookings')
        .select(
          'booking_id, client_id, place_of_pickup_id, place_of_delivery_id, booking_date, booking_status, rate_of_delivery_service, amount_to_pay, amount_paid, invoice_number, cost_per_trip, downpayment_waived_at, created_at, cancelled_at',
        )
        .order('created_at', { ascending: false })
        .order('booking_id', { ascending: false })
        .range(from, to),
    )

    if (bookingsError) {
      setError(bookingsError)
      setLoading(false)
      return
    }

    if (bookingRows.length === 0) {
      setBookings([])
      setError(null)
      setLoading(false)
      return
    }

    const clientIds = Array.from(new Set(bookingRows.map((b) => b.client_id)))
    const placeIds = Array.from(
      new Set(
        bookingRows.flatMap((b) => [b.place_of_pickup_id, b.place_of_delivery_id]),
      ),
    )
    const bookingIds = bookingRows.map((b) => b.booking_id)

    const [clientsResult, placesResult, itinerariesResult] = await Promise.all([
      fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, from, to) =>
        supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(from, to),
      ),
      fetchIn<{ place_id: number; place_name: string }>(placeIds, (chunk, from, to) =>
        supabase.from('places').select('place_id, place_name').in('place_id', chunk).range(from, to),
      ),
      fetchIn<{ booking_id: number; itinerary_status: string | null; trip_rate: number | string | null }>(bookingIds, (chunk, from, to) =>
        supabase
          .from('itineraries')
          .select('booking_id, itinerary_status, trip_rate')
          .in('booking_id', chunk)
          .range(from, to),
      ),
    ])

    if (clientsResult.error) {
      setError(clientsResult.error)
      setLoading(false)
      return
    }
    if (placesResult.error) {
      setError(placesResult.error)
      setLoading(false)
      return
    }
    if (itinerariesResult.error) {
      setError(itinerariesResult.error)
      setLoading(false)
      return
    }


    // Extra charges (approved Client damage + added charges), on top of the delivery amount.
    const { byBooking: damageByBooking, error: damageError } =
      await loadExtraChargesByBooking(bookingIds)
    if (damageError) {
      setError(damageError)
      setLoading(false)
      return
    }

    const clientNameById = new Map(
      clientsResult.rows.map((c) => [c.client_id, c.client_name]),
    )
    const placeNameById = new Map(
      placesResult.rows.map((p) => [p.place_id, p.place_name]),
    )

    const totalTripsByBooking = new Map<number, number>()
    const completedTripsByBooking = new Map<number, number>()
    const cancelledTripsByBooking = new Map<number, number>()
    itinerariesResult.rows.forEach((itinerary) => {
      // Cancelled trips aren't part of the booking any more (counted separately).
      if (itinerary.itinerary_status === 'Cancelled') {
        cancelledTripsByBooking.set(itinerary.booking_id, (cancelledTripsByBooking.get(itinerary.booking_id) ?? 0) + 1)
        return
      }
      totalTripsByBooking.set(
        itinerary.booking_id,
        (totalTripsByBooking.get(itinerary.booking_id) ?? 0) + 1,
      )
      if (itinerary.itinerary_status === 'Delivered') {
        completedTripsByBooking.set(
          itinerary.booking_id,
          (completedTripsByBooking.get(itinerary.booking_id) ?? 0) + 1,
        )
      }
    })

    // Every trip's own rate (cargo lines can be priced differently). The
    // downpayment counts only non-cancelled trips.
    const tripRatesByBooking = groupTripRates(
      itinerariesResult.rows,
      new Map(bookingRows.map((b) => [b.booking_id, b.rate_of_delivery_service])),
    )
    setDownpaymentById(
      new Map(
        bookingRows.map((b) => [
          b.booking_id,
          downpaymentStatus({
            contract: sumRates(tripRatesByBooking.get(b.booking_id)?.live ?? []),
            costPerTrip: b.cost_per_trip,
            trips: tripRatesByBooking.get(b.booking_id)?.live.length ?? 0,
            amountPaid: b.amount_paid,
            waivedAt: b.downpayment_waived_at,
          }),
        ]),
      ),
    )

    setBookings(
      bookingRows.map((b) => {
        const tripRates = tripRatesByBooking.get(b.booking_id) ?? { live: [], delivered: [] }
        const totalTrips = totalTripsByBooking.get(b.booking_id) ?? 0
        const completedTrips = completedTripsByBooking.get(b.booking_id) ?? 0
        const computedBillableAmount = sumRates(tripRates.delivered)
        const damageCharges = damageByBooking.get(b.booking_id) ?? 0
        // Any cancellation: only delivered trips are billable (same cap as getDeliveryTarget).
        const deliveryAmount = deliveryAmountFor({
          amountToPay: b.amount_to_pay,
          computedBillable: computedBillableAmount,
          hadCancellation: b.booking_status === 'Cancelled' || b.cancelled_at != null,
        })
        const billableAmount = deliveryAmount + damageCharges
        const amountPaid = b.amount_paid ?? 0

        return {
          booking_id: b.booking_id,
          client_name: clientNameById.get(b.client_id) ?? '—',
          pickup_location: placeNameById.get(b.place_of_pickup_id) ?? '—',
          delivery_location: placeNameById.get(b.place_of_delivery_id) ?? '—',
          date: b.booking_date,
          status: b.booking_status ?? 'Draft',
          rate: b.rate_of_delivery_service,
          trip_rates: tripRates.live,
          total_trips: totalTrips,
          completed_trips: completedTrips,
          total_contract_value: sumRates(tripRates.live),
          computed_billable_amount: computedBillableAmount,
          amount_to_pay: b.amount_to_pay,
          damage_charges: damageCharges,
          billable_amount: billableAmount,
          amount_paid: amountPaid,
          balance_due: billableAmount - amountPaid,
          invoice_number: b.invoice_number,
          created_at: b.created_at,
          cancelled_trips: cancelledTripsByBooking.get(b.booking_id) ?? 0,
          cancelled_at: b.cancelled_at,
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  // "Record payment" -- one form for any amount; its "Full remaining"
  // button covers what "Paid Full" used to do.
  function openPayment(booking: Booking) {
    setActionError(null)
    setPartialBooking(booking)
  }

  const visibleBookings = bookings.filter(
    (b) =>
      getTab(b) === tab &&
      (!clientFilter || b.client_name === clientFilter) &&
      (!termsFilter || dueByBooking.get(b.booking_id)?.payment_terms === termsFilter),
  )
  const clientNames = [...new Set(bookings.map((b) => b.client_name))].sort((a, b) => a.localeCompare(b))
  const termsInUse = [...new Set(dueRows.map((r) => r.payment_terms))].filter(Boolean)

  // The "amounts owed" tiles -- same due dates as Payments Due / AR Aging.
  const owing = dueRows.filter((r) => r.balance_due > 0)
  const sum = (rows: PaymentDueRow[]) => rows.reduce((total, r) => total + r.balance_due, 0)
  const tiles = [
    { label: 'Total outstanding', value: sum(owing), tone: 'text-ink' },
    { label: 'Not yet due', value: sum(owing.filter((r) => r.days_until_due === null || r.days_until_due >= 0)), tone: 'text-ink' },
    {
      label: 'Overdue 1–30 days',
      value: sum(owing.filter((r) => r.days_until_due !== null && r.days_until_due < 0 && r.days_until_due >= -30)),
      tone: 'text-amber-800',
    },
    { label: 'Overdue over 30 days', value: sum(owing.filter((r) => r.days_until_due !== null && r.days_until_due < -30)), tone: 'text-red-700' },
  ]

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(visibleBookings, `${tab}|${clientFilter}|${termsFilter}`)
  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'
  const FILTER_LABEL = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
  const FILTER_CONTROL =
    'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'
  return (
    <div>
      <PageHeader
        title="Bills Receivable"
        subtitle="What each client owes, sorted newest first. Record payments and refunds here."
        actions={
          <button type="button" onClick={() => loadBookings()} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
            </svg>
            Refresh
          </button>
        }
      />
      {actionError && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}

      <section aria-label="Amounts owed" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card px-[18px] py-3.5">
            <p className="text-sm font-medium text-ink-secondary">{t.label}</p>
            <p className={`text-[28px] leading-9 font-bold tracking-[-0.01em] tabular-nums ${t.value > 0 ? t.tone : 'text-ink'}`}>
              {formatMoney(t.value)}
            </p>
          </div>
        ))}
      </section>

      {loading && <p className="text-ink-muted">Loading financial records...</p>}
      {error && <p className="text-red-700">{error}</p>}
      {!loading && !error && bookings.length === 0 && <EmptyState message="No bookings yet." />}
      {!loading && !error && bookings.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div role="tablist" aria-label="Receivable status" className="flex flex-wrap gap-2">
                {(Object.keys(TAB_LABELS) as Tab[]).map((key) => {
                  const count = bookings.filter((b) => getTab(b) === key).length
                  return (
                    <button
                      key={key}
                      role="tab"
                      onClick={() => setTab(key)}
                      aria-selected={tab === key}
                      className={`flex h-11 items-center gap-2.5 rounded-[2px] border px-5 text-sm font-semibold ${
                        tab === key
                          ? 'border-primary bg-primary text-white'
                          : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
                      }`}
                    >
                      {TAB_LABELS[key]}
                      <span
                        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] px-1.5 text-xs font-bold ${
                          tab === key ? 'bg-white text-primary' : 'bg-primary text-white'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <label className={FILTER_LABEL}>
                  Client
                  <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={`${FILTER_CONTROL} w-44`}>
                    <option value="">All clients</option>
                    {clientNames.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label className={FILTER_LABEL}>
                  Terms
                  <select value={termsFilter} onChange={(e) => setTermsFilter(e.target.value)} className={`${FILTER_CONTROL} w-36`}>
                    <option value="">All terms</option>
                    {termsInUse.map((t) => (
                      <option key={t} value={t}>
                        {TERMS_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {tab === 'cancelled' && (
              <p className="text-sm text-ink-muted">
                Cancelled bookings are only billed for the trips that were delivered before cancellation. Bookings with no
                delivered trips owe nothing.
              </p>
            )}

            <section aria-label="Receivables" className="card flex min-h-[calc(100dvh-26rem)] flex-col">
              {visibleBookings.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                  <p className="text-base font-semibold text-ink">Nothing in this tab</p>
                  <p className="max-w-[420px] text-sm text-ink-secondary">
                    A booking shows here once it is billed and stays until the balance reaches {formatMoney(0)}.
                  </p>
                  <Link to="/dashboard/collections" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
                    See payments in Collections
                  </Link>
                </div>
              ) : (
                <div className="flex-1 overflow-x-auto">
                  <table className="w-full min-w-[1180px] text-left text-sm text-ink-metric">
                    <thead>
                      <tr>
                        <th className={TH}>Booking</th>
                        <th className={TH}>Client</th>
                        <th className={TH}>Terms</th>
                        <th className={TH}>Due Date</th>
                        <th className={TH}>Status</th>
                        <th className={TH}>Trips</th>
                        <th className={`${TH} text-right`}>Billed</th>
                        <th className={`${TH} text-right`}>Paid</th>
                        <th className={`${TH} text-right`}>Balance Due</th>
                        <th className={TH}>Downpayment</th>
                        <th className={TH}>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.rows.map((booking) => {
                        const downpayment = downpaymentById.get(booking.booking_id) ?? null
                        // Still has trips to come: money above what's billed so far is paid ahead, not a refund.
                        const tripsToCome = booking.status !== 'Delivered' && booking.status !== 'Cancelled'
                        const due = dueByBooking.get(booking.booking_id)
                        const overdue = booking.balance_due > 0 && due?.days_until_due != null && due.days_until_due < 0
                        return (
                          <tr key={booking.booking_id} className="h-[60px] border-b border-slate-200">
                            <td className={TD}>
                              <span className="block font-bold text-ink">#{booking.booking_id}</span>
                              <span className="block text-[13px] leading-[18px] text-ink-muted">
                                {booking.invoice_number ? `Inv. ${booking.invoice_number}` : 'No invoice no.'}
                              </span>
                            </td>
                            <td className={`${TD} font-semibold`}>{booking.client_name}</td>
                            <td className={TD}>{due ? (TERMS_LABELS[due.payment_terms] ?? due.payment_terms) : '—'}</td>
                            <td className={TD}>
                              {due?.due_date ? (
                                <span className="flex flex-col items-start gap-1">
                                  <span className="whitespace-nowrap">{formatDate(due.due_date)}</span>
                                  {overdue && (
                                    <span className="rounded-[2px] bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                                      {-due.days_until_due!} {due.days_until_due === -1 ? 'day' : 'days'} overdue
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-ink-muted">Not delivered yet</span>
                              )}
                            </td>
                            <td className={TD}>
                              <StatusBadge status={booking.status} icon />
                            </td>
                            <td className={TD}>
                              {booking.completed_trips}/{booking.total_trips}
                              {booking.cancelled_trips ? (
                                <span className="block text-[13px] text-ink-muted">{booking.cancelled_trips} cancelled</span>
                              ) : null}
                            </td>
                            <td className={`${TD} text-right tabular-nums`}>{formatMoney(booking.billable_amount)}</td>
                            <td className={`${TD} text-right tabular-nums`}>{formatMoney(booking.amount_paid)}</td>
                            <td className={`${TD} text-right font-semibold tabular-nums`}>
                              {booking.balance_due < 0 && tripsToCome ? (
                                <span className="font-medium text-ink-secondary">Paid ahead {formatMoney(-booking.balance_due)}</span>
                              ) : booking.balance_due < 0 ? (
                                <span className="text-amber-800">Refund {formatMoney(-booking.balance_due)}</span>
                              ) : (
                                <span className={booking.balance_due > 0 ? (overdue ? 'text-red-700' : 'text-primary') : ''}>
                                  {formatMoney(booking.balance_due)}
                                </span>
                              )}
                            </td>
                            <td className={`${TD} text-[13px]`}>
                              {downpayment === null ? (
                                <span className="text-ink-muted">—</span>
                              ) : downpayment.met ? (
                                <span className="font-semibold text-green-800">✓ {formatMoney(downpayment.required)}</span>
                              ) : downpayment.waived ? (
                                <span className="text-ink-muted">Waived</span>
                              ) : (
                                <span className="flex flex-col items-start">
                                  <span className="font-semibold text-amber-800">{formatMoney(downpayment.missing)} to go</span>
                                  <span className="text-ink-muted">of {formatMoney(downpayment.required)}</span>
                                </span>
                              )}
                            </td>
                            <td className={TD}>
                              {/* At most one primary action -- the row's next step --
                                  then Manage / Billing as matching secondary buttons. */}
                              <div className="flex flex-wrap items-center gap-2">
                                {downpayment && !downpayment.met && !downpayment.waived ? (
                                  <button
                                    onClick={() => {
                                      setActionError(null)
                                      setDownpaymentBooking(booking)
                                    }}
                                    className={primaryAction}
                                  >
                                    Record downpayment
                                  </button>
                                ) : booking.balance_due > 0 ? (
                                  <button onClick={() => openPayment(booking)} className={primaryAction}>
                                    Record payment
                                  </button>
                                ) : booking.balance_due < 0 && !tripsToCome ? (
                                  // Mark Refunded lives in the Manage form.
                                  <button onClick={() => setSelectedBooking(booking)} className={primaryAction}>
                                    Mark refunded
                                  </button>
                                ) : null}
                                <button onClick={() => setSelectedBooking(booking)} className={secondaryAction}>
                                  Manage
                                </button>
                                <Link to={`/dashboard/billing/${booking.booking_id}`} className={secondaryAction}>
                                  Billing
                                </Link>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
                <span>
                  {paged.pager.pageCount > 1
                    ? `Page ${paged.pager.page + 1} of ${paged.pager.pageCount}`
                    : `${visibleBookings.length} ${visibleBookings.length === 1 ? 'booking' : 'bookings'}`}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                    disabled={paged.pager.page === 0}
                    className="btn-secondary px-3.5 text-sm font-medium"
                  >
                    ‹ Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                    disabled={paged.pager.page >= paged.pager.pageCount - 1}
                    className="btn-secondary px-3.5 text-sm font-medium"
                  >
                    Next ›
                  </button>
                </span>
              </div>
            </section>
          </div>

          <aside aria-labelledby="terms-h" className="card flex flex-col px-5 py-4">
            <h2 id="terms-h" className="mb-1 border-b border-line pb-2 text-sm font-semibold text-ink">
              How due dates are set
            </h2>
            {DUE_RULES.map(([terms, rule]) => (
              <div key={terms} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm">
                <span className="text-ink-secondary">{terms}</span>
                <span className="font-semibold">{rule}</span>
              </div>
            ))}
            <p className="mt-3 text-[13px] leading-[18px] text-ink-muted">
              Each trip is billed when it is delivered, at the booking's rate per trip, plus any damage charged to the client.
              Before any trip can start, the client pays the downpayment (or an admin waives it).
            </p>
          </aside>
        </div>
      )}
      {partialBooking && (
        <PartialPaymentModal
          booking={partialBooking}
          target={getPaymentTarget(partialBooking)}
          deliveryTarget={getDeliveryTarget(partialBooking)}
          onClose={() => setPartialBooking(null)}
          onSaved={() => {
            setPartialBooking(null)
            loadBookings()
          }}
        />
      )}
      {downpaymentBooking && downpaymentById.get(downpaymentBooking.booking_id) && (
        <DownpaymentModal
          booking={downpaymentBooking}
          status={downpaymentById.get(downpaymentBooking.booking_id)!}
          onClose={() => setDownpaymentBooking(null)}
          onSaved={() => {
            setDownpaymentBooking(null)
            loadBookings()
          }}
        />
      )}
      {selectedBooking && (
        <FinancialActionModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onUpdated={(updatedBooking) => {
            setBookings((prev) =>
              prev.map((booking) =>
                booking.booking_id === updatedBooking.booking_id ? updatedBooking : booking,
              ),
            )
            setSelectedBooking(updatedBooking)
          }}
        />
      )}
    </div>
  )
}

export default FinancialSection
