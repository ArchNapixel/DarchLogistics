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
import { formatDate } from '../../../lib/quoteRequest'
import ClientStatusRequestModal from './ClientStatusRequestModal'

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
  rate_of_delivery_service: number | null
  pickup_place_name: string
  delivery_place_name: string
  itineraries: Itinerary[]
}

const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Confirmed: 'bg-blue-100 text-blue-700',
  Dispatched: 'bg-purple-100 text-purple-700',
  InProgress: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
  OnHold: 'bg-yellow-100 text-yellow-700',
}

function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {status === 'InProgress' ? 'In progress' : status}
    </span>
  )
}

const ITINERARY_STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked Up',
  InTransit: 'In Transit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
}

const ITINERARY_STATUS_STYLES: Record<string, string> = {
  Awaiting: 'bg-gray-100 text-gray-700',
  Dispatched: 'bg-blue-100 text-blue-700',
  PickedUp: 'bg-purple-100 text-purple-700',
  InTransit: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function ItineraryStatusBadge({ status }: { status: string }) {
  const styles = ITINERARY_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {ITINERARY_STATUS_LABELS[status] ?? status}
    </span>
  )
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
        'booking_id, booking_status, booking_date, cargo_type, container_type, rate_of_delivery_service, place_of_pickup_id, place_of_delivery_id',
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
        rate_of_delivery_service: b.rate_of_delivery_service,
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
    return <p className="text-slate-500">No bookings yet.</p>
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
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
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

        return (
          <div
            key={booking.booking_id}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
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

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Field label="Cargo" value={booking.cargo_type} />
              <Field label="Container" value={booking.container_type} />
              <Field
                label="Rate/Trip"
                value={
                  booking.rate_of_delivery_service != null
                    ? `₱${booking.rate_of_delivery_service.toLocaleString()}`
                    : '—'
                }
              />
              <Field
                label="Contract Value"
                value={
                  booking.rate_of_delivery_service != null
                    ? `₱${(booking.rate_of_delivery_service * billableTripCount).toLocaleString()}`
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
                  <p className="text-sm text-slate-500">
                    No trips scheduled yet for this booking.
                  </p>
                )}

                {booking.itineraries.map((itinerary) => (
                  <div
                    key={itinerary.itinerary_id}
                    className="rounded-lg bg-slate-50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-900">
                        Trip #{itinerary.itinerary_id}
                      </p>
                      <ItineraryStatusBadge status={itinerary.itinerary_status} />
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
