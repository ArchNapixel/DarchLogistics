// MyQuoteRequestsSection: the client's own quote requests that haven't
// turned into a booking -- Pending (waiting on staff) and Rejected (with
// the reason staff gave). Approved quotes aren't listed here since they
// already show up under My Bookings. Without this, a quote vanished from
// the portal the moment it was sent until staff approved it.
//
// Only quotes with client_id set are found -- portal-submitted ones
// always have it. Needs the quote_requests_select_own_client RLS policy
// (client_id -> users.auth_user_id); without it this just shows empty.
//
// A Rejected quote has "Edit & Resubmit": it opens the New Quote Request
// page with ?resubmit=<id>, which loads the quote pre-filled; sending puts
// the same quote back to Pending for staff.
//
// Clients don't set a rate: staff send an offer (lib/quoteOffers.ts).
// Layout (the canvas's Client My Quotes board): "Needs your answer"
// (Offered quotes, click one to show it) and "Other quotes" on the left;
// the selected offer's panel (QuoteOfferCard -- Accept / Counter-offer… /
// Decline…) on the right.
import { useEffect, useEffectEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate } from '../../../lib/format'
import QuoteOfferCard from './QuoteOfferCard'
import { parseLineRates, rateLabel } from '../../../lib/lineRates'
import { showToast } from '../../../components/Toast'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { withdrawQuoteRequest } from '../../../lib/quoteOffers'
import {
  PAYMENT_TERMS_LABELS,
  REJECTION_TAGS,
  cargoSummary,
  parseCargoLines,
  type RejectionTag,
} from '../../../lib/quoteRequest'

type QuoteRow = {
  quote_request_id: number
  reference_code: string | null
  request_status: string
  rejection_reason: string | null
  rejection_tag: string | null
  resubmit_count: number
  pickup_city: string
  pickup_barangay: string
  delivery_city: string
  delivery_barangay: string
  // jsonb list of cargo lines (lib/quoteRequest.ts CargoLineRow).
  cargo_lines: unknown
  preferred_pickup_date: string
  preferred_delivery_date: string | null
  // The rate on the table: our offer (Offered) or the client's counter.
  proposed_rate: number | null
  // One rate per cargo line (lib/lineRates.ts); proposed_rate is their average.
  line_rates: number[] | null
  delivery_order_count: number | null
  // Saved with our offer; the downpayment shown on it comes from this.
  cost_per_trip: number | null
  // Saved with our offer (the Capacity Check re-reads them when the client accepts).
  hours_per_trip: number | null
  is_last_day_of_port_storage: boolean | null
  payment_terms: string | null
  decline_reason: string | null
  created_at: string
}

// "₱5,500.00", or "₱5,000.00 – ₱8,000.00" when the cargo lines are priced differently.
const quoteRateLabel = (q: QuoteRow) =>
  rateLabel(parseLineRates(q.line_rates, parseCargoLines(q.cargo_lines).length, q.proposed_rate))

// What the client sees for each status.
const CLIENT_STATUS_LABELS: Record<string, string> = {
  Pending: 'Waiting for our price',
  Offered: 'Offer received',
  Countered: 'Your counter-offer sent',
  Rejected: 'Rejected',
  Declined: 'Declined',
  Withdrawn: 'Withdrawn',
}

