// ClientStatusRequestModal: lets a client ask staff for a status update
// on one of their bookings. Lands in the admin Reports page's "Client
// Requests" tab for staff to respond to.
import { useState } from 'react'
import { requestClientStatus } from '../../../lib/clientStatusRequests'

function ClientStatusRequestModal({
  clientId,
  bookingId,
  route,
  onClose,
  onRequested,
}: {
  clientId: number
  bookingId: number
  route: string
  onClose: () => void
  onRequested: () => void
}) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!message.trim()) {
      setError('Enter a question or note for dispatch.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: requestError } = await requestClientStatus({
      clientId,
      bookingId,
      message: message.trim(),
    })

    setSubmitting(false)

    if (requestError) {
      setError(requestError)
      return
    }

    onRequested()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 className="text-lg font-bold text-slate-900">Request a Status Update</h3>
        <p className="mt-1 text-sm text-slate-500">{route}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
          What would you like to know?
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="e.g. Has this been picked up yet?"
            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
          />
        </label>

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
            {submitting ? 'Sending...' : 'Send Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ClientStatusRequestModal
