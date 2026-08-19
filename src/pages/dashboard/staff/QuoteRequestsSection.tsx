// QuoteRequestsSection: shows all Pending quote requests for staff to
// review. Clicking "Review" opens QuoteReviewModal, which handles the
// actual Approve/Reject logic.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import QuoteReviewModal from './QuoteReviewModal'

// The shape of a row from the quote_requests table (only the fields we
// use here -- the modal reads more fields directly from the same row).
export type QuoteRequest = {
  quote_request_id: number
  client_name: string
  contact_number: string | null
  contact_email: string | null
  pickup_location_text: string
  delivery_location_text: string
  cargo_type: string
  cargo_description: string
  weight: number
  container_type: string
  payment_terms: string
  proposed_rate: number | null
  preferred_pickup_date: string | null
  created_at: string
}

function QuoteRequestsSection() {
  const [quotes, setQuotes] = useState<QuoteRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(
    null,
  )

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
      <h2 className="text-xl font-bold text-slate-900">
        Pending Quote Requests
      </h2>

      {quotes.length === 0 ? (
        <p className="mt-4 text-slate-500">No pending quote requests.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Cargo Type</th>
                <th className="px-4 py-3 font-medium">Origin → Destination</th>
                <th className="px-4 py-3 font-medium">Pickup Date</th>
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
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {quote.cargo_type}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {quote.pickup_location_text} → {quote.delivery_location_text}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {quote.preferred_pickup_date ?? '—'}
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
    </div>
  )
}

export default QuoteRequestsSection
