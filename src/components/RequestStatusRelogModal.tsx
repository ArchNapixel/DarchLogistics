// RequestStatusRelogModal: shared by the Dispatch Board (itinerary
// status) and the Maintenance page (work order status) -- submits a
// status_relog_requests row instead of changing the status directly.
// Admin reviews it from Reports -> Status Relog Requests.
import { useState } from 'react'
import { createStatusRelogRequest, type RelogTargetType } from '../lib/statusRelogRequests'

function RequestStatusRelogModal({
  targetType,
  itineraryId,
  workOrderId,
  currentStatus,
  statusOptions,
  employeeId,
  onClose,
  onRequested,
}: {
  targetType: RelogTargetType
  itineraryId?: number
  workOrderId?: number
  currentStatus: string
  statusOptions: string[]
  employeeId: number
  onClose: () => void
  onRequested: () => void
}) {
  const [requestedStatus, setRequestedStatus] = useState(statusOptions[0] ?? '')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!requestedStatus) {
      setError('Select the status you want instead.')
      return
    }
    if (!reason.trim()) {
      setError('Explain why this needs to change.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: createError } = await createStatusRelogRequest({
      targetType,
      itineraryId,
      workOrderId,
      requestedByEmployeeId: employeeId,
      currentStatus,
      requestedStatus,
      reason: reason.trim(),
    })

    setSubmitting(false)

    if (createError) {
      setError(createError)
      return
    }

    onRequested()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Request Status Correction</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-500">
          Currently <span className="font-medium text-slate-700">{currentStatus}</span>. This
          needs admin approval before it takes effect.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 grid gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Change status to
            <select
              value={requestedStatus}
              onChange={(e) => setRequestedStatus(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="What happened, and why this needs to be corrected"
              className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RequestStatusRelogModal
