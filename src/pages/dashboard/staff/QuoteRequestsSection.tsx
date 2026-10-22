// QuoteRequestsSection: the Quotations page. Three tabs:
// - Pending: quote requests waiting for review. Clicking "Review" opens
//   QuoteReviewModal, which handles the actual Approve/Reject logic.
// - Approved: every approved quote with the booking it became
//   (bookings.quote_request_id) and the client, linking to that booking.
// - Rejected: rejected quotes with the preset tag + reason staff gave
//   (a quote the client resubmitted is back under Pending).
// Approved/Rejected are read-only and load when their tab is opened.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import QuoteReviewModal from './QuoteReviewModal'
import NewQuoteRequestModal from './NewQuoteRequestModal'
import { formatLocationDisplay } from '../../../lib/locationReference'
import PageHeader from '../../../components/PageHeader'
import { formatDate, formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import StatusBadge from '../../../components/StatusBadge'
import Pager from '../../../components/Pager'
import { pageSlice } from '../../../lib/pageSlice'

// Rows per page on every tab (Pending, Approved, Rejected).
const QUOTES_PER_PAGE = 10
import { REJECTION_TAGS, type RejectionTag } from '../../../lib/quoteRequest'

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
  // How many times the client edited and resent it after a Reject, and
  // the reason staff gave the last time (resubmit_quote_request).
  resubmit_count: number
  previous_rejection_reason: string | null
  created_at: string
}

type Tab = 'pending' | 'approved' | 'rejected'