function MyQuoteRequestsSection() {
  const { clientId } = useAuth()
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null)
  // The offer shown in the panel (null = the first one waiting).
  const [selectedId, setSelectedId] = useState<number | null>(null)

  async function load(id: number) {
    setLoading(true)

    const { data, error: loadError } = await supabase
      .from('quote_requests')
      .select(
        'quote_request_id, reference_code, request_status, rejection_reason, rejection_tag, resubmit_count, pickup_city, pickup_barangay, delivery_city, delivery_barangay, cargo_lines, preferred_pickup_date, preferred_delivery_date, proposed_rate, line_rates, delivery_order_count, cost_per_trip, hours_per_trip, is_last_day_of_port_storage, payment_terms, decline_reason, created_at',
      )
      .eq('client_id', id)
      .neq('request_status', 'Approved')
      .order('created_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    // Offers waiting for the client's answer first (stable: newest first after).
    setQuotes([...data].sort((a, b) => Number(b.request_status === 'Offered') - Number(a.request_status === 'Offered')))
    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever clientId changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    if (clientId) {
      load(clientId)
    } else {
      setLoading(false)
    }
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [clientId])

  if (loading) {
    return <p className="text-slate-500">Loading your quote requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }


  // Take back a quote that is still open (Pending / Offered / Countered).
  async function withdraw(quote: QuoteRow) {
    const ok = await confirmDialog({
      title: 'Withdraw this quote?',
      message: `${quote.reference_code ?? `Quote #${quote.quote_request_id}`} will be cancelled. You can send a new quote any time.`,
      confirmLabel: 'Withdraw quote',
      danger: true,
    })
    if (!ok || !clientId) return
    setWithdrawingId(quote.quote_request_id)
    const withdrawError = await withdrawQuoteRequest(quote.quote_request_id)
    setWithdrawingId(null)
    if (withdrawError) return showToast(withdrawError, 'error')
    showToast('Quote withdrawn.')
    load(clientId)
  }

  const offers = quotes.filter((q) => q.request_status === 'Offered')
  const others = quotes.filter((q) => q.request_status !== 'Offered')
  const selected = offers.find((q) => q.quote_request_id === selectedId) ?? offers[0] ?? null

  const reference = (q: QuoteRow) => q.reference_code ?? `Quote #${q.quote_request_id}`
  const route = (q: QuoteRow) => `${q.pickup_barangay}, ${q.pickup_city} → ${q.delivery_barangay}, ${q.delivery_city}`
  const trips = (q: QuoteRow) => {
    const n = q.delivery_order_count ?? 0
    return `${n} ${n === 1 ? 'trip' : 'trips'}`
  }
  const terms = (q: QuoteRow) =>
    q.payment_terms ? (PAYMENT_TERMS_LABELS[q.payment_terms as keyof typeof PAYMENT_TERMS_LABELS] ?? q.payment_terms) : '—'
  const GROUP = 'px-5 pt-4 pb-2 text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase'

  const withdrawButton = (quote: QuoteRow) =>
    ['Pending', 'Offered', 'Countered'].includes(quote.request_status) && (
      <button
        type="button"
        onClick={() => withdraw(quote)}
        disabled={withdrawingId !== null}
        className="btn-secondary px-3.5 text-sm font-medium"
      >
        {withdrawingId === quote.quote_request_id ? 'Withdrawing...' : 'Withdraw This Quote…'}
      </button>
    )

  return (
    <div className={`grid gap-4 ${selected ? 'xl:grid-cols-[minmax(0,1fr)_480px]' : ''} xl:items-start`}>
      <section aria-label="Your quotes" className="card flex min-w-0 flex-col pb-2">
        {quotes.length === 0 && (
          <div className="px-5 py-8 text-center">
            <p className="font-semibold text-ink">No open quote requests.</p>
            <p className="mt-1 text-[13px] text-ink-muted">Send a New Quote Request. Accepted quotes move to My Bookings.</p>
          </div>
        )}

        {offers.length > 0 && (
          <>
            <h2 className={GROUP}>Needs your answer</h2>
            <div className="flex flex-col gap-2 px-5">
              {offers.map((quote) => {
                const isSelected = quote.quote_request_id === selected?.quote_request_id
                return (
                  <article key={quote.quote_request_id} aria-label={`Quote ${reference(quote)} with an offer`}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(quote.quote_request_id)}
                      className={`flex w-full flex-col gap-1 px-4 py-3 text-left ${
                        isSelected
                          ? 'border-2 border-primary bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]'
                          : 'border-2 border-amber-600 bg-amber-50 hover:bg-amber-100'
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-ink">{reference(quote)}</span>
                        <span className="rounded-[2px] bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">Offer received</span>
                        <span className="ml-auto text-sm font-semibold text-ink tabular-nums">{quoteRateLabel(quote)} per trip</span>
                      </span>
                      <span className="text-sm text-ink-metric">
                        {route(quote)} · {trips(quote)}
                      </span>
                    </button>
                  </article>
                )
              })}
            </div>
          </>
        )}

        {others.length > 0 && (
          <>
            <h2 className={GROUP}>{offers.length > 0 ? 'Other quotes' : 'Your quotes'}</h2>
            <div className="flex flex-col gap-2 px-5">
              {others.map((quote) => (
                <article key={quote.quote_request_id} aria-label={`Quote ${reference(quote)}`} className="flex flex-col gap-1.5 border border-line px-4 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-ink">{reference(quote)}</span>
                    <StatusBadge
                      status={quote.request_status}
                      label={
                        quote.request_status === 'Pending' && quote.resubmit_count > 0
                          ? 'Resubmitted · waiting for our price'
                          : CLIENT_STATUS_LABELS[quote.request_status]
                      }
                      icon
                    />
                  </span>
                  <span className="text-sm text-ink-metric">{route(quote)}</span>
                  <span className="text-[13px] text-ink-muted">
                    {trips(quote)} · {cargoSummary(parseCargoLines(quote.cargo_lines))} · Pickup {formatDate(quote.preferred_pickup_date)}
                  </span>

                  {quote.request_status === 'Countered' && (
                    <p className="bg-slate-50 px-3 py-2 text-sm text-ink-secondary">
                      You asked for {quoteRateLabel(quote)} per trip. We'll reply here with a decision or a new offer.
                    </p>
                  )}
                  {quote.request_status === 'Declined' && quote.decline_reason && (
                    <p className="bg-slate-50 px-3 py-2 text-sm text-ink-secondary">Your reason: {quote.decline_reason}</p>
                  )}
                  {quote.request_status === 'Rejected' && quote.rejection_reason && (
                    <p className="bg-red-50 px-3 py-2 text-sm text-red-900">
                      {quote.rejection_tag && quote.rejection_tag in REJECTION_TAGS && quote.rejection_tag !== 'Other' && (
                        <span className="mr-2 rounded-[2px] bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">
                          {REJECTION_TAGS[quote.rejection_tag as RejectionTag].label}
                        </span>
                      )}
                      Our reason: {quote.rejection_reason}
                    </p>
                  )}

                  {(['Pending', 'Countered'].includes(quote.request_status) || quote.request_status === 'Rejected') && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {withdrawButton(quote)}
                      {quote.request_status === 'Rejected' && (
                        <button
                          type="button"
                          onClick={() => navigate(`/dashboard/quotes/new?resubmit=${quote.quote_request_id}`)}
                          className="btn-primary px-4 text-sm"
                        >
                          Edit &amp; Resubmit
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {selected && clientId && (
        <div className="flex flex-col gap-3">
          <QuoteOfferCard
            // key: fresh state (mode, typed counter) per quote
            key={selected.quote_request_id}
            quote={selected}
            reference={reference(selected)}
            route={route(selected)}
            cargo={cargoSummary(parseCargoLines(selected.cargo_lines))}
            terms={terms(selected)}
            onAnswered={(message) => {
              showToast(message)
              setSelectedId(null)
              load(clientId)
            }}
          />
          <div className="flex justify-end">{withdrawButton(selected)}</div>
        </div>
      )}
    </div>
  )
}

export default MyQuoteRequestsSection
