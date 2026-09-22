// MechanicTasks: shows the logged-in mechanic's assigned work orders,
// found via work_orders.assigned_mechanic_id. Status is a free-choice
// dropdown (ALL_STATUSES), not a fixed progression -- the mechanic can
// set it to whatever actually applies, in any order. New work orders
// get assigned here by accepting them on the Task Board (TaskBoard.tsx)
// first.
//
// Picking "Completed" doesn't update the status directly -- it opens
// CompleteWorkOrderModal, which requires a description + parts-used
// breakdown before the work order can actually be marked complete.
//
// Completed work orders drop off the main list above (the load query
// excludes them), so a "Recently Completed" list below it is the only
// place a mechanic can flag one they finished by mistake -- "Request
// Correction" submits a status_relog_requests row for Admin to approve
// (see statusRelogRequests.ts) rather than reopening it directly.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { logWorkOrderStatusChange } from '../../../lib/workOrderStatusLog'
import CompleteWorkOrderModal from './CompleteWorkOrderModal'
import RequestStatusRelogModal from '../../../components/RequestStatusRelogModal'
import InspectionReportModal from './InspectionReportModal'
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

function MechanicTasks() {
  const { employeeId } = useAuth()
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [completingOrder, setCompletingOrder] = useState<WorkOrder | null>(null)
  const [reopeningOrder, setReopeningOrder] = useState<WorkOrder | null>(null)
  const [showInspectionReport, setShowInspectionReport] = useState(false)
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
      .select(
        'work_order_id, work_order_number, plate_number, trailer_id, work_order_status, maintenance_type, work_description, scheduled_start_date',
      )
      .eq('assigned_mechanic_id', mechanicEmployeeId)
      .not('work_order_status', 'in', '(Completed,Cancelled)')
      .order('scheduled_start_date', { ascending: true })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const trailerIds = Array.from(
      new Set(data.filter((o) => o.trailer_id != null).map((o) => o.trailer_id)),
    )

    const { data: trailers, error: trailerError } =
      trailerIds.length > 0
        ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
        : { data: [], error: null }

    if (trailerError) {
      setError(trailerError.message)
      setLoading(false)
      return
    }

    const trailerPlateById = new Map(trailers.map((t) => [t.trailer_id, t.plate_number]))

    setOrders(
      data.map((order) => ({
        ...order,
        vehicle_label: order.plate_number
          ? `Truck ${order.plate_number}`
          : `Trailer ${trailerPlateById.get(order.trailer_id) ?? `#${order.trailer_id}`}`,
      })),
    )
    setError(null)
    setLoading(false)
  }

  // Last 10 the mechanic finished, most recent first (by work_order_id,
  // the closest proxy to completion order without an extra join to
  // work_order_completions.completed_at) -- just enough to catch a
  // "wait, I marked the wrong one" a little after the fact.
  async function loadRecentlyCompleted(mechanicEmployeeId: number) {
    const { data, error: loadError } = await supabase
      .from('work_orders')
      .select(
        'work_order_id, work_order_number, plate_number, trailer_id, work_order_status, maintenance_type, work_description, scheduled_start_date',
      )
      .eq('assigned_mechanic_id', mechanicEmployeeId)
      .eq('work_order_status', 'Completed')
      .order('work_order_id', { ascending: false })
      .limit(10)

    if (loadError || !data) return

    const trailerIds = Array.from(
      new Set(data.filter((o) => o.trailer_id != null).map((o) => o.trailer_id)),
    )

    const { data: trailers } =
      trailerIds.length > 0
        ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
        : { data: [] }

    const trailerPlateById = new Map((trailers ?? []).map((t) => [t.trailer_id, t.plate_number]))

    setRecentlyCompleted(
      data.map((order) => ({
        ...order,
        vehicle_label: order.plate_number
          ? `Truck ${order.plate_number}`
          : `Trailer ${trailerPlateById.get(order.trailer_id) ?? `#${order.trailer_id}`}`,
      })),
    )
  }

  async function handleStatusChange(order: WorkOrder, newStatus: string) {
    if (newStatus === 'Completed') {
      setCompletingOrder(order)
      setAccessingOrderId(null)
      return
    }

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

    // Best effort -- the status change above already succeeded even if
    // this fails, same reasoning as dispatch_status_logs elsewhere.
    if (employeeId) {
      logWorkOrderStatusChange({
        workOrderId: order.work_order_id,
        previousStatus: order.work_order_status,
        newStatus,
        changedByEmployeeId: employeeId,
      })
    }

    if (newStatus === 'Cancelled') {
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

  function handleWorkOrderCompleted() {
    if (completingOrder) {
      setSuccessMessage(`${completingOrder.work_order_number} marked complete.`)
      setOrders((prev) =>
        prev.filter((o) => o.work_order_id !== completingOrder.work_order_id),
      )
    }
    setCompletingOrder(null)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your work orders...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowInspectionReport(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Submit Inspection Report
        </button>
      </div>

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
                  {order.work_order_number} — {order.vehicle_label}
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

              <button
                onClick={() => setAccessingOrderId(order.work_order_id)}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
              >
                Access Work Order
              </button>
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
                <button
                  onClick={() => setReopeningOrder(order)}
                  className="text-xs font-medium text-slate-500 underline hover:text-slate-700"
                >
                  Request correction
                </button>
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
          onRequested={() => setReopeningOrder(null)}
        />
      )}

      {showInspectionReport && (
        <InspectionReportModal onClose={() => setShowInspectionReport(false)} />
      )}

      {accessingOrder && employeeId && (
        <AccessWorkOrderModal
          order={accessingOrder}
          employeeId={employeeId}
          updating={updatingId === accessingOrder.work_order_id}
          onStatusChange={handleStatusChange}
          onClose={() => setAccessingOrderId(null)}
        />
      )}
    </div>
  )
}

export default MechanicTasks
