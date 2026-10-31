// MaintenanceSection: the Maintenance page (the canvas's board) -- tiles
// (requests waiting, work orders in progress, trucks not operational, parts
// cost this month), then three tabs, each a table + side panel:
//   - Requests: pending maintenance requests from drivers/mechanics
//     (lib/maintenanceRequests.ts). Approve creates an unassigned work order;
//     Reject asks for a reason. Admin only.
//   - Work Orders: open ones, or completed/cancelled ("Show"). The panel's
//     "Open Work Order" opens WorkOrderDetailModal (mechanic's notes and
//     parts, reassign, status, Complete work order...).
//   - Schedules: pending maintenance schedules (lib/maintenanceSchedules.ts),
//     Mark Done, and "Assign Schedule" (moved here from Truck Monitoring).
// Links: ?tab=Requests|Schedules|Completed opens that tab; ?wo=ID opens
// that work order (Truck Monitoring's alerts use it).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePaged } from '../../../lib/usePaged'
import { useAuth } from '../../../context/AuthContext'
import { isAdmin } from '../../../lib/roles'
import { supabase } from '../../../lib/supabaseClient'
import {
  approveMaintenanceRequest,
  loadPendingMaintenanceRequests,
  rejectMaintenanceRequest,
  type PendingMaintenanceRequest,
} from '../../../lib/maintenanceRequests'
import {
  formatScheduleDueDate,
  loadPendingMaintenanceSchedules,
  markMaintenanceScheduleDone,
  SCHEDULE_TONE_STYLES,
  type PendingMaintenanceSchedule,
} from '../../../lib/maintenanceSchedules'
import { currentReportMonth, loadMaintenanceCostReport } from '../../../lib/maintenanceCostReport'
import CreateWorkOrderModal from './CreateWorkOrderModal'
import AssignScheduleModal from './AssignScheduleModal'
import MaintenanceCostReportModal from './MaintenanceCostReportModal'
import WorkOrderDetailModal, { type WorkOrderDetail } from './WorkOrderDetailModal'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'
import { promptDialog } from '../../../components/ConfirmDialog'
import { showToast } from '../../../components/Toast'
import { formatDate, formatDateTime, formatMoney } from '../../../lib/format'

type WorkOrder = WorkOrderDetail & {
  mechanic_name: string
}

type Mechanic = {
  employee_id: number
  full_name: string
  active_work_orders: number
}

const TABS = ['Requests', 'Work Orders', 'Schedules'] as const
type Tab = (typeof TABS)[number]

const ACTIVE_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const GROUP = 'mb-2.5 flex justify-between gap-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink'
const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'm-0 text-[15px] leading-[22px] font-medium text-ink'
const FILTER_LABEL = 'flex items-center gap-2.5 text-sm font-medium text-ink-secondary'
const FILTER_CONTROL =
  'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-full' : ''}>
      <dt className={LABEL}>{label}</dt>
      <dd className={VALUE}>{children || '—'}</dd>
    </div>
  )
}

// Table row click target + the "selected" look shared by all three tabs.
function rowClass(selected: boolean) {
  return `h-[60px] cursor-pointer border-b border-slate-200 ${
    selected ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
  }`
}

function OpenCell({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <td className={TD}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        aria-label={`Open ${label}`}
        className="flex h-11 w-11 items-center justify-center text-primary"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </td>
  )
}

// "Truck: ABC 123" -> "ABC 123" for the narrow Vehicle column.
const shortVehicle = (label: string) => label.replace(/^Truck: /, '')

