// HistorySection: "My History" page for Driver/Helper/Mechanic -- a table
// of past trips (drivers and helpers) or work orders (mechanics).
//
// Drivers/Helpers: reads real completed/cancelled itineraries via
// itinerary_crews (same lookup pattern as DriverTasks.tsx), filtered by
// the matching crew_role, joined with places for the pickup/delivery
// names.
// Mechanics: reads real completed/cancelled work_orders assigned to
// them, joined with trailers for the vehicle label when the work order
// is for a trailer rather than a truck (same pattern as
// MaintenanceSection.tsx).
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

type HistoryStatus = 'Completed' | 'Cancelled'

type HistoryEntry = {
  history_id: number
  date: string
  description: string
  status: HistoryStatus
}

const STATUS_STYLES: Record<HistoryStatus, string> = {
  Completed: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function HistoryStatusBadge({ status }: { status: HistoryStatus }) {
  return (
    <span
      className={`px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

function HistorySection() {
  const { role, employeeId } = useAuth()
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employeeId) {
      setLoading(false)
      return
    }

    if (role === 'Driver' || role === 'Helper') {
      loadTripHistory(employeeId, role)
    } else if (role === 'Mechanic') {
      loadMechanicHistory(employeeId)
    } else {
      setLoading(false)
    }
  }, [role, employeeId])

  async function loadTripHistory(crewEmployeeId: number, crewRole: 'Driver' | 'Helper') {
    setLoading(true)

    const { data: crewRows, error: crewError } = await supabase
      .from('itinerary_crews')
      .select('itinerary_id')
      .eq('employee_id', crewEmployeeId)
      .eq('crew_role', crewRole)

    if (crewError) {
      setError(crewError.message)
      setLoading(false)
      return
    }

    const itineraryIds = crewRows.map((row) => row.itinerary_id)
    if (itineraryIds.length === 0) {
      setHistory([])
      setError(null)
      setLoading(false)
      return
    }

    const { data: itineraries, error: itineraryError } = await supabase
      .from('itineraries')
      .select(
        'itinerary_id, trip_date_from, trip_date_to, itinerary_status, place_of_pickup_id, place_of_delivery_id',
      )
      .in('itinerary_id', itineraryIds)
      .in('itinerary_status', ['Delivered', 'Cancelled'])
      .order('trip_date_from', { ascending: false })

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

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

    setHistory(
      itineraries.map((trip) => ({
        history_id: trip.itinerary_id,
        date: trip.trip_date_to ?? trip.trip_date_from,
        description: `${placeNameById.get(trip.place_of_pickup_id) ?? '—'} → ${placeNameById.get(trip.place_of_delivery_id) ?? '—'}`,
        status: trip.itinerary_status === 'Delivered' ? 'Completed' : 'Cancelled',
      })),
    )
    setError(null)
    setLoading(false)
  }

  async function loadMechanicHistory(mechanicEmployeeId: number) {
    setLoading(true)

    const { data: orders, error: orderError } = await supabase
      .from('work_orders')
      .select(
        'work_order_id, work_order_number, plate_number, trailer_id, maintenance_type, work_order_status, scheduled_start_date',
      )
      .eq('assigned_mechanic_id', mechanicEmployeeId)
      .in('work_order_status', ['Completed', 'Cancelled'])
      .order('scheduled_start_date', { ascending: false })

    if (orderError) {
      setError(orderError.message)
      setLoading(false)
      return
    }

    const trailerIds = Array.from(
      new Set(orders.filter((o) => o.trailer_id != null).map((o) => o.trailer_id)),
    )

    const { data: trailers, error: trailerError } =
      trailerIds.length > 0
        ? await supabase
            .from('trailers')
            .select('trailer_id, plate_number')
            .in('trailer_id', trailerIds)
        : { data: [], error: null }

    if (trailerError) {
      setError(trailerError.message)
      setLoading(false)
      return
    }

    const trailerPlateById = new Map(
      trailers.map((t) => [t.trailer_id, t.plate_number]),
    )

    setHistory(
      orders.map((order) => {
        const vehicleLabel = order.plate_number
          ? `Truck ${order.plate_number}`
          : `Trailer ${trailerPlateById.get(order.trailer_id) ?? `#${order.trailer_id}`}`

        return {
          history_id: order.work_order_id,
          date: order.scheduled_start_date ?? '—',
          description: `${order.work_order_number} — ${order.maintenance_type} (${vehicleLabel})`,
          status: order.work_order_status === 'Completed' ? 'Completed' : 'Cancelled',
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  const emptyMessage =
    role === 'Mechanic' ? 'No past work orders yet.' : 'No past trips yet.'

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My History</h2>

      {loading && <p className="mt-4 text-slate-500">Loading your history...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && history.length === 0 ? (
        <p className="mt-4 text-slate-500">{emptyMessage}</p>
      ) : (
        !loading &&
        !error && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr
                    key={entry.history_id}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-4 py-3 text-slate-600">{entry.date}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {entry.description}
                    </td>
                    <td className="px-4 py-3">
                      <HistoryStatusBadge status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

export default HistorySection
