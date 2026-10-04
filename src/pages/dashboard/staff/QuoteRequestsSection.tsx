// QuoteRequestsSection: shows all Pending quote requests for staff to
// review. Clicking "Review" opens QuoteReviewModal, which handles the
// actual Approve/Reject logic.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import QuoteReviewModal from './QuoteReviewModal'
import NewQuoteRequestModal from './NewQuoteRequestModal'
import { formatLocationDisplay } from '../../../lib/locationReference'
import { formatDate } from '../../../lib/quoteRequest'

// The shape of a row from the quote_requests table (only the fields we
// use here -- the modal reads more fields directly from the same row).
export type QuoteRequest = {
  quote_request_id: number
  // Short code shown to the customer on submit ("Q-7F3K9A"), so staff
  // can find the quote when they call. Null for quotes from before it
  // existed.
  reference_code: string | null
  // Set when staff picked an existing client while logging the request
  // (NewQuoteRequestModal). Null for a public/client-submitted quote or
  // a brand-new client, in which case Approve resolves the client by
  // email instead.
  client_id: number | null
  client_name: string
  contact_number: string | null
  contact_email: string | null
  pickup_location_text: string
  pickup_city: string | null
  pickup_barangay: string | null
  delivery_location_text: string
  delivery_city: string | null
  delivery_barangay: string | null
  // Exact map pins, when the submitter dropped one (LocationPicker).
  // Null for dropdown-only picks and every quote from before pins existed.
  pickup_lat: number | null
  pickup_lng: number | null
  delivery_lat: number | null
  delivery_lng: number | null
  cargo_type: string
  cargo_description: string
  weight: number
  container_type: string
  trailer_type: string | null
  payment_terms: string
  proposed_rate: number | null
  preferred_pickup_date: string | null
  delivery_order_count: number | null
  created_at: string
}

function QuoteRequestsSection() {
  const [quotes, setQuotes] = useState<QuoteRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(
    null,
  )
  const [showNewQuote, setShowNewQuote] = useState(false)

  useEffect(() => {
    loadQuotes()
  }, [])

  async function loadQuotes() {
    setLoading(true)
    const { data, error } = await supabase
      .from('quote_requests')
      .select('*')
      .eq('request_status', 'Pending')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setQuotes(data)
    setError(null)
    setLoading(false)
  }

  // Called by the modal after a successful approve/reject -- the quote is
  // no longer Pending, so just remove it from this list.
  function handleResolved(quoteRequestId: number) {
    setQuotes((prev) =>
      prev.filter((q) => q.quote_request_id !== quoteRequestId),
    )
    setSelectedQuote(null)
  }

  if (loading) {
    return <p className="text-slate-500">Loading quote requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">
          Client Quotations
        </h2>
        <button
          onClick={() => setShowNewQuote(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New Quote
        </button>
      </div>

      {quotes.length === 0 ? (
        <p className="mt-4 text-slate-500">No pending quote requests.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Cargo Type</th>
                <th className="px-4 py-3 font-medium">Pickup → Delivery</th>
                <th className="px-4 py-3 font-medium">Pickup Date</th>
                <th className="px-4 py-3 font-medium">Deliveries</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr
                  key={quote.quote_request_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {quote.client_name}
                    {quote.reference_code && (
                      <span className="block font-mono text-xs text-slate-500">
                        {quote.reference_code}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {quote.cargo_type}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatLocationDisplay({
                      city: quote.pickup_city,
                      barangay: quote.pickup_barangay,
                      detail: quote.pickup_location_text,
                    })}{' '}
                    →{' '}
                    {formatLocationDisplay({
                      city: quote.delivery_city,
                      barangay: quote.delivery_barangay,
                      detail: quote.delivery_location_text,
                    })}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {quote.delivery_order_count ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedQuote(quote)}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedQuote && (
        <QuoteReviewModal
          quote={selectedQuote}
          onClose={() => setSelectedQuote(null)}
          onResolved={handleResolved}
        />
      )}

      {showNewQuote && (
        <NewQuoteRequestModal
          onClose={() => setShowNewQuote(false)}
          onCreated={() => {
            setShowNewQuote(false)
            loadQuotes()
          }}
        />
      )}
    </div>
  )
}

export default QuoteRequestsSection
