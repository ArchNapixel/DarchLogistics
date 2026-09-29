// StatusRelogRequestsSection: pending "move this status backward"
// requests from Dispatchers (itinerary status) and Mechanics (work
// order status) -- see RequestStatusRelogModal.tsx. Admin-only:
// Approve actually applies the status change and logs it; Reject just
// closes the request out with a reason.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPendingRelogRequests,
  approveStatusRelogRequest,
  rejectStatusRelogRequest,
  type PendingRelogRequest,
} from '../../../lib/statusRelogRequests'
import { promptDialog } from '../../../components/ConfirmDialog'

function StatusRelogRequestsSection({ onChanged }: { onChanged?: () => void }) {
  const { employeeId } = useAuth()
  const [requests, setRequests] = useState<PendingRelogRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { requests: loaded, error: loadError } = await loadPendingRelogRequests()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRequests(loaded)
    setError(null)
    setLoading(false)
  }

  async function handleApprove(request: PendingRelogRequest) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as approved by you. Contact an admin.',
      )
      return
    }

    setBusyId(request.request_id)
    setActionError(null)

    const { error: approveError } = await approveStatusRelogRequest({
      request,
      resolvedByEmployeeId: employeeId,
    })

    setBusyId(null)

    if (approveError) {
      setActionError(approveError)
      return
    }

    setRequests((prev) => prev.filter((r) => r.request_id !== request.request_id))
    onChanged?.()
  }

  async function handleReject(request: PendingRelogRequest) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as rejected by you. Contact an admin.',
      )
      return
    }

    const note = await promptDialog({
      title: 'Reject request',
      message: `Why is the request for ${request.target_label} being rejected?`,
      confirmLabel: 'Reject',
      danger: true,
    })
    if (note === null) return

    setBusyId(request.request_id)
    setActionError(null)

    const { error: rejectError } = await rejectStatusRelogRequest({
      requestId: request.request_id,
      resolvedByEmployeeId: employeeId,
      resolutionNote: note.trim(),
    })

    setBusyId(null)

    if (rejectError) {
      setActionError(rejectError)
      return
    }

    setRequests((prev) => prev.filter((r) => r.request_id !== request.request_id))
    onChanged?.()
  }

  if (loading) {
    return <p className="text-slate-500">Loading status relog requests...</p>
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
        <p className="text-slate-500">No pending status relog requests.</p>
      ) : (
        <div className="grid gap-3">
          {requests.map((request) => (
            <div
              key={request.request_id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{request.target_label}</p>
                <span className="text-xs text-slate-500">
                  {new Date(request.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {request.current_status} → {request.requested_status}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Requested by {request.requested_by_name}
              </p>
              <p className="mt-2 text-sm text-slate-700">{request.reason}</p>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => handleApprove(request)}
                  disabled={busyId === request.request_id}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {busyId === request.request_id ? 'Saving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleReject(request)}
                  disabled={busyId === request.request_id}
                  className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default StatusRelogRequestsSection
