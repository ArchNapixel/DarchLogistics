// ClientStatusRequestModal: "Ask about this trip" (the canvas's Client Ask
// board) -- the client asks Dispatch a question about one trip
// (itinerary) of one of their bookings. Lands in the admin Reports page's
// "Client Requests" tab; the answer shows in the client's My Requests.
import { useState } from 'react'
import { requestClientStatus } from '../../../lib/clientStatusRequests'

function ClientStatusRequestModal({
  clientId,
  bookingId,
  itineraryId,
  date,
  timeWindow,
  onClose,
  onRequested,
}: {
  clientId: number
  bookingId: number
  itineraryId: number
  // The trip's date and time slot ("6 AM – 9 AM"), null if not set yet.
  date: string
  timeWindow: string | null
  onClose: () => void
  onRequested: () => void
}) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!message.trim()) {
      setError('Type your question for Dispatch.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: requestError } = await requestClientStatus({
      clientId,
      bookingId,
      itineraryId,
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="ask-h" className="card w-full max-w-[560px]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="ask-h" className="text-xl leading-7 font-bold text-ink">
              Ask about this trip
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">Dispatch will answer in My Requests.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border border-line bg-slate-50 px-4 py-3 text-sm sm:grid-cols-4">
            {[
              ['Trip', `#${itineraryId}`],
              ['Booking', `#${bookingId}`],
              ['Date', date],
              ['Time window', timeWindow ?? 'Not set yet'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[13px] font-medium text-ink-muted">{label}</dt>
                <dd className="font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <label className="flex flex-col gap-1.5">
            <span className="flex justify-between gap-2 text-sm font-semibold text-ink">
              Your question <span className="text-xs text-amber-800">Required</span>
            </span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="e.g. What time will the truck arrive at the pickup point?"
              className="min-h-11 w-full resize-none rounded-[2px] border border-line-control bg-white px-3 py-2.5 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary"
            />
          </label>
        </div>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary px-6 text-sm">
            {submitting ? 'Sending...' : 'Send Question'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default ClientStatusRequestModal
