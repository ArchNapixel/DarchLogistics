// EmployeeDetailModal: staff detail view for a Driver, Mechanic, or
// Helper -- opened by clicking their name in EmployeesSection.tsx (only
// wired up for those 3 positions; Admin/Dispatcher have no trips/work
// orders to show). Read-only -- never writes to itinerary_crews,
// itineraries, work_orders, or work_order_completions.
//
// Status labels/colors below are duplicated (not imported) from
// DispatchBoardSection.tsx (trip statuses) and MechanicTasks.tsx (work
// order statuses) rather than exporting from those files, to stay
// entirely within this new file -- same values, so badges look
// identical wherever they appear.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const TRIP_STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked Up',
  InTransit: 'In Transit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
}

const TRIP_STATUS_STYLES: Record<string, string> = {
  Awaiting: 'bg-gray-100 text-gray-700',
  Dispatched: 'bg-blue-100 text-blue-700',
  PickedUp: 'bg-purple-100 text-purple-700',
  InTransit: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function TripStatusBadge({ status }: { status: string }) {
  const style = TRIP_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${style}`}>
      {TRIP_STATUS_LABELS[status] ?? status}
    </span>
  )
}

// A trip counts as "currently underway" if it's past Awaiting but not
// yet finished -- matches the Dispatch Board's own definition of
// "active" (not Delivered/Cancelled), with Awaiting also excluded here
// since that means assigned-but-not-yet-moving, not "currently on a trip."
const ACTIVE_TRIP_STATUSES = new Set(['Dispatched', 'PickedUp', 'InTransit'])

const WORK_ORDER_STATUS_STYLES: Record<string, string> = {
  Created: 'bg-gray-100 text-gray-700',
  Scheduled: 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-orange-100 text-orange-700',
  'On Hold': 'bg-yellow-100 text-yellow-700',
  Completed: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

function WorkOrderStatusBadge({ status }: { status: string }) {
  const style = WORK_ORDER_STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${style}`}>
      {status}
    </span>
  )
}

type TripRow = {
  itinerary_id: number
  trip_date_from: string
  pickup_location: string
  delivery_location: string
  status: string
}

type CompletionRow = {
  completion_id: number
  completed_at: string
  description: string
  labor_hours: number | null
  vehicle_label: string
}

type CurrentWorkOrder = {
  work_order_id: number
  work_order_number: string
  work_order_status: string
  maintenance_type: string
  work_description: string | null
  vehicle_label: string
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-slate-900">{value}</p>
    </div>
  )
}

