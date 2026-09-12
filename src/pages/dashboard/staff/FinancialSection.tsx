// FinancialSection: where payments actually get recorded. Reuses the
// same Booking type/loading logic as BookingsSection.tsx (rate is per
// trip, so billable_amount = amount_to_pay override if staff has set
// one, otherwise computed_billable_amount = rate x trips Delivered so
// far -- see BookingsSection.tsx / src/lib/paymentDue.ts for the full
// rule). This page is the one place that WRITES amount_to_pay and
// amount_paid; the Payments Due panel/tab (Bookings page, Reports page)
// and the client portal are read-only views of the same numbers.
import { useEffect, useState } from 'react'
import type { Booking } from './BookingsSection'
import { BookingStatusBadge } from './BookingsSection'
import { supabase } from '../../../lib/supabaseClient'

function formatMoney(value: number | null): string {
  return value !== null ? `₱${value.toLocaleString()}` : '—'
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
  const [overrideAmount, setOverrideAmount] = useState(
    String(booking.billable_amount),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(
    databaseValues: Record<string, number | null>,
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

  function savePayment() {
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

    const nextPaid = booking.amount_paid + payment
    save(
      { amount_paid: nextPaid },
      { amount_paid: nextPaid, balance_due: booking.billable_amount - nextPaid },
    )
  }

  function saveOverride() {
    const total = Number(overrideAmount)

    if (!Number.isFinite(total) || total < 0) {
      setError('Amount to pay must be zero or greater.')
      return
    }
    if (total < booking.amount_paid) {
      setError(
        `Amount to pay can't be less than what's already been paid (${formatMoney(booking.amount_paid)}).`,
      )
      return
    }

    save(
      { amount_to_pay: total },
      {
        amount_to_pay: total,
        billable_amount: total,
        balance_due: total - booking.amount_paid,
      },
    )
  }

  function resetOverride() {
    setOverrideAmount(String(booking.computed_billable_amount))
    save(
      { amount_to_pay: null },
      {
        amount_to_pay: null,
        billable_amount: booking.computed_billable_amount,
        balance_due: booking.computed_billable_amount - booking.amount_paid,
      },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-lg">
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
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
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

        <div className="mt-6 rounded-lg bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Record payment received</h4>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Payment amount" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
            <button onClick={savePayment} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save Payment'}</button>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Override amount to pay</h4>
          <p className="mt-1 text-xs text-slate-500">
            Defaults to rate x trips completed ({formatMoney(booking.computed_billable_amount)}).
            Override this for a discount or special arrangement -- it stays
            fixed at your override even as more trips complete, until you
            reset it.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="number" min="0" step="0.01" value={overrideAmount} onChange={(e) => setOverrideAmount(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
            <button onClick={saveOverride} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Override'}</button>
            {booking.amount_to_pay !== null && (
              <button onClick={resetOverride} disabled={saving} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50">Reset to computed</button>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Close</button>
        </div>
      </div>
    </div>
  )
}

function FinancialSection() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadBookings()
  }, [])

  async function loadBookings() {
    setLoading(true)

    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select(
        'booking_id, client_id, place_of_pickup_id, place_of_delivery_id, booking_date, booking_status, rate_of_delivery_service, amount_to_pay, amount_paid',
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
        const billableAmount = b.amount_to_pay ?? computedBillableAmount
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
          billable_amount: billableAmount,
          amount_paid: amountPaid,
          balance_due: billableAmount - amountPaid,
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Financial Records</h2>
      <p className="mt-1 text-sm text-slate-500">Record payments and, if needed, override the amount due.</p>
      {loading && <p className="mt-4 text-slate-500">Loading financial records...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && bookings.length === 0 && <p className="mt-4 text-slate-500">No bookings yet.</p>}
      {!loading && !error && bookings.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Booking</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Trips</th>
                <th className="px-4 py-3 font-medium">Amount to pay</th>
                <th className="px-4 py-3 font-medium">Amount paid</th>
                <th className="px-4 py-3 font-medium">Balance due</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr key={booking.booking_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-900">#{booking.booking_id}</td>
                  <td className="px-4 py-3 text-slate-900">{booking.client_name}</td>
                  <td className="px-4 py-3"><BookingStatusBadge status={booking.status} /></td>
                  <td className="px-4 py-3 text-slate-600">{booking.completed_trips}/{booking.total_trips}</td>
                  <td className="px-4 py-3 text-slate-600">{formatMoney(booking.billable_amount)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatMoney(booking.amount_paid)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{formatMoney(booking.balance_due)}</td>
                  <td className="px-4 py-3"><button onClick={() => setSelectedBooking(booking)} className="font-medium text-slate-700 hover:text-slate-900">Manage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
