// MyBookingsSection: lists the logged-in client's bookings. clientId
// comes from AuthContext (users.client_id -- set up by staff via
// ClientsSection, then linked to this login on first sign-in).
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

type Booking = {
  booking_id: number
  booking_status: string
  booking_date: string
  cargo_type: string
  container_type: string
  pickup_place_name: string
  delivery_place_name: string
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

function MyBookingsSection() {
  const { clientId } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        'booking_id, booking_status, booking_date, cargo_type, container_type, place_of_pickup_id, place_of_delivery_id',
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

    const { data: places, error: placesError } =
      placeIds.length > 0
        ? await supabase
            .from('places')
            .select('place_id, place_name')
            .in('place_id', placeIds)
        : { data: [], error: null }

    if (placesError) {
      setError(placesError.message)
      setLoading(false)
      return
    }

    const placeNameById = new Map(
      places.map((place) => [place.place_id, place.place_name]),
    )

    setBookings(
      bookingRows.map((b) => ({
        booking_id: b.booking_id,
        booking_status: b.booking_status,
        booking_date: b.booking_date,
        cargo_type: b.cargo_type,
        container_type: b.container_type,
        pickup_place_name: placeNameById.get(b.place_of_pickup_id) ?? '—',
        delivery_place_name:
          placeNameById.get(b.place_of_delivery_id) ?? '—',
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
      {bookings.map((booking) => (
        <div
          key={booking.booking_id}
          className="rounded-xl border border-slate-200 p-5"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-900">
              {booking.pickup_place_name} → {booking.delivery_place_name}
            </p>
            <StatusBadge status={booking.booking_status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {booking.cargo_type} · {booking.container_type} ·{' '}
            {booking.booking_date}
          </p>
        </div>
      ))}
    </div>
  )
}

export default MyBookingsSection
