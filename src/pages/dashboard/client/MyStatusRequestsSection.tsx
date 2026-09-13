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
  type ClientStatusRequest,
} from '../../../lib/clientStatusRequests'

const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-orange-100 text-orange-700',
  Responded: 'bg-green-100 text-green-700',
}

function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function MyStatusRequestsSection() {
  const { clientId } = useAuth()
  const [requests, setRequests] = useState<ClientStatusRequest[]>([])
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
    return <p className="text-slate-500">No status requests yet.</p>
  }

  return (
    <div className="grid gap-3">
      {requests.map((request) => (
        <div key={request.request_id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              Booking #{request.booking_id} ·{' '}
              {new Date(request.created_at).toLocaleDateString()}
            </p>
            <StatusBadge status={request.status} />
          </div>
          <p className="mt-2 text-sm text-slate-900">{request.message}</p>
          {request.staff_response && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3">
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
