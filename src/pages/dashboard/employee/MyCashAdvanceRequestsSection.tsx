// MyCashAdvanceRequestsSection: "Request Cash Advance" button + the
// employee's own request history (Driver/Mechanic/Helper -- mounted
// only from MyPayslipPage.tsx, not the Dispatcher's payslip page).
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadCashAdvanceRequestsForEmployee,
  type CashAdvanceRequest,
} from '../../../lib/cashAdvanceRequests'
import {
  getOutstandingCashAdvance,
  loadCashAdvanceDeductionRate,
  DEFAULT_CASH_ADVANCE_DEDUCTION_RATE,
} from '../../../lib/payslip'
import RequestCashAdvanceModal from './RequestCashAdvanceModal'
import StatusBadge from '../../../components/StatusBadge'
import { showToast } from '../../../components/Toast'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'


function MyCashAdvanceRequestsSection() {
  const { employeeId } = useAuth()
  const [requests, setRequests] = useState<CashAdvanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRequestModal, setShowRequestModal] = useState(false)
  // What the employee still owes (counts finalized payslips only -- they
  // can't see drafts).
  const [owed, setOwed] = useState(0)
  const [rate, setRate] = useState(DEFAULT_CASH_ADVANCE_DEDUCTION_RATE)

  useEffect(() => {
    if (employeeId) {
      load(employeeId)
    } else {
      setLoading(false)
    }
  }, [employeeId])

  async function load(id: number) {
    setLoading(true)
    const { requests: loaded, error: loadError } =
      await loadCashAdvanceRequestsForEmployee(id)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRequests(loaded)
    setOwed((await getOutstandingCashAdvance(id)).outstanding)
    setRate(await loadCashAdvanceDeductionRate())
    setError(null)
    setLoading(false)
  }

  return (
    <div>
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowRequestModal(true)}
          className="btn-primary px-4 py-2 text-sm font-medium"
        >
          Request Cash Advance
        </button>
      </div>

      {owed > 0 && (
        <p className="mt-4 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          You still owe <span className="font-semibold text-primary">{formatMoney(owed)}</span>. {rate}% of your gross pay is deducted from each weekly payslip until it's paid off.
        </p>
      )}


      {loading && <p className="mt-4 text-slate-500">Loading your requests...</p>}
      {!loading && error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && requests.length === 0 && (
        <EmptyState message="No cash advance requests yet." className="mt-4" />
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="mt-4 grid gap-3">
          {requests.map((request) => (
            <div
              key={request.cash_advance_id}
              className="border border-slate-200 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  {formatMoney(request.amount)}
                </p>
                <StatusBadge status={request.status} />
              </div>
              {request.note && (
                <p className="mt-1 text-sm text-slate-600">{request.note}</p>
              )}
              <p className="mt-1 text-sm text-slate-500">
                Requested {formatDate(request.created_at)}
              </p>
              {request.status === 'Rejected' && request.rejection_reason && (
                <p className="mt-2 text-sm text-red-700">
                  Reason: {request.rejection_reason}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {showRequestModal && (
        <RequestCashAdvanceModal
          onClose={() => setShowRequestModal(false)}
          onRequested={() => {
            setShowRequestModal(false)
            showToast('Your cash advance request was submitted.')
            if (employeeId) load(employeeId)
          }}
        />
      )}
    </div>
  )
}

export default MyCashAdvanceRequestsSection