function QuoteRequestsSection() {
  const [tab, setTab] = useState<Tab>('pending')
  const [quotes, setQuotes] = useState<QuoteRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(
    null,
  )
  const [showNewQuote, setShowNewQuote] = useState(false)
  const [pendingPage, setPendingPage] = useState(0)

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

  const pendingSlice = pageSlice(quotes, pendingPage, QUOTES_PER_PAGE)

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
      <PageHeader
        title="Quotations"
        subtitle="Quote requests: waiting for review, approved into bookings, and rejected."
        actions={
          <div className="flex gap-2">
            {/* The list doesn't update by itself -- quotes other admins
                handled, or new client quotes, show after a refresh. */}
            <button
              onClick={loadQuotes}
              className="btn-secondary px-4 py-2 text-sm font-medium"
            >
              Refresh
            </button>
            <button
              onClick={() => setShowNewQuote(true)}
              className="btn-primary px-4 py-2 text-sm font-medium"
            >
              New Quote
            </button>
          </div>
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ['pending', `Pending (${quotes.length})`],
          ['approved', 'Approved'],
          ['rejected', 'Rejected'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-sm font-medium ${
              tab === key ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== 'pending' ? (
        // key: reload when switching between the two history tabs
        <QuoteHistory key={tab} status={tab === 'approved' ? 'Approved' : 'Rejected'} />
      ) : quotes.length === 0 ? (
        <EmptyState message="No pending quote requests." className="mt-4" />
      ) : (
        <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
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
              {pendingSlice.rows.map((quote) => (
                <tr
                  key={quote.quote_request_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {quote.client_name}
                    {quote.resubmit_count > 0 && (
                      <span className="ml-2 bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        Resubmitted{quote.resubmit_count > 1 ? ` ×${quote.resubmit_count}` : ''}
                      </span>
                    )}
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
                      className="btn-secondary px-3 py-1.5 text-xs font-medium"
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
      {tab === 'pending' && (
        <Pager page={pendingSlice.page} pageCount={pendingSlice.pageCount} onChange={setPendingPage} />
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

// ---- Approved / Rejected history ----------------------------------

type HistoryRow = {
  quote_request_id: number
  reference_code: string | null
  client_name: string
  pickup_city: string | null
  pickup_barangay: string | null
  pickup_location_text: string
  delivery_city: string | null
  delivery_barangay: string | null
  delivery_location_text: string
  proposed_rate: number | null
  delivery_order_count: number | null
  rejection_tag: string | null
  rejection_reason: string | null
  resubmit_count: number
  created_at: string
}

type LinkedBooking = {
  booking_id: number
  client_name: string | null
  booking_date: string | null
  booking_status: string
}

// ponytail: newest 200 per tab, no paging -- add LoadMore (components/
// LoadMore.tsx) when the list outgrows that.
const HISTORY_LIMIT = 200

type HistoryResult = {
  rows: HistoryRow[]
  // Approved only: the booking each quote became, keyed by quote id.
  bookingByQuote: Map<number, LinkedBooking>
}

// Loads one history tab. Throws the Supabase message on failure.
async function fetchQuoteHistory(status: 'Approved' | 'Rejected'): Promise<HistoryResult> {
  const { data, error: quotesError } = await supabase
    .from('quote_requests')
    .select(
      'quote_request_id, reference_code, client_name, pickup_city, pickup_barangay, pickup_location_text, delivery_city, delivery_barangay, delivery_location_text, proposed_rate, delivery_order_count, rejection_tag, rejection_reason, resubmit_count, created_at',
    )
    .eq('request_status', status)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (quotesError) throw new Error(quotesError.message)
  if (status !== 'Approved' || data.length === 0) return { rows: data, bookingByQuote: new Map() }

  // Joined in JS (same lookup-by-id pattern as BookingsSection):
  // quote -> booking (bookings.quote_request_id) -> client name.
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('booking_id, quote_request_id, client_id, booking_date, booking_status')
    .in('quote_request_id', data.map((q) => q.quote_request_id))

  if (bookingsError) throw new Error(bookingsError.message)

  const clientIds = Array.from(new Set(bookings.map((b) => b.client_id)))
  const { data: clients } = clientIds.length
    ? await supabase.from('clients').select('client_id, client_name').in('client_id', clientIds)
    : { data: [] as { client_id: number; client_name: string }[] }
  const nameById = new Map((clients ?? []).map((c) => [c.client_id, c.client_name]))

  return {
    rows: data,
    bookingByQuote: new Map(
      bookings.map((b) => [
        b.quote_request_id,
        {
          booking_id: b.booking_id,
          client_name: nameById.get(b.client_id) ?? null,
          booking_date: b.booking_date,
          booking_status: b.booking_status,
        },
      ]),
    ),
  }
}

function QuoteHistory({ status }: { status: 'Approved' | 'Rejected' }) {
  const [result, setResult] = useState<HistoryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loading = !result && !error

  useEffect(() => {
    let cancelled = false
    fetchQuoteHistory(status)
      .then((r) => !cancelled && setResult(r))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [status])

  const rows = result?.rows ?? []
  const [page, setPage] = useState(0)
  const pageRows = pageSlice(rows, page, QUOTES_PER_PAGE)
  const bookingByQuote = result?.bookingByQuote ?? new Map<number, LinkedBooking>()

  if (loading) return <p className="mt-4 text-slate-500">Loading {status.toLowerCase()} quotes...</p>
  if (error) return <p className="mt-4 text-red-700">{error}</p>
  if (rows.length === 0) {
    return <EmptyState message={`No ${status.toLowerCase()} quote requests.`} className="mt-4" />
  }

  const approved = status === 'Approved'

  return (
    <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Quote</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Pickup → Delivery</th>
            <th className="px-4 py-3 font-medium">Rate</th>
            {approved ? (
              <>
                <th className="px-4 py-3 font-medium">Booking</th>
                <th className="px-4 py-3 font-medium">Booking status</th>
              </>
            ) : (
              <th className="px-4 py-3 font-medium">Reason</th>
            )}
          </tr>
        </thead>
        <tbody>
          {pageRows.rows.map((q) => {
            const booking = bookingByQuote.get(q.quote_request_id)
            const tag =
              q.rejection_tag && q.rejection_tag in REJECTION_TAGS
                ? REJECTION_TAGS[q.rejection_tag as RejectionTag].label
                : null
            return (
              <tr key={q.quote_request_id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-slate-900">
                    {q.reference_code ?? `#${q.quote_request_id}`}
                  </span>
                  <span className="block text-xs text-slate-500">Requested {formatDate(q.created_at)}</span>
                  {q.resubmit_count > 0 && (
                    <span className="mt-1 inline-block bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                      Resubmitted{q.resubmit_count > 1 ? ` ×${q.resubmit_count}` : ''}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {/* The booking's client record when there is one (that's
                      who is billed), else the name on the quote. */}
                  {booking?.client_name ?? q.client_name}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {formatLocationDisplay({
                    city: q.pickup_city,
                    barangay: q.pickup_barangay,
                    detail: q.pickup_location_text,
                  })}{' '}
                  →{' '}
                  {formatLocationDisplay({
                    city: q.delivery_city,
                    barangay: q.delivery_barangay,
                    detail: q.delivery_location_text,
                  })}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                  {q.proposed_rate !== null ? formatMoney(q.proposed_rate) : '—'}
                  {(q.delivery_order_count ?? 1) > 1 && (
                    <span className="block text-xs text-slate-500">× {q.delivery_order_count} trips</span>
                  )}
                </td>
                {approved ? (
                  booking ? (
                    <>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link
                          to={`/dashboard/bookings?booking=${booking.booking_id}`}
                          className="font-semibold text-slate-900 underline-offset-2 hover:underline"
                        >
                          Booking #{booking.booking_id}
                        </Link>
                        {booking.booking_date && (
                          <span className="block text-xs text-slate-500">{formatDate(booking.booking_date)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={booking.booking_status} />
                      </td>
                    </>
                  ) : (
                    // Approve marks the quote Approved and creates the
                    // booking in separate steps -- a failure in between
                    // leaves an approved quote with no booking.
                    <td colSpan={2} className="px-4 py-3 text-sm text-red-700">
                      No booking found — needs manual review
                    </td>
                  )
                ) : (
                  <td className="max-w-xs px-4 py-3 text-slate-700">
                    {tag && (
                      <span className="mb-1 inline-block bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                        {tag}
                      </span>
                    )}
                    <span className="block">{q.rejection_reason ?? '—'}</span>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <Pager page={pageRows.page} pageCount={pageRows.pageCount} onChange={setPage} className="border-t border-slate-200 px-4 py-2" />
    </div>
  )
}

export default QuoteRequestsSection
