// MechanicTasks: shows the logged-in mechanic's assigned work orders,
// found via work_orders.assigned_mechanic_id. Status is a free-choice
// dropdown (ALL_STATUSES), not a fixed progression -- the mechanic can
// set it to whatever actually applies, in any order. New work orders
// get assigned here by accepting them on the Task Board (TaskBoard.tsx)
// first.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

type WorkOrder = {
  work_order_id: number
  work_order_number: string
  plate_number: string
  work_order_status: string
  work_description: string | null
  scheduled_start_date: string | null
}

const STATUS_STYLES: Record<string, string> = {
  Created: 'bg-gray-100 text-gray-700',
  Scheduled: 'bg-blue-100 text-blue-700',
  'In Progress': 'bg-orange-100 text-orange-700',
  'On Hold': 'bg-yellow-100 text-yellow-700',
  Completed: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

// A free-choice dropdown, not a fixed progression -- the mechanic picks
// whatever status actually applies (including going back to "On Hold"
// or jumping straight to "Cancelled"), rather than being forced through
// one status at a time.
const ALL_STATUSES = [
  'Created',
  'Scheduled',
  'In Progress',
  'On Hold',
  'Completed',
  'Cancelled',
]

function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function MechanicTasks() {
  const { employeeId } = useAuth()
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  useEffect(() => {
    if (employeeId) loadOrders(employeeId)
  }, [employeeId])

  async function loadOrders(mechanicEmployeeId: number) {
    setLoading(true)

    const { data, error } = await supabase
      .from('work_orders')
      .select(
        'work_order_id, work_order_number, plate_number, work_order_status, work_description, scheduled_start_date',
      )
      .eq('assigned_mechanic_id', mechanicEmployeeId)
      .not('work_order_status', 'in', '(Completed,Cancelled)')
      .order('scheduled_start_date', { ascending: true })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setOrders(data)
    setError(null)
    setLoading(false)
  }

  async function handleStatusChange(order: WorkOrder, newStatus: string) {
    setUpdatingId(order.work_order_id)
    setActionError(null)

    const { error: updateError } = await supabase
      .from('work_orders')
      .update({ work_order_status: newStatus })
      .eq('work_order_id', order.work_order_id)

    setUpdatingId(null)

    if (updateError) {
      setActionError(updateError.message)
      return
    }

    if (newStatus === 'Completed' || newStatus === 'Cancelled') {
      // Matches the load filter (Completed/Cancelled excluded) -- drop
      // it off the list instead of showing a status it'll never leave.
      setOrders((prev) => prev.filter((o) => o.work_order_id !== order.work_order_id))
    } else {
      setOrders((prev) =>
        prev.map((o) =>
          o.work_order_id === order.work_order_id
            ? { ...o, work_order_status: newStatus }
            : o,
        ),
      )
    }
  }

  if (loading) {
    return <p className="text-slate-500">Loading your work orders...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      {actionError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {orders.length === 0 ? (
        <p className="text-slate-500">Nothing assigned yet.</p>
      ) : (
        <div className="grid gap-4">
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

              <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                Status:
                <select
                  value={order.work_order_status}
                  disabled={updatingId === order.work_order_id}
                  onChange={(e) => handleStatusChange(order, e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900"
                >
                  {ALL_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MechanicTasks
