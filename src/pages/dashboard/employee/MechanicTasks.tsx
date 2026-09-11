// MechanicTasks: shows the logged-in mechanic's assigned work orders,
// found via work_orders.assigned_mechanic_id.
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

const STATUS_FLOW = ['Created', 'Scheduled', 'In Progress', 'Completed']

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

  async function advanceStatus(order: WorkOrder) {
    const currentIndex = STATUS_FLOW.indexOf(order.work_order_status)
    const nextStatus = currentIndex >= 0 ? STATUS_FLOW[currentIndex + 1] : undefined
    if (!nextStatus) return

    setUpdatingId(order.work_order_id)

    const { error: updateError } = await supabase
      .from('work_orders')
      .update({ work_order_status: nextStatus })
      .eq('work_order_id', order.work_order_id)

    setUpdatingId(null)

    if (updateError) {
      setError(updateError.message)
      return
    }

    if (nextStatus === 'Completed') {
      setOrders((prev) => prev.filter((o) => o.work_order_id !== order.work_order_id))
    } else {
      setOrders((prev) =>
        prev.map((o) =>
          o.work_order_id === order.work_order_id
            ? { ...o, work_order_status: nextStatus }
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

  if (orders.length === 0) {
    return <p className="text-slate-500">Nothing assigned yet.</p>
  }

  return (
    <div className="grid gap-4">
      {orders.map((order) => {
        const currentIndex = STATUS_FLOW.indexOf(order.work_order_status)
        const nextStatus = currentIndex >= 0 ? STATUS_FLOW[currentIndex + 1] : undefined

        return (
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

            {nextStatus && (
              <button
                onClick={() => advanceStatus(order)}
                disabled={updatingId === order.work_order_id}
                className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {updatingId === order.work_order_id
                  ? 'Updating...'
                  : `Mark as ${nextStatus}`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default MechanicTasks
