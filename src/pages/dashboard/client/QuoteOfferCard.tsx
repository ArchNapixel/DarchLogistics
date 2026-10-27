// QuoteOfferCard: the client's side of a price offer (lib/quoteOffers.ts)
// -- the "Our offer for Q-..." panel beside the list on My Quotes (the
// canvas's Client My Quotes board). Shown for a quote that is Offered: the
// request (route, trips, cargo, terms), Darch Logistics' rate per trip, the
// total, the downpayment, the dates and their note -- then Accept Offer
// (the booking is created right away, in the database), Counter-offer…
// (pop-up: the client's own rate, and other dates if they want) or
// Decline… (pop-up, reason required). All three go through
// respond_to_quote_offer, which only lets a client answer their own quote
// while the offer is open.
import { useEffect, useState, type ReactNode } from 'react'
import { filterAmountInput } from '../../../lib/amountInput'
import { formatDate, formatMoney } from '../../../lib/format'
import { downpaymentFor } from '../../../lib/downpayment'
import { loadQuoteOffers, respondToQuoteOffer, type QuoteOfferRow } from '../../../lib/quoteOffers'
import OfferComparison from '../../../components/OfferComparison'
import { todayDateString } from '../../../lib/quoteRequest'
import { offerTiming } from '../../../lib/offerTiming'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { checkCapacity } from '../../../lib/capacity'
import { buildDemand, loadCapacityInputs } from '../../../lib/capacityLoad'

const inputClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'

export type OfferQuote = {
  quote_request_id: number
  proposed_rate: number | null
  delivery_order_count: number | null
  cost_per_trip: number | null
  preferred_pickup_date: string | null
  preferred_delivery_date: string | null
  // What the Capacity Check needs to re-check the date when the client accepts.
  cargo_lines: unknown
  hours_per_trip: number | null
  is_last_day_of_port_storage: boolean | null
}

// A pop-up for Counter-offer / Decline.
function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="offer-dialog-h" className="card w-full max-w-[560px]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="offer-dialog-h" className="text-xl leading-7 font-bold text-ink">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="flex flex-col gap-4 px-6 py-5">{children}</div>
        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</footer>
      </div>
    </div>
  )
}

function Required() {
  return <span className="text-xs text-amber-800">Required</span>
}

