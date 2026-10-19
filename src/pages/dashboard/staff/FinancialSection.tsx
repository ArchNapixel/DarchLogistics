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
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Booking } from './BookingsSection'
import StatusBadge from '../../../components/StatusBadge'
import { supabase } from '../../../lib/supabaseClient'
import { loadClientDamageChargesByBooking } from '../../../lib/damageCharges'
import { confirmDialog } from '../../../components/ConfirmDialog'
import {
  PAYMENT_METHODS,
  emptyPaymentDetails,
  paymentDateError,
  recordBookingPayment,
  type PaymentDetails,
} from '../../../lib/bookingPayments'
import { toManilaDate } from '../../../lib/payslip'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

// PaymentDetailsFields: method / date received / reference / OR number / note,
// shown under the amount in both payment forms. Controlled by the parent.
function PaymentDetailsFields({
  details,
  onChange,
}: {
  details: PaymentDetails
  onChange: (details: PaymentDetails) => void
}) {
  const set = (patch: Partial<PaymentDetails>) => onChange({ ...details, ...patch })
  const input = 'mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900'
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
          max={toManilaDate(new Date())}
          onChange={(e) => set({ paidOn: e.target.value })}
          className={input}
        />
      </div>
      <div>
        <label className={label} htmlFor="pay-ref">Reference no. (optional)</label>
        <input id="pay-ref" type="text" maxLength={50} value={details.referenceNo} onChange={(e) => set({ referenceNo: e.target.value })} className={input} />
      </div>
      <div>
        <label className={label} htmlFor="pay-or">OR number (optional)</label>
        <input id="pay-or" type="text" maxLength={50} value={details.orNumber} onChange={(e) => set({ orNumber: e.target.value })} className={input} />
      </div>
      <div className="sm:col-span-2">
        <label className={label} htmlFor="pay-note">Note (optional)</label>
        <input id="pay-note" type="text" maxLength={200} value={details.note} onChange={(e) => set({ note: e.target.value })} className={input} />
      </div>
    </div>
  )
}

