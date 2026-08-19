// DriverTasks: shows the logged-in driver's assigned trips (upcoming +
// in-progress). itinerary_crews is the link table between an employee
// and an itinerary; we filter it to crew_role = 'Driver' to find which
// itineraries belong to this driver.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import UpdateStatusControl from './UpdateStatusControl'

type Trip = {
  itinerary_id: number
  trip_date_from: string
  trip_date_to: string | null
  itinerary_status: string
  pickup_place_name: string
  delivery_place_name: string
}

const STATUS_STYLES: Record<string, string> = {
  Awaiting: 'bg-gray-100 text-gray-700',
  Dispatched: 'bg-blue-100 text-blue-700',
  PickedUp: 'bg-purple-100 text-purple-700',
  InTransit: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

export function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function DriverTasks() {
  const { employeeId } = useAuth()
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (employeeId) loadTrips(employeeId)
  }, [employeeId])

  async function loadTrips(driverEmployeeId: number) {
    setLoading(true)

    // 1. Which itineraries is this driver assigned to?
    const { data: crewRows, error: crewError } = await supabase
      .from('itinerary_crews')
      .select('itinerary_id')
      .eq('employee_id', driverEmployeeId)
      .eq('crew_role', 'Driver')

    if (crewError) {
      setError(crewError.message)
      setLoading(false)
      return
    }

    const itineraryIds = crewRows.map((row) => row.itinerary_id)
    if (itineraryIds.length === 0) {
      setTrips([])
      setError(null)
      setLoading(false)
      return
    }

    // 2. Load those itineraries, skipping finished/cancelled ones.
    const { data: itineraries, error: itineraryError } = await supabase
      .from('itineraries')
      .select(
        'itinerary_id, trip_date_from, trip_date_to, itinerary_status, place_of_pickup_id, place_of_delivery_id',
      )
      .in('itinerary_id', itineraryIds)
      .not('itinerary_status', 'in', '(Delivered,Cancelled)')
      .order('trip_date_from', { ascending: true })

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

    // 3. Look up pickup/delivery place names (itineraries only stores IDs).
    const placeIds = Array.from(
      new Set(
        itineraries.flatMap((trip) => [
          trip.place_of_pickup_id,
          trip.place_of_delivery_id,
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

    setTrips(
      itineraries.map((trip) => ({
        itinerary_id: trip.itinerary_id,
        trip_date_from: trip.trip_date_from,
        trip_date_to: trip.trip_date_to,
        itinerary_status: trip.itinerary_status,
        pickup_place_name: placeNameById.get(trip.place_of_pickup_id) ?? '—',
        delivery_place_name:
          placeNameById.get(trip.place_of_delivery_id) ?? '—',
      })),
    )
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your trips...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (trips.length === 0) {
    return <p className="text-slate-500">Nothing assigned yet.</p>
  }

  // Called by UpdateStatusControl after a successful status change.
  // "Delivered" trips drop out of this list entirely (matches the
  // Delivered/Cancelled exclusion in loadTrips); other changes just
  // update the badge in place.
  function handleStatusChanged(itineraryId: number, newStatus: string) {
    if (newStatus === 'Delivered') {
      setTrips((prev) => prev.filter((t) => t.itinerary_id !== itineraryId))
      return
    }
    setTrips((prev) =>
      prev.map((t) =>
        t.itinerary_id === itineraryId
          ? { ...t, itinerary_status: newStatus }
          : t,
      ),
    )
  }

  return (
    <div className="grid gap-4">
      {trips.map((trip) => (
        <div
          key={trip.itinerary_id}
          className="rounded-xl border border-slate-200 p-5"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-900">
              {trip.pickup_place_name} → {trip.delivery_place_name}
            </p>
            <StatusBadge status={trip.itinerary_status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {trip.trip_date_from}
            {trip.trip_date_to ? ` – ${trip.trip_date_to}` : ''}
          </p>
          <UpdateStatusControl
            itineraryId={trip.itinerary_id}
            currentStatus={trip.itinerary_status}
            onStatusChanged={handleStatusChanged}
          />
        </div>
      ))}
    </div>
  )
}

export default DriverTasks
