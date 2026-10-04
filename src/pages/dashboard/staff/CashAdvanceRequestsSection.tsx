// CashAdvanceRequestsSection: pending cash-advance requests submitted
// by employees (employee/RequestCashAdvanceModal.tsx), with Approve/
// Reject actions. Separate from IssueCashAdvanceModal's direct-issue
// path -- that keeps working exactly as it does now for advances staff
// give proactively, without a request.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPendingCashAdvanceRequests,
  decideCashAdvanceRequest,
  type PendingCashAdvanceRequest,
} from '../../../lib/cashAdvanceRequests'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function CashAdvanceRequestsSection() {
  const { employeeId } = useAuth()
  const [requests, setRequests] = useState<PendingCashAdvanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { requests: loaded, error: loadError } = await loadPendingCashAdvanceRequests()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRequests(loaded)
    setError(null)
    setLoading(false)
  }

  async function handleDecide(request: PendingCashAdvanceRequest, approve: boolean) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as approved/rejected by you. Contact an admin.',
      )
      return
    }

    let rejectionReason: string | undefined
    if (!approve) {
      const input = window.prompt(
        `Reason for rejecting ${request.employee_name}'s request?`,
      )
      if (input === null) return
      if (!input.trim()) {
        setActionError('Enter a reason for rejecting this request.')
        return
      }
      rejectionReason = input.trim()
    }

    setDecidingId(request.cash_advance_id)
    setActionError(null)

    const { error: decideError, alreadyDecided } = await decideCashAdvanceRequest({
      cashAdvanceId: request.cash_advance_id,
      approve,
      approvedByEmployeeId: employeeId,
      rejectionReason,
    })

    setDecidingId(null)

    if (decideError) {
      setActionError(decideError)
      return
    }

    if (alreadyDecided) {
      setActionError(
        `${request.employee_name}'s request was already decided by someone else.`,
      )
    }

    setRequests((prev) =>
      prev.filter((r) => r.cash_advance_id !== request.cash_advance_id),
    )
  }

  if (loading) {
    return <p className="text-slate-500">Loading pending requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-700">
        Cash Advance Requests
      </h3>

      {actionError && (
        <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {requests.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No pending requests.</p>
      ) : (
        <div className="mt-3 grid gap-3">
          {requests.map((request) => (
            <div
              key={request.cash_advance_id}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  {request.employee_name} — ₱{request.amount.toLocaleString()}
                </p>
                <span className="text-xs text-slate-500">
                  Requested {formatDate(request.created_at)}
                </span>
              </div>
              {request.note && (
                <p className="mt-1 text-sm text-slate-600">{request.note}</p>
              )}
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => handleDecide(request, true)}
                  disabled={decidingId === request.cash_advance_id}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {decidingId === request.cash_advance_id ? 'Saving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleDecide(request, false)}
                  disabled={decidingId === request.cash_advance_id}
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

export default CashAdvanceRequestsSection
