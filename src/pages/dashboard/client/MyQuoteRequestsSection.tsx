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
// A Rejected quote has "Edit & resubmit": it loads the quote's shipment
// fields, opens the same quote form pre-filled (NewQuoteModal), and
// sending puts the same quote back to Pending for staff.
//
// Clients don't set a rate: staff send an offer (lib/quoteOffers.ts). An
// Offered quote shows QuoteOfferCard -- Accept (booking created at once),
// Counter-offer (own rate and/or dates) or Decline (with a reason).
// Offers waiting for an answer are listed first.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import NewQuoteModal from './NewQuoteModal'
import QuoteOfferCard from './QuoteOfferCard'
import { formatMoney } from '../../../lib/format'
import { showToast } from '../../../components/Toast'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { withdrawQuoteRequest } from '../../../lib/quoteOffers'
import type { ResubmitTarget } from './ClientQuoteForm'
import {
  REJECTION_TAGS,
  SHIPMENT_COLUMNS,
  cargoSummary,
  parseCargoLines,
  quoteToForm,
  rejectionErrors,
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
  delivery_order_count: number | null
  // Saved with our offer; the downpayment shown on it comes from this.
  cost_per_trip: number | null
  // Saved with our offer (the Capacity Check re-reads them when the client accepts).
  hours_per_trip: number | null
  is_last_day_of_port_storage: boolean | null
  decline_reason: string | null
  created_at: string
}

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
  const [resubmit, setResubmit] = useState<ResubmitTarget | null>(null)
  const [openingId, setOpeningId] = useState<number | null>(null)
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null)

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
        'quote_request_id, reference_code, request_status, rejection_reason, rejection_tag, resubmit_count, pickup_city, pickup_barangay, delivery_city, delivery_barangay, cargo_lines, preferred_pickup_date, preferred_delivery_date, proposed_rate, delivery_order_count, cost_per_trip, hours_per_trip, is_last_day_of_port_storage, decline_reason, created_at',
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

  // Fetch the full shipment details of a rejected quote, then open the
  // form with them.
  async function openResubmit(quote: QuoteRow) {
    setOpeningId(quote.quote_request_id)
    const { data, error: loadError } = await supabase
      .from('quote_requests')
      .select(SHIPMENT_COLUMNS)
      .eq('quote_request_id', quote.quote_request_id)
      .maybeSingle()
    setOpeningId(null)

    if (loadError || !data) {
      setError(loadError?.message ?? 'Could not open that quote. Refresh and try again.')
      return
    }
    setResubmit({
      quoteId: quote.quote_request_id,
      referenceCode: quote.reference_code,
      form: quoteToForm(data),
      errors: rejectionErrors(quote.rejection_tag, quote.rejection_reason),
    })
  }

  if (loading) {
    return <p className="text-slate-500">Loading your quote requests...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (quotes.length === 0) {
    return (
      <EmptyState message="No open quote requests." hint="Approved quotes appear under My Bookings." />
    )
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

  const offersWaiting = quotes.filter((q) => q.request_status === 'Offered').length

  return (
    <div className="grid gap-3">
      {offersWaiting > 0 && (
        <p className="bg-slate-900 px-4 py-2.5 text-sm font-medium text-white">
          You have {offersWaiting} {offersWaiting === 1 ? 'offer' : 'offers'} to answer.
        </p>
      )}
      {quotes.map((quote) => (
        <div
          key={quote.quote_request_id}
          className="border border-slate-200 p-4"
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
                {cargoSummary(parseCargoLines(quote.cargo_lines))} · Pickup{' '}
                {formatDate(quote.preferred_pickup_date)}
              </p>
            </div>
            <StatusBadge
              status={quote.request_status}
              label={
                quote.request_status === 'Pending' && quote.resubmit_count > 0
                  ? 'Resubmitted'
                  : CLIENT_STATUS_LABELS[quote.request_status]
              }
            />
          </div>
          {quote.request_status === 'Offered' && clientId && (
            <QuoteOfferCard
              quote={quote}
              onAnswered={(message) => {
                showToast(message)
                load(clientId)
              }}
            />
          )}
          {quote.request_status === 'Countered' && (
            <p className="mt-2 bg-slate-50 p-3 text-sm text-slate-700">
              You asked for {formatMoney(quote.proposed_rate ?? 0)} per trip. We'll reply here with a decision or a new offer.
            </p>
          )}
          {quote.request_status === 'Declined' && quote.decline_reason && (
            <p className="mt-2 bg-slate-50 p-3 text-sm text-slate-700">You declined: {quote.decline_reason}</p>
          )}
          {quote.request_status === 'Rejected' && quote.rejection_reason && (
            <div className="mt-2 bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Reason
                {quote.rejection_tag && quote.rejection_tag in REJECTION_TAGS && quote.rejection_tag !== 'Other' && (
                  <span className="ml-2 bg-red-100 px-1.5 py-0.5 normal-case tracking-normal text-red-700">
                    {REJECTION_TAGS[quote.rejection_tag as RejectionTag].label}
                  </span>
                )}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                {quote.rejection_reason}
              </p>
            </div>
          )}
          {['Pending', 'Offered', 'Countered'].includes(quote.request_status) && (
            <button
              type="button"
              onClick={() => withdraw(quote)}
              disabled={withdrawingId !== null}
              className="mt-3 text-xs font-medium text-slate-500 underline hover:text-red-700 disabled:opacity-50"
            >
              {withdrawingId === quote.quote_request_id ? 'Withdrawing...' : 'Withdraw this quote'}
            </button>
          )}
          {quote.request_status === 'Rejected' && (
            <button
              type="button"
              onClick={() => openResubmit(quote)}
              disabled={openingId !== null}
              className="btn-primary mt-3 px-3 py-1.5 text-xs font-medium"
            >
              {openingId === quote.quote_request_id ? 'Opening...' : 'Edit & resubmit'}
            </button>
          )}
        </div>
      ))}

      {resubmit && clientId && (
        <NewQuoteModal
          // key: a fresh form for each quote opened
          key={resubmit.quoteId}
          clientId={clientId}
          resubmit={resubmit}
          onCreated={() => {
            setResubmit(null)
            load(clientId)
          }}
        />
      )}
    </div>
  )
}

export default MyQuoteRequestsSection