function QuoteOfferCard({
  quote,
  reference,
  route,
  cargo,
  terms,
  onAnswered,
}: {
  quote: OfferQuote
  // For the panel's header and "Request" part.
  reference: string
  route: string
  cargo: string
  terms: string
  // Called with a message for the client once they've answered.
  onAnswered: (message: string) => void
}) {
  const rate = quote.proposed_rate ?? 0
  // Past its pickup date the offer can't be accepted (the trips would start in the past).
  const timing = offerTiming(quote.preferred_pickup_date, todayDateString())
  const trips = quote.delivery_order_count ?? 1
  const downpayment = quote.cost_per_trip != null ? downpaymentFor(rate, quote.cost_per_trip, trips) : null
  const [note, setNote] = useState<string | null>(null)
  // On a new offer after the client's counter: their counter and our offer,
  // compared (changes highlighted). Null on a first offer.
  const [compare, setCompare] = useState<{ before: QuoteOfferRow; now: QuoteOfferRow } | null>(null)
  const [mode, setMode] = useState<'view' | 'counter' | 'decline'>('view')
  const [counterRate, setCounterRate] = useState('')
  const [pickupDate, setPickupDate] = useState(quote.preferred_pickup_date ?? '')
  const [deadline, setDeadline] = useState(quote.preferred_delivery_date ?? '')
  const [reason, setReason] = useState('')
  const [counterNote, setCounterNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The note that came with our latest offer, if any.
  useEffect(() => {
    loadQuoteOffers(quote.quote_request_id).then(({ rows }) => {
      const oursIndex = rows.map((r) => r.party === 'Business' && r.action === 'Offer').lastIndexOf(true)
      const ours = oursIndex >= 0 ? rows[oursIndex] : undefined
      setNote(ours?.note ?? null)
      // The client's last counter before this offer, if any.
      const theirs = rows.slice(0, Math.max(oursIndex, 0)).reverse().find((r) => r.action === 'Counter')
      setCompare(ours && theirs ? { before: theirs, now: ours } : null)
    })
  }, [quote.quote_request_id])

  // Can we still run the offered trips on the offered date? (Can't be
  // checked -> true: never block a client because the check itself failed.)
  async function dateStillFree() {
    if (!quote.preferred_pickup_date || !quote.hours_per_trip) return true
    const args = {
      cargoLines: quote.cargo_lines,
      hours: quote.hours_per_trip,
      pickupDate: quote.preferred_pickup_date,
      deadlineDate: quote.preferred_delivery_date,
      storage: quote.is_last_day_of_port_storage === true,
    }
    const { inputs } = await loadCapacityInputs(buildDemand({ ...args, defaultStartMinutes: 360 }), quote.quote_request_id)
    if (!inputs) return true
    const demand = buildDemand({ ...args, defaultStartMinutes: inputs.defaultStartMinutes })
    if (demand.trips.length === 0) return true
    return checkCapacity(demand, inputs.resources).status === 'fits'
  }

  async function accept() {
    const ok = await confirmDialog({
      title: `Accept ${formatMoney(rate)} per trip?`,
      message: `${trips} ${trips === 1 ? 'trip' : 'trips'}, ${formatMoney(rate * trips)} in total. Your booking is created right away${
        downpayment !== null ? `; trips start once the ${formatMoney(downpayment)} downpayment is paid` : ''
      }.`,
      confirmLabel: 'Accept offer',
    })
    if (!ok) return
    setSaving(true)
    setError(null)
    // Capacity Check again: another booking may have taken the drivers or
    // trucks since our offer went out. If the date is gone, don't book it;
    // staff send a new date.
    if (!(await dateStillFree())) {
      setSaving(false)
      return setError("Sorry, that pickup date was just taken. We'll send you a new date soon, or you can send a counter-offer with another date.")
    }
    const { bookingId, error: rpcError } = await respondToQuoteOffer({ quoteId: quote.quote_request_id, action: 'accept' })
    setSaving(false)
    if (rpcError) return setError(rpcError)
    onAnswered(`Offer accepted. Booking #${bookingId} is now under My Bookings.`)
  }

  async function sendCounter() {
    const value = Number(counterRate)
    if (!counterRate || !(value > 0)) return setError('Enter your rate per trip.')
    if (!/^\d+(\.\d{1,2})?$/.test(counterRate)) return setError('Rate: max 2 decimals.')
    if (!pickupDate) return setError('Enter a pickup date.')
    if (pickupDate < todayDateString()) return setError('The pickup date is in the past.')
    if (deadline && deadline < pickupDate) return setError('The deadline is before the pickup date.')
    setSaving(true)
    setError(null)
    const { error: rpcError } = await respondToQuoteOffer({
      quoteId: quote.quote_request_id,
      action: 'counter',
      rate: value,
      // Only send dates that changed.
      pickupDate: pickupDate !== quote.preferred_pickup_date ? pickupDate : null,
      deadlineDate: deadline && deadline !== quote.preferred_delivery_date ? deadline : null,
      note: counterNote,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError)
    onAnswered(`Counter-offer sent (${formatMoney(value)} per trip). We'll reply here.`)
  }

  async function decline() {
    if (!reason.trim()) return setError('Please tell us why you are declining.')
    setSaving(true)
    setError(null)
    const { error: rpcError } = await respondToQuoteOffer({
      quoteId: quote.quote_request_id,
      action: 'decline',
      note: reason,
    })
    setSaving(false)
    if (rpcError) return setError(rpcError)
    onAnswered('Offer declined. Thank you for letting us know.')
  }

  function close() {
    setMode('view')
    setError(null)
  }

  const KV = 'text-[13px] leading-[18px] font-medium text-ink-muted'
  const VAL = 'text-[15px] leading-[22px] font-medium text-ink'

  return (
    <section aria-labelledby="of-h" className="card flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-4">
        <h2 id="of-h" className="text-lg leading-[26px] font-bold text-ink">
          Our offer for <span className="font-mono">{reference}</span>
        </h2>
        <span className="rounded-[2px] bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">Offer received</span>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          <div className="col-span-2">
            <dt className={KV}>Route</dt>
            <dd className={VAL}>{route}</dd>
          </div>
          <div>
            <dt className={KV}>Trips</dt>
            <dd className={VAL}>{trips}</dd>
          </div>
          <div>
            <dt className={KV}>Cargo</dt>
            <dd className={VAL}>{cargo}</dd>
          </div>
          <div>
            <dt className={KV}>Payment terms</dt>
            <dd className={VAL}>{terms}</dd>
          </div>
        </dl>

        <section aria-label="Offer" className="border-2 border-primary bg-primary-soft px-4 py-3">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-primary/30 pb-3">
            <div>
              <p className={KV}>Rate per trip</p>
              <p className="text-[28px] leading-9 font-bold text-ink tabular-nums">{formatMoney(rate)}</p>
            </div>
            <div className="text-right">
              <p className={KV}>
                Total <span className="font-normal">· {trips} {trips === 1 ? 'trip' : 'trips'} × rate</span>
              </p>
              <p className="text-lg font-bold text-ink tabular-nums">{formatMoney(rate * trips)}</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-sm">
            {downpayment !== null && (
              <div className="col-span-2">
                <dt className={KV}>Downpayment</dt>
                <dd className="font-semibold text-ink tabular-nums">{formatMoney(downpayment)} before the first trip</dd>
              </div>
            )}
            <div>
              <dt className={KV}>Pickup date</dt>
              <dd className="font-medium text-ink">{quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}</dd>
            </div>
            <div>
              <dt className={KV}>Deadline</dt>
              <dd className="font-medium text-ink">{quote.preferred_delivery_date ? formatDate(quote.preferred_delivery_date) : '—'}</dd>
            </div>
            <div>
              <dt className={KV}>Answer by</dt>
              <dd className="font-medium text-ink">{quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}</dd>
            </div>
          </dl>
        </section>

        {note && (
          <div>
            <p className={KV}>Our note</p>
            <p className="text-sm text-ink-metric">"{note}"</p>
          </div>
        )}

        {compare && (
          <div className="border border-line bg-slate-50 px-3 py-2">
            <p className="mb-1 text-xs font-semibold tracking-wide text-ink-secondary uppercase">What changed from your counter-offer</p>
            <OfferComparison before={compare.before} now={compare.now} beforeLabel="You asked" nowLabel="Our new offer" />
          </div>
        )}

        {timing !== 'open' && (
          <p className="bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {timing === 'expired'
              ? 'This offer has expired. Send a counter-offer with a new pickup date and we will reply.'
              : 'The pickup date on this offer has passed. Send a counter-offer with a new pickup date and we will reply.'}
          </p>
        )}

        <p className="border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
          Accepting books your trucks right away if they're still free. If someone just took that date, we'll ask you to counter with
          a new one. After the pickup date passes you can only counter, and 3 days later the offer expires.
        </p>

        {mode === 'view' && error && (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
        <button type="button" onClick={() => setMode('decline')} disabled={saving} className="btn-danger px-4 text-sm">
          Decline…
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => setMode('counter')} disabled={saving} className="btn-secondary px-4 text-sm font-medium">
          Counter-offer…
        </button>
        {timing === 'open' && (
          <button type="button" onClick={accept} disabled={saving} className="btn-primary px-5 text-sm">
            {saving ? 'Accepting...' : 'Accept Offer'}
          </button>
        )}
      </div>

      {mode === 'counter' && (
        <Dialog
          title="Counter-offer"
          subtitle={`Our offer: ${formatMoney(rate)} per trip · pickup ${quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}`}
          onClose={close}
          footer={
            <>
              <button type="button" onClick={close} disabled={saving} className="btn-secondary px-5 text-sm font-medium">
                Cancel
              </button>
              <button type="button" onClick={sendCounter} disabled={saving} className="btn-primary px-5 text-sm">
                {saving ? 'Sending...' : 'Send Counter-offer'}
              </button>
            </>
          }
        >
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
          <label className="flex flex-col gap-1.5">
            <span className="flex justify-between gap-2 text-sm font-semibold text-ink">
              Your rate per trip (₱) <Required />
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={counterRate}
              onChange={(e) => setCounterRate(filterAmountInput(e.target.value))}
              placeholder="0.00"
              className={`${inputClasses} text-right tabular-nums`}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">
                Pickup date <span className="font-normal text-ink-muted">(change if you need)</span>
              </span>
              <input type="date" value={pickupDate} min={todayDateString()} onChange={(e) => setPickupDate(e.target.value)} className={inputClasses} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">
                Deadline <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <input type="date" value={deadline} min={pickupDate || undefined} onChange={(e) => setDeadline(e.target.value)} className={inputClasses} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink">
              Message <span className="font-normal text-ink-muted">(optional)</span>
            </span>
            <textarea value={counterNote} maxLength={300} rows={3} onChange={(e) => setCounterNote(e.target.value)} className={`${inputClasses} resize-none py-2.5`} />
          </label>
          <p className="border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
            The quote will show "Your counter-offer sent". We'll accept it or send you a new offer.
          </p>
        </Dialog>
      )}

      {mode === 'decline' && (
        <Dialog
          title="Decline this offer?"
          subtitle={`${reference} · ${formatMoney(rate)} per trip`}
          onClose={close}
          footer={
            <>
              <button type="button" onClick={close} disabled={saving} className="btn-secondary px-5 text-sm font-medium">
                Keep Offer
              </button>
              <button type="button" onClick={decline} disabled={saving} className="btn-danger px-5 text-sm">
                {saving ? 'Sending...' : 'Decline Offer'}
              </button>
            </>
          }
        >
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
          <label className="flex flex-col gap-1.5">
            <span className="flex justify-between gap-2 text-sm font-semibold text-ink">
              Reason <Required />
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="Tell us why, so we can do better next time"
              className={`${inputClasses} resize-none py-2.5`}
            />
          </label>
          <p className="border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
            The quote moves to Declined and is kept as a record.
          </p>
        </Dialog>
      )}
    </section>
  )
}

export default QuoteOfferCard
