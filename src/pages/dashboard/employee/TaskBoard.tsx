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
// Shown as a panel beside My Tasks (the canvas's Mechanic Dashboard): it
// opens by itself on login if there is work to accept, otherwise it stays
// collapsed until the mechanic clicks Show.
import { useEffect, useEffectEvent, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { logWorkOrderAcceptance } from '../../../lib/workOrderAcceptanceLog'
import {
  WORK_ORDER_COLUMNS,
  withVehicleLabels,
  type WorkOrder,
} from '../../../lib/mechanicWorkOrders'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

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

  // Load once, when this opens.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    loadAvailableOrders()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

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
    <aside aria-labelledby="task-board-h" className="flex flex-col border-2 border-primary bg-white xl:sticky xl:top-0">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-primary-soft py-3.5 pr-4 pl-5">
        <h2 id="task-board-h" className="text-base font-semibold text-ink">
          Task Board{' '}
          {!loading && <span className="font-medium text-ink-secondary">· {orders.length} not taken</span>}
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="task-board-list"
          className="btn-secondary px-4 text-sm font-medium"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <>
          <p className="px-5 pt-3 text-sm text-ink-secondary">Approved work no mechanic has taken yet. Opens by itself when there's work.</p>
          <div id="task-board-list" className="flex max-h-[calc(100dvh-16rem)] flex-col gap-3 overflow-y-auto px-5 py-3">
            {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {loading ? (
              <p className="text-ink-muted">Loading available work orders...</p>
            ) : orders.length === 0 ? (
              <EmptyState message="No work orders to take right now." />
            ) : (
              orders.map((order) => (
                <article key={order.work_order_id} aria-label={`Unclaimed work order ${order.work_order_number}`} className="flex flex-col gap-2 border border-line bg-white px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-bold text-ink">
                      {order.work_order_number} · {order.vehicle_label}
                    </span>
                    <StatusBadge status={order.work_order_status} />
                  </div>
                  <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-[13px] text-ink-muted">Type</dt>
                    <dd className="m-0 text-ink-secondary">{order.maintenance_type}</dd>
                    <dt className="text-[13px] text-ink-muted">Problem</dt>
                    <dd className="m-0 text-ink-secondary">{order.work_description || '—'}</dd>
                    {order.scheduled_start_date && (
                      <>
                        <dt className="text-[13px] text-ink-muted">Scheduled</dt>
                        <dd className="m-0 text-ink-secondary">{formatDate(order.scheduled_start_date)}</dd>
                      </>
                    )}
                  </dl>
                  <button
                    type="button"
                    onClick={() => handleAccept(order)}
                    disabled={acceptingId === order.work_order_id}
                    className="btn-primary w-full px-4 text-sm"
                  >
                    {acceptingId === order.work_order_id ? 'Accepting...' : 'Accept Work Order'}
                  </button>
                </article>
              ))
            )}
          </div>
        </>
      )}
      <p className="border-t border-line px-5 py-3 text-[13px] text-ink-muted">If someone accepts it first, you'll be told it's taken.</p>
    </aside>
  )
}

export default TaskBoard
