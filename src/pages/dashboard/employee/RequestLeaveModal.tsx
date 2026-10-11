// RequestLeaveModal: an employee (any role) filing a leave request --
// dates, type, reason. Inserts a 'Pending' leave_requests row; Admin
// approves/rejects it in staff/LeaveRequestsSection.tsx.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { LEAVE_TYPES, submitLeaveRequest, type LeaveType } from '../../../lib/leaveRequests'
import { toManilaDate } from '../../../lib/payslip'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'

function RequestLeaveModal({
  onClose,
  onRequested,
}: {
  onClose: () => void
  onRequested: () => void
}) {
  const { employeeId } = useAuth()
  const today = toManilaDate(new Date())
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('Vacation')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!employeeId) {
      setError('Could not determine your employee record. Contact an admin.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: requestError } = await submitLeaveRequest({
      employeeId,
      startDate,
      endDate,
      leaveType,
      reason: reason.trim(),
      today,
    })

    setSubmitting(false)

    if (requestError) {
      setError(requestError)
      return
    }
    onRequested()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Request Leave</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Start date
              <input
                type="date"
                min={today}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  // Keep the end date from falling before the new start.
                  if (endDate && e.target.value > endDate) setEndDate(e.target.value)
                }}
                className={fieldClasses}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              End date
              <input
                type="date"
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={fieldClasses}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Type
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className={fieldClasses}>
              {LEAVE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Reason (optional)
            <textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} rows={3} className={fieldClasses} />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RequestLeaveModal
