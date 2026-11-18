// FinancialSection (Bills Receivable): where payments actually get recorded.
// The numbers are the shared Payments Due rows (lib/paymentDue.ts, rules in
// lib/bookingBalance.ts): billable = the delivered trips' rates + extra
// charges. Since 2026-11-18 there's no "amount to pay" override and no
// payment locks the bill -- a price is changed by editing the trip's rate
// (Bookings & Trips -> Full Details -> Edit). This page records payments: each payment/refund is a booking_payments row saved
// through lib/bookingPayments.ts (a DB trigger then keeps bookings.amount_paid
// = the sum of non-voided rows -- never write amount_paid directly). The
// Payments Due panel/tab (Bookings page, Reports page) and the client portal
// are read-only views of the same numbers.
//
// Downpayment (#10/#11): bookings with a saved cost_per_trip need a
// downpayment before any trip can start (lib/downpayment.ts). The
// Downpayment column shows what's still missing, and its button records a
// normal payment row -- so billing still follows the
// delivered trips and the payment terms count from delivery, just with
// less left to pay. Paid ahead of delivery shows as "Paid ahead", not
// "Refund".
import { useEffect, useRef, useState } from 'react'
import { usePaged } from '../../../lib/usePaged'
import { Link, useSearchParams } from 'react-router-dom'
import type { Booking } from './BookingsSection'
import StatusBadge from '../../../components/StatusBadge'
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
import { bookingRateLabel } from '../../../lib/lineRates'
import { loadPaymentDueReport, type PaymentDueRow } from '../../../lib/paymentDue'
import { daysBetween } from '../../../lib/bookingBalance'
import NoMatchRow from '../../../components/NoMatchRow'
import { idMatches, noMatchText, numberQuery, textMatches } from '../../../lib/search'
import WordCount from '../../../components/WordCount'
import { limitWords } from '../../../lib/wordLimit'

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
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      {/* Bank Transfer: the note box becomes a required bank name (saved into the
          note as "Bank: X"; a preset note like "Pay ahead" is kept in front). */}
      {details.method === 'Bank Transfer' ? (
        <div className="sm:col-span-2">
          <label className={label} htmlFor="pay-bank">
            Bank name <span className="text-red-700">(required)</span>
          </label>
          <input
            id="pay-bank"
            type="text"
            maxLength={80}
            value={details.bankName}
            onChange={(e) => set({ bankName: e.target.value })}
            aria-invalid={!details.bankName.trim() ? true : undefined}
            className={`${input} ${!details.bankName.trim() ? 'border-red-400' : ''}`}
          />
        </div>
      ) : (
        <div className="sm:col-span-2">
          <label className={label} htmlFor="pay-note">Note (optional)</label>
          <input id="pay-note" type="text" value={details.note} onChange={(e) => set({ note: limitWords(e.target.value) })} className={input} />
          <WordCount text={details.note} />
        </div>
      )}
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

