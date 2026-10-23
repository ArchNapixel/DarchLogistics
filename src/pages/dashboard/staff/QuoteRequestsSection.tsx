// QuoteRequestsSection: the Quotations page. Three tabs:
// - Pending: quote requests waiting for review. Clicking "Review" opens
//   QuoteReviewModal, which handles the actual Approve/Reject logic.
// - Approved: every approved quote with the booking it became
//   (bookings.quote_request_id) and the client, linking to that booking.
// - Rejected: rejected quotes with the preset tag + reason staff gave
//   (a quote the client resubmitted is back under Pending).
// Approved/Rejected are read-only and load when their tab is opened.
// One search box (client name or quote reference) filters whichever tab is open.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import QuoteReviewModal from './QuoteReviewModal'
import NewQuoteRequestModal from './NewQuoteRequestModal'
import { formatLocationDisplay } from '../../../lib/locationReference'
import PageHeader from '../../../components/PageHeader'
import { formatDate, formatMoney } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import StatusBadge from '../../../components/StatusBadge'
import { usePaged } from '../../../lib/usePaged'

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
  // Optional landmark for the driver (display only, not used for cost).
  pickup_landmark: string | null
  pickup_city: string | null
  pickup_barangay: string | null
  delivery_location_text: string
  delivery_landmark: string | null
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
  // "Deadline date" on screen: the latest day the client needs the cargo.
  // Null on urgent quotes from before 2026-10-23 (it wasn't asked then).
  preferred_delivery_date: string | null
  // Last free port-storage day: every trip must be Picked Up by 11:59 PM on
  // preferred_pickup_date (lib/storageDeadline.ts).
  is_last_day_of_port_storage: boolean | null
  delivery_order_count: number | null
  // How many times the client edited and resent it after a Reject, and
  // the reason staff gave the last time (resubmit_quote_request).
  resubmit_count: number
  previous_rejection_reason: string | null
  created_at: string
}

type Tab = 'pending' | 'approved' | 'rejected'

// ---- Shared table pieces (same look on all three tabs) -------------

// Small outline icons (24x24 SVG paths, same style as the sidebar's).
const ICONS = {
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
}

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block shrink-0"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

const TH = 'px-5 py-3 font-semibold'
const TD = 'px-5 py-3'

// The bordered box every tab's table sits in: fills the screen height, with
// a footer line at the bottom -- the pager when there's more than one page,
// otherwise `summary` ("6 rejected quotations").
function TableCard({
  head,
  children,
  pager,
  summary,
}: {
  head: React.ReactNode
  children: React.ReactNode
  pager: { page: number; pageCount: number; onChange: (page: number) => void }
  summary: string
}) {
  const button =
    'border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40'
  return (
    <div className="mt-4 flex min-h-[calc(100dvh-15rem)] flex-col border-2 border-slate-300 bg-white">
      <div className="flex-1 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wider text-slate-600 uppercase">
            <tr>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm text-slate-700">
        {pager.pageCount > 1 ? (
          <>
            <span>
              Page {pager.page + 1} of {pager.pageCount}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => pager.onChange(pager.page - 1)}
                disabled={pager.page === 0}
                className={button}
              >
                ‹ Previous
              </button>
              <button
                type="button"
                onClick={() => pager.onChange(pager.page + 1)}
                disabled={pager.page >= pager.pageCount - 1}
                className={button}
              >
                Next ›
              </button>
            </span>
          </>
        ) : (
          <span>{summary}</span>
        )}
      </div>
    </div>
  )
}

// One table row for a message (loading / error / nothing found).
function MessageRow({ colSpan, children, tone = 'text-slate-500' }: { colSpan: number; children: React.ReactNode; tone?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className={`px-5 py-8 text-center ${tone}`}>
        {children}
      </td>
    </tr>
  )
}

function ResubmittedChip({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-2 bg-amber-100 px-1.5 py-0.5 font-sans text-xs font-medium text-amber-800">
      Resubmitted{count > 1 ? ` ×${count}` : ''}
    </span>
  )
}

// Reference code (mono) + optional "Requested <date>" line.
function QuoteCell({ q, showDate = true }: { q: { reference_code: string | null; quote_request_id: number; resubmit_count: number; created_at: string }; showDate?: boolean }) {
  return (
    <td className={`${TD} whitespace-nowrap`}>
      <span className="font-mono text-xs font-semibold text-slate-900">
        {q.reference_code ?? `#${q.quote_request_id}`}
      </span>
      <ResubmittedChip count={q.resubmit_count} />
      {showDate && <span className="block text-slate-500">Requested {formatDate(q.created_at)}</span>}
    </td>
  )
}

type RouteFields = {
  pickup_city: string | null
  pickup_barangay: string | null
  pickup_location_text: string
  delivery_city: string | null
  delivery_barangay: string | null
  delivery_location_text: string
}

