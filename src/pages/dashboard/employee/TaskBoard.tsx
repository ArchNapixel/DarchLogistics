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
//
// Shown as a drawer on the right edge of the screen: a thin tab is always
// visible, and the drawer slides open by itself on login if there is
// work to accept (otherwise it stays closed until the mechanic opens it).
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
  const [open, setOpen] = useState(false)

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
    // Pop open on first load when there is something to accept
    if (labelled.orders.length > 0) setOpen(true)
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
    <div
      className={`fixed bottom-0 right-0 top-[69px] z-40 flex transition-transform duration-300 ${
        open ? '' : 'translate-x-[calc(100%-2.5rem)]'
      }`}
    >
      {/* Always-visible tab on the drawer's left edge */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative my-auto flex h-40 w-10 shrink-0 items-center justify-center rounded-l-xl border border-r-0 border-slate-900 bg-slate-900 text-sm font-medium text-white hover:bg-slate-700"
        aria-label={open ? 'Close task board' : 'Open task board'}
      >
        <span className="whitespace-nowrap [writing-mode:vertical-rl]">
          Task Board{!loading && ` (${orders.length})`}
        </span>
      </button>

      <div className="w-[min(22rem,calc(100vw-2.5rem))] overflow-y-auto border-l border-slate-900 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">
        Task Board
        {!loading && (
          <span className="ml-2 text-sm font-normal text-slate-500">
            {orders.length} available
          </span>
        )}
      </h2>

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
          No work orders to do right now.
        </p>
      )}

      {!loading && orders.length > 0 && (
        <div className="mt-3 grid gap-2">
          {orders.map((order) => (
            <div
              key={order.work_order_id}
              className="rounded-lg border border-slate-200 p-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">
                  {order.work_order_number} — {order.vehicle_label}
                </p>
                <StatusBadge status={order.work_order_status} />
              </div>
              <p className="mt-0.5 text-xs text-slate-600">
                {order.maintenance_type}
              </p>
              {order.work_description && (
                <p className="mt-0.5 text-xs text-slate-600">
                  {order.work_description}
                </p>
              )}
              {order.scheduled_start_date && (
                <p className="mt-0.5 text-xs text-slate-500">
                  Scheduled: {formatDate(order.scheduled_start_date)}
                </p>
              )}

              <button
                onClick={() => handleAccept(order)}
                disabled={acceptingId === order.work_order_id}
                className="mt-2 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
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
    </div>
  )
}

export default TaskBoard
