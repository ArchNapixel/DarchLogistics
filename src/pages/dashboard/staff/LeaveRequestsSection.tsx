// LeaveRequestsSection: pending leave requests from employees
// (employee/MyLeaveSection.tsx) with Approve/Reject, shown on the
// Attendance page (Admin only). Approving a non-driver's request marks
// those days as Leave in the attendance sheet; if the person is already
// crewed on a trip in those dates, Admin gets a warning to reassign it.
import { useEffect, useEffectEvent, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { useAuth } from '../../../context/AuthContext'
import { confirmDialog, promptDialog } from '../../../components/ConfirmDialog'
import {
  ANNUAL_PAID_LEAVE_DAYS,
  paidLeaveSplit,
  decideLeaveRequest,
  leaveDayCount,
  loadPendingLeaveRequests,
  loadTripConflicts,
  type PendingLeaveRequest,
} from '../../../lib/leaveRequests'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

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

  // Load once, when this opens.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    void load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
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

    // Days past the yearly paid balance become Unpaid Leave -- say so
    // before approving (drivers are paid per trip, so it doesn't apply).
    if (approve && !request.is_driver) {
      const split = await paidLeaveSplit(request)
      if (split.error) {
        setActionError(split.error)
        return
      }
      if (
        split.unpaid > 0 &&
        !(await confirmDialog({
          title: `Approve ${request.employee_name}'s leave?`,
          message:
            `${split.unpaid} of these ${split.paid + split.unpaid} working days go past the ` +
            `${ANNUAL_PAID_LEAVE_DAYS} paid leave days for the year, so they'll be marked Unpaid Leave ` +
            `(not paid)${split.paid > 0 ? `; the other ${split.paid} are paid` : ''}.`,
          confirmLabel: 'Approve',
        }))
      ) {
        return
      }
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

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(requests, '', 5)
  if (loading) return <p className="text-slate-500">Loading leave requests...</p>
  if (error) return <p className="text-red-700">{error}</p>

  return (
    <div className="border-2 border-line-card bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">Leave Requests</h3>

      {actionError && <p className="mt-3 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</p>}
      {notice && <p className="mt-3 bg-orange-50 px-4 py-3 text-sm text-orange-700">{notice}</p>}

      {requests.length === 0 ? (
        <EmptyState message="No pending leave requests." className="mt-3" />
      ) : (
        <div className="mt-3 grid gap-3">
          {paged.rows.map((request) => (
            <div key={request.leave_id} className="border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {request.employee_name} — {request.leave_type}
                </p>
                <span className="text-xs text-slate-500">Requested {formatDate(request.created_at)}</span>
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
                  className="btn-primary px-3 py-1.5 text-sm font-medium"
                >
                  {decidingId === request.leave_id ? 'Saving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleDecide(request, false)}
                  disabled={decidingId === request.leave_id}
                  className="border border-line-control px-3 py-1.5 text-sm font-medium text-ink-metric hover:bg-slate-50 disabled:opacity-50 rounded-[2px]"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Pager {...paged.pager} />
    </div>
  )
}

export default LeaveRequestsSection