function DriverHelperDetail({
  employeeId,
  crewRole,
}: {
  employeeId: number
  crewRole: 'Driver' | 'Helper'
}) {
  const [trips, setTrips] = useState<TripRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const { data: crewRows, error: crewError } = await supabase
      .from('itinerary_crews')
      .select('itinerary_id')
      .eq('employee_id', employeeId)
      .eq('crew_role', crewRole)

    if (crewError) {
      setError(crewError.message)
      setLoading(false)
      return
    }

    const itineraryIds = Array.from(new Set(crewRows.map((r) => r.itinerary_id)))
    if (itineraryIds.length === 0) {
      setTrips([])
      setError(null)
      setLoading(false)
      return
    }

    const { data: itineraryRows, error: itineraryError } = await supabase
      .from('itineraries')
      .select(
        'itinerary_id, trip_date_from, itinerary_status, place_of_pickup_id, place_of_delivery_id',
      )
      .in('itinerary_id', itineraryIds)
      .order('trip_date_from', { ascending: false })

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

    const placeIds = Array.from(
      new Set(
        itineraryRows.flatMap((it) => [it.place_of_pickup_id, it.place_of_delivery_id]),
      ),
    )

    const { data: places, error: placesError } =
      placeIds.length > 0
        ? await supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
        : { data: [], error: null }

    if (placesError) {
      setError(placesError.message)
      setLoading(false)
      return
    }

    const placeNameById = new Map(places.map((p) => [p.place_id, p.place_name]))

    setTrips(
      itineraryRows.map((it) => ({
        itinerary_id: it.itinerary_id,
        trip_date_from: it.trip_date_from,
        pickup_location: placeNameById.get(it.place_of_pickup_id) ?? '—',
        delivery_location: placeNameById.get(it.place_of_delivery_id) ?? '—',
        status: it.itinerary_status ?? 'Awaiting',
      })),
    )
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading trip history...</p>
  }
  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  const current = trips.find((t) => ACTIVE_TRIP_STATUSES.has(t.status))

  return (
    <div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        {current ? (
          <div className="flex items-center gap-3">
            <TripStatusBadge status={current.status} />
            <p className="text-sm text-slate-700">
              {current.pickup_location} → {current.delivery_location}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Not currently assigned to a trip.</p>
        )}
      </div>

      <h4 className="mt-5 text-sm font-semibold text-slate-700">
        Trip History ({trips.length})
      </h4>

      {trips.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No trips yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Origin → Destination</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => (
                <tr key={trip.itinerary_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-600">{trip.trip_date_from}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {trip.pickup_location} → {trip.delivery_location}
                  </td>
                  <td className="px-4 py-3">
                    <TripStatusBadge status={trip.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MechanicDetail({ employeeId }: { employeeId: number }) {
  const [currentWorkOrder, setCurrentWorkOrder] = useState<CurrentWorkOrder | null>(null)
  const [completions, setCompletions] = useState<CompletionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function vehicleLabelFor(plateNumber: string | null, trailerId: number | null) {
    if (plateNumber) return `Truck: ${plateNumber}`
    if (trailerId === null) return '—'
    const { data } = await supabase
      .from('trailers')
      .select('plate_number')
      .eq('trailer_id', trailerId)
      .maybeSingle()
    return `Trailer: ${data?.plate_number ?? `#${trailerId}`}`
  }

  async function load() {
    setLoading(true)

    // 1. Current (not-yet-finished) work order, if any.
    const { data: activeOrders, error: activeError } = await supabase
      .from('work_orders')
      .select('work_order_id, work_order_number, work_order_status, maintenance_type, work_description, plate_number, trailer_id')
      .eq('assigned_mechanic_id', employeeId)
      .not('work_order_status', 'in', '(Completed,Cancelled)')
      .order('scheduled_start_date', { ascending: true })
      .limit(1)

    if (activeError) {
      setError(activeError.message)
      setLoading(false)
      return
    }

    if (activeOrders.length > 0) {
      const order = activeOrders[0]
      setCurrentWorkOrder({
        work_order_id: order.work_order_id,
        work_order_number: order.work_order_number,
        work_order_status: order.work_order_status,
        maintenance_type: order.maintenance_type,
        work_description: order.work_description,
        vehicle_label: await vehicleLabelFor(order.plate_number, order.trailer_id),
      })
    } else {
      setCurrentWorkOrder(null)
    }

    // 2. Completion history.
    const { data: completionRows, error: completionError } = await supabase
      .from('work_order_completions')
      .select('completion_id, work_order_id, description, labor_hours, completed_at')
      .eq('employee_id', employeeId)
      .order('completed_at', { ascending: false })

    if (completionError) {
      setError(completionError.message)
      setLoading(false)
      return
    }

    if (completionRows.length === 0) {
      setCompletions([])
      setError(null)
      setLoading(false)
      return
    }

    const workOrderIds = Array.from(new Set(completionRows.map((c) => c.work_order_id)))
    const { data: relatedOrders, error: relatedError } = await supabase
      .from('work_orders')
      .select('work_order_id, plate_number, trailer_id')
      .in('work_order_id', workOrderIds)

    if (relatedError) {
      setError(relatedError.message)
      setLoading(false)
      return
    }

    const trailerIds = Array.from(
      new Set(
        relatedOrders.filter((o) => o.trailer_id !== null).map((o) => o.trailer_id as number),
      ),
    )
    const { data: trailerRows, error: trailerError } =
      trailerIds.length > 0
        ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
        : { data: [], error: null }

    if (trailerError) {
      setError(trailerError.message)
      setLoading(false)
      return
    }

    const trailerPlateById = new Map(trailerRows.map((t) => [t.trailer_id, t.plate_number]))
    const orderById = new Map(relatedOrders.map((o) => [o.work_order_id, o]))

    setCompletions(
      completionRows.map((c) => {
        const order = orderById.get(c.work_order_id)
        const vehicleLabel = order?.plate_number
          ? `Truck: ${order.plate_number}`
          : order?.trailer_id
            ? `Trailer: ${trailerPlateById.get(order.trailer_id) ?? `#${order.trailer_id}`}`
            : '—'

        return {
          completion_id: c.completion_id,
          completed_at: c.completed_at,
          description: c.description,
          labor_hours: c.labor_hours,
          vehicle_label: vehicleLabel,
        }
      }),
    )
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading work order history...</p>
  }
  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        {currentWorkOrder ? (
          <div>
            <div className="flex items-center gap-3">
              <WorkOrderStatusBadge status={currentWorkOrder.work_order_status} />
              <p className="text-sm font-medium text-slate-900">
                {currentWorkOrder.work_order_number} — {currentWorkOrder.vehicle_label}
              </p>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {currentWorkOrder.maintenance_type}
              {currentWorkOrder.work_description ? ` — ${currentWorkOrder.work_description}` : ''}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No active work order.</p>
        )}
      </div>

      <h4 className="mt-5 text-sm font-semibold text-slate-700">
        Completion History ({completions.length})
      </h4>

      {completions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No completed work orders yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Description</th>
                <th className="px-4 py-3 font-medium">Labor Hours</th>
                <th className="px-4 py-3 font-medium">Vehicle</th>
              </tr>
            </thead>
            <tbody>
              {completions.map((c) => (
                <tr key={c.completion_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(c.completed_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.description}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {c.labor_hours !== null ? c.labor_hours : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.vehicle_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export type DetailableEmployee = {
  employee_id: number
  name: string
  position: string
}

function EmployeeDetailModal({
  employee,
  onClose,
}: {
  employee: DetailableEmployee
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">{employee.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>
        <InfoRow label="Position" value={employee.position} />

        <div className="mt-5">
          {employee.position === 'Mechanic' ? (
            <MechanicDetail employeeId={employee.employee_id} />
          ) : (
            <DriverHelperDetail
              employeeId={employee.employee_id}
              crewRole={employee.position as 'Driver' | 'Helper'}
            />
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
  )
}

export default EmployeeDetailModal
