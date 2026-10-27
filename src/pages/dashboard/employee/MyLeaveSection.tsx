// MyLeaveSection ("My Leave" page, /dashboard/leave, the canvas's Driver
// Leave board): the logged-in employee's leave requests in a table, and a
// "Request Leave" form beside it (dates, type, reason). Shown to Driver,
// Mechanic, Helper and Dispatcher. Drivers are paid per trip, so they get
// no paid-day balance -- just their requests (approved days grey them out
// in the Dispatch Board's driver list). Everyone else sees this year's paid
// leave balance. Admin approves / rejects on the Attendance page.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  ANNUAL_PAID_LEAVE_DAYS,
  LEAVE_TYPES,
  getLeaveDaysUsed,
  loadLeaveForEmployee,
  submitLeaveRequest,
  type LeaveRequest,
  type LeaveType,
} from '../../../lib/leaveRequests'
import { toManilaDate } from '../../../lib/payslip'
import { usePaged } from '../../../lib/usePaged'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { showToast } from '../../../components/Toast'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric focus:border-primary'
const labelClasses = 'text-sm font-semibold text-ink'
const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'

// Calendar days in a request, both ends counted.
const daysIn = (start: string, end: string) =>
  Math.round((new Date(`${end}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime()) / 86_400_000) + 1

function MyLeaveSection() {
  const { employeeId, role } = useAuth()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [used, setUsed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The Request Leave form.
  const today = toManilaDate(new Date())
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [leaveType, setLeaveType] = useState<LeaveType>('Vacation')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const year = Number(today.slice(0, 4))
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

  // Load when this opens (and when the year / login changes). The 0 ms timer
  // keeps load()'s state updates out of the effect's own run (React's
  // set-state-in-effect rule). No employee = the page says so below.
  useEffect(() => {
    if (!employeeId) return
    const timer = setTimeout(() => void load(employeeId), 0)
    return () => clearTimeout(timer)
  }, [employeeId, load])

  const paged = usePaged(requests, '')

  if (!employeeId) {
    return <p className="text-ink-muted">Your account has no linked employee record, so you can't file leave.</p>
  }

  function clearForm() {
    setStartDate('')
    setEndDate('')
    setLeaveType('Vacation')
    setReason('')
    setFormError(null)
  }

  async function handleSubmit() {
    setSubmitting(true)
    setFormError(null)
    const { error: requestError } = await submitLeaveRequest({
      employeeId: employeeId!,
      startDate,
      endDate,
      leaveType,
      reason: reason.trim(),
      today,
    })
    setSubmitting(false)
    if (requestError) {
      setFormError(requestError)
      return
    }
    clearForm()
    showToast('Your leave request was submitted.')
    void load(employeeId!)
  }

  return (
    <div>
      <PageHeader
        title="My Leave"
        subtitle={
          isDriver
            ? 'Your leave requests. Admin approves or rejects them.'
            : 'Your paid-leave balance and requests. Admin approves or rejects them.'
        }
      />

      {isDriver ? (
        <section
          aria-label="About leave"
          className="mb-4 flex items-start gap-2.5 border border-line-control bg-white px-4 py-3 text-sm text-ink-secondary"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-primary" aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8h.01 M11 12h1v5h1" />
          </svg>
          <span>
            <strong className="text-ink">Drivers have no leave balance.</strong> Leave is kept as a record. On approved days you
            are greyed out in the Dispatch Board's driver list, so no trips are assigned to you.
          </span>
        </section>
      ) : (
        // Paid leave balance for the year (Sundays don't count; days past the
        // balance are approved as unpaid leave).
        <section aria-label={`Leave balance for ${year}`} className="mb-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Paid leave per year', value: ANNUAL_PAID_LEAVE_DAYS },
            { label: `Used in ${year}`, value: used },
            { label: 'Remaining', note: `${ANNUAL_PAID_LEAVE_DAYS} − used`, value: Math.max(0, ANNUAL_PAID_LEAVE_DAYS - used) },
          ].map((tile) => (
            <div key={tile.label} className="card px-[18px] py-3.5">
              <p className="text-sm font-medium text-ink-secondary">
                {tile.label}
                {tile.note && <span className="font-normal text-ink-muted"> · {tile.note}</span>}
              </p>
              <p className="text-[28px] leading-9 font-bold tracking-[-0.01em] text-ink tabular-nums">
                {loading ? '…' : `${tile.value} ${tile.value === 1 ? 'day' : 'days'}`}
              </p>
            </div>
          ))}
        </section>
      )}

      {error && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <section aria-label="My leave requests" className="card flex min-h-[calc(100dvh-19rem)] flex-col">
          <div className="flex-1 overflow-x-auto">
            {loading ? (
              <p className="p-5 text-ink-muted">Loading your requests...</p>
            ) : requests.length === 0 ? (
              <EmptyState message="No leave requests yet." hint="Use the form to request time off." className="m-5" />
            ) : (
              <table className="w-full min-w-[720px] text-left text-sm text-ink-metric">
                <thead>
                  <tr>
                    <th className={TH}>Dates</th>
                    <th className={TH}>Type</th>
                    <th className={`${TH} text-right`}>Days</th>
                    <th className={TH}>Reason / Admin Note</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((request) => (
                    <tr key={request.leave_id} className="h-[60px] border-b border-slate-200">
                      <td className={`${TD} font-semibold text-ink`}>
                        {formatDate(request.start_date)}
                        {request.end_date !== request.start_date && ` – ${formatDate(request.end_date)}`}
                      </td>
                      <td className={TD}>{request.leave_type}</td>
                      <td className={`${TD} text-right tabular-nums`}>{daysIn(request.start_date, request.end_date)}</td>
                      <td className={TD}>
                        {request.reason ?? <span className="text-ink-muted">—</span>}
                        {request.status === 'Rejected' && request.rejection_reason && (
                          <span className="block text-[13px] text-red-700">Admin: {request.rejection_reason}</span>
                        )}
                      </td>
                      <td className={TD}>
                        <StatusBadge status={request.status} icon />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
            <span>
              {isDriver
                ? "Dispatch can't assign you trips on approved leave days."
                : 'Approved days show as Leave on your attendance, paid up to your balance.'}
            </span>
            {paged.pager.pageCount > 1 && (
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                  disabled={paged.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                  disabled={paged.pager.page >= paged.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            )}
          </div>
        </section>

        <aside aria-labelledby="request-leave-h" className="card flex flex-col">
          <h2 id="request-leave-h" className="border-b border-line px-5 py-4 text-lg font-bold text-ink">
            Request Leave
          </h2>
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit()
            }}
          >
            {formError && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={labelClasses}>From</span>
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
              <label className="flex flex-col gap-1.5">
                <span className={labelClasses}>To</span>
                <input
                  type="date"
                  min={startDate || today}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={fieldClasses}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>Type</span>
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className={fieldClasses}>
                {LEAVE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClasses}>
                Reason <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <textarea
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className={`${fieldClasses} resize-none py-2.5`}
              />
            </label>
          </form>
          <div className="flex justify-end gap-3 border-t border-line px-5 py-4">
            <button type="button" onClick={clearForm} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
              Clear
            </button>
            <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary px-6 text-sm">
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default MyLeaveSection
