// QuoteRequestsSection: the Quotations page. Clients don't set a rate --
// staff price each quote and send an offer the client accepts, counters or
// declines (lib/quoteOffers.ts). Four tabs:
// - Needs pricing: Pending (new) + Countered (the client answered with
//   their own rate/dates). "Review" opens QuoteReviewModal to send an
//   offer, accept a counter, or reject.
// - Waiting on client: Offered -- read-only there, staff can withdraw it
//   or record a phone/walk-in client's reply.
// - Approved: every approved quote with the booking it became
//   (bookings.quote_request_id) and the client, linking to that booking.
// - Rejected / Declined: rejected by us (preset tag + reason) or declined
//   by the client (their reason).
// Approved and Rejected / Declined are read-only and load when opened.
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
import { offerTiming } from '../../../lib/offerTiming'
import { usePaged } from '../../../lib/usePaged'

// Rows per page on every tab (Pending, Approved, Rejected).
const QUOTES_PER_PAGE = 10
import { REJECTION_TAGS, cargoSummary, parseCargoLines, type RejectionTag } from '../../../lib/quoteRequest'

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
  // Cargo per trip, as lines (jsonb, lib/quoteRequest.ts CargoLineRow --
  // read with parseCargoLines). The single-cargo columns below are from
  // before 2026-10-23 and no longer written.
  cargo_lines: unknown
  cargo_type: string | null
  cargo_description: string | null
  weight: number | null
  container_type: string | null
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
  // Where the price negotiation is (lib/quoteOffers.ts): Pending, Offered,
  // Countered, Approved, Rejected, Declined.
  request_status: string
  // Saved with staff's offer (send_quote_offer) and copied to the booking.
  estimated_distance_km: number | null
  hours_per_trip: number | null
  cost_per_trip: number | null
  // The client's reason when they declined an offer.
  decline_reason: string | null
  // How many times the client edited and resent it after a Reject, and
  // the reason staff gave the last time (resubmit_quote_request).
  resubmit_count: number
  previous_rejection_reason: string | null
  created_at: string
}

type Tab = 'pricing' | 'waiting' | 'approved' | 'closed'

// ---- Shared table pieces (same look on all three tabs) -------------

// Small outline icons (24x24 SVG paths, same style as the sidebar's).
const ICONS = {
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
}

function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

// Same spacing as the canvas board: 20px at the table's edges, 16px between
// columns, rows at least 60px tall.
const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const ROW = 'h-[60px] border-b border-slate-200 hover:bg-slate-50'

// Column widths (px) from the canvas board; '' = takes the rest (the route).
const PENDING_COLS = ['230px', '170px', '', '170px', '200px', '150px', '120px']
const APPROVED_COLS = ['230px', '170px', '', '170px', '200px', '150px', '120px']
// Rejected: the reason takes the last three columns' room (no Open link).
const CLOSED_COLS = ['230px', '170px', '', '170px', '470px']

