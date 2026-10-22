// MyBookingsSection: lists the logged-in client's bookings. clientId
// comes from AuthContext (users.client_id -- set up by staff via
// ClientsSection, then linked to this login on first sign-in).
//
// Each booking loads its itineraries up front (one per deliverable --
// e.g. several containers under one booking) so the "Delivery Date"
// shown on the collapsed card can be computed without an extra fetch --
// it's the latest itinerary trip_date_to if any itinerary has one set,
// otherwise the card shows booking_date labelled as the preferred PICKUP
// date (that's what Approve copies into it -- it was previously shown
// as a delivery date by mistake). Status requests are asked per trip
// ("Ask about this trip"), not per booking. Relies on the
// itineraries_select_own_client RLS policy (booking_id ->
// bookings.client_id -> users.auth_user_id) since clients previously
// had no way to read itineraries at all.
//
// Deliberately does NOT fetch or show plate_number/trailer_id -- which
// specific truck/trailer is assigned is treated as internal fleet
// info, not something clients see.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import ClientStatusRequestModal from './ClientStatusRequestModal'
import StatusBadge from '../../../components/StatusBadge'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import { downpaymentStatus } from '../../../lib/downpayment'

type Itinerary = {
  itinerary_id: number
  itinerary_status: string
  trip_date_from: string
  trip_date_to: string | null
}

export type Booking = {
  booking_id: number
  booking_status: string
  booking_date: string
  cargo_type: string
  container_type: string
  trailer_type: string | null
  rate_of_delivery_service: number | null
  // Downpayment inputs (lib/downpayment.ts): trips can't start until it's paid.
  cost_per_trip: number | null
  amount_paid: number | null
  downpayment_waived_at: string | null
  pickup_place_name: string
  delivery_place_name: string
  itineraries: Itinerary[]
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-slate-900">{value}</p>
    </div>
  )
}

// Latest itinerary delivery date for this booking, or null if none of
// its itineraries have trip_date_to set yet.
function getConfirmedDeliveryDate(booking: Booking): string | null {
  const dates = booking.itineraries
    .map((itinerary) => itinerary.trip_date_to)
    .filter((date): date is string => date !== null)

  if (dates.length === 0) {
    return null
  }

  return dates.reduce((latest, date) => (date > latest ? date : latest))
}

// Delivered and Cancelled bookings are finished -- everything else is
// still active (Draft/Confirmed/InProgress/...).
export function isActiveBooking(booking: Booking): boolean {
  return (
    booking.booking_status !== 'Delivered' &&
    booking.booking_status !== 'Cancelled'
  )
}

