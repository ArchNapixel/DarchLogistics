// ClientStatusRequestsSection: pending status-update requests from
// clients (client/ClientStatusRequestModal.tsx), with a Respond action.
// Same shell as CashAdvanceRequestsSection.tsx.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPendingStatusRequests,
  respondToStatusRequest,
  type PendingStatusRequest,
} from '../../../lib/clientStatusRequests'
import { promptDialog } from '../../../components/ConfirmDialog'

function ClientStatusRequestsSection({ onChanged }: { onChanged?: () => void }) {
  const { employeeId } = useAuth()
  const [requests, setRequests] = useState<PendingStatusRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [respondingId, setRespondingId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { requests: loaded, error: loadError } = await loadPendingStatusRequests()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRequests(loaded)
    setError(null)
    setLoading(false)
  }

  async function handleRespond(request: PendingStatusRequest) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as responded by you. Contact an admin.',
      )
      return
    }

    const input = await promptDialog({
      title: `Respond to ${request.client_name}`,
      message: 'This response is sent back to the client.',
      confirmLabel: 'Send response',
    })
    if (input === null) return

    setRespondingId(request.request_id)
    setActionError(null)

    const { error: respondError } = await respondToStatusRequest({
      requestId: request.request_id,
      response: input.trim(),
      respondedByEmployeeId: employeeId,
    })

    setRespondingId(null)

    if (respondError) {
      setActionError(respondError)
      return
    }

    setRequests((prev) => prev.filter((r) => r.request_id !== request.request_id))
    onChanged?.()
  }

  if (loading) {
    return <p className="text-slate-500">Loading pending requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      {actionError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {requests.length === 0 ? (
        <p className="text-slate-500">No pending status requests.</p>
      ) : (
        <div className="grid gap-3">
          {requests.map((request) => (
            <div
              key={request.request_id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {request.client_name} — Booking #{request.booking_id}
                  {request.itinerary_id !== null && ` · Trip #${request.itinerary_id}`}
                </p>
                <span className="text-xs text-slate-500">
                  {new Date(request.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {request.pickup_place_name} → {request.delivery_place_name}
              </p>
              <p className="mt-2 text-sm text-slate-700">{request.message}</p>
              <button
                onClick={() => handleRespond(request)}
                disabled={respondingId === request.request_id}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {respondingId === request.request_id ? 'Saving...' : 'Respond'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default ClientStatusRequestsSection
