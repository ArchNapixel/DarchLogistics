// QuoteReviewModal: full detail view for one quote request, with an
// editable proposed rate + payment terms, and Approve/Reject actions.
//
// Approve does 4 steps in order: create a `clients` row from the quote's
// free-text client info, create 2 `places` rows from the free-text
// pickup/delivery text, then update the quote_request and create the
// `bookings` row using those new IDs. If a later step fails, earlier
// ones have already been saved (no rollback) -- fine for now, but worth
// moving into a single database function later for atomicity.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import type { QuoteRequest } from './QuoteRequestsSection'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-slate-900">{value}</p>
    </div>
  )
}

function QuoteReviewModal({
  quote,
  onClose,
  onResolved,
}: {
  quote: QuoteRequest
  onClose: () => void
  onResolved: (quoteRequestId: number) => void
}) {
  const [proposedRate, setProposedRate] = useState(
    quote.proposed_rate?.toString() ?? '',
  )
  const [paymentTerms, setPaymentTerms] = useState(quote.payment_terms)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  async function handleApprove() {
    const rateValue = Number(proposedRate)
    if (!proposedRate || rateValue <= 0) {
      setError('Enter a proposed rate before approving.')
      return
    }

    setSubmitting(true)
    setError(null)

    // 1. Create a client record from the quote's free-text client info.
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        client_name: quote.client_name,
        email: quote.contact_email,
        phone_number: quote.contact_number,
      })
      .select('client_id')
      .single()

    if (clientError || !client) {
      setError(clientError?.message ?? 'Could not create client record.')
      setSubmitting(false)
      return
    }

    // 2. Create place records from the free-text pickup/delivery text.
    const { data: pickupPlace, error: pickupError } = await supabase
      .from('places')
      .insert({ place_name: quote.pickup_location_text })
      .select('place_id')
      .single()

    if (pickupError || !pickupPlace) {
      setError(pickupError?.message ?? 'Could not create pickup location.')
      setSubmitting(false)
      return
    }

    const { data: deliveryPlace, error: deliveryError } = await supabase
      .from('places')
      .insert({ place_name: quote.delivery_location_text })
      .select('place_id')
      .single()

    if (deliveryError || !deliveryPlace) {
      setError(deliveryError?.message ?? 'Could not create delivery location.')
      setSubmitting(false)
      return
    }

    // 3. Update the quote request: approved, with the final rate/terms
    // and links to the client/place records just created.
    const { error: updateError } = await supabase
      .from('quote_requests')
      .update({
        request_status: 'Approved',
        proposed_rate: rateValue,
        payment_terms: paymentTerms,
        client_id: client.client_id,
        place_of_pickup_id: pickupPlace.place_id,
        place_of_delivery_id: deliveryPlace.place_id,
      })
      .eq('quote_request_id', quote.quote_request_id)

    if (updateError) {
      setError(updateError.message)
      setSubmitting(false)
      return
    }

    // 4. Create the booking itself.
    const { error: bookingError } = await supabase.from('bookings').insert({
      quote_request_id: quote.quote_request_id,
      client_id: client.client_id,
      place_of_pickup_id: pickupPlace.place_id,
      place_of_delivery_id: deliveryPlace.place_id,
      cargo_type: quote.cargo_type,
      cargo_description: quote.cargo_description,
      weight: quote.weight,
      container_type: quote.container_type,
      payment_terms: paymentTerms,
      booking_status: 'Draft',
      booking_date: quote.preferred_pickup_date,
    })

    setSubmitting(false)

    if (bookingError) {
      setError(bookingError.message)
      return
    }

    onResolved(quote.quote_request_id)
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      setError('Enter a reason for rejecting this quote.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: rejectError } = await supabase
      .from('quote_requests')
      .update({
        request_status: 'Rejected',
        rejection_reason: rejectReason,
      })
      .eq('quote_request_id', quote.quote_request_id)

    setSubmitting(false)

    if (rejectError) {
      setError(rejectError.message)
      return
    }

    onResolved(quote.quote_request_id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Quote #{quote.quote_request_id}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <InfoRow label="Client name" value={quote.client_name} />
          <InfoRow
            label="Contact"
            value={
              [quote.contact_number, quote.contact_email]
                .filter(Boolean)
                .join(' / ') || '—'
            }
          />
          <InfoRow label="Origin" value={quote.pickup_location_text} />
          <InfoRow label="Destination" value={quote.delivery_location_text} />
          <InfoRow label="Cargo type" value={quote.cargo_type} />
          <InfoRow label="Trailer type" value={quote.container_type} />
          <InfoRow label="Weight (tons)" value={String(quote.weight)} />
          <InfoRow
            label="Preferred pickup date"
            value={quote.preferred_pickup_date ?? '—'}
          />
          <InfoRow
            label="Cargo description"
            value={quote.cargo_description}
          />
        </div>

        <div className="mt-6 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <label className={labelClasses}>
            Proposed rate
            <input
              type="number"
              min="0"
              step="0.01"
              value={proposedRate}
              onChange={(e) => setProposedRate(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Payment terms
            <select
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              className={fieldClasses}
            >
              <option value="Cash">Cash</option>
              <option value="7Days">7 days</option>
              <option value="14Days">14 days</option>
              <option value="30Days">30 days</option>
            </select>
          </label>
        </div>

        {showRejectForm ? (
          <div className="mt-6 border-t border-slate-200 pt-4">
            <label className={labelClasses}>
              Reason for rejection
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className={fieldClasses}
              />
            </label>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowRejectForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={submitting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {submitting ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              onClick={() => setShowRejectForm(true)}
              disabled={submitting}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={handleApprove}
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {submitting ? 'Approving...' : 'Approve'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default QuoteReviewModal
