// ClientBookingHistoryModal: a client's full booking history, opened by
// clicking their name in ClientsSection.tsx. Reuses BookingDetailModal
// (from BookingsSection.tsx) for the row click-through instead of
// duplicating that display -- so each row here is built into the exact
// same `Booking` shape that modal expects, just filtered to one
// client_id and with an extra cargo_type field for the list itself
// (BookingDetailModal doesn't show cargo_type, so it isn't part of the
// shared Booking type).
//
// clients has no payment_terms column (confirmed via the REST API) --
// that's a per-booking field, not a client-level one, so it isn't shown
// in the header; client name/email/phone are passed in from
// ClientsSection's already-loaded data instead of being refetched here.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { loadClientDamageChargesByBooking } from '../../../lib/damageCharges'
import BookingDetailModal from './BookingDetailModal'
import { BookingStatusBadge, type Booking } from './BookingsSection'

type ClientBooking = Booking & { cargo_type: string | null }

const ONGOING_STATUSES = new Set(['Draft', 'Confirmed', 'InProgress'])

function formatMoney(value: number | null): string {
  return value !== null ? `₱${value.toLocaleString()}` : '—'
}

function ClientBookingHistoryModal({
  client,
  onClose,
}: {
  client: {
    client_id: number
    client_name: string
    email: string | null
    phone_number: string | null
  }
  onClose: () => void
}) {
  const [bookings, setBookings] = useState<ClientBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<ClientBooking | null>(null)

  useEffect(() => {
    loadBookings()
  }, [])

  async function loadBookings() {
    setLoading(true)

    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select(
        'booking_id, place_of_pickup_id, place_of_delivery_id, booking_date, booking_status, rate_of_delivery_service, amount_to_pay, amount_paid, cargo_type',
      )
      .eq('client_id', client.client_id)
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

    const placeIds = Array.from(
      new Set(
        bookingRows.flatMap((b) => [b.place_of_pickup_id, b.place_of_delivery_id]),
      ),
    )
    const bookingIds = bookingRows.map((b) => b.booking_id)

    const [placesResult, itinerariesResult] = await Promise.all([
      supabase.from('places').select('place_id, place_name').in('place_id', placeIds),
      supabase
        .from('itineraries')
        .select('booking_id, itinerary_status')
        .in('booking_id', bookingIds),
    ])

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
        const billableAmount = (b.amount_to_pay ?? computedBillableAmount) + damageCharges
        const amountPaid = b.amount_paid ?? 0

        return {
          booking_id: b.booking_id,
          client_name: client.client_name,
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
          cargo_type: b.cargo_type,
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  const ongoing = bookings.filter((b) => ONGOING_STATUSES.has(b.status))
  const past = bookings.filter((b) => !ONGOING_STATUSES.has(b.status))

  function BookingTable({ rows }: { rows: ClientBooking[] }) {
    return (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Origin → Destination</th>
              <th className="px-4 py-3 font-medium">Cargo</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Rate</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((booking) => (
              <tr
                key={booking.booking_id}
                onClick={() => setSelectedBooking(booking)}
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-3 text-slate-600">{booking.date}</td>
                <td className="px-4 py-3 text-slate-600">
                  {booking.pickup_location} → {booking.delivery_location}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {booking.cargo_type ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <BookingStatusBadge status={booking.status} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatMoney(booking.rate)}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatMoney(booking.amount_paid)}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {formatMoney(booking.balance_due)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
        <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{client.client_name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          <span>{client.email ?? 'No email on file'}</span>
          <span>{client.phone_number ?? 'No phone on file'}</span>
        </div>

        <div className="mt-6">
          {loading && <p className="text-slate-500">Loading bookings...</p>}
          {!loading && error && <p className="text-red-700">{error}</p>}

          {!loading && !error && bookings.length === 0 && (
            <p className="text-slate-500">No bookings yet.</p>
          )}

          {!loading && !error && bookings.length > 0 && (
            <div className="grid gap-6">
              {ongoing.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">
                    Ongoing ({ongoing.length})
                  </h4>
                  <div className="mt-2">
                    <BookingTable rows={ongoing} />
                  </div>
                </div>
              )}

              {past.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">
                    Past ({past.length})
                  </h4>
                  <div className="mt-2">
                    <BookingTable rows={past} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

          <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </>
  )
}

export default ClientBookingHistoryModal
