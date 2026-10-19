// MyStatusRequestsSection: the client's own status-request history --
// same self-contained pattern as MyCashAdvanceRequestsSection.tsx on
// the employee side (own useAuth(), own refresh). Submitting a new
// request happens via ClientStatusRequestModal.tsx from
// MyBookingsSection.tsx elsewhere on the page; ClientDashboard.tsx
// forces this section to reload by remounting it (a changed `key`)
// when that happens.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadStatusRequestsForClient,
  type PendingStatusRequest,
} from '../../../lib/clientStatusRequests'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function MyStatusRequestsSection() {
  const { clientId } = useAuth()
  const [requests, setRequests] = useState<PendingStatusRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (clientId) {
      load(clientId)
    } else {
      setLoading(false)
    }
  }, [clientId])

  async function load(id: number) {
    setLoading(true)

    const { requests: loaded, error: loadError } = await loadStatusRequestsForClient(id)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRequests(loaded)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (requests.length === 0) {
    return <EmptyState message="No status requests yet." />
  }

  return (
    <div className="grid gap-3">
      {requests.map((request) => (
        <div key={request.request_id} className="border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-slate-900">
                {request.pickup_place_name} → {request.delivery_place_name}
              </p>
              <p className="text-xs text-slate-500">
                Booking #{request.booking_id}
                {request.itinerary_id !== null && ` · Trip #${request.itinerary_id}`}
                {' · '}
                {formatDate(request.created_at)}
              </p>
            </div>
            <StatusBadge status={request.status} />
          </div>
          <p className="mt-2 text-sm text-slate-900">{request.message}</p>
          {request.staff_response && (
            <div className="mt-2 bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Dispatch response
              </p>
              <p className="mt-1 text-sm text-slate-700">{request.staff_response}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default MyStatusRequestsSection
