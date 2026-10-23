// QuoteOfferCard: the client's side of a price offer (lib/quoteOffers.ts).
// Shown on a quote that is Offered: Darch Logistics' rate per trip, the
// total, the dates, the downpayment and their note -- then Accept (the
// booking is created right away, in the database), Counter-offer (the
// client's own rate, and other dates if they want) or Decline (reason
// required). All three go through respond_to_quote_offer, which only lets
// a client answer their own quote while the offer is open.
import { useEffect, useState } from 'react'
import { formatDate, formatMoney } from '../../../lib/format'
import { downpaymentFor } from '../../../lib/downpayment'
import { loadQuoteOffers, respondToQuoteOffer, type QuoteOfferRow } from '../../../lib/quoteOffers'
import OfferComparison from '../../../components/OfferComparison'
import { todayDateString } from '../../../lib/quoteRequest'
import { confirmDialog } from '../../../components/ConfirmDialog'

const inputClasses =
  'border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none'

export type OfferQuote = {
  quote_request_id: number
  proposed_rate: number | null
  delivery_order_count: number | null
  cost_per_trip: number | null
  preferred_pickup_date: string | null
  preferred_delivery_date: string | null
}

function QuoteOfferCard({
  quote,
  onAnswered,
}: {
  quote: OfferQuote
  // Called with a message for the client once they've answered.
  onAnswered: (message: string) => void
}) {
  const rate = quote.proposed_rate ?? 0
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

  return (
    <div className="mt-3 border-2 border-slate-900 p-4">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Our offer</p>
      <p className="mt-1 text-lg font-bold text-slate-900">
        {formatMoney(rate)} <span className="text-sm font-normal text-slate-600">per trip</span>
      </p>
      <p className="text-sm text-slate-700">
        {trips} {trips === 1 ? 'trip' : 'trips'} · {formatMoney(rate * trips)} in total
        {downpayment !== null && ` · downpayment ${formatMoney(downpayment)} before the first trip`}
      </p>
      <p className="text-sm text-slate-700">
        Pickup {quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'} · Deadline{' '}
        {quote.preferred_delivery_date ? formatDate(quote.preferred_delivery_date) : '—'}
      </p>
      {note && <p className="mt-1 text-sm text-slate-600">"{note}"</p>}
      {compare && (
        <div className="mt-3 bg-slate-50 px-3 py-2">
          <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">What changed from your counter-offer</p>
          <OfferComparison before={compare.before} now={compare.now} beforeLabel="You asked" nowLabel="Our new offer" />
        </div>
      )}

      {mode === 'counter' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
            Your rate per trip (PHP)
            <input
              type="text"
              inputMode="decimal"
              value={counterRate}
              onChange={(e) => setCounterRate(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder={String(rate)}
              className={inputClasses}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Pickup date
            <input
              type="date"
              value={pickupDate}
              min={todayDateString()}
              onChange={(e) => setPickupDate(e.target.value)}
              className={inputClasses}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Deadline date
            <input
              type="date"
              value={deadline}
              min={pickupDate || undefined}
              onChange={(e) => setDeadline(e.target.value)}
              className={inputClasses}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 sm:col-span-2">
            Message <span className="font-normal text-slate-400">(optional)</span>
            <input
              type="text"
              value={counterNote}
              maxLength={300}
              onChange={(e) => setCounterNote(e.target.value)}
              className={inputClasses}
            />
          </label>
        </div>
      )}

      {mode === 'decline' && (
        <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-slate-600">
          Why are you declining?
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            className={inputClasses}
          />
        </label>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {mode === 'view' ? (
          <>
            <button type="button" onClick={accept} disabled={saving} className="btn-primary px-4 py-2 text-sm font-semibold">
              {saving ? 'Accepting...' : 'Accept offer'}
            </button>
            <button
              type="button"
              onClick={() => setMode('counter')}
              className="border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Counter-offer
            </button>
            <button
              type="button"
              onClick={() => setMode('decline')}
              className="px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Decline
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={mode === 'counter' ? sendCounter : decline}
              disabled={saving}
              className={`px-4 py-2 text-sm font-semibold text-white ${mode === 'counter' ? 'btn-primary' : 'bg-red-700 hover:bg-red-800'}`}
            >
              {saving ? 'Sending...' : mode === 'counter' ? 'Send counter-offer' : 'Decline offer'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('view')
                setError(null)
              }}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Back
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default QuoteOfferCard
