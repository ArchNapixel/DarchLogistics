// TaskBoard: work orders not yet claimed by any mechanic
// (assigned_mechanic_id IS NULL). Any mechanic can browse this list and
// accept one to add it to their own "My Tasks" list -- self-assignment,
// not staff dispatching it to them.
//
// The accept update is guarded two ways: the WHERE clause only matches
// if the row is STILL unassigned at the moment of the update (protects
// against two mechanics accepting the same one at nearly the same
// time), and .select().maybeSingle() tells us whether it actually
// matched a row -- if not, someone else got there first. Status itself
// isn't touched on accept; the mechanic controls that afterward via the
// dropdown in MechanicTasks.tsx.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { logWorkOrderAcceptance } from '../../../lib/workOrderAcceptanceLog'
import { formatDate } from '../../../lib/quoteRequest'
import {
  StatusBadge,
  WORK_ORDER_COLUMNS,
  withVehicleLabels,
  type WorkOrder,
} from './MechanicTasks'

// Same shape as a mechanic's own work orders -- includes trailer_id, so
// trailer jobs show "Trailer XYZ" instead of "Truck null".
type AvailableWorkOrder = WorkOrder

function TaskBoard({ onAccepted }: { onAccepted: () => void }) {
  const { employeeId } = useAuth()
  const [orders, setOrders] = useState<AvailableWorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [acceptingId, setAcceptingId] = useState<number | null>(null)

  useEffect(() => {
    loadAvailableOrders()
  }, [])

  async function loadAvailableOrders() {
    setLoading(true)

    const { data, error: loadError } = await supabase
      .from('work_orders')
      .select(WORK_ORDER_COLUMNS)
      .is('assigned_mechanic_id', null)
      .not('work_order_status', 'in', '(Completed,Cancelled)')
      .order('scheduled_start_date', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    const labelled = await withVehicleLabels(data)
    if (labelled.error) {
      setError(labelled.error)
      setLoading(false)
      return
    }

    setOrders(labelled.orders)
    setError(null)
    setLoading(false)
  }

  async function handleAccept(order: AvailableWorkOrder) {
    if (!employeeId) {
      return
    }

    setAcceptingId(order.work_order_id)
    setError(null)

    const { data: updated, error: updateError } = await supabase
      .from('work_orders')
      .update({ assigned_mechanic_id: employeeId })
      .eq('work_order_id', order.work_order_id)
      .is('assigned_mechanic_id', null)
      .select('work_order_id')
      .maybeSingle()

    setAcceptingId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }

    if (!updated) {
      setError(
        `"${order.work_order_number}" was just accepted by another mechanic.`,
      )
      setOrders((prev) =>
        prev.filter((o) => o.work_order_id !== order.work_order_id),
      )
      return
    }

    setOrders((prev) =>
      prev.filter((o) => o.work_order_id !== order.work_order_id),
    )

    // Best-effort -- the accept itself already succeeded above; a
    // failure to log it shouldn't block or error out the actual accept.
    logWorkOrderAcceptance({ workOrderId: order.work_order_id, employeeId })

    onAccepted()
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">
        Task Board
        {!loading && (
          <span className="ml-2 text-sm font-normal text-slate-500">
            {orders.length} available
          </span>
        )}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Work orders waiting for a mechanic -- accept one to add it to your
        own task list.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && (
        <p className="mt-4 text-slate-500">Loading available work orders...</p>
      )}
      {!loading && orders.length === 0 && (
        <p className="mt-4 text-slate-500">
          No unassigned work orders right now.
        </p>
      )}

      {!loading && orders.length > 0 && (
        <div className="mt-4 grid gap-4">
          {orders.map((order) => (
            <div
              key={order.work_order_id}
              className="rounded-xl border border-slate-200 p-5"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  {order.work_order_number} — {order.vehicle_label}
                </p>
                <StatusBadge status={order.work_order_status} />
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {order.maintenance_type}
              </p>
              {order.work_description && (
                <p className="mt-1 text-sm text-slate-600">
                  {order.work_description}
                </p>
              )}
              {order.scheduled_start_date && (
                <p className="mt-1 text-sm text-slate-500">
                  Scheduled: {formatDate(order.scheduled_start_date)}
                </p>
              )}

              <button
                onClick={() => handleAccept(order)}
                disabled={acceptingId === order.work_order_id}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {acceptingId === order.work_order_id
                  ? 'Accepting...'
                  : 'Accept Work Order'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TaskBoard
