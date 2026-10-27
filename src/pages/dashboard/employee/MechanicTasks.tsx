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
import { WORK_ORDER_COLUMNS, withVehicleLabels, type WorkOrder } from '../../../lib/mechanicWorkOrders'
import { changeWorkOrderStatus } from '../../../lib/workOrderStatusLog'
import { loadMyPendingWorkOrderRelogIds } from '../../../lib/statusRelogRequests'
import CompleteWorkOrderModal from './CompleteWorkOrderModal'
import RequestStatusRelogModal from '../../../components/RequestStatusRelogModal'
import AccessWorkOrderModal from './AccessWorkOrderModal'
import StatusBadge from '../../../components/StatusBadge'
import { showToast } from '../../../components/Toast'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

const REOPEN_STATUS_OPTIONS = ['Created', 'Scheduled', 'In Progress', 'On Hold']

function MechanicTasks() {
  const { employeeId } = useAuth()
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [recentlyCompleted, setRecentlyCompleted] = useState<WorkOrder[]>([])
  // work_order_id -> its latest completion (date + what was done).
  const [completionById, setCompletionById] = useState<Map<number, { completed_at: string; description: string | null }>>(new Map())
  const [pendingRelogIds, setPendingRelogIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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

    // When each was completed and what was done (latest completion wins --
    // a reopened job can have more than one).
    const ids = data.map((o) => o.work_order_id)
    if (ids.length === 0) return
    const { data: completions } = await supabase
      .from('work_order_completions')
      .select('work_order_id, completed_at, description')
      .in('work_order_id', ids)
      .order('completed_at', { ascending: true })
    setCompletionById(new Map((completions ?? []).map((c) => [c.work_order_id, c])))
  }

  async function handleStatusChange(order: WorkOrder, newStatus: string) {
    setUpdatingId(order.work_order_id)
    setActionError(null)

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
      if (!changeError) showToast(`${order.work_order_number} cancelled.`)
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
      showToast(`${completingOrder.work_order_number} marked complete.`)
      setOrders((prev) =>
        prev.filter((o) => o.work_order_id !== completingOrder.work_order_id),
      )
    }
    setCompletingOrder(null)
    if (employeeId) loadRecentlyCompleted(employeeId)
  }

  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby="my-tasks-h" className="card flex flex-col gap-3 px-5 pt-3.5 pb-5">
        <h2 id="my-tasks-h" className="text-base font-semibold text-ink">
          My Tasks <span className="font-medium text-ink-muted">· {orders.length} open</span>
        </h2>
        {actionError && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}
        {loading ? (
          <p className="text-ink-muted">Loading your work orders...</p>
        ) : error ? (
          <p className="text-red-700">{error}</p>
        ) : orders.length === 0 ? (
          <EmptyState message="No work orders assigned to you." hint="Accept one from the Task Board to get started." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {orders.map((order) => (
              <article key={order.work_order_id} aria-label={`Work order ${order.work_order_number}`} className="flex flex-col gap-2 border border-line bg-white px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-bold text-ink">
                    {order.work_order_number} · {order.vehicle_label}
                  </span>
                  <StatusBadge status={order.work_order_status} icon />
                </div>
                <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-[13px] text-ink-muted">Type</dt>
                  <dd className="m-0 text-ink-secondary">{order.maintenance_type}</dd>
                  <dt className="text-[13px] text-ink-muted">Problem</dt>
                  <dd className="m-0 text-ink-secondary">{order.work_description || '—'}</dd>
                  <dt className="text-[13px] text-ink-muted">Scheduled</dt>
                  <dd className="m-0 text-ink-secondary">{order.scheduled_start_date ? formatDate(order.scheduled_start_date) : '—'}</dd>
                </dl>
                <div className="mt-1 flex gap-2">
                  <button type="button" onClick={() => setAccessingOrderId(order.work_order_id)} className="btn-secondary flex-1 px-3 text-sm font-medium">
                    Open Work Order
                  </button>
                  <button type="button" onClick={() => startCompleting(order)} className="btn-secondary flex-1 px-3 text-sm font-medium">
                    Mark Complete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="recent-h" className="card flex flex-col">
        <h2 id="recent-h" className="px-5 py-3.5 text-base font-semibold text-ink">
          Recently Completed
        </h2>
        {recentlyCompleted.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-ink-muted">Nothing completed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm text-ink-metric">
              <thead>
                <tr>
                  <th className={TH}>Work Order</th>
                  <th className={TH}>Vehicle · Work Done</th>
                  <th className={TH}>Completed</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>
                    <span className="sr-only">Correction</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentlyCompleted.map((order) => {
                  const completion = completionById.get(order.work_order_id)
                  const requested = pendingRelogIds.includes(order.work_order_id)
                  return (
                    <tr key={order.work_order_id} className="h-[60px] border-b border-slate-200">
                      <td className={`${TD} font-semibold text-ink`}>{order.work_order_number}</td>
                      <td className={TD}>
                        {order.vehicle_label}
                        {completion?.description && <span className="text-ink-muted"> · {completion.description}</span>}
                      </td>
                      <td className={TD}>{completion ? formatDate(completion.completed_at) : '—'}</td>
                      <td className={TD}>
                        <StatusBadge status={order.work_order_status} icon />
                      </td>
                      <td className={TD}>
                        <button
                          type="button"
                          onClick={() => setReopeningOrder(order)}
                          disabled={requested}
                          className="btn-secondary w-48 px-3 text-sm font-medium"
                        >
                          {requested ? 'Correction Requested' : 'Request Correction'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-5 py-3 text-sm text-ink-secondary">
          Marked complete by mistake? Request a correction and Admin will reopen it.
        </p>
      </section>

      {completingOrder && (
        <CompleteWorkOrderModal
          workOrderId={completingOrder.work_order_id}
          workOrderNumber={completingOrder.work_order_number}
          plateNumber={completingOrder.plate_number}
          trailerId={completingOrder.trailer_id}
          previousStatus={completingOrder.work_order_status}
          subtitle={`${completingOrder.vehicle_label} · ${completingOrder.maintenance_type}`}
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
            showToast(`Correction for ${reopeningOrder.work_order_number} sent to admin for approval.`)
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