function MyBookingsSection({
  onStatusRequested,
  onLoaded,
}: {
  onStatusRequested?: () => void
  // Hands the loaded list up to ClientDashboard for its summary strip,
  // so it doesn't need a second fetch.
  onLoaded?: (bookings: Booking[]) => void
}) {
  const { clientId } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedBookingId, setExpandedBookingId] = useState<number | null>(
    null,
  )
  const [showPast, setShowPast] = useState(false)
  // The trip the client is asking about (status requests are per trip,
  // not per booking).
  const [requesting, setRequesting] = useState<{
    booking: Booking
    itinerary: Itinerary
  } | null>(null)

  useEffect(() => {
    if (clientId) {
      loadBookings(clientId)
    } else {
      setLoading(false)
    }
  }, [clientId])

  async function loadBookings(id: number) {
    setLoading(true)

    const { data: bookingRows, error: bookingError } = await supabase
      .from('bookings')
      .select(
        'booking_id, booking_status, booking_date, cargo_type, container_type, trailer_type, rate_of_delivery_service, cost_per_trip, amount_paid, downpayment_waived_at, place_of_pickup_id, place_of_delivery_id',
      )
      .eq('client_id', id)
      .order('booking_date', { ascending: false })

    if (bookingError) {
      setError(bookingError.message)
      setLoading(false)
      return
    }

    // Look up pickup/delivery place names (bookings only stores IDs).
    const placeIds = Array.from(
      new Set(
        bookingRows.flatMap((b) => [
          b.place_of_pickup_id,
          b.place_of_delivery_id,
        ]),
      ),
    )

    const bookingIds = bookingRows.map((b) => b.booking_id)

    const [placesResult, itinerariesResult] = await Promise.all([
      placeIds.length > 0
        ? supabase
            .from('places')
            .select('place_id, place_name')
            .in('place_id', placeIds)
        : Promise.resolve({ data: [], error: null }),
      bookingIds.length > 0
        ? supabase
            .from('itineraries')
            .select(
              'itinerary_id, booking_id, itinerary_status, trip_date_from, trip_date_to',
            )
            .in('booking_id', bookingIds)
            .order('itinerary_id', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
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

    const placeNameById = new Map(
      placesResult.data.map((place) => [place.place_id, place.place_name]),
    )

    const itineraryRows = itinerariesResult.data

    const itinerariesByBookingId = new Map<number, Itinerary[]>()
    itineraryRows.forEach((row) => {
      const list = itinerariesByBookingId.get(row.booking_id) ?? []
      list.push({
        itinerary_id: row.itinerary_id,
        itinerary_status: row.itinerary_status,
        trip_date_from: row.trip_date_from,
        trip_date_to: row.trip_date_to,
      })
      itinerariesByBookingId.set(row.booking_id, list)
    })

    const loadedBookings = bookingRows.map((b) => ({
        booking_id: b.booking_id,
        booking_status: b.booking_status,
        booking_date: b.booking_date,
        cargo_type: b.cargo_type,
        container_type: b.container_type,
        trailer_type: b.trailer_type,
        rate_of_delivery_service: b.rate_of_delivery_service,
        cost_per_trip: b.cost_per_trip,
        amount_paid: b.amount_paid,
        downpayment_waived_at: b.downpayment_waived_at,
        pickup_place_name: placeNameById.get(b.place_of_pickup_id) ?? '—',
        delivery_place_name:
          placeNameById.get(b.place_of_delivery_id) ?? '—',
        itineraries: itinerariesByBookingId.get(b.booking_id) ?? [],
      }))
    setBookings(loadedBookings)
    onLoaded?.(loadedBookings)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your bookings...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (bookings.length === 0) {
    return <EmptyState message="No bookings yet." />
  }

  const activeCount = bookings.filter(isActiveBooking).length
  const visibleBookings = bookings.filter(
    (booking) => isActiveBooking(booking) !== showPast,
  )

  return (
    <div className="grid gap-4">
      <div className="flex gap-2">
        {[
          { label: `Active (${activeCount})`, past: false },
          { label: `Past (${bookings.length - activeCount})`, past: true },
        ].map((tab) => (
          <button
            key={tab.label}
            onClick={() => setShowPast(tab.past)}
            className={`px-3 py-1.5 text-sm font-medium ${
              showPast === tab.past
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visibleBookings.length === 0 && (
        <p className="text-slate-500">
          {showPast
            ? 'No delivered or cancelled bookings yet.'
            : 'No active bookings right now. Send a new quote request to book a trip.'}
        </p>
      )}

      {visibleBookings.map((booking) => {
        const confirmedDeliveryDate = getConfirmedDeliveryDate(booking)
        const isExpanded = expandedBookingId === booking.booking_id
        // Cancelled trips aren't billed, so they don't count toward the
        // contract value (same rule as lib/paymentDue.ts).
        const billableTripCount = booking.itineraries.filter(
          (itinerary) => itinerary.itinerary_status !== 'Cancelled',
        ).length
        const downpayment = downpaymentStatus({
          ratePerTrip: booking.rate_of_delivery_service,
          costPerTrip: booking.cost_per_trip,
          trips: billableTripCount,
          amountPaid: booking.amount_paid,
          waivedAt: booking.downpayment_waived_at,
        })

        return (
          <div
            key={booking.booking_id}
            className="border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Booking #{booking.booking_id}
                </p>
                <p className="mt-0.5 text-lg font-semibold text-slate-900">
                  {booking.pickup_place_name}{' '}
                  <span className="text-slate-400">→</span>{' '}
                  {booking.delivery_place_name}
                </p>
              </div>
              <StatusBadge status={booking.booking_status} />
            </div>

            {/* Only while it matters: before trips start (a waived one isn't the client's business). */}
            {downpayment && !downpayment.waived && booking.booking_status !== 'Cancelled' && (
              <p
                className={`mt-3 px-3 py-2 text-sm ${
                  downpayment.met ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'
                }`}
              >
                {downpayment.met ? (
                  <>✓ Downpayment of {formatMoney(downpayment.required)} received.</>
                ) : (
                  <>
                    <span className="font-semibold">Downpayment: {formatMoney(downpayment.required)}</span>
                    {' · '}Paid {formatMoney(downpayment.paid)}
                    {' · '}
                    {formatMoney(downpayment.missing)} to go. Your trips start once it's paid; the rest is due
                    after delivery under your payment terms.
                  </>
                )}
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Field label="Cargo" value={booking.cargo_type} />
              <Field
                label="Trailer"
                value={`${booking.container_type}${booking.trailer_type ? ` ${booking.trailer_type}` : ''}`}
              />
              <Field
                label="Rate/Trip"
                value={
                  booking.rate_of_delivery_service != null
                    ? `${formatMoney(booking.rate_of_delivery_service)}`
                    : '—'
                }
              />
              <Field
                label="Contract Value"
                value={
                  booking.rate_of_delivery_service != null
                    ? `${formatMoney((booking.rate_of_delivery_service * billableTripCount))}`
                    : '—'
                }
              />
              <div className="col-span-2 sm:col-span-4">
                {/* booking_date is the quote's preferred PICKUP date (set
                    on Approve), so it's only ever shown as that -- never
                    passed off as a delivery date. */}
                {confirmedDeliveryDate ? (
                  <Field
                    label="Delivery Date"
                    value={formatDate(confirmedDeliveryDate)}
                  />
                ) : (
                  <Field
                    label="Preferred Pickup"
                    value={
                      <>
                        {formatDate(booking.booking_date)}
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          (delivery date not scheduled yet)
                        </span>
                      </>
                    }
                  />
                )}
              </div>
            </div>

            <div className="mt-4">
              <button
                onClick={() =>
                  setExpandedBookingId(isExpanded ? null : booking.booking_id)
                }
                className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                {isExpanded ? 'Hide' : 'View'} trips ({booking.itineraries.length})
                <span
                  className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                >
                  ▾
                </span>
              </button>
            </div>

            {isExpanded && (
              <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3">
                {booking.itineraries.length === 0 && (
                  <EmptyState message="No trips scheduled yet for this booking." />
                )}

                {booking.itineraries.map((itinerary) => (
                  <div
                    key={itinerary.itinerary_id}
                    className="bg-slate-50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-900">
                        Trip #{itinerary.itinerary_id}
                      </p>
                      <StatusBadge status={itinerary.itinerary_status} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field
                        label="Pickup"
                        value={formatDate(itinerary.trip_date_from)}
                      />
                      <Field
                        label="Delivery"
                        value={
                          itinerary.trip_date_to
                            ? formatDate(itinerary.trip_date_to)
                            : 'Not scheduled yet'
                        }
                      />
                    </div>
                    {/* Status requests are per trip. Nothing to ask about
                        on a cancelled one. */}
                    {itinerary.itinerary_status !== 'Cancelled' && (
                      <button
                        onClick={() => setRequesting({ booking, itinerary })}
                        className="mt-2 text-sm font-medium text-slate-600 underline hover:text-slate-900"
                      >
                        Ask about this trip
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {requesting && clientId && (
        <ClientStatusRequestModal
          clientId={clientId}
          bookingId={requesting.booking.booking_id}
          itineraryId={requesting.itinerary.itinerary_id}
          route={`${requesting.booking.pickup_place_name} → ${requesting.booking.delivery_place_name}`}
          onClose={() => setRequesting(null)}
          onRequested={() => {
            setRequesting(null)
            onStatusRequested?.()
          }}
        />
      )}
    </div>
  )
}

export default MyBookingsSection
