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

type AvailableWorkOrder = {
  work_order_id: number
  work_order_number: string
  plate_number: string
  maintenance_type: string
  work_description: string | null
  work_order_status: string
  scheduled_start_date: string | null
}

const STATUS_STYLES: Record<string, string> = {
  Created: 'bg-gray-100 text-gray-700',
  Scheduled: 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-orange-100 text-orange-700',
  'On Hold': 'bg-yellow-100 text-yellow-700',
}

function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

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
      .select(
        'work_order_id, work_order_number, plate_number, maintenance_type, work_description, work_order_status, scheduled_start_date',
      )
      .is('assigned_mechanic_id', null)
      .not('work_order_status', 'in', '(Completed,Cancelled)')
      .order('scheduled_start_date', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setOrders(data)
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
    onAccepted()
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Task Board</h2>
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
                  {order.work_order_number} — Truck {order.plate_number}
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
                  Scheduled: {order.scheduled_start_date}
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