// The bordered box every tab's table sits in: fills the screen height, with
// a footer line at the bottom -- "Page 2 of 5" (or `summary`, e.g. "6
// rejected quotations") on the left, Previous / Next on the right.
function TableCard({
  head,
  cols,
  children,
  pager,
  summary,
}: {
  head: React.ReactNode
  cols: string[]
  children: React.ReactNode
  pager: { page: number; pageCount: number; onChange: (page: number) => void }
  summary: string
}) {
  const button = 'btn-secondary px-3.5 text-sm font-medium'
  return (
    <div className="card mt-4 flex min-h-[calc(100dvh-15rem)] flex-col">
      <div className="flex-1 overflow-x-auto">
        {/* Header row style comes from index.css (thead th). */}
        <table className="w-full min-w-[1000px] table-fixed text-left text-sm text-ink-metric">
          <colgroup>
            {cols.map((width, i) => (
              <col key={i} style={width ? { width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
        <span>{pager.pageCount > 1 ? `Page ${pager.page + 1} of ${pager.pageCount}` : summary}</span>
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

// The canvas's small tag (2px corners, 12px semibold).
const CHIP = 'inline-flex w-fit items-center gap-1.5 rounded-[2px] px-2 py-0.5 text-xs font-semibold whitespace-nowrap'
const CHIP_WARN = `${CHIP} bg-amber-100 text-amber-900`
// Small grey line under a cell's main value.
const SUB = 'block text-[13px] leading-[18px] text-ink-muted'

function ResubmittedChip({ count }: { count: number }) {
  if (count <= 0) return null
  return <span className={`${CHIP_WARN} font-sans`}>Resubmitted{count > 1 ? ` ×${count}` : ''}</span>
}

// Reference code (mono) + Resubmitted tag on one line, optional
// "Requested <date>" under it.
function QuoteCell({ q, showDate = true }: { q: { reference_code: string | null; quote_request_id: number; resubmit_count: number; created_at: string }; showDate?: boolean }) {
  return (
    <td className={TD}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[13px] font-semibold tracking-[0.02em] text-ink">
          {q.reference_code ?? `#${q.quote_request_id}`}
        </span>
        <ResubmittedChip count={q.resubmit_count} />
      </span>
      {showDate && <span className={SUB}>Requested {formatDate(q.created_at)}</span>}
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
      <p>
        {formatLocationDisplay({ city: q.pickup_city, barangay: q.pickup_barangay, detail: q.pickup_location_text })}
      </p>
      <p className="flex items-center gap-1.5 text-ink-muted">
        <Icon name="arrow" size={14} />
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
  const [tab, setTab] = useState<Tab>('pricing')
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
      // The open ones: staff's turn (Pending, Countered) or the client's (Offered).
      .in('request_status', ['Pending', 'Countered', 'Offered'])
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

  const pricingQuotes = quotes.filter((q) => q.request_status !== 'Offered')
  const waitingQuotes = quotes.filter((q) => q.request_status === 'Offered')
  const visiblePending = (tab === 'waiting' ? waitingQuotes : pricingQuotes).filter((q) => matchesSearch(q, search))
  const pendingPaged = usePaged(visiblePending, `${tab}|${search}`, QUOTES_PER_PAGE)
  const today = toManilaDate(new Date())

  // Called by the modal after an offer / accept / withdraw / reject -- the
  // quote moved tab, so reload the open ones.
  function handleResolved(quoteRequestId: number) {
    setQuotes((prev) =>
      prev.filter((q) => q.quote_request_id !== quoteRequestId),
    )
    setSelectedQuote(null)
    loadQuotes()
    setRefreshKey((k) => k + 1)
  }

  return (
    <div>
      <PageHeader
        title="Quotations"
        subtitle="Price each request and send the client an offer; it becomes a booking once a rate is accepted."
        actions={
          <div className="flex gap-3">
            {/* The list doesn't update by itself -- quotes other admins
                handled, or new client quotes, show after a refresh. */}
            <button
              onClick={() => {
                loadQuotes()
                setRefreshKey((k) => k + 1)
              }}
              className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium"
            >
              <Icon name="refresh" />
              Refresh
            </button>
            <button
              onClick={() => setShowNewQuote(true)}
              className="btn-primary flex items-center gap-2 px-5 text-sm"
            >
              <Icon name="plus" />
              New Quote
            </button>
          </div>
        }
      />

      {/* Toolbar: tabs on the left, search on the right */}
      <div className="flex flex-wrap items-center gap-2 gap-y-3">
        {([
          ['pricing', 'Needs pricing'],
          ['waiting', 'Waiting on client'],
          ['approved', 'Approved'],
          ['closed', 'Rejected / Declined'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`flex h-11 items-center gap-2.5 rounded-[2px] border px-5 text-sm font-semibold ${
              tab === key
                ? 'border-primary bg-primary text-white'
                : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
            }`}
          >
            {label}
            {(key === 'pricing' || key === 'waiting') && !loading && (
              <span
                className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] px-1.5 text-xs font-bold ${
                  tab === key ? 'bg-white text-primary' : 'bg-primary text-white'
                }`}
              >
                {key === 'pricing' ? pricingQuotes.length : waitingQuotes.length}
              </span>
            )}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-3 text-sm font-medium text-ink-secondary">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Client or quote ID"
            className="h-11 w-64 rounded-[2px] border border-line-control bg-white px-3 text-sm text-ink-metric placeholder:text-ink-muted focus:border-primary sm:w-80"
          />
        </label>
      </div>

      {tab === 'approved' || tab === 'closed' ? (
        // key: reload when switching between the two history tabs or on Refresh
        <QuoteHistory
          key={`${tab}-${refreshKey}`}
          status={tab === 'approved' ? 'Approved' : 'Closed'}
          search={search}
        />
      ) : (
        <TableCard
          cols={PENDING_COLS}
          pager={pendingPaged.pager}
          summary={`${plural(visiblePending.length, 'quotation')} ${tab === 'waiting' ? 'waiting on the client' : 'waiting for review'}`}
          head={
            <>
              <th className={TH}>Quote</th>
              <th className={TH}>Client</th>
              <th className={TH}>Pickup → Delivery</th>
              <th className={TH}>Rate</th>
              <th className={TH}>Pickup Date</th>
              <th className={TH}>Cargo Type</th>
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
              {search
                ? 'No quotes match your search.'
                : tab === 'waiting'
                  ? 'No offers waiting on a client.'
                  : 'Nothing to price right now.'}
            </MessageRow>
          ) : (
            pendingPaged.rows.map((quote) => (
              <tr key={quote.quote_request_id} className={ROW}>
                <QuoteCell q={quote} showDate={false} />
                <td className={`${TD} font-semibold`}>{quote.client_name}</td>
                <RouteCell q={quote} />
                {/* Rate, "× N trips" under it, then where the negotiation is */}
                <td className={TD}>
                  {quote.request_status === 'Pending' ? (
                    <span className="text-ink-muted">Not priced</span>
                  ) : (
                    <span className="font-semibold tabular-nums">{formatMoney(quote.proposed_rate ?? 0)}</span>
                  )}
                  {quote.delivery_order_count != null && (
                    <span className={SUB}>× {plural(quote.delivery_order_count, 'trip')}</span>
                  )}
                  {quote.request_status !== 'Pending' && (
                    <span
                      className={`${CHIP} mt-1 ${
                        quote.request_status === 'Countered' ? 'bg-sky-100 text-sky-800' : 'bg-slate-200 text-ink-secondary'
                      }`}
                    >
                      {quote.request_status === 'Countered' ? "Client's counter" : 'Our offer'}
                    </span>
                  )}
                  {/* An offer nobody answered by its pickup date: stale, then expired. */}
                  {quote.request_status === 'Offered' && offerTiming(quote.preferred_pickup_date, today) !== 'open' && (
                    <span className={`${CHIP} mt-1 bg-red-100 text-red-800`}>
                      {offerTiming(quote.preferred_pickup_date, today) === 'expired' ? 'Offer expired' : 'Pickup date passed'}
                    </span>
                  )}
                </td>
                <td className={TD}>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}</span>
                    {quote.preferred_pickup_date === today && <span className={CHIP_WARN}>Today</span>}
                  </span>
                  {quote.is_last_day_of_port_storage && (
                    <span className={`${CHIP_WARN} mt-1`}>Urgent · last free storage day</span>
                  )}
                </td>
                <td className={TD}>{cargoSummary(parseCargoLines(quote.cargo_lines))}</td>
                <td className={TD}>
                  <button
                    onClick={() => setSelectedQuote(quote)}
                    className="btn-primary h-11 px-5 text-sm"
                  >
                    {tab === 'waiting' ? 'View' : 'Review'}
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
  request_status: string
  decline_reason: string | null
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
async function fetchQuoteHistory(status: 'Approved' | 'Closed'): Promise<HistoryResult> {
  const { data, error: quotesError } = await supabase
    .from('quote_requests')
    .select(
      'quote_request_id, reference_code, client_name, pickup_city, pickup_barangay, pickup_location_text, delivery_city, delivery_barangay, delivery_location_text, proposed_rate, delivery_order_count, rejection_tag, rejection_reason, request_status, decline_reason, resubmit_count, created_at',
    )
    // Closed = rejected by us or declined by the client.
    .in('request_status', status === 'Approved' ? ['Approved'] : ['Rejected', 'Declined'])
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

function QuoteHistory({ status, search }: { status: 'Approved' | 'Closed'; search: string }) {
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
  const cols = approved ? 7 : 5

  return (
    <TableCard
      cols={approved ? APPROVED_COLS : CLOSED_COLS}
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
              <th className={TH}>Booking Status</th>
            </>
          ) : (
            <th className={TH}>Reason</th>
          )}
          {approved && (
            <th className={TH}>
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
            <tr key={q.quote_request_id} className={ROW}>
              <QuoteCell q={q} />
              <td className={`${TD} font-semibold`}>
                {/* The booking's client record when there is one (that's
                    who is billed), else the name on the quote. */}
                {booking?.client_name ?? q.client_name}
              </td>
              <RouteCell q={q} />
              <td className={TD}>
                <span className="font-semibold tabular-nums">
                  {q.proposed_rate !== null ? formatMoney(q.proposed_rate) : '—'}
                </span>
                {(q.delivery_order_count ?? 1) > 1 && (
                  <span className={SUB}>× {q.delivery_order_count} trips</span>
                )}
              </td>
              {approved ? (
                booking ? (
                  <>
                    <td className={TD}>
                      <Link
                        to={`/dashboard/bookings?booking=${booking.booking_id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        Booking #{booking.booking_id}
                      </Link>
                      {booking.booking_date && (
                        <span className={SUB}>{formatDate(booking.booking_date)}</span>
                      )}
                    </td>
                    <td className={TD}>
                      <StatusBadge status={booking.booking_status} icon />
                    </td>
                    <td className={TD}>
                      <Link
                        to={`/dashboard/bookings?booking=${booking.booking_id}`}
                        aria-label={`Open booking #${booking.booking_id}`}
                        className="flex h-11 w-11 items-center justify-center text-primary"
                      >
                        <Icon name="chevron" size={18} />
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
                <td className={`${TD} font-medium text-ink-secondary`}>
                  {tag && <span className={`${CHIP} mb-1 bg-red-100 text-red-800`}>{tag}</span>}
                  {q.request_status === 'Declined' ? (
                    <>
                      <span className={`${CHIP} mb-1 bg-slate-200 text-ink-secondary`}>Declined by client</span>
                      <span className="block">{q.decline_reason ?? '—'}</span>
                    </>
                  ) : (
                    <span className="block">{q.rejection_reason ?? '—'}</span>
                  )}
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
