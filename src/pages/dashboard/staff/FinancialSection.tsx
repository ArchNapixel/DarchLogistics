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
  const [amountToPay, setAmountToPay] = useState(String(booking.amount_to_pay ?? ''))
  const [amountPaid, setAmountPaid] = useState(String(booking.amount_paid ?? 0))
  const [balanceDue, setBalanceDue] = useState(String(booking.balance_due ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(values: Partial<Booking>, databaseValues: Record<string, number | null>) {
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

    onUpdated({ ...booking, ...values })
  }

  function savePayment() {
    const payment = Number(paymentAmount)
    const currentPaid = booking.amount_paid ?? 0
    const total = booking.amount_to_pay

    if (!Number.isFinite(payment) || payment <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    if (total !== null && currentPaid + payment > total) {
      setError('Payment cannot be greater than the remaining balance.')
      return
    }

    const nextPaid = currentPaid + payment
    const nextBalance = total === null ? null : Math.max(total - nextPaid, 0)
    save(
      { amount_paid: nextPaid, balance_due: nextBalance },
      { amount_paid: nextPaid, balance_due: nextBalance },
    )
  }

  function saveFinancialRecords() {
    const total = Number(amountToPay)
    const paid = Number(amountPaid)
    const balance = Number(balanceDue)

    if (
      !Number.isFinite(total) ||
      !Number.isFinite(paid) ||
      !Number.isFinite(balance) ||
      total < 0 ||
      paid < 0 ||
      balance < 0
    ) {
      setError('Financial amounts must be zero or greater.')
      return
    }
    if (paid > total || balance > total) {
      setError('Amount paid and balance due cannot be greater than the total.')
      return
    }

    save(
      { amount_to_pay: total, amount_paid: paid, balance_due: balance },
      { amount_to_pay: total, amount_paid: paid, balance_due: balance },
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
          <div><p className="text-xs text-slate-400">Amount to pay</p><p className="font-semibold text-slate-900">{formatMoney(booking.amount_to_pay)}</p></div>
          <div><p className="text-xs text-slate-400">Amount paid</p><p className="font-semibold text-slate-900">{formatMoney(booking.amount_paid)}</p></div>
          <div><p className="text-xs text-slate-400">Balance due</p><p className="font-semibold text-slate-900">{formatMoney(booking.balance_due)}</p></div>
        </div>

        <div className="mt-6 rounded-lg bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Record payment received</h4>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="Payment amount" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" />
            <button onClick={savePayment} disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save Payment'}</button>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-4">
          <h4 className="font-medium text-slate-900">Update financial records</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">Amount to pay<input type="number" min="0" step="0.01" value={amountToPay} onChange={(e) => setAmountToPay(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" /></label>
            <label className="text-sm font-medium text-slate-700">Amount paid<input type="number" min="0" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" /></label>
            <label className="text-sm font-medium text-slate-700">Balance due<input type="number" min="0" step="0.01" value={balanceDue} onChange={(e) => setBalanceDue(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900" /></label>
          </div>
          <button onClick={saveFinancialRecords} disabled={saving} className="mt-3 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white disabled:opacity-50">{saving ? 'Saving...' : 'Save Financial Records'}</button>
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
    const { data, error: bookingsError } = await supabase
      .from('bookings')
      .select('booking_id, client_id, booking_date, booking_status, rate_of_delivery_service, amount_to_pay, amount_paid, balance_due')
      .order('created_at', { ascending: false })

    if (bookingsError) {
      setError(bookingsError.message)
      setLoading(false)
      return
    }

    const clientIds = Array.from(new Set(data.map((booking) => booking.client_id)))
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('client_id, client_name')
      .in('client_id', clientIds)

    if (clientsError) {
      setError(clientsError.message)
      setLoading(false)
      return
    }

    const clientNames = new Map(clients.map((client) => [client.client_id, client.client_name]))
    setBookings(data.map((booking) => ({
      booking_id: booking.booking_id,
      client_name: clientNames.get(booking.client_id) ?? '—',
      pickup_location: '—',
      delivery_location: '—',
      date: booking.booking_date,
      status: booking.booking_status ?? 'Draft',
      rate: booking.rate_of_delivery_service,
      amount_to_pay: booking.amount_to_pay,
      amount_paid: booking.amount_paid,
      balance_due: booking.balance_due,
    })))
    setError(null)
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Financial Records</h2>
      <p className="mt-1 text-sm text-slate-500">Record payments and maintain booking balances.</p>
      {loading && <p className="mt-4 text-slate-500">Loading financial records...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && bookings.length === 0 && <p className="mt-4 text-slate-500">No bookings yet.</p>}
      {!loading && !error && bookings.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-4 py-3 font-medium">Booking</th><th className="px-4 py-3 font-medium">Client</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Amount to pay</th><th className="px-4 py-3 font-medium">Amount paid</th><th className="px-4 py-3 font-medium">Balance due</th><th className="px-4 py-3 font-medium">Action</th></tr></thead>
            <tbody>{bookings.map((booking) => <tr key={booking.booking_id} className="border-b border-slate-100 last:border-0"><td className="px-4 py-3 text-slate-900">#{booking.booking_id}</td><td className="px-4 py-3 text-slate-900">{booking.client_name}</td><td className="px-4 py-3"><BookingStatusBadge status={booking.status} /></td><td className="px-4 py-3 text-slate-600">{formatMoney(booking.amount_to_pay)}</td><td className="px-4 py-3 text-slate-600">{formatMoney(booking.amount_paid)}</td><td className="px-4 py-3 text-slate-600">{formatMoney(booking.balance_due)}</td><td className="px-4 py-3"><button onClick={() => setSelectedBooking(booking)} className="font-medium text-slate-700 hover:text-slate-900">Manage</button></td></tr>)}</tbody>
          </table>
        </div>
      )}
      {selectedBooking && <FinancialActionModal booking={selectedBooking} onClose={() => setSelectedBooking(null)} onUpdated={(updatedBooking) => { setBookings((prev) => prev.map((booking) => booking.booking_id === updatedBooking.booking_id ? updatedBooking : booking)); setSelectedBooking(updatedBooking) }} />}
    </div>
  )
}

export default FinancialSection
