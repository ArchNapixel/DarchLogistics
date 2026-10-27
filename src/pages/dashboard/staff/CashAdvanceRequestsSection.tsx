// CashAdvanceRequestsSection: pending cash-advance requests submitted
// by employees (employee/RequestCashAdvanceForm.tsx), with Approve/
// Reject actions. Separate from IssueCashAdvanceModal's direct-issue
// path -- that keeps working exactly as it does now for advances staff
// give proactively, without a request.
import { useEffect, useEffectEvent, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPendingCashAdvanceRequests,
  decideCashAdvanceRequest,
  type PendingCashAdvanceRequest,
} from '../../../lib/cashAdvanceRequests'
import { promptDialog } from '../../../components/ConfirmDialog'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'


function CashAdvanceRequestsSection() {
  const { employeeId } = useAuth()
  const [requests, setRequests] = useState<PendingCashAdvanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<number | null>(null)

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

  // Load once, when this opens.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

  async function handleDecide(request: PendingCashAdvanceRequest, approve: boolean) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as approved/rejected by you. Contact an admin.',
      )
      return
    }

    let rejectionReason: string | undefined
    if (!approve) {
      // promptDialog keeps its Reject button disabled until a reason is typed.
      const input = await promptDialog({
        title: 'Reject cash advance request',
        message: `Why is ${request.employee_name}'s request being rejected?`,
        confirmLabel: 'Reject',
        danger: true,
      })
      if (input === null) return
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

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(requests, '', 5)
  if (loading) {
    return <p className="text-slate-500">Loading pending requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div className="border-2 border-line-card bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-700">
        Cash Advance Requests
      </h3>

      {actionError && (
        <p className="mt-3 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {requests.length === 0 ? (
        <EmptyState message="No pending requests." className="mt-3" />
      ) : (
        <div className="mt-3 grid gap-3">
          {paged.rows.map((request) => (
            <div
              key={request.cash_advance_id}
              className="border border-line p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  {request.employee_name} — {formatMoney(request.amount)}
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
                  className="btn-primary px-3 py-1.5 text-sm font-medium"
                >
                  {decidingId === request.cash_advance_id ? 'Saving...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleDecide(request, false)}
                  disabled={decidingId === request.cash_advance_id}
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

export default CashAdvanceRequestsSection
