// MyLeaveSection ("My Leave" page, /dashboard/leave): the logged-in
// employee's leave balance and requests, plus the "Request Leave" button.
// Shown to Driver, Mechanic, Helper and Dispatcher. Drivers are paid per
// trip, so they get no paid-day balance -- just their requests.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  ANNUAL_PAID_LEAVE_DAYS,
  getLeaveDaysUsed,
  loadLeaveForEmployee,
  type LeaveRequest,
} from '../../../lib/leaveRequests'
import { toManilaDate } from '../../../lib/payslip'
import RequestLeaveModal from './RequestLeaveModal'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { showToast } from '../../../components/Toast'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function MyLeaveSection() {
  const { employeeId, role } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [used, setUsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const year = Number(toManilaDate(new Date()).slice(0, 4))
  const isDriver = role === 'Driver'

  const load = useCallback(
    async (id: number) => {
      setLoading(true)
      const [list, days] = await Promise.all([loadLeaveForEmployee(id), getLeaveDaysUsed(id, year)])
      setRequests(list.requests)
      setUsed(days.used)
      setError(list.error ?? days.error)
      setLoading(false)
    },
    [year],
  )

  useEffect(() => {
    if (employeeId) void load(employeeId)
    else setLoading(false)
  }, [employeeId, load])

  if (!employeeId) {
    return <p className="text-slate-500">Your account has no linked employee record, so you can't file leave.</p>
  }

  return (
    <div>
      <PageHeader
        title="My Leave"
        subtitle="Request time off and see what's been approved."
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            Request Leave
          </button>
        }
      />

      {!isDriver && (
        <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Paid leave {year}: <span className="font-semibold text-slate-900">{used}</span> of {ANNUAL_PAID_LEAVE_DAYS} days
          used ({Math.max(0, ANNUAL_PAID_LEAVE_DAYS - used)} left). Sundays don't count.
        </p>
      )}

      {error && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-4 text-slate-500">Loading your requests...</p>
      ) : requests.length === 0 ? (
        <EmptyState message="No leave requests yet." className="mt-4" />
      ) : (
        <div className="mt-4 grid gap-3">
          {requests.map((request) => (
            <div key={request.leave_id} className="border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  {formatDate(request.start_date)}
                  {request.end_date !== request.start_date && ` – ${formatDate(request.end_date)}`}
                </p>
                <StatusBadge status={request.status} />
              </div>
              <p className="mt-1 text-sm text-slate-500">{request.leave_type}</p>
              {request.reason && <p className="mt-1 text-sm text-slate-600">{request.reason}</p>}
              {request.status === 'Rejected' && request.rejection_reason && (
                <p className="mt-2 text-sm text-red-700">Reason: {request.rejection_reason}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <RequestLeaveModal
          onClose={() => setShowModal(false)}
          onRequested={() => {
            setShowModal(false)
            showToast('Your leave request was submitted.')
            void load(employeeId)
          }}
        />
      )}
    </div>
  )
}

export default MyLeaveSection
