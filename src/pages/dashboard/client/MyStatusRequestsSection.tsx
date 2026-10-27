// MyStatusRequestsSection: the client's My Requests page (the canvas's
// Client My Requests board) -- every question they asked about a trip,
// newest first, with Dispatch's answer under it ("Waiting for Dispatch"
// until staff respond). New questions are asked from a trip in My Bookings
// (ClientStatusRequestModal).
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadStatusRequestsForClient,
  type PendingStatusRequest,
} from '../../../lib/clientStatusRequests'
import { formatDate, formatTime } from '../../../lib/format'

function MyStatusRequestsSection() {
  const { clientId } = useAuth()
  const [requests, setRequests] = useState<PendingStatusRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The client's requests, newest first. Reloads when the login changes.
  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    loadStatusRequestsForClient(clientId).then(({ requests: loaded, error: loadError }) => {
      if (cancelled) return
      setRequests(loaded)
      setError(loadError)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [clientId])

  if (!clientId) return <p className="text-ink-muted">Your login isn't linked to a client account.</p>
  if (loading) return <p className="text-ink-muted">Loading your requests...</p>
  if (error) return <p className="text-red-700">{error}</p>

  return (
    <section aria-label="Requests" className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <h2 className="text-base font-semibold text-ink">
          All requests <span className="font-medium text-ink-muted">· {requests.length}</span>
        </h2>
        <span className="text-[13px] text-ink-muted">Newest first</span>
      </div>

      {requests.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-ink-muted">No questions yet.</p>
      ) : (
        <div className="flex flex-col gap-3 px-5 py-4">
          {requests.map((request) => {
            const answered = request.status === 'Responded' || !!request.staff_response
            return (
              <article key={request.request_id} aria-label={`Request about trip ${request.itinerary_id ?? ''}`} className="border border-line">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
                  <span className="font-semibold text-ink">
                    {request.itinerary_id !== null ? `Trip #${request.itinerary_id} · ` : ''}Booking #{request.booking_id}
                  </span>
                  <span
                    className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold ${
                      answered ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {answered ? 'Answered' : 'Waiting for Dispatch'}
                  </span>
                  <span className="text-[13px] text-ink-muted">
                    {request.pickup_place_name} → {request.delivery_place_name}
                  </span>
                </div>
                <div className="px-4 pt-2 pb-3">
                  <p className="text-[13px] text-ink-muted">
                    You asked · {formatDate(request.created_at)}, {formatTime(request.created_at)}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-metric">{request.message}</p>
                </div>
                <div
                  className={`border-t px-4 py-3 text-sm ${
                    answered ? 'border-primary/30 bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'border-line bg-slate-50'
                  }`}
                >
                  <p className="text-[13px] font-semibold text-ink-secondary">
                    {answered
                      ? `Dispatch answered${request.responded_at ? ` · ${formatDate(request.responded_at)}, ${formatTime(request.responded_at)}` : ''}`
                      : 'Dispatch'}
                  </p>
                  <p className="mt-0.5 text-ink-metric">{request.staff_response ?? "No answer yet. You'll see it here."}</p>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default MyStatusRequestsSection
