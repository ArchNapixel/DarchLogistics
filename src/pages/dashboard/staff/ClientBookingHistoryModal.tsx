// ClientBookingHistoryModal: a client's full booking history, opened by
// clicking their name in ClientsSection.tsx. Reuses BookingDetailModal
// (from BookingsSection.tsx) for the row click-through instead of
// duplicating that display -- so each row here is built into the exact
// same `Booking` shape that modal expects, just filtered to one
// client_id and with an extra `cargo` label for the list itself -- the
// booking's trips counted by cargo type ("3 container · 1 loose"), since
// cargo is per trip (itineraries.cargo_type).
//
// clients has no payment_terms column (confirmed via the REST API) --
// that's a per-booking field, not a client-level one, so it isn't shown
// in the header; client name/email/phone are passed in from
// ClientsSection's already-loaded data instead of being refetched here.
import { useEffect, useEffectEvent, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { loadExtraChargesByBooking } from '../../../lib/bookingCharges'
import { deliveryAmountFor } from '../../../lib/paymentDue'
import { bookingRateLabel, groupTripRates, sumRates } from '../../../lib/lineRates'
import BookingDetailModal from './BookingDetailModal'
import { type Booking } from './BookingsSection'
import StatusBadge from '../../../components/StatusBadge'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

type ClientBooking = Booking & { cargo: string }

const ONGOING_STATUSES = new Set(['Draft', 'Confirmed', 'InProgress'])

// One table of bookings (Ongoing or Past); clicking a row opens its details.
// Outside the modal so React doesn't treat it as a new component every render.
function BookingTable({ rows, onSelect }: { rows: ClientBooking[]; onSelect: (booking: ClientBooking) => void }) {
  return (
    <div className="overflow-x-auto border-2 border-line-card bg-white">
      <table className="w-full text-left text-sm text-ink-metric">
        <thead>
          <tr>
            <th className="px-4 py-2.5">Date</th>
            <th className="px-4 py-2.5">Origin → Destination</th>
            <th className="px-4 py-2.5">Cargo</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Rate</th>
            <th className="px-4 py-2.5">Paid</th>
            <th className="px-4 py-2.5">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((booking) => (
            <tr
              key={booking.booking_id}
              onClick={() => onSelect(booking)}
              className="cursor-pointer border-b border-slate-200 last:border-0 hover:bg-slate-50"
            >
              <td className="px-4 py-3 text-slate-600">{formatDate(booking.date)}</td>
              <td className="px-4 py-3 text-slate-600">
                {booking.pickup_location} → {booking.delivery_location}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {booking.cargo}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={booking.status} />
              </td>
              <td className="px-4 py-3 text-slate-600">
                {bookingRateLabel(booking.trip_rates, booking.rate)}
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

  async function loadBookings() {
    setLoading(true)

    const { data: bookingRows, error: bookingsError } = await supabase
      .from('bookings')
      .select(
        'booking_id, place_of_pickup_id, place_of_delivery_id, booking_date, booking_status, cancelled_at, rate_of_delivery_service, amount_to_pay, amount_paid',
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
        .select('booking_id, itinerary_status, cargo_type, trip_rate')
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
      await loadExtraChargesByBooking(bookingIds)
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
    const cancelledTripsByBooking = new Map<number, number>()
    // "Container"/"Loose" -> trip count, per booking (non-cancelled trips).
    const cargoCountsByBooking = new Map<number, Map<string, number>>()
    itinerariesResult.data.forEach((itinerary) => {
      // Cancelled trips aren't part of the booking any more (counted separately).
      if (itinerary.itinerary_status === 'Cancelled') {
        cancelledTripsByBooking.set(itinerary.booking_id, (cancelledTripsByBooking.get(itinerary.booking_id) ?? 0) + 1)
        return
      }
      const counts = cargoCountsByBooking.get(itinerary.booking_id) ?? new Map<string, number>()
      const type = itinerary.cargo_type === 'Loose' ? 'loose' : itinerary.cargo_type ? 'container' : 'no cargo'
      counts.set(type, (counts.get(type) ?? 0) + 1)
      cargoCountsByBooking.set(itinerary.booking_id, counts)
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

    // Every trip's own rate (cargo lines can be priced differently).
    const tripRatesByBooking = groupTripRates(
      itinerariesResult.data,
      new Map(bookingRows.map((b) => [b.booking_id, b.rate_of_delivery_service])),
    )

    setBookings(
      bookingRows.map((b) => {
        const tripRates = tripRatesByBooking.get(b.booking_id) ?? { live: [], delivered: [] }
        const totalTrips = totalTripsByBooking.get(b.booking_id) ?? 0
        const completedTrips = completedTripsByBooking.get(b.booking_id) ?? 0
        const computedBillableAmount = sumRates(tripRates.delivered)
        const damageCharges = damageByBooking.get(b.booking_id) ?? 0
        const billableAmount =
          deliveryAmountFor({
            amountToPay: b.amount_to_pay,
            computedBillable: computedBillableAmount,
            hadCancellation: b.booking_status === 'Cancelled' || b.cancelled_at != null,
          }) + damageCharges
        const amountPaid = b.amount_paid ?? 0

        return {
          booking_id: b.booking_id,
          client_name: client.client_name,
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
          cargo:
            [...(cargoCountsByBooking.get(b.booking_id) ?? [])].map(([type, n]) => `${n} ${type}`).join(' · ') || '—',
          cancelled_trips: cancelledTripsByBooking.get(b.booking_id) ?? 0,
          cancelled_at: b.cancelled_at,
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  // Load once, when this opens.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    loadBookings()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

  const ongoing = bookings.filter((b) => ONGOING_STATUSES.has(b.status))
  const past = bookings.filter((b) => !ONGOING_STATUSES.has(b.status))

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
        <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white p-6 border-2 border-line-card">
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
            <EmptyState message="No bookings yet." />
          )}

          {!loading && !error && bookings.length > 0 && (
            <div className="grid gap-6">
              {ongoing.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">
                    Ongoing ({ongoing.length})
                  </h4>
                  <div className="mt-2">
                    <BookingTable rows={ongoing} onSelect={setSelectedBooking} />
                  </div>
                </div>
              )}

              {past.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-700">
                    Past ({past.length})
                  </h4>
                  <div className="mt-2">
                    <BookingTable rows={past} onSelect={setSelectedBooking} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

          <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
            <button
              onClick={onClose}
              className="btn-secondary px-4 py-2 text-sm font-medium"
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
