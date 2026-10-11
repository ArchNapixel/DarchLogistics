// LeaveRequestsSection: pending leave requests from employees
// (employee/RequestLeaveModal.tsx) with Approve/Reject, shown on the
// Attendance page (Admin only). Approving a non-driver's request marks
// those days as Leave in the attendance sheet; if the person is already
// crewed on a trip in those dates, Admin gets a warning to reassign it.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { promptDialog } from '../../../components/ConfirmDialog'
import {
  decideLeaveRequest,
  leaveDayCount,
  loadPendingLeaveRequests,
  loadTripConflicts,
  type PendingLeaveRequest,
} from '../../../lib/leaveRequests'
import { formatDate } from '../../../lib/quoteRequest'

function LeaveRequestsSection({ onDecided }: { onDecided?: () => void }) {
  const { employeeId } = useAuth()
  const [requests, setRequests] = useState<PendingLeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<number | null>(null)

  async function load() {
    const { requests: loaded, error: loadError } = await loadPendingLeaveRequests()
    setRequests(loaded)
    setError(loadError)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleDecide(request: PendingLeaveRequest, approve: boolean) {
    if (!employeeId) {
      setActionError('Your account has no linked employee record, so this cannot be recorded under your name. Contact an admin.')
      return
    }

    let rejectionReason: string | undefined
    if (!approve) {
      const input = await promptDialog({
        message: `Reason for rejecting ${request.employee_name}'s leave?`,
        confirmLabel: 'Reject',
        danger: true,
      })
      if (input === null) return
      rejectionReason = input.trim()
    }

    setDecidingId(request.leave_id)
    setActionError(null)
    setNotice(null)

    const { error: decideError, alreadyDecided } = await decideLeaveRequest({
      request,
      approve,
      decidedByEmployeeId: employeeId,
      rejectionReason,
    })

    // Only on approve: warn if they're already on a trip in these dates.
    if (approve && !decideError && !alreadyDecided) {
      const { trips } = await loadTripConflicts(request.employee_id, request.start_date, request.end_date)
      if (trips.length > 0) {
        const list = trips
          .map((t) => `booking #${t.booking_id} (${formatDate(t.trip_date_from)}${t.trip_date_to ? ` – ${formatDate(t.trip_date_to)}` : ''})`)
          .join(', ')
        setNotice(`${request.employee_name} is assigned to ${list} during this leave. Reassign it on the Dispatch Board.`)
      }
    }

    setDecidingId(null)

    if (decideError) setActionError(decideError)
    else if (alreadyDecided) setActionError(`${request.employee_name}'s request was already decided by someone else.`)

    // Approved-but-attendance-failed also leaves the Pending list.
    if (!alreadyDecided) onDecided?.()
    await load()
  }

  if (loading) return <p className="text-slate-500">Loading leave requests...</p>
  if (error) return <p className="text-red-700">{error}</p>

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">Leave Requests</h3>

      {actionError && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}
      {notice && <p className="mt-3 rounded-lg bg-orange-50 px-4 py-3 text-sm text-orange-700">{notice}</p>}

      {requests.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No pending leave requests.</p>
      ) : (
        <div className="mt-3 grid gap-3">
          {requests.map((request) => (
            <div key={request.leave_id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {request.employee_name} — {request.leave_type}
                </p>
                <span className="text-xs text-slate-500">Requested {formatDate(request.created_at.slice(0, 10))}</span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                {formatDate(request.start_date)}
                {request.end_date !== request.start_date && ` – ${formatDate(request.end_date)}`} ·{' '}
                {leaveDayCount(request.start_date, request.end_date)} working day(s)
                {request.is_driver && ' · Driver (paid per trip, attendance not affected)'}
              </p>
              {request.reason && <p className="mt-1 text-sm text-slate-600">{request.reason}</p>}
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => handleDecide(request, true)}
                  disabled={decidingId === request.leave_id}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {decidingId === request.leave_id ? 'Saving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleDecide(request, false)}
                  disabled={decidingId === request.leave_id}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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

export default LeaveRequestsSection
