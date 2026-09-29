// MyQuoteRequestsSection: the client's own quote requests that haven't
// turned into a booking -- Pending (waiting on staff) and Rejected (with
// the reason staff gave). Approved quotes aren't listed here since they
// already show up under My Bookings. Without this, a quote vanished from
// the portal the moment it was sent until staff approved it.
//
// Only quotes with client_id set are found -- portal-submitted ones
// always have it. Needs the quote_requests_select_own_client RLS policy
// (client_id -> users.auth_user_id); without it this just shows empty.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { formatDate } from '../../../lib/quoteRequest'

type QuoteRow = {
  quote_request_id: number
  reference_code: string | null
  request_status: string
  rejection_reason: string | null
  pickup_city: string
  pickup_barangay: string
  delivery_city: string
  delivery_barangay: string
  cargo_type: string
  preferred_pickup_date: string
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-orange-100 text-orange-700',
  Rejected: 'bg-red-100 text-red-700',
}

function MyQuoteRequestsSection() {
  const { clientId } = useAuth()
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
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

    const { data, error: loadError } = await supabase
      .from('quote_requests')
      .select(
        'quote_request_id, reference_code, request_status, rejection_reason, pickup_city, pickup_barangay, delivery_city, delivery_barangay, cargo_type, preferred_pickup_date, created_at',
      )
      .eq('client_id', id)
      .neq('request_status', 'Approved')
      .order('created_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setQuotes(data)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your quote requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (quotes.length === 0) {
    return (
      <p className="text-slate-500">
        No open quote requests. Approved quotes appear under My Bookings.
      </p>
    )
  }

  return (
    <div className="grid gap-3">
      {quotes.map((quote) => (
        <div
          key={quote.quote_request_id}
          className="rounded-xl border border-slate-200 p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-slate-900">
                {quote.pickup_barangay}, {quote.pickup_city} →{' '}
                {quote.delivery_barangay}, {quote.delivery_city}
              </p>
              <p className="text-xs text-slate-500">
                {quote.reference_code ?? `Quote #${quote.quote_request_id}`}
                {' · '}
                {quote.cargo_type} · Pickup{' '}
                {formatDate(quote.preferred_pickup_date)}
              </p>
            </div>
            <span
              className={`shrink-0 px-3 py-1 text-xs font-semibold ${STATUS_STYLES[quote.request_status] ?? 'bg-gray-100 text-gray-700'}`}
            >
              {quote.request_status === 'Pending'
                ? 'Under review'
                : quote.request_status}
            </span>
          </div>
          {quote.request_status === 'Rejected' && quote.rejection_reason && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Reason
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {quote.rejection_reason}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default MyQuoteRequestsSection
