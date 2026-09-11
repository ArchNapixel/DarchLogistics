// BookingsSection: lists real bookings in a table, with a click-through
// detail view for each row.
//
// Reads from `bookings`, then looks up client/place names separately from
// `clients` and `places` (same pattern as DriverTasks.tsx) since Supabase
// doesn't auto-join related tables. Bookings only ever get created via
// the Quotations Approve flow (QuoteReviewModal) -- staff wanting to log
// a booking that didn't come through the public form uses "New Quote"
// on the Quotations page instead, so it goes through the same tested
// approve logic rather than a separate manual-entry path.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import BookingDetailModal from './BookingDetailModal'

export type Booking = {
  booking_id: number
  client_name: string
  pickup_location: string
  delivery_location: string
  date: string
  status: string
  rate: number | null
  amount_to_pay: number | null
  amount_paid: number | null
  balance_due: number | null
}

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Confirmed: 'bg-blue-100 text-blue-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

export function BookingStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style}`}>
      {status}
    </span>
  )
}

function BookingsSection() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    loadBookings()
  }, [])

  async function handleDelete(booking: Booking) {
    if (
      !window.confirm(
        `Delete booking #${booking.booking_id}? This cannot be undone.`,
      )
    ) {
      return
    }

    setDeletingId(booking.booking_id)

    const { error: deleteError } = await supabase
      .from('bookings')
      .delete()
      .eq('booking_id', booking.booking_id)

    setDeletingId(null)

    if (deleteError) {
      // itineraries has a foreign key to bookings with no cascade rule,
      // so deleting a booking that still has itineraries fails here --
      // translate that into something staff can actually act on.
      if (deleteError.message.includes('itineraries')) {
        setError(
          `Can't delete booking #${booking.booking_id} -- it still has ` +
            `itineraries attached. Remove those first (Dispatch Board or ` +
            `directly in Supabase), then try again.`,
        )
      } else {
        setError(deleteError.message)
      }
      return
    }

    setBookings((prev) => prev.filter((b) => b.booking_id !== booking.booking_id))
  }

  async function loadBookings() {
    setLoading(true)

    // 1. Load the bookings themselves.
    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select(
        'booking_id, client_id, place_of_pickup_id, place_of_delivery_id, booking_date, booking_status, rate_of_delivery_service, amount_to_pay, amount_paid, balance_due',
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

    // 2. Look up client names and place names (bookings only stores IDs).
    const clientIds = Array.from(new Set(bookingRows.map((b) => b.client_id)))
    const placeIds = Array.from(
      new Set(
        bookingRows.flatMap((b) => [
          b.place_of_pickup_id,
          b.place_of_delivery_id,
        ]),
      ),
    )

    const [clientsResult, placesResult] = await Promise.all([
      supabase.from('clients').select('client_id, client_name').in('client_id', clientIds),
      supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
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

    const clientNameById = new Map(
      clientsResult.data.map((c) => [c.client_id, c.client_name]),
    )
    const placeNameById = new Map(
      placesResult.data.map((p) => [p.place_id, p.place_name]),
    )

    setBookings(
      bookingRows.map((b) => ({
        booking_id: b.booking_id,
        client_name: clientNameById.get(b.client_id) ?? '—',
        pickup_location: placeNameById.get(b.place_of_pickup_id) ?? '—',
        delivery_location: placeNameById.get(b.place_of_delivery_id) ?? '—',
        date: b.booking_date,
        status: b.booking_status ?? 'Draft',
        rate: b.rate_of_delivery_service,
        amount_to_pay: b.amount_to_pay,
        amount_paid: b.amount_paid,
        balance_due: b.balance_due,
      })),
    )
    setError(null)
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Bookings</h2>

      {loading ? (
        <p className="mt-4 text-slate-500">Loading bookings...</p>
      ) : error ? (
        <p className="mt-4 text-red-700">{error}</p>
      ) : bookings.length === 0 ? (
        <p className="mt-4 text-slate-500">No bookings yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Booking ID</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Origin → Destination</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Rate</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr
                  key={booking.booking_id}
                  onClick={() => setSelectedBooking(booking)}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 text-slate-900">
                    #{booking.booking_id}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {booking.client_name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {booking.pickup_location} → {booking.delivery_location}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{booking.date}</td>
                  <td className="px-4 py-3">
                    <BookingStatusBadge status={booking.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {booking.rate !== null
                      ? `₱${booking.rate.toLocaleString()}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(booking)
                      }}
                      disabled={deletingId === booking.booking_id}
                      className="font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      {deletingId === booking.booking_id ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </div>
  )
}

export default BookingsSection
