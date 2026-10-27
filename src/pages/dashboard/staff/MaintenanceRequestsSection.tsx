// MaintenanceRequestsSection: pending "issue maintenance request" tickets
// from Drivers/Mechanics (employee/IssueMaintenanceRequestModal.tsx) --
// unlike MaintenanceSchedulesSection.tsx (a future heads-up, no approval
// needed), these need an explicit Admin decision. Approving creates a
// real, unassigned work order (lands on the Task Board for any mechanic
// to accept). Rejecting asks for a reason, same pattern as other
// request queues in this app (e.g. CashAdvanceRequestsSection.tsx).
// Approve/Reject are Admin-only -- Dispatchers can see this page (it's
// shared with them via the Maintenance/Reports tabs) but can't act here.
import { useEffect, useEffectEvent, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { useAuth } from '../../../context/AuthContext'
import { isAdmin } from '../../../lib/roles'
import {
  loadPendingMaintenanceRequests,
  approveMaintenanceRequest,
  rejectMaintenanceRequest,
  type PendingMaintenanceRequest,
} from '../../../lib/maintenanceRequests'
import { promptDialog } from '../../../components/ConfirmDialog'
import { formatDateTime } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function MaintenanceRequestsSection({ onChanged }: { onChanged?: () => void }) {
  const { role, employeeId } = useAuth()
  const canDecide = isAdmin(role)

  const [requests, setRequests] = useState<PendingMaintenanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    const { requests: loaded, error: loadError } = await loadPendingMaintenanceRequests()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRequests(loaded)
    setError(null)
    setLoading(false)
  }

  // Load once, when this opens.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

  async function handleApprove(request: PendingMaintenanceRequest) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as approved by you. Contact an admin.',
      )
      return
    }

    setDecidingId(request.request_id)
    setActionError(null)

    const { error: approveError } = await approveMaintenanceRequest({
      request,
      resolvedByEmployeeId: employeeId,
    })

    setDecidingId(null)

    if (approveError) {
      setActionError(approveError)
      return
    }

    setRequests((prev) => prev.filter((r) => r.request_id !== request.request_id))
    onChanged?.()
  }

  async function handleReject(request: PendingMaintenanceRequest) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as rejected by you. Contact an admin.',
      )
      return
    }

    const reason = await promptDialog({
      title: 'Reject maintenance request',
      message: `Why is the request for ${request.vehicle_label} being rejected?`,
      confirmLabel: 'Reject',
      danger: true,
    })
    if (reason === null) return

    setDecidingId(request.request_id)
    setActionError(null)

    const { error: rejectError } = await rejectMaintenanceRequest({
      requestId: request.request_id,
      resolvedByEmployeeId: employeeId,
      rejectionReason: reason.trim(),
    })

    setDecidingId(null)

    if (rejectError) {
      setActionError(rejectError)
      return
    }

    setRequests((prev) => prev.filter((r) => r.request_id !== request.request_id))
    onChanged?.()
  }

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(requests, '', 5)
  if (loading) {
    return <p className="text-slate-500">Loading maintenance requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      {actionError && (
        <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {requests.length === 0 ? (
        <EmptyState message="No pending maintenance requests." />
      ) : (
        <div className="grid gap-3">
          {paged.rows.map((request) => (
            <div
              key={request.request_id}
              className="border-2 border-line-card bg-white p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{request.vehicle_label}</p>
                <span className="bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
                  Pending
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Requested by {request.requested_by_name} ·{' '}
                {formatDateTime(request.created_at)}
              </p>
              <p className="mt-2 text-sm text-slate-700">{request.maintenance_type}</p>
              <p className="mt-1 text-sm text-slate-500">{request.description}</p>

              {canDecide ? (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleApprove(request)}
                    disabled={decidingId === request.request_id}
                    className="btn-primary px-3 py-1.5 text-sm font-medium"
                  >
                    {decidingId === request.request_id ? 'Saving...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleReject(request)}
                    disabled={decidingId === request.request_id}
                    className="border border-line-control px-3 py-1.5 text-sm font-medium text-ink-metric hover:bg-slate-100 disabled:opacity-50 rounded-[2px]"
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-400">
                  Only Admin can approve or reject maintenance requests.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <Pager {...paged.pager} />
    </div>
  )
}

export default MaintenanceRequestsSection