// Pickup on the first line, "→ delivery" under it.
function RouteCell({ q }: { q: RouteFields }) {
  return (
    <td className={TD}>
      <p className="text-slate-900">
        {formatLocationDisplay({ city: q.pickup_city, barangay: q.pickup_barangay, detail: q.pickup_location_text })}
      </p>
      <p className="text-primary">
        →{' '}
        {formatLocationDisplay({
          city: q.delivery_city,
          barangay: q.delivery_barangay,
          detail: q.delivery_location_text,
        })}
      </p>
    </td>
  )
}

// Search box matches the client name or the quote's reference code / id.
function matchesSearch(q: { client_name: string; reference_code: string | null; quote_request_id: number }, search: string) {
  const s = search.trim().toLowerCase()
  if (!s) return true
  return (
    q.client_name.toLowerCase().includes(s) ||
    (q.reference_code ?? '').toLowerCase().includes(s) ||
    String(q.quote_request_id) === s.replace(/^#/, '')
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function QuoteRequestsSection() {
  const [tab, setTab] = useState<Tab>('pending')
  const [search, setSearch] = useState('')
  const [quotes, setQuotes] = useState<QuoteRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(
    null,
  )
  const [showNewQuote, setShowNewQuote] = useState(false)
  // Bumped by Refresh so the Approved/Rejected tab reloads too.
  const [refreshKey, setRefreshKey] = useState(0)

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

  const visiblePending = quotes.filter((q) => matchesSearch(q, search))
  const pendingPaged = usePaged(visiblePending, search, QUOTES_PER_PAGE)
  const today = toManilaDate(new Date())

  // Called by the modal after a successful approve/reject -- the quote is
  // no longer Pending, so just remove it from this list.
  function handleResolved(quoteRequestId: number) {
    setQuotes((prev) =>
      prev.filter((q) => q.quote_request_id !== quoteRequestId),
    )
    setSelectedQuote(null)
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
              onClick={() => {
                loadQuotes()
                setRefreshKey((k) => k + 1)
              }}
              className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium"
            >
              <Icon name="refresh" />
              Refresh
            </button>
            <button
              onClick={() => setShowNewQuote(true)}
              className="btn-primary flex items-center gap-2 px-4 py-2 text-sm font-medium"
            >
              <Icon name="plus" />
              New Quote
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        {([
          ['pending', 'Pending'],
          ['approved', 'Approved'],
          ['rejected', 'Rejected'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`flex items-center gap-2.5 border px-5 py-2.5 text-sm font-medium ${
              tab === key
                ? 'border-primary bg-primary text-white'
                : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
            }`}
          >
            {label}
            {key === 'pending' && !loading && (
              <span
                className={`px-1.5 text-xs ${tab === key ? 'bg-white text-primary' : 'bg-primary text-white'}`}
              >
                {quotes.length}
              </span>
            )}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-3 text-sm text-slate-700">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Client or quote ID"
            className="w-64 border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-primary focus:outline-none sm:w-80"
          />
        </label>
      </div>

      {tab !== 'pending' ? (
        // key: reload when switching between the two history tabs or on Refresh
        <QuoteHistory
          key={`${tab}-${refreshKey}`}
          status={tab === 'approved' ? 'Approved' : 'Rejected'}
          search={search}
        />
      ) : (
        <TableCard
          pager={pendingPaged.pager}
          summary={`${plural(visiblePending.length, 'quotation')} waiting for review`}
          head={
            <>
              <th className={TH}>Quote</th>
              <th className={TH}>Client</th>
              <th className={TH}>Pickup → Delivery</th>
              <th className={TH}>Cargo type</th>
              <th className={TH}>Pickup date</th>
              <th className={TH}>Deliveries</th>
              <th className={TH}>
                <span className="sr-only">Action</span>
              </th>
            </>
          }
        >
          {loading ? (
            <MessageRow colSpan={7}>Loading quote requests...</MessageRow>
          ) : error ? (
            <MessageRow colSpan={7} tone="text-red-700">
              {error}
            </MessageRow>
          ) : visiblePending.length === 0 ? (
            <MessageRow colSpan={7}>
              {search ? 'No pending quotes match your search.' : 'No pending quote requests.'}
            </MessageRow>
          ) : (
            pendingPaged.rows.map((quote) => (
              <tr key={quote.quote_request_id} className="border-b border-slate-200 hover:bg-slate-50">
                <QuoteCell q={quote} showDate={false} />
                <td className={`${TD} font-semibold text-slate-900`}>{quote.client_name}</td>
                <RouteCell q={quote} />
                <td className={`${TD} text-slate-900`}>{quote.cargo_type}</td>
                <td className={`${TD} text-slate-900`}>
                  <span className="whitespace-nowrap">
                    {quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}
                    {quote.preferred_pickup_date === today && (
                      <span className="ml-2 bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        Today
                      </span>
                    )}
                  </span>
                  {quote.is_last_day_of_port_storage && (
                    <span className="mt-1 block w-fit bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                      Urgent · last free storage day
                    </span>
                  )}
                </td>
                <td className={`${TD} text-slate-900`}>{quote.delivery_order_count ?? '—'}</td>
                <td className={`${TD} text-right`}>
                  <button
                    onClick={() => setSelectedQuote(quote)}
                    className="btn-primary px-5 py-2 text-sm font-semibold"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))
          )}
        </TableCard>
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

function QuoteHistory({ status, search }: { status: 'Approved' | 'Rejected'; search: string }) {
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

  const bookingByQuote = result?.bookingByQuote ?? new Map<number, LinkedBooking>()
  // Search the name staff see: the booking's client when there is one.
  const rows = (result?.rows ?? []).filter((q) =>
    matchesSearch({ ...q, client_name: bookingByQuote.get(q.quote_request_id)?.client_name ?? q.client_name }, search),
  )
  const paged = usePaged(rows, search, QUOTES_PER_PAGE)

  const approved = status === 'Approved'
  const cols = approved ? 7 : 6

  return (
    <TableCard
      pager={paged.pager}
      summary={`${plural(rows.length, `${status.toLowerCase()} quotation`)}`}
      head={
        <>
          <th className={TH}>Quote</th>
          <th className={TH}>Client</th>
          <th className={TH}>Pickup → Delivery</th>
          <th className={TH}>Rate</th>
          {approved ? (
            <>
              <th className={TH}>Booking</th>
              <th className={TH}>Booking status</th>
            </>
          ) : (
            <th className={TH}>Reason</th>
          )}
          {approved && (
            <th className="w-12 px-2 py-3">
              <span className="sr-only">Open</span>
            </th>
          )}
        </>
      }
    >
      {loading ? (
        <MessageRow colSpan={cols}>Loading {status.toLowerCase()} quotes...</MessageRow>
      ) : error ? (
        <MessageRow colSpan={cols} tone="text-red-700">
          {error}
        </MessageRow>
      ) : rows.length === 0 ? (
        <MessageRow colSpan={cols}>
          {search
            ? `No ${status.toLowerCase()} quotes match your search.`
            : `No ${status.toLowerCase()} quote requests.`}
        </MessageRow>
      ) : (
        paged.rows.map((q) => {
          const booking = bookingByQuote.get(q.quote_request_id)
          const tag =
            q.rejection_tag && q.rejection_tag in REJECTION_TAGS
              ? REJECTION_TAGS[q.rejection_tag as RejectionTag].label
              : null
          return (
            <tr key={q.quote_request_id} className="border-b border-slate-200 hover:bg-slate-50">
              <QuoteCell q={q} />
              <td className={`${TD} font-semibold text-slate-900`}>
                {/* The booking's client record when there is one (that's
                    who is billed), else the name on the quote. */}
                {booking?.client_name ?? q.client_name}
              </td>
              <RouteCell q={q} />
              <td className={`${TD} whitespace-nowrap`}>
                <span className="font-semibold text-slate-900">
                  {q.proposed_rate !== null ? formatMoney(q.proposed_rate) : '—'}
                </span>
                {(q.delivery_order_count ?? 1) > 1 && (
                  <span className="block text-slate-500">× {q.delivery_order_count} trips</span>
                )}
              </td>
              {approved ? (
                booking ? (
                  <>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Link
                        to={`/dashboard/bookings?booking=${booking.booking_id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        Booking #{booking.booking_id}
                      </Link>
                      {booking.booking_date && (
                        <span className="block text-slate-500">{formatDate(booking.booking_date)}</span>
                      )}
                    </td>
                    <td className={TD}>
                      <StatusBadge status={booking.booking_status} />
                    </td>
                    <td className="px-2 py-3 text-slate-500">
                      <Link
                        to={`/dashboard/bookings?booking=${booking.booking_id}`}
                        aria-label={`Open booking #${booking.booking_id}`}
                        className="hover:text-primary"
                      >
                        <Icon name="chevron" />
                      </Link>
                    </td>
                  </>
                ) : (
                  // Approve marks the quote Approved and creates the
                  // booking in separate steps -- a failure in between
                  // leaves an approved quote with no booking.
                  <td colSpan={3} className={`${TD} text-red-700`}>
                    No booking found — needs manual review
                  </td>
                )
              ) : (
                <td className={`${TD} max-w-xs text-slate-900`}>
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
        })
      )}
    </TableCard>
  )
}

export default QuoteRequestsSection
