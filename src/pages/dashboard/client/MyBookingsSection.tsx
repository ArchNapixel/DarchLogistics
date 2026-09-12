// MyBookingsSection: lists the logged-in client's bookings. clientId
// comes from AuthContext (users.client_id -- set up by staff via
// ClientsSection, then linked to this login on first sign-in).
//
// Each booking loads its itineraries up front (one per deliverable --
// e.g. several containers under one booking) so the "Delivery Date"
// shown on the collapsed card can be computed without an extra fetch --
// it's the latest itinerary trip_date_to if any itinerary has one set,
// otherwise there's no confirmed delivery date yet, so it falls back to
// booking_date (the client's originally preferred date, carried over
// from the quote at approval time). The same fallback applies per
// itinerary in the expanded list. Relies on the
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

type Itinerary = {
  itinerary_id: number
  itinerary_status: string
  trip_date_from: string
  trip_date_to: string | null
}

type Booking = {
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
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

const ITINERARY_STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked Up',
  InTransit: 'In Transit',
  Delivered: 'Delivered',
}

const ITINERARY_STATUS_STYLES: Record<string, string> = {
  Awaiting: 'bg-gray-100 text-gray-700',
  Dispatched: 'bg-blue-100 text-blue-700',
  PickedUp: 'bg-purple-100 text-purple-700',
  InTransit: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
}

function ItineraryStatusBadge({ status }: { status: string }) {
  const styles = ITINERARY_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
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

function MyBookingsSection() {
  const { clientId } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedBookingId, setExpandedBookingId] = useState<number | null>(
    null,
  )

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

    setBookings(
      bookingRows.map((b) => ({
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
      })),
    )
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

  return (
    <div className="grid gap-4">
      {bookings.map((booking) => {
        const confirmedDeliveryDate = getConfirmedDeliveryDate(booking)
        const deliveryDate = confirmedDeliveryDate ?? booking.booking_date
        const isExpanded = expandedBookingId === booking.booking_id

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
                label="Rate"
                value={
                  booking.rate_of_delivery_service != null
                    ? `₱${booking.rate_of_delivery_service.toLocaleString()}`
                    : '—'
                }
              />
              <div className="col-span-2 sm:col-span-4">
                <Field
                  label="Delivery Date"
                  value={
                    <>
                      {deliveryDate}
                      {!confirmedDeliveryDate && (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          (preferred date — not yet confirmed)
                        </span>
                      )}
                    </>
                  }
                />
              </div>
            </div>

            <button
              onClick={() =>
                setExpandedBookingId(isExpanded ? null : booking.booking_id)
              }
              className="mt-4 flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              {isExpanded ? 'Hide' : 'View'} itineraries (
              {booking.itineraries.length})
              <span
                className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              >
                ▾
              </span>
            </button>

            {isExpanded && (
              <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3">
                {booking.itineraries.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No itineraries yet for this booking.
                  </p>
                )}

                {booking.itineraries.map((itinerary) => {
                  const itineraryHasConfirmedDate =
                    itinerary.trip_date_to !== null
                  const itineraryDeliveryDate =
                    itinerary.trip_date_to ?? booking.booking_date

                  return (
                    <div
                      key={itinerary.itinerary_id}
                      className="rounded-lg bg-slate-50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-900">
                          Itinerary #{itinerary.itinerary_id}
                        </p>
                        <ItineraryStatusBadge
                          status={itinerary.itinerary_status}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Field label="Pickup" value={itinerary.trip_date_from} />
                        <Field
                          label="Delivery"
                          value={
                            <>
                              {itineraryDeliveryDate}
                              {!itineraryHasConfirmedDate && (
                                <span className="text-xs font-normal text-slate-400">
                                  {' '}
                                  (est.)
                                </span>
                              )}
                            </>
                          }
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default MyBookingsSection
