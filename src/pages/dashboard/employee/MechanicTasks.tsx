// MechanicTasks: shows the logged-in mechanic's assigned work orders,
// found via work_orders.assigned_mechanic_id. Status is a free-choice
// dropdown (ALL_STATUSES minus "Completed"), not a fixed progression --
// the mechanic can set it to whatever actually applies, in any order,
// including Cancelled. New work orders get assigned here by accepting
// them on the Task Board (TaskBoard.tsx) first.
//
// Status changes go through changeWorkOrderStatus() (workOrderStatusLog.ts),
// which also frees the truck/trailer when a job is Cancelled.
//
// Completing is its own "Mark Complete" button (on the card and in
// AccessWorkOrderModal), which opens CompleteWorkOrderModal -- it
// requires a description + parts-used breakdown before the work order
// can actually be marked complete.
//
// Completed work orders drop off the main list above (the load query
// excludes them), so a "Recently Completed" list below it is the only
// place a mechanic can flag one they finished by mistake -- "Request
// Correction" submits a status_relog_requests row for Admin to approve
// (see statusRelogRequests.ts) rather than reopening it directly. Once
// requested, the link is replaced by "Correction requested" so the same
// request can't be sent twice.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { changeWorkOrderStatus } from '../../../lib/workOrderStatusLog'
import { loadMyPendingWorkOrderRelogIds } from '../../../lib/statusRelogRequests'
import { formatDate } from '../../../lib/quoteRequest'
import CompleteWorkOrderModal from './CompleteWorkOrderModal'
import RequestStatusRelogModal from '../../../components/RequestStatusRelogModal'
import AccessWorkOrderModal from './AccessWorkOrderModal'

const REOPEN_STATUS_OPTIONS = ['Created', 'Scheduled', 'In Progress', 'On Hold']

export type WorkOrder = {
  work_order_id: number
  work_order_number: string
  plate_number: string | null
  trailer_id: number | null
  vehicle_label: string
  work_order_status: string
  maintenance_type: string
  work_description: string | null
  scheduled_start_date: string | null
}

export const WORK_ORDER_COLUMNS =
  'work_order_id, work_order_number, plate_number, trailer_id, work_order_status, maintenance_type, work_description, scheduled_start_date'

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
// one status at a time. "Completed" is kept in this list (other screens
// use it for labels), but the dropdowns leave it out -- completing is
// the separate "Mark Complete" button.
export const ALL_STATUSES = [
  'Created',
  'Scheduled',
  'In Progress',
  'On Hold',
  'Completed',
  'Cancelled',
]

export function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

// Adds the "Truck ABC-123" / "Trailer XYZ-789" label -- trailers need a
// lookup, since work_orders only stores trailer_id for them. Also used by
// TaskBoard.tsx.
export async function withVehicleLabels(
  rows: Omit<WorkOrder, 'vehicle_label'>[],
): Promise<{ orders: WorkOrder[]; error: string | null }> {
  const trailerIds = Array.from(
    new Set(rows.filter((o) => o.trailer_id != null).map((o) => o.trailer_id)),
  )

  const { data: trailers, error } =
    trailerIds.length > 0
      ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : { data: [], error: null }

  if (error) {
    return { orders: [], error: error.message }
  }

  const trailerPlateById = new Map(trailers.map((t) => [t.trailer_id, t.plate_number]))

  return {
    orders: rows.map((order) => ({
      ...order,
      vehicle_label: order.plate_number
        ? `Truck ${order.plate_number}`
        : `Trailer ${trailerPlateById.get(order.trailer_id) ?? `#${order.trailer_id}`}`,
    })),
    error: null,
  }
}

