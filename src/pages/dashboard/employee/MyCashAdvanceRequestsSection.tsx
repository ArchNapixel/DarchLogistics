// MyCashAdvanceRequestsSection: "Request Cash Advance" button + the
// employee's own request history (Driver/Mechanic/Helper -- mounted
// only from MyPayslipPage.tsx, not the Dispatcher's payslip page).
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadCashAdvanceRequestsForEmployee,
  type CashAdvanceRequest,
} from '../../../lib/cashAdvanceRequests'
import RequestCashAdvanceModal from './RequestCashAdvanceModal'

const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-orange-100 text-orange-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
}

function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function MyCashAdvanceRequestsSection() {
  const { employeeId } = useAuth()
  const [requests, setRequests] = useState<CashAdvanceRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

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
    setError(null)
    setLoading(false)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Requesting a cash advance sends it to Admin/Dispatcher for approval.
        </p>
        <button
          onClick={() => setShowRequestModal(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Request Cash Advance
        </button>
      </div>

      {successMessage && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      {loading && <p className="mt-4 text-slate-500">Loading your requests...</p>}
      {!loading && error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && requests.length === 0 && (
        <p className="mt-4 text-slate-500">No cash advance requests yet.</p>
      )}

      {!loading && !error && requests.length > 0 && (
        <div className="mt-4 grid gap-3">
          {requests.map((request) => (
            <div
              key={request.cash_advance_id}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">
                  ₱{request.amount.toLocaleString()}
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
            setSuccessMessage('Your cash advance request was submitted.')
            if (employeeId) load(employeeId)
          }}
        />
      )}
    </div>
  )
}

export default MyCashAdvanceRequestsSection
