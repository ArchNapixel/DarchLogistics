// MaintenanceRequestsSection: pending "issue maintenance request" tickets
// from Drivers/Mechanics (employee/IssueMaintenanceRequestModal.tsx) --
// unlike MaintenanceSchedulesSection.tsx (a future heads-up, no approval
// needed), these need an explicit Admin decision. Approving creates a
// real, unassigned work order (lands on the Task Board for any mechanic
// to accept). Rejecting asks for a reason, same pattern as other
// request queues in this app (e.g. CashAdvanceRequestsSection.tsx).
// Approve/Reject are Admin-only -- Dispatchers can see this page (it's
// shared with them via the Maintenance/Reports tabs) but can't act here.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { isAdmin } from '../../../lib/roles'
import {
  loadPendingMaintenanceRequests,
  approveMaintenanceRequest,
  rejectMaintenanceRequest,
  type PendingMaintenanceRequest,
} from '../../../lib/maintenanceRequests'

function MaintenanceRequestsSection() {
  const { role, employeeId } = useAuth()
  const canDecide = isAdmin(role)

  const [requests, setRequests] = useState<PendingMaintenanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

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
  }

  async function handleReject(request: PendingMaintenanceRequest) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as rejected by you. Contact an admin.',
      )
      return
    }

    const reason = window.prompt('Reason for rejecting this maintenance request?')
    if (reason === null) return
    if (!reason.trim()) {
      setActionError('A rejection reason is required.')
      return
    }

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
  }

  if (loading) {
    return <p className="text-slate-500">Loading maintenance requests...</p>
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

      {requests.length === 0 ? (
        <p className="text-slate-500">No pending maintenance requests.</p>
      ) : (
        <div className="grid gap-3">
          {requests.map((request) => (
            <div
              key={request.request_id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{request.vehicle_label}</p>
                <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-700">
                  Pending
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Requested by {request.requested_by_name} ·{' '}
                {new Date(request.created_at).toLocaleString()}
              </p>
              <p className="mt-2 text-sm text-slate-700">{request.maintenance_type}</p>
              <p className="mt-1 text-sm text-slate-500">{request.description}</p>

              {canDecide ? (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleApprove(request)}
                    disabled={decidingId === request.request_id}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {decidingId === request.request_id ? 'Saving...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleReject(request)}
                    disabled={decidingId === request.request_id}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
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
    </div>
  )
}

export default MaintenanceRequestsSection