function MechanicTasks() {
  const { employeeId } = useAuth()
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = useState<WorkOrder[]>([])
  const [pendingRelogIds, setPendingRelogIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [completingOrder, setCompletingOrder] = useState<WorkOrder | null>(null)
  const [reopeningOrder, setReopeningOrder] = useState<WorkOrder | null>(null)
  const [accessingOrderId, setAccessingOrderId] = useState<number | null>(null)
  const accessingOrder = orders.find((o) => o.work_order_id === accessingOrderId) ?? null

  useEffect(() => {
    if (employeeId) {
      loadOrders(employeeId)
      loadRecentlyCompleted(employeeId)
    }
  }, [employeeId])

  async function loadOrders(mechanicEmployeeId: number) {
    setLoading(true)

    const { data, error } = await supabase
      .from('work_orders')
      .select(WORK_ORDER_COLUMNS)
      .eq('assigned_mechanic_id', mechanicEmployeeId)
      .not('work_order_status', 'in', '(Completed,Cancelled)')
      .order('scheduled_start_date', { ascending: true })

    if (error) {
      setError(error.message)
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

  // Last 10 the mechanic finished, most recent first (by work_order_id,
  // the closest proxy to completion order without an extra join to
  // work_order_completions.completed_at) -- just enough to catch a
  // "wait, I marked the wrong one" a little after the fact.
  async function loadRecentlyCompleted(mechanicEmployeeId: number) {
    const [{ data, error: loadError }, pendingIds] = await Promise.all([
      supabase
        .from('work_orders')
        .select(WORK_ORDER_COLUMNS)
        .eq('assigned_mechanic_id', mechanicEmployeeId)
        .eq('work_order_status', 'Completed')
        .order('work_order_id', { ascending: false })
        .limit(10),
      loadMyPendingWorkOrderRelogIds(mechanicEmployeeId),
    ])

    setPendingRelogIds(pendingIds)
    if (loadError || !data) return

    const labelled = await withVehicleLabels(data)
    if (!labelled.error) setRecentlyCompleted(labelled.orders)
  }

  async function handleStatusChange(order: WorkOrder, newStatus: string) {
    setUpdatingId(order.work_order_id)
    setActionError(null)
    setSuccessMessage(null)

    const { error: changeError, statusChanged } = await changeWorkOrderStatus({
      workOrderId: order.work_order_id,
      plateNumber: order.plate_number,
      trailerId: order.trailer_id,
      previousStatus: order.work_order_status,
      newStatus,
      changedByEmployeeId: employeeId ?? null,
    })

    setUpdatingId(null)

    if (changeError) setActionError(changeError)
    if (!statusChanged) return

    if (newStatus === 'Cancelled') {
      // Matches the load filter (Completed/Cancelled excluded) -- drop
      // it off the list instead of showing a status it'll never leave.
      setOrders((prev) => prev.filter((o) => o.work_order_id !== order.work_order_id))
      setAccessingOrderId(null)
      if (!changeError) setSuccessMessage(`${order.work_order_number} cancelled.`)
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

  function startCompleting(order: WorkOrder) {
    setAccessingOrderId(null)
    setCompletingOrder(order)
  }

  function handleWorkOrderCompleted() {
    if (completingOrder) {
      setSuccessMessage(`${completingOrder.work_order_number} marked complete.`)
      setOrders((prev) =>
        prev.filter((o) => o.work_order_id !== completingOrder.work_order_id),
      )
    }
    setCompletingOrder(null)
    if (employeeId) loadRecentlyCompleted(employeeId)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your work orders...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500">
        {orders.length} active work order{orders.length === 1 ? '' : 's'} assigned to you
      </p>

      {actionError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {successMessage && (
        <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      {orders.length === 0 ? (
        <p className="text-slate-500">
          Nothing assigned right now -- accept one from the Task Board below.
        </p>
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <div
              key={order.work_order_id}
              className="rounded-xl border border-slate-200 p-5"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">
                  {order.work_order_number} — {order.vehicle_label}
                </p>
                <StatusBadge status={order.work_order_status} />
              </div>
              <p className="mt-1 text-sm text-slate-600">{order.maintenance_type}</p>
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

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setAccessingOrderId(order.work_order_id)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Open Work Order
                </button>
                <button
                  onClick={() => startCompleting(order)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                >
                  Mark Complete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {recentlyCompleted.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-slate-700">Recently Completed</h3>
          <div className="mt-3 grid gap-3">
            {recentlyCompleted.map((order) => (
              <div
                key={order.work_order_id}
                className="flex items-center justify-between rounded-xl border border-slate-200 p-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {order.work_order_number} — {order.vehicle_label}
                  </p>
                  <StatusBadge status={order.work_order_status} />
                </div>
                {pendingRelogIds.includes(order.work_order_id) ? (
                  <span className="text-xs text-slate-400">Correction requested</span>
                ) : (
                  <button
                    onClick={() => setReopeningOrder(order)}
                    className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
                  >
                    Request correction
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {completingOrder && (
        <CompleteWorkOrderModal
          workOrderId={completingOrder.work_order_id}
          workOrderNumber={completingOrder.work_order_number}
          plateNumber={completingOrder.plate_number}
          trailerId={completingOrder.trailer_id}
          previousStatus={completingOrder.work_order_status}
          onClose={() => setCompletingOrder(null)}
          onCompleted={handleWorkOrderCompleted}
        />
      )}

      {reopeningOrder && employeeId && (
        <RequestStatusRelogModal
          targetType="work_order"
          workOrderId={reopeningOrder.work_order_id}
          currentStatus={reopeningOrder.work_order_status}
          statusOptions={REOPEN_STATUS_OPTIONS}
          employeeId={employeeId}
          onClose={() => setReopeningOrder(null)}
          onRequested={() => {
            setPendingRelogIds((prev) => [...prev, reopeningOrder.work_order_id])
            setSuccessMessage(
              `Correction for ${reopeningOrder.work_order_number} sent to admin for approval.`,
            )
            setReopeningOrder(null)
          }}
        />
      )}

      {accessingOrder && employeeId && (
        <AccessWorkOrderModal
          order={accessingOrder}
          employeeId={employeeId}
          updating={updatingId === accessingOrder.work_order_id}
          onStatusChange={handleStatusChange}
          onMarkComplete={() => startCompleting(accessingOrder)}
          onClose={() => setAccessingOrderId(null)}
        />
      )}
    </div>
  )
}

export default MechanicTasks