// PartialPaymentModal ("Record payment"): any amount up to the rest of the
// contract. It never locks the bill -- the bill follows the delivered trips, so paying one delivered trip
// can't turn the whole contract into "billed" (and overdue). Money above
// what's billed so far shows as "Paid ahead" until more trips are delivered.
function PartialPaymentModal({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking
  onClose: () => void
  onSaved: () => void
}) {
  // Everything in centavos, so a float leftover can't make a quick-fill look too big.
  const owedNow = cents(Math.max(booking.balance_due, 0))
  // The most it can take: the whole contract + extra charges (or the bill, if
  // an old override made it bigger), minus what's paid.
  const restOfContract = cents(
    Math.max(Math.max(booking.total_contract_value + booking.damage_charges, booking.billable_amount) - booking.amount_paid, 0),
  )
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
    (parsed.value !== null && parsed.value > restOfContract
      ? `Can't exceed the rest of the contract (${formatMoney(restOfContract)}).`
      : null)
  const dateError = paymentDateError(details.paidOn, earliest)
  const canSave = parsed.value !== null && !inputError && !paymentDetailsError(details, earliest) && !saving

  function fill(value: number) {
    setAmountText(String(cents(value)))
  }

  async function save() {
    setSaving(true)
    setSaveError(null)

    // A plain payment row -- the bill is never locked (see the comment above).
    const recordError = await recordBookingPayment({
      bookingId: booking.booking_id,
      amount,
      details,
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
            <p className="text-[13px] text-ink-muted">Owed now</p>
            <p className="font-semibold text-slate-900">{formatMoney(owedNow)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Paid so far</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.amount_paid)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Rest of contract</p>
            <p className="font-semibold text-slate-900">{formatMoney(restOfContract)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Owed now = delivered trips + extra charges, minus payments. Anything above it is kept as paid ahead and used
          up as the next trips are delivered.
        </p>

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

        {/* Quick-fills (no % presets -- staff type the amount received). */}
        <div className="mt-2 flex gap-2">
          {owedNow > 0 && (
            <button
              type="button"
              onClick={() => fill(owedNow)}
              className="border border-line-control px-3 py-1 text-xs font-medium text-ink-metric hover:bg-slate-50 rounded-[2px]"
            >
              All owed now
            </button>
          )}
          {restOfContract > owedNow && (
            <button
              type="button"
              onClick={() => fill(restOfContract)}
              className="border border-line-control px-3 py-1 text-xs font-medium text-ink-metric hover:bg-slate-50 rounded-[2px]"
            >
              Whole rest of contract
            </button>
          )}
        </div>

        <PaymentDetailsFields details={details} onChange={setDetails} earliest={earliest} />
        {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}

        {/* Preview of what the balance becomes */}
        {amountText !== '' && !inputError && (
          <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {cents(owedNow - amount) >= 0 ? (
              <>
                Owed now after this payment:{' '}
                <span className="font-semibold text-slate-900">{formatMoney(cents(owedNow - amount))}</span>
                {cents(owedNow - amount) === 0 && ' (fully paid)'}
              </>
            ) : (
              <>
                Owed now is paid; <span className="font-semibold text-slate-900">{formatMoney(cents(amount - owedNow))}</span>{' '}
                is kept as paid ahead.
              </>
            )}
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
// like any other payment (see the header comment).
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

// PayAheadModal: the client pays before the trips are delivered. Saved as a
// normal payment row (same as a downpayment),
// so billing still follows the delivered trips and the extra shows as
// "Paid ahead" until those trips are delivered.
function PayAheadModal({
  booking,
  onClose,
  onSaved,
}: {
  booking: Booking
  onClose: () => void
  onSaved: () => void
}) {
  const [amountText, setAmountText] = useState('')
  const [details, setDetails] = useState(() => ({ ...emptyPaymentDetails(), note: 'Pay ahead' }))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const earliest = booking.created_at ? toManilaDate(booking.created_at) : undefined
  // Can't pay more than the whole contract + extra charges.
  const contractTotal = booking.total_contract_value + booking.damage_charges
  const restOfContract = cents(Math.max(contractTotal - booking.amount_paid, 0))
  const parsed = parseAmount(amountText)
  const amount = parsed.value ?? 0
  const amountError =
    parsed.error ??
    (parsed.value !== null && parsed.value > restOfContract
      ? `Can't exceed the rest of the contract (${formatMoney(restOfContract)}).`
      : null)
  const dateError = paymentDateError(details.paidOn, earliest)
  const canSave = parsed.value !== null && !amountError && !paymentDetailsError(details, earliest) && !saving

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
            <p className="text-sm font-medium text-neutral-500">Pay ahead</p>
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
            <p className="text-[13px] text-ink-muted">Contract</p>
            <p className="font-semibold text-slate-900">{formatMoney(contractTotal)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Paid so far</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.amount_paid)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-muted">Rest of contract</p>
            <p className="font-semibold text-slate-900">{formatMoney(restOfContract)}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Trips are still billed as they're delivered -- this payment is used up as they are.
        </p>

        <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="pay-ahead-amount">
          Amount received (₱)
        </label>
        <input
          id="pay-ahead-amount"
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
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setAmountText(String(restOfContract))}
            className="border border-line-control px-3 py-1 text-xs font-medium text-ink-metric hover:bg-slate-50 rounded-[2px]"
          >
            Whole rest of contract
          </button>
        </div>

        <PaymentDetailsFields details={details} onChange={setDetails} earliest={earliest} />
        {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}

        {amountText !== '' && !amountError && (
          <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Rest of contract after this:{' '}
            <span className="font-semibold text-slate-900">{formatMoney(cents(restOfContract - amount))}</span>
            {cents(restOfContract - amount) === 0 && ' (whole contract paid)'}
          </p>
        )}

        {saveError && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="border border-line-control px-4 py-2 text-sm font-medium text-ink-metric hover:bg-slate-100 rounded-[2px]">Cancel</button>
          <button onClick={save} disabled={!canSave} className="btn-primary px-4 py-2 text-sm font-medium">{saving ? 'Saving…' : 'Record pay ahead'}</button>
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    // The balance on screen is from when the page loaded. Since then a
    // payment / refund may have been recorded, or a trip delivered / a charge
    // added (which shrinks the overpayment) -- re-read the WHOLE balance
    // (same rule as everywhere, lib/paymentDue.ts) before refunding.
    const { rows: fresh, error: freshError } = await loadPaymentDueReport(undefined, {
      includeSettled: true,
      bookingId: booking.booking_id,
    })
    if (freshError || fresh.length === 0) {
      setError(freshError ?? 'Could not re-check this booking.')
      return
    }
    if (cents(fresh[0].balance_due) !== cents(booking.balance_due)) {
      setError(
        `This booking changed since the page loaded (balance is now ${formatMoney(fresh[0].balance_due)}). ` +
          'Close this and reload Bills Receivable before refunding.',
      )
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

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
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

        {/* Payments are recorded with the row's "Record payment" button, not here. */}
        <div className="mt-6 bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Prices and extra charges</h4>
          <p className="mt-1 text-xs text-slate-500">
            The bill is the delivered trips ({formatMoney(booking.computed_billable_amount)}) plus extra charges
            ({formatMoney(booking.damage_charges)}). Change a trip&apos;s price in Bookings &amp; Trips (Full Details →
            Edit); add an extra charge on the Billing page.
          </p>
          <Link
            to={`/dashboard/billing/${booking.booking_id}`}
            className="mt-3 inline-flex min-h-11 items-center border border-line-control bg-white px-4 text-sm font-medium text-ink-metric hover:bg-slate-50 rounded-[2px]"
          >
            Open Billing
          </Link>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="border border-line-control px-4 py-2 text-sm font-medium text-ink-metric hover:bg-slate-100 rounded-[2px]">Close</button>
        </div>
      </div>
    </div>
  )
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
  // The Payments Due rows (due dates, terms, unpaid parts) the bookings were built from.
  const [dueRows, setDueRows] = useState<PaymentDueRow[]>([])
  const [clientFilter, setClientFilter] = useState('')
  const [termsFilter, setTermsFilter] = useState('')
  const [search, setSearch] = useState('')
  const dueByBooking = new Map(dueRows.map((r) => [r.booking_id, r]))
  const [tab, setTab] = useState<Tab>('ongoing')
  // Downpayment per booking (null = no requirement) and the one being recorded.
  const [downpaymentById, setDownpaymentById] = useState<Map<number, DownpaymentStatus | null>>(new Map())
  const [downpaymentBooking, setDownpaymentBooking] = useState<Booking | null>(null)
  const [payAheadBooking, setPayAheadBooking] = useState<Booking | null>(null)

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

  // One read: the shared Payments Due report (lib/paymentDue.ts, rules in
  // lib/bookingBalance.ts) with settled bookings kept -- the same numbers
  // Statements, Billing, Financial Summary and the client portal show.
  async function loadBookings() {
    setLoading(true)
    const { rows, error: loadError } = await loadPaymentDueReport(undefined, { includeSettled: true })
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    // Newest first.
    const sorted = [...rows].sort(
      (a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.booking_id - a.booking_id,
    )
    setDueRows(sorted)
    setDownpaymentById(
      new Map(
        sorted.map((r) => [
          r.booking_id,
          downpaymentStatus({
            contract: r.total_contract_value,
            costPerTrip: r.cost_per_trip,
            trips: r.total_trips,
            amountPaid: r.amount_paid,
            waivedAt: r.downpayment_waived_at,
            fixed: r.downpayment_fixed,
            percent: r.downpayment_percent,
          }),
        ]),
      ),
    )
    setBookings(
      sorted.map((r) => ({
        booking_id: r.booking_id,
        client_name: r.client_name,
        pickup_location: r.pickup_place_name,
        delivery_location: r.delivery_place_name,
        date: r.booking_date,
        status: r.booking_status ?? 'Draft',
        rate: r.rate_per_trip,
        trip_rates: r.trip_rates,
        total_trips: r.total_trips,
        completed_trips: r.completed_trips,
        total_contract_value: r.total_contract_value,
        computed_billable_amount: r.computed_billable_amount,
        damage_charges: r.damage_charges,
        billable_amount: r.billable_amount,
        amount_paid: r.amount_paid,
        balance_due: r.balance_due,
        created_at: r.created_at ?? undefined,
        cancelled_trips: r.cancelled_trips,
        cancelled_at: r.cancelled_at,
      })),
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
      (!termsFilter || dueByBooking.get(b.booking_id)?.payment_terms === termsFilter) &&
      // An EXACT booking # ("48" / "#48"), else part of the client name (lib/search.ts).
      (numberQuery(search) !== null ? idMatches(search, b.booking_id) : textMatches(search, b.client_name)),
  )
  const filtering = search.trim() !== '' || clientFilter !== '' || termsFilter !== ''
  const clientNames = [...new Set(bookings.map((b) => b.client_name))].sort((a, b) => a.localeCompare(b))
  const termsInUse = [...new Set(dueRows.map((r) => r.payment_terms))].filter(Boolean)

  // The "amounts owed" tiles. Each unpaid PART of a bill (a delivered trip, a
  // charge) counts by its own due date, so a booking's newer, not-yet-due
  // trip isn't counted as overdue with an older one (lib/bookingBalance.ts).
  const today = toManilaDate(new Date())
  const openParts = dueRows.flatMap((r) => r.open_items)
  const sumParts = (test: (days: number | null) => boolean) =>
    cents(
      openParts
        .filter((p) => test(p.due_date === null ? null : daysBetween(today, p.due_date)))
        .reduce((total, p) => total + p.amount, 0),
    )
  const tiles = [
    { label: 'Total outstanding', value: sumParts(() => true), tone: 'text-ink' },
    { label: 'Not yet due', value: sumParts((d) => d === null || d >= 0), tone: 'text-ink' },
    { label: 'Overdue 1–30 days', value: sumParts((d) => d !== null && d < 0 && d >= -30), tone: 'text-amber-800' },
    { label: 'Overdue over 30 days', value: sumParts((d) => d !== null && d < -30), tone: 'text-red-700' },
  ]

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(visibleBookings, `${tab}|${clientFilter}|${termsFilter}|${search}`)
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

      <section aria-label="Amounts owed" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        // Table takes the full width; the due-date rules sit underneath as a horizontal strip.
        <div className="flex flex-col gap-4">
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
                <label className={FILTER_LABEL}>
                  Search
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Client or booking #"
                    className={`${FILTER_CONTROL} w-56 font-normal placeholder:text-ink-muted`}
                  />
                </label>
              </div>
            </div>
            {tab === 'cancelled' && (
              <p className="text-sm text-ink-muted">
                Cancelled bookings are only billed for the trips that were delivered before cancellation. Bookings with no
                delivered trips owe nothing.
              </p>
            )}

            <section aria-label="Receivables" className="card flex min-h-[calc(100dvh-34rem)] flex-col">
              {visibleBookings.length === 0 && !filtering ? (
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
                      {paged.rows.length === 0 && (
                        <NoMatchRow
                          colSpan={11}
                          message={noMatchText('booking', search, clientFilter !== '' || termsFilter !== '')}
                          clearLabel={clientFilter || termsFilter ? 'Clear search & filters' : 'Clear search'}
                          onClear={() => {
                            setSearch('')
                            setClientFilter('')
                            setTermsFilter('')
                          }}
                        />
                      )}
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
                              <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
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
                                ) : tripsToCome &&
                                  cents(booking.total_contract_value + booking.damage_charges - booking.amount_paid) > 0 ? (
                                  // Nothing owed yet but trips to come: the client may pay ahead.
                                  <button
                                    onClick={() => {
                                      setActionError(null)
                                      setPayAheadBooking(booking)
                                    }}
                                    className={primaryAction}
                                  >
                                    Pay ahead
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
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 sm:gap-x-6">
              {DUE_RULES.map(([terms, rule]) => (
                <div key={terms} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm xl:border-b-0">
                  <span className="text-ink-secondary">{terms}</span>
                  <span className="font-semibold">{rule}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
      {partialBooking && (
        <PartialPaymentModal
          booking={partialBooking}
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
      {payAheadBooking && (
        <PayAheadModal
          booking={payAheadBooking}
          onClose={() => setPayAheadBooking(null)}
          onSaved={() => {
            setPayAheadBooking(null)
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