// PartialPaymentModal: opened by the "Partial Payment" button. Shows what's
// owed, takes the amount received (with quick-fill buttons) and previews
// the balance that will be left before anything is saved.
function PartialPaymentModal({
  booking,
  target,
  deliveryTarget,
  fullPayment,
  onClose,
  onSaved,
}: {
  booking: Booking
  target: number // delivery + damage
  deliveryTarget: number // delivery only -- what amount_to_pay gets locked to
  // Opened from "Paid Full": amount starts at the whole remaining balance.
  fullPayment?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const remaining = target - booking.amount_paid
  const [amountText, setAmountText] = useState(
    fullPayment ? String(Math.round(remaining * 100) / 100) : '',
  )
  const [details, setDetails] = useState(emptyPaymentDetails)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const amount = Number(amountText)
  // Shown live as the user types (empty box = no message yet).
  let inputError: string | null = null
  if (amountText !== '') {
    if (!Number.isFinite(amount) || amount <= 0) {
      inputError = 'Enter an amount greater than zero.'
    } else if (amount > remaining) {
      inputError = `Can't exceed the remaining balance (${formatMoney(remaining)}).`
    }
  }
  const dateError = paymentDateError(details.paidOn)
  const canSave = amountText !== '' && !inputError && !dateError && !saving

  // Round to cents so 25% of an odd number doesn't give 1234.5600000001.
  function fill(value: number) {
    setAmountText(String(Math.round(value * 100) / 100))
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
    })

    setSaving(false)

    if (recordError) {
      setSaveError(recordError)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {fullPayment ? 'Paid in full' : 'Partial payment'}
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
            <p className="text-xs text-slate-400">Total due</p>
            <p className="font-semibold text-slate-900">{formatMoney(target)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Paid so far</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.amount_paid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Remaining</p>
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
          // Plain text box (no spinner / scroll-wheel changes); only digits and a dot are kept.
          onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && canSave && save()}
          className="mt-1 w-full border border-slate-300 bg-white px-3 py-2 text-slate-900"
        />
        {inputError && <p className="mt-1 text-xs text-red-700">{inputError}</p>}

        {/* Quick-fill buttons */}
        <div className="mt-2 flex gap-2">
          {[0.25, 0.5].map((share) => (
            <button
              key={share}
              type="button"
              onClick={() => fill(remaining * share)}
              className="border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {share * 100}%
            </button>
          ))}
          <button
            type="button"
            onClick={() => fill(remaining)}
            className="border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Full remaining
          </button>
        </div>

        <PaymentDetailsFields details={details} onChange={setDetails} />
        {dateError && <p className="mt-1 text-xs text-red-700">{dateError}</p>}

        {/* Preview of what the balance becomes */}
        {amountText !== '' && !inputError && (
          <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Balance after this payment:{' '}
            <span className="font-semibold text-slate-900">{formatMoney(remaining - amount)}</span>
            {remaining - amount === 0 && ' (fully paid)'}
          </p>
        )}

        {saveError && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={!canSave} className="btn-primary px-4 py-2 text-sm font-medium">{saving ? 'Saving...' : 'Record payment'}</button>
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
  const [paymentAmount, setPaymentAmount] = useState('')
  // The override is the delivery amount only (damage is added on top).
  const [overrideAmount, setOverrideAmount] = useState(
    String(booking.billable_amount - booking.damage_charges),
  )
  const [paymentDetails, setPaymentDetails] = useState(emptyPaymentDetails)
  const [invoiceText, setInvoiceText] = useState(booking.invoice_number ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(
    databaseValues: Record<string, number | string | null>,
    nextBooking: Partial<Booking>,
  ) {
    setSaving(true)
    setError(null)

    const { error: updateError } = await supabase
      .from('bookings')
      .update(databaseValues)
      .eq('booking_id', booking.booking_id)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
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

  async function savePayment() {
    const payment = Number(paymentAmount)

    if (!Number.isFinite(payment) || payment <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    if (payment > booking.balance_due) {
      setError(
        `Payment can't exceed the current balance due (${formatMoney(booking.balance_due)}).`,
      )
      return
    }
    const dateError = paymentDateError(paymentDetails.paidOn)
    if (dateError) {
      setError(dateError)
      return
    }

    if (await addPayment(payment, paymentDetails)) {
      setPaymentAmount('')
      setPaymentDetails(emptyPaymentDetails())
    }
  }

  // Overpaid (e.g. cancelled before delivery): hand the extra back. Saved as
  // a negative payment (method Refund) so it shows in the payment history
  // and brings amount_paid down to what's actually owed.
  async function refundOverpayment() {
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

    if (!Number.isFinite(total) || total < 0) {
      setError('Amount to pay must be zero or greater.')
      return
    }
    if (total + booking.damage_charges < booking.amount_paid) {
      setError(
        `Amount to pay (plus damage charges) can't be less than what's already been paid (${formatMoney(booking.amount_paid)}).`,
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-2xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
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
            <p className="text-xs text-slate-400">Rate / trip</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.rate)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Trips completed</p>
            <p className="font-semibold text-slate-900">
              {booking.completed_trips}/{booking.total_trips}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Contract value</p>
            <p className="font-semibold text-slate-900">
              {formatMoney(booking.total_contract_value)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Amount to pay</p>
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
                incl. {formatMoney(booking.damage_charges)} damage charges
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400">Amount paid</p>
            <p className="font-semibold text-slate-900">{formatMoney(booking.amount_paid)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Balance due</p>
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

        <div className="mt-6 bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Record payment received</h4>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Payment amount" className="w-full border border-slate-300 bg-white px-3 py-2 text-slate-900" />
            <button onClick={savePayment} disabled={saving} className="btn-primary px-4 py-2 text-sm font-medium">{saving ? 'Saving...' : 'Save Payment'}</button>
          </div>
          <PaymentDetailsFields details={paymentDetails} onChange={setPaymentDetails} />
        </div>

        <div className="mt-4 bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Override amount to pay</h4>
          <p className="mt-1 text-xs text-slate-500">
            Defaults to rate x trips completed ({formatMoney(booking.computed_billable_amount)}).
            This is the delivery amount only -- approved damage charges
            ({formatMoney(booking.damage_charges)}) are always added on top.
            Override this for a discount or special arrangement -- it stays
            fixed at your override even as more trips complete, until you
            reset it.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="number" min="0" step="0.01" value={overrideAmount} onChange={(e) => setOverrideAmount(e.target.value)} className="w-full border border-slate-300 bg-white px-3 py-2 text-slate-900" />
            <button onClick={saveOverride} disabled={saving} className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Override'}</button>
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
            <input type="text" maxLength={50} value={invoiceText} onChange={(e) => setInvoiceText(e.target.value)} className="w-full border border-slate-300 bg-white px-3 py-2 text-slate-900" />
            <button onClick={saveInvoice} disabled={saving} className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Invoice No.'}</button>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Close</button>
        </div>
      </div>
    </div>
  )
}

// Paid Full / Partial Payment both track against the FULL contract
// value (rate x all trips) plus damage charges, not just trips completed so far -- a client
// can pay in advance before delivery finishes. Whichever one is used
// first locks in amount_to_pay at that target (the existing override if
// staff already set a discount via Manage, otherwise the full contract
// value), so the rest of the app's "amount due" for this booking
// switches from trip-based to full-contract-based from then on --
// consistent everywhere, since every view already reads the same
// amount_to_pay override (see paymentDue.ts).
// Delivery part only -- this is what gets written to amount_to_pay.
function getDeliveryTarget(booking: Booking): number {
  // A cancelled booking is only ever billed for the trips actually
  // delivered -- an earlier lock at the full contract value is capped.
  if (booking.status === 'Cancelled') {
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

const TAB_LABELS: Record<Tab, string> = {
  ongoing: 'Ongoing (awaiting payment)',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

// Everything the client owes in total: delivery + damage charges.
function getPaymentTarget(booking: Booking): number {
  return getDeliveryTarget(booking) + booking.damage_charges
}

function FinancialSection() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [partialBooking, setPartialBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [paymentIsFull, setPaymentIsFull] = useState(false)
  const [tab, setTab] = useState<Tab>('ongoing')

  useEffect(() => {
    loadBookings()
  }, [])

  async function loadBookings() {
    setLoading(true)

    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select(
        'booking_id, client_id, place_of_pickup_id, place_of_delivery_id, booking_date, booking_status, rate_of_delivery_service, amount_to_pay, amount_paid, invoice_number',
      )
      .order('created_at', { ascending: false })

    if (bookingsError) {
      setError(bookingsError.message)
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
      supabase.from('clients').select('client_id, client_name').in('client_id', clientIds),
      supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
      supabase
        .from('itineraries')
        .select('booking_id, itinerary_status')
        .in('booking_id', bookingIds),
    ])

    if (clientsResult.error) {
      setError(clientsResult.error.message)
      setLoading(false)
      return
    }
    if (placesResult.error) {
      setError(placesResult.error.message)
      setLoading(false)
      return
    }
    if (itinerariesResult.error) {
      setError(itinerariesResult.error.message)
      setLoading(false)
      return
    }


    // Approved Client damage charges, added on top of the delivery amount.
    const { byBooking: damageByBooking, error: damageError } =
      await loadClientDamageChargesByBooking(bookingIds)
    if (damageError) {
      setError(damageError)
      setLoading(false)
      return
    }

    const clientNameById = new Map(
      clientsResult.data.map((c) => [c.client_id, c.client_name]),
    )
    const placeNameById = new Map(
      placesResult.data.map((p) => [p.place_id, p.place_name]),
    )

    const totalTripsByBooking = new Map<number, number>()
    const completedTripsByBooking = new Map<number, number>()
    itinerariesResult.data.forEach((itinerary) => {
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

    setBookings(
      bookingRows.map((b) => {
        const rate = b.rate_of_delivery_service ?? 0
        const totalTrips = totalTripsByBooking.get(b.booking_id) ?? 0
        const completedTrips = completedTripsByBooking.get(b.booking_id) ?? 0
        const computedBillableAmount = rate * completedTrips
        const damageCharges = damageByBooking.get(b.booking_id) ?? 0
        // Cancelled: only delivered trips are billable (same cap as getDeliveryTarget).
        const deliveryAmount =
          b.booking_status === 'Cancelled'
            ? Math.min(b.amount_to_pay ?? Infinity, computedBillableAmount)
            : (b.amount_to_pay ?? computedBillableAmount)
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
          total_trips: totalTrips,
          completed_trips: completedTrips,
          total_contract_value: rate * totalTrips,
          computed_billable_amount: computedBillableAmount,
          amount_to_pay: b.amount_to_pay,
          damage_charges: damageCharges,
          billable_amount: billableAmount,
          amount_paid: amountPaid,
          balance_due: billableAmount - amountPaid,
          invoice_number: b.invoice_number,
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  // Both buttons open the same payment form; Paid Full starts with the
  // whole remaining balance filled in.
  function openPayment(booking: Booking, full: boolean) {
    setActionError(null)
    setPaymentIsFull(full)
    setPartialBooking(booking)
  }

  const visibleBookings = bookings.filter((b) => getTab(b) === tab)

  return (
    <div>
      <PageHeader title="Bills Receivable" subtitle="What each client owes, payments received, and refunds." />
      {actionError && (
        <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {loading && <p className="mt-4 text-slate-500">Loading financial records...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && bookings.length === 0 && <EmptyState message="No bookings yet." className="mt-4" />}
      {!loading && !error && bookings.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 text-sm font-medium ${
                tab === key
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {TAB_LABELS[key]} ({bookings.filter((b) => getTab(b) === key).length})
            </button>
          ))}
        </div>
      )}
      {!loading && !error && bookings.length > 0 && tab === 'cancelled' && (
        <p className="mt-3 text-sm text-slate-500">
          Cancelled bookings are only billed for the trips that were delivered before
          cancellation. Bookings with no delivered trips owe nothing.
        </p>
      )}
      {!loading && !error && bookings.length > 0 && visibleBookings.length === 0 && (
        <EmptyState message="Nothing in this tab." className="mt-4" />
      )}
      {!loading && !error && visibleBookings.length > 0 && (
        <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Booking</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Invoice no.</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Trips</th>
                <th className="px-4 py-3 font-medium">Amount to pay</th>
                <th className="px-4 py-3 font-medium">Amount paid</th>
                <th className="px-4 py-3 font-medium">Balance due</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleBookings.map((booking) => {
                const remaining = getPaymentTarget(booking) - booking.amount_paid
                return (
                  <tr key={booking.booking_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-900">#{booking.booking_id}</td>
                    <td className="px-4 py-3 text-slate-900">{booking.client_name}</td>
                    <td className="px-4 py-3 text-slate-600">{booking.invoice_number || '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={booking.status} /></td>
                    <td className="px-4 py-3 text-slate-600">{booking.completed_trips}/{booking.total_trips}</td>
                    <td className="px-4 py-3 text-slate-600">{formatMoney(booking.billable_amount)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatMoney(booking.amount_paid)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {booking.balance_due < 0 ? (
                        <span className="text-amber-700">Refund {formatMoney(-booking.balance_due)}</span>
                      ) : (
                        <span className={booking.balance_due > 0 ? 'font-semibold text-primary' : ''}>
                          {formatMoney(booking.balance_due)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {remaining > 0 && (
                          <>
                            <button
                              onClick={() => openPayment(booking, false)}
                              className="border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Partial Payment
                            </button>
                            <button
                              onClick={() => openPayment(booking, true)}
                              className="btn-secondary px-3 py-1.5 text-xs font-medium"
                            >
                              Paid Full
                            </button>
                          </>
                        )}
                        <button onClick={() => setSelectedBooking(booking)} className="font-medium text-slate-700 hover:text-slate-900">Manage</button>
                        <Link to={`/dashboard/billing/${booking.booking_id}`} className="font-medium text-slate-700 hover:text-slate-900">Billing</Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {partialBooking && (
        <PartialPaymentModal
          booking={partialBooking}
          target={getPaymentTarget(partialBooking)}
          deliveryTarget={getDeliveryTarget(partialBooking)}
          fullPayment={paymentIsFull}
          onClose={() => setPartialBooking(null)}
          onSaved={() => {
            setPartialBooking(null)
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
