// RequestCashAdvanceModal: an employee (Driver/Mechanic/Helper) asking
// for a cash advance. Inserts into cash_advances with status 'Pending'
// -- staff then Approve/Reject it from the staff-side "Pending
// Requests" view (staff/CashAdvanceRequestsSection.tsx). Doesn't touch
// or resemble the admin's direct-issue flow (IssueCashAdvanceModal.tsx),
// which still creates an already-approved row with no request step.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { requestCashAdvance } from '../../../lib/cashAdvanceRequests'

function RequestCashAdvanceModal({
  onClose,
  onRequested,
}: {
  onClose: () => void
  onRequested: () => void
}) {
  const { employeeId } = useAuth()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const amountValue = Number(amount)

    if (!amount || Number.isNaN(amountValue) || amountValue <= 0) {
      setError('Enter a valid amount.')
      return
    }
    if (!reason.trim()) {
      setError('Enter a reason for this request.')
      return
    }
    if (!employeeId) {
      setError('Could not determine your employee record. Contact an admin.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: requestError } = await requestCashAdvance({
      employeeId,
      amount: amountValue,
      reason: reason.trim(),
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
          <h3 className="text-lg font-bold text-slate-900">Request Cash Advance</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Amount
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
            />
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

export default RequestCashAdvanceModal