function MaintenanceSection() {
  const { role, employeeId } = useAuth()
  const canDecide = isAdmin(role)
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const requestedOrderId = Number(searchParams.get('wo')) || null

  const [activeTab, setActiveTab] = useState<Tab>(
    requestedTab === 'Requests' ? 'Requests' : requestedTab === 'Schedules' ? 'Schedules' : 'Work Orders',
  )
  // Work Orders tab: open ones, or the finished (completed / cancelled) ones.
  const [showClosed, setShowClosed] = useState(requestedTab === 'Completed')
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [requests, setRequests] = useState<PendingMaintenanceRequest[]>([])
  const [schedules, setSchedules] = useState<PendingMaintenanceSchedule[]>([])
  const [trucksDown, setTrucksDown] = useState(0)
  const [partsCost, setPartsCost] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [showCostReport, setShowCostReport] = useState(false)
  const [openOrderId, setOpenOrderId] = useState<number | null>(requestedOrderId)
  // The row shown in the side panel, per tab.
  const [paneId, setPaneId] = useState<Record<Tab, number | null>>({
    Requests: null,
    'Work Orders': requestedOrderId,
    Schedules: null,
  })
  const openOrder = workOrders.find((o) => o.work_order_id === openOrderId) ?? null

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function loadData() {
    setLoading(true)

    const [ordersResult, mechanicsResult, trailersResult, trucksResult, requestsResult, schedulesResult, costResult] =
      await Promise.all([
        supabase
          .from('work_orders')
          .select(
            'work_order_id, work_order_number, plate_number, trailer_id, assigned_mechanic_id, maintenance_type, work_description, work_order_status, scheduled_start_date',
          )
          .order('scheduled_start_date', { ascending: true }),
        supabase.from('employees').select('employee_id, full_name').eq('position', 'Mechanic').order('full_name', { ascending: true }),
        supabase.from('trailers').select('trailer_id, plate_number'),
        supabase.from('truck_profiles').select('plate_number, current_status').eq('is_active', true),
        loadPendingMaintenanceRequests(),
        loadPendingMaintenanceSchedules(),
        loadMaintenanceCostReport(currentReportMonth()),
      ])

    const loadError =
      ordersResult.error?.message ??
      mechanicsResult.error?.message ??
      trailersResult.error?.message ??
      trucksResult.error?.message ??
      requestsResult.error ??
      schedulesResult.error
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    const orderRows = ordersResult.data ?? []
    const mechanicRows = mechanicsResult.data ?? []
    const mechanicNameById = new Map(mechanicRows.map((m) => [m.employee_id, m.full_name]))
    const trailerPlateById = new Map((trailersResult.data ?? []).map((t) => [t.trailer_id, t.plate_number]))

    setWorkOrders(
      orderRows.map((row) => ({
        work_order_id: row.work_order_id,
        work_order_number: row.work_order_number,
        plate_number: row.plate_number,
        trailer_id: row.trailer_id,
        assigned_mechanic_id: row.assigned_mechanic_id,
        work_description: row.work_description,
        vehicle_label: row.plate_number
          ? `Truck: ${row.plate_number}`
          : `Trailer: ${trailerPlateById.get(row.trailer_id) ?? `#${row.trailer_id}`}`,
        mechanic_name: mechanicNameById.get(row.assigned_mechanic_id) ?? '—',
        maintenance_type: row.maintenance_type,
        work_order_status: row.work_order_status,
        scheduled_start_date: row.scheduled_start_date,
      })),
    )
    setMechanics(
      mechanicRows.map((m) => ({
        employee_id: m.employee_id,
        full_name: m.full_name,
        active_work_orders: orderRows.filter(
          (o) => o.assigned_mechanic_id === m.employee_id && ACTIVE_STATUSES.includes(o.work_order_status),
        ).length,
      })),
    )
    setRequests(requestsResult.requests)
    setSchedules(schedulesResult.schedules)
    setTrucksDown(
      (trucksResult.data ?? []).filter((t) => t.current_status === 'Under Maintenance' || t.current_status === 'Out of Service').length,
    )
    // The cost tile just shows "—" if the report can't load.
    setPartsCost(costResult.error ? null : costResult.workOrders.reduce((sum, w) => sum + w.total, 0))
    setError(null)
    setLoading(false)
  }

  async function handleApprove(request: PendingMaintenanceRequest) {
    if (!employeeId) {
      setActionError('Could not determine your own employee record, so this cannot be recorded as approved by you. Contact an admin.')
      return
    }
    setBusyId(request.request_id)
    setActionError(null)
    const { error: approveError } = await approveMaintenanceRequest({ request, resolvedByEmployeeId: employeeId })
    setBusyId(null)
    if (approveError) {
      setActionError(approveError)
      return
    }
    showToast(`Request approved -- a work order was created for ${shortVehicle(request.vehicle_label)}.`)
    void loadData()
  }

  async function handleReject(request: PendingMaintenanceRequest) {
    if (!employeeId) {
      setActionError('Could not determine your own employee record, so this cannot be recorded as rejected by you. Contact an admin.')
      return
    }
    const reason = await promptDialog({
      title: 'Reject maintenance request',
      message: `Why is the request for ${request.vehicle_label} being rejected?`,
      confirmLabel: 'Reject',
      danger: true,
    })
    if (reason === null) return
    setBusyId(request.request_id)
    setActionError(null)
    const { error: rejectError } = await rejectMaintenanceRequest({
      requestId: request.request_id,
      resolvedByEmployeeId: employeeId,
      rejectionReason: reason.trim(),
    })
    setBusyId(null)
    if (rejectError) {
      setActionError(rejectError)
      return
    }
    setRequests((prev) => prev.filter((r) => r.request_id !== request.request_id))
  }

  async function handleMarkDone(schedule: PendingMaintenanceSchedule) {
    if (!employeeId) {
      setActionError('Could not determine your own employee record, so this cannot be recorded as done by you. Contact an admin.')
      return
    }
    setBusyId(schedule.schedule_id)
    setActionError(null)
    const { error: markError } = await markMaintenanceScheduleDone({
      scheduleId: schedule.schedule_id,
      completedByEmployeeId: employeeId,
    })
    setBusyId(null)
    if (markError) {
      setActionError(markError)
      return
    }
    setSchedules((prev) => prev.filter((s) => s.schedule_id !== schedule.schedule_id))
  }

  const openOrders = workOrders.filter((o) => ACTIVE_STATUSES.includes(o.work_order_status))
  const shownOrders = showClosed ? workOrders.filter((o) => !ACTIVE_STATUSES.includes(o.work_order_status)).reverse() : openOrders

  // One page at a time (back to page 1 when the filters change).
  const pagedRequests = usePaged(requests, activeTab)
  const pagedOrders = usePaged(shownOrders, `${activeTab}|${showClosed}`)
  const pagedSchedules = usePaged(schedules, activeTab)
  const paneRequest = pagedRequests.rows.find((r) => r.request_id === paneId.Requests) ?? pagedRequests.rows[0] ?? null
  const paneOrder =
    shownOrders.find((o) => o.work_order_id === paneId['Work Orders']) ?? pagedOrders.rows[0] ?? null
  const paneSchedule = pagedSchedules.rows.find((s) => s.schedule_id === paneId.Schedules) ?? pagedSchedules.rows[0] ?? null
  const pick = (tab: Tab, id: number) => setPaneId((prev) => ({ ...prev, [tab]: id }))

  const counts: Record<Tab, number> = { Requests: requests.length, 'Work Orders': openOrders.length, Schedules: schedules.length }
  const pager =
    activeTab === 'Requests' ? pagedRequests.pager : activeTab === 'Work Orders' ? pagedOrders.pager : pagedSchedules.pager

  return (
    <div>
      <PageHeader
        title="Maintenance"
        subtitle="Repair requests, the work orders that fix them, and maintenance schedules."
        actions={
          <>
            <button type="button" onClick={() => setShowCostReport(true)} className="btn-secondary px-4 text-sm font-medium">
              Cost Report
            </button>
            {activeTab === 'Work Orders' && (
              <button type="button" onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 px-5 text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14 M5 12h14" />
                </svg>
                New Work Order
              </button>
            )}
            {activeTab === 'Schedules' && (
              <button
                type="button"
                onClick={() => setShowAssign(true)}
                disabled={!employeeId}
                className="btn-primary flex items-center gap-2 px-5 text-sm"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14 M5 12h14" />
                </svg>
                Assign Schedule
              </button>
            )}
          </>
        }
      />

      <section aria-label="Maintenance totals" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Requests waiting for approval', value: String(requests.length) },
          { label: 'Work orders in progress', value: String(workOrders.filter((o) => o.work_order_status === 'In Progress').length) },
          { label: 'Trucks not operational', value: String(trucksDown), bad: trucksDown > 0 },
          { label: 'Parts cost, this month', value: partsCost === null ? '—' : formatMoney(partsCost) },
        ].map((tile) => (
          <div key={tile.label} className="card px-[18px] py-3">
            <p className="text-sm font-medium text-ink-secondary">{tile.label}</p>
            <p className={`text-[26px] leading-[34px] font-bold tracking-[-0.01em] tabular-nums ${tile.bad ? 'text-red-700' : 'text-ink'}`}>
              {loading ? '…' : tile.value}
            </p>
          </div>
        ))}
      </section>

      {actionError && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}
      {loading && <p className="text-ink-muted">Loading maintenance data...</p>}
      {error && <p className="text-red-700">{error}</p>}

      {!loading && !error && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="tablist" aria-label="Maintenance views" className="flex flex-wrap gap-2">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex h-11 items-center gap-2.5 rounded-[2px] border px-5 text-sm font-semibold ${
                      activeTab === tab ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
                    }`}
                  >
                    {tab}
                    <span
                      className={`rounded-[2px] px-1.5 text-xs tabular-nums ${activeTab === tab ? 'bg-white/20 text-white' : 'bg-slate-200 text-ink-secondary'}`}
                    >
                      {counts[tab]}
                    </span>
                  </button>
                ))}
              </div>
              {activeTab === 'Work Orders' && (
                <label className={FILTER_LABEL}>
                  Show
                  <select value={showClosed ? 'closed' : 'open'} onChange={(e) => setShowClosed(e.target.value === 'closed')} className={`${FILTER_CONTROL} w-56`}>
                    <option value="open">Open work orders</option>
                    <option value="closed">Completed & cancelled</option>
                  </select>
                </label>
              )}
            </div>

            <section aria-label={activeTab} className="card flex min-h-[calc(100dvh-24rem)] flex-col">
              <div className="flex-1 overflow-x-auto">
                {activeTab === 'Requests' &&
                  (requests.length === 0 ? (
                    <EmptyState message="No pending maintenance requests." hint="Drivers and mechanics send these from their portal." className="m-5" />
                  ) : (
                    <table className="w-full min-w-[760px] text-left text-sm text-ink-metric">
                      <thead>
                        <tr>
                          <th className={TH}>Request</th>
                          <th className={TH}>Vehicle</th>
                          <th className={TH}>Issue</th>
                          <th className={TH}>Requested By</th>
                          <th className={TH}>Reported</th>
                          <th className={TH}>Status</th>
                          <th className={TH}>
                            <span className="sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRequests.rows.map((r) => (
                          <tr key={r.request_id} onClick={() => pick('Requests', r.request_id)} className={rowClass(paneRequest?.request_id === r.request_id)}>
                            <td className={`${TD} font-semibold text-ink tabular-nums`}>#{r.request_id}</td>
                            <td className={TD}>{shortVehicle(r.vehicle_label)}</td>
                            <td className={`${TD} max-w-[260px]`}>
                              <span className="block font-medium text-ink">{r.maintenance_type}</span>
                              <span className="block truncate text-[13px] text-ink-muted" title={r.description}>
                                {r.description}
                              </span>
                            </td>
                            <td className={TD}>{r.requested_by_name}</td>
                            <td className={TD}>{formatDate(r.created_at)}</td>
                            <td className={TD}>
                              <StatusBadge status="Pending" icon />
                            </td>
                            <OpenCell label={`request #${r.request_id}`} onOpen={() => pick('Requests', r.request_id)} />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}

                {activeTab === 'Work Orders' &&
                  (shownOrders.length === 0 ? (
                    <EmptyState message={showClosed ? 'No completed or cancelled work orders yet.' : 'No open work orders.'} className="m-5" />
                  ) : (
                    <table className="w-full min-w-[760px] text-left text-sm text-ink-metric">
                      <thead>
                        <tr>
                          <th className={TH}>Work Order</th>
                          <th className={TH}>Vehicle</th>
                          <th className={TH}>Service</th>
                          <th className={TH}>Mechanic</th>
                          <th className={TH}>Scheduled</th>
                          <th className={TH}>Status</th>
                          <th className={TH}>
                            <span className="sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedOrders.rows.map((o) => (
                          <tr key={o.work_order_id} onClick={() => pick('Work Orders', o.work_order_id)} className={rowClass(paneOrder?.work_order_id === o.work_order_id)}>
                            <td className={`${TD} font-semibold text-ink`}>{o.work_order_number}</td>
                            <td className={TD}>{shortVehicle(o.vehicle_label)}</td>
                            <td className={`${TD} max-w-[260px]`}>
                              <span className="block font-medium text-ink">{o.maintenance_type}</span>
                              {o.work_description && (
                                <span className="block truncate text-[13px] text-ink-muted" title={o.work_description}>
                                  {o.work_description}
                                </span>
                              )}
                            </td>
                            <td className={`${TD} ${o.assigned_mechanic_id ? '' : 'text-ink-muted'}`}>
                              {o.assigned_mechanic_id ? o.mechanic_name : 'On the Task Board'}
                            </td>
                            <td className={TD}>{o.scheduled_start_date ? formatDate(o.scheduled_start_date) : '—'}</td>
                            <td className={TD}>
                              <StatusBadge status={o.work_order_status} icon />
                            </td>
                            <OpenCell label={o.work_order_number} onOpen={() => pick('Work Orders', o.work_order_id)} />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}

                {activeTab === 'Schedules' &&
                  (schedules.length === 0 ? (
                    <EmptyState message="No upcoming maintenance schedules." hint='Use "Assign Schedule" to add one.' className="m-5" />
                  ) : (
                    <table className="w-full min-w-[760px] text-left text-sm text-ink-metric">
                      <thead>
                        <tr>
                          <th className={TH}>Vehicle</th>
                          <th className={TH}>Maintenance Type</th>
                          <th className={TH}>Notes</th>
                          <th className={TH}>Flagged By</th>
                          <th className={TH}>Next Due</th>
                          <th className={TH}>Status</th>
                          <th className={TH}>
                            <span className="sr-only">Open</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedSchedules.rows.map((s) => {
                          const due = formatScheduleDueDate(s.due_date)
                          return (
                            <tr key={s.schedule_id} onClick={() => pick('Schedules', s.schedule_id)} className={rowClass(paneSchedule?.schedule_id === s.schedule_id)}>
                              <td className={`${TD} font-semibold text-ink`}>{shortVehicle(s.vehicle_label)}</td>
                              <td className={TD}>{s.maintenance_type}</td>
                              <td className={`${TD} max-w-[220px] truncate ${s.notes ? '' : 'text-ink-muted'}`} title={s.notes ?? undefined}>
                                {s.notes || '—'}
                              </td>
                              <td className={TD}>{s.reported_by_name}</td>
                              <td className={TD}>{formatDate(s.due_date)}</td>
                              <td className={TD}>
                                <span className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${SCHEDULE_TONE_STYLES[due.tone]}`}>
                                  {due.label}
                                </span>
                              </td>
                              <OpenCell label={`${s.maintenance_type} for ${s.vehicle_label}`} onOpen={() => pick('Schedules', s.schedule_id)} />
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  ))}
              </div>
              <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
                <span>
                  {activeTab === 'Requests'
                    ? 'Requests from drivers and mechanics · approving one creates a work order'
                    : activeTab === 'Work Orders'
                      ? 'Completing a work order sets the vehicle back to Available'
                      : 'Mark a schedule done once the maintenance happens'}
                </span>
                {pager.pageCount > 1 && (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => pager.onChange(pager.page - 1)} disabled={pager.page === 0} className="btn-secondary px-3.5 text-sm font-medium">
                      ‹ Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => pager.onChange(pager.page + 1)}
                      disabled={pager.page >= pager.pageCount - 1}
                      className="btn-secondary px-3.5 text-sm font-medium"
                    >
                      Next ›
                    </button>
                  </span>
                )}
              </div>
            </section>
          </div>

          {/* Side panel for the selected row. */}
          {activeTab === 'Requests' && paneRequest && (
            <aside aria-labelledby="mp-title" className="card flex flex-col xl:sticky xl:top-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
                <h2 id="mp-title" className="text-lg leading-[26px] font-bold text-ink">
                  Evaluate Request #{paneRequest.request_id}
                </h2>
                <StatusBadge status="Pending" icon />
              </div>
              <div className="px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                  <Field label="Vehicle">{paneRequest.vehicle_label}</Field>
                  <Field label="Requested by">{paneRequest.requested_by_name}</Field>
                  <Field label="Type">{paneRequest.maintenance_type}</Field>
                  <Field label="Reported">{formatDateTime(paneRequest.created_at)}</Field>
                  <Field label="Issue" wide>
                    <span className="whitespace-pre-line">{paneRequest.description}</span>
                  </Field>
                </dl>
                <p className="mt-4 text-[13px] text-ink-muted">
                  Approving creates an unassigned work order (it goes on the mechanics' Task Board) and sets the vehicle Under
                  Maintenance. Rejecting asks for a reason.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
                {canDecide ? (
                  <>
                    <button type="button" onClick={() => void handleReject(paneRequest)} disabled={busyId === paneRequest.request_id} className="btn-danger px-4 text-sm">
                      Reject…
                    </button>
                    <span className="flex-1" />
                    <button type="button" onClick={() => void handleApprove(paneRequest)} disabled={busyId === paneRequest.request_id} className="btn-primary px-5 text-sm">
                      {busyId === paneRequest.request_id ? 'Saving...' : 'Approve'}
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">Only Admin can approve or reject maintenance requests.</p>
                )}
              </div>
            </aside>
          )}

          {activeTab === 'Work Orders' && paneOrder && (
            <aside aria-labelledby="mp-title" className="card flex flex-col xl:sticky xl:top-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
                <h2 id="mp-title" className="text-lg leading-[26px] font-bold text-ink">
                  Work Order {paneOrder.work_order_number}
                </h2>
                <StatusBadge status={paneOrder.work_order_status} icon />
              </div>
              <div className="flex flex-col gap-[18px] px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                  <Field label="Vehicle">{paneOrder.vehicle_label}</Field>
                  <Field label="Mechanic">{paneOrder.assigned_mechanic_id ? paneOrder.mechanic_name : 'Not assigned (Task Board)'}</Field>
                  <Field label="Type">{paneOrder.maintenance_type}</Field>
                  <Field label="Scheduled">{paneOrder.scheduled_start_date ? formatDate(paneOrder.scheduled_start_date) : null}</Field>
                  <Field label="Work to do" wide>
                    {paneOrder.work_description && <span className="whitespace-pre-line">{paneOrder.work_description}</span>}
                  </Field>
                </dl>
                <section>
                  <h3 className={GROUP}>Mechanics</h3>
                  {mechanics.length === 0 ? (
                    <p className="text-sm text-ink-muted">No mechanics found. Add one under Employees.</p>
                  ) : (
                    mechanics.map((m) => (
                      <div key={m.employee_id} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm last:border-0">
                        <span className="text-ink-secondary">{m.full_name}</span>
                        <span className="font-semibold tabular-nums">{m.active_work_orders} open</span>
                      </div>
                    ))
                  )}
                </section>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
                <p className="flex-1 text-[13px] text-ink-muted">Notes, parts used, reassign, status and Complete are inside.</p>
                <button type="button" onClick={() => setOpenOrderId(paneOrder.work_order_id)} className="btn-primary px-5 text-sm">
                  Open Work Order
                </button>
              </div>
            </aside>
          )}

          {activeTab === 'Schedules' && paneSchedule && (
            <aside aria-labelledby="mp-title" className="card flex flex-col xl:sticky xl:top-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
                <h2 id="mp-title" className="text-lg leading-[26px] font-bold text-ink">
                  {paneSchedule.maintenance_type}
                </h2>
                <span className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold ${SCHEDULE_TONE_STYLES[formatScheduleDueDate(paneSchedule.due_date).tone]}`}>
                  {formatScheduleDueDate(paneSchedule.due_date).label}
                </span>
              </div>
              <div className="px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
                  <Field label="Vehicle">{paneSchedule.vehicle_label}</Field>
                  <Field label="Next due">{formatDate(paneSchedule.due_date)}</Field>
                  <Field label="Flagged by">{paneSchedule.reported_by_name}</Field>
                  <Field label="Added">{formatDate(paneSchedule.created_at)}</Field>
                  <Field label="Notes" wide>
                    {paneSchedule.notes && <span className="whitespace-pre-line">{paneSchedule.notes}</span>}
                  </Field>
                </dl>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => void handleMarkDone(paneSchedule)}
                  disabled={busyId === paneSchedule.schedule_id}
                  className="btn-primary px-5 text-sm"
                >
                  {busyId === paneSchedule.schedule_id ? 'Saving...' : 'Mark Done'}
                </button>
              </div>
            </aside>
          )}
        </div>
      )}

      {showCostReport && <MaintenanceCostReportModal onClose={() => setShowCostReport(false)} />}

      {openOrder && (
        <WorkOrderDetailModal
          key={openOrder.work_order_id}
          order={openOrder}
          mechanics={mechanics}
          onClose={() => setOpenOrderId(null)}
          onChanged={loadData}
        />
      )}

      {showCreate && (
        <CreateWorkOrderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            void loadData()
          }}
        />
      )}

      {showAssign && employeeId && (
        <AssignScheduleModal
          employeeId={employeeId}
          onClose={() => setShowAssign(false)}
          onSaved={() => {
            setShowAssign(false)
            showToast('Schedule assigned.')
            void loadData()
          }}
        />
      )}
    </div>
  )
}

export default MaintenanceSection
