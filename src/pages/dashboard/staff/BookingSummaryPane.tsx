// BookingSummaryPane: the right-hand panel on Bookings & Trips (the canvas's
// booking card): summary, payment, and one small card per trip with its slot
// and status (who drives it is on the Dispatch Board). Read-only -- "Full Details" opens the whole
// booking card (BookingDetailModal: cancel, downpayment waiver, hours per
// trip, cargo, documents) and "Record Payment" goes to Bills Receivable.
// Loads this booking's trips itself.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate, formatMoney, formatSlot } from '../../../lib/format'
import { bookingRateLabel, ratesDiffer } from '../../../lib/lineRates'
import type { Booking } from './BookingsSection'

type PaneTrip = {
  itinerary_id: number
  status: string
  slot: string
}

const STATUS_LABELS: Record<string, string> = { PickedUp: 'Picked Up', InTransit: 'In Transit' }

async function loadPaneTrips(bookingId: number): Promise<{ trips: PaneTrip[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('itineraries')
    .select('itinerary_id, itinerary_status, trip_start_at, trip_end_at, trip_date_from')
    .eq('booking_id', bookingId)
    .order('itinerary_id')
  if (error) return { trips: [], error: error.message }

  return {
    trips: rows.map((r) => ({
      itinerary_id: r.itinerary_id,
      status: r.itinerary_status ?? 'Awaiting',
      slot: r.trip_start_at ? formatSlot(r.trip_start_at, r.trip_end_at) : `${formatDate(r.trip_date_from)} · no time set`,
    })),
    error: null,
  }
}

const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'text-[15px] leading-[22px] font-medium text-ink'

function BookingSummaryPane({
  booking,
  highlightTripId,
  canRecordPayment,
  onOpenFull,
}: {
  booking: Booking
  highlightTripId: number | null
  // Admin: Bills Receivable is in their routes only.
  canRecordPayment: boolean
  onOpenFull: () => void
}) {
  const [trips, setTrips] = useState<PaneTrip[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPaneTrips(booking.booking_id).then((result) => {
      if (cancelled) return
      setTrips(result.trips)
      setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [booking.booking_id])

  const delivered = booking.completed_trips
  const balance = booking.balance_due
  const tripsToCome = booking.status !== 'Delivered' && booking.status !== 'Cancelled'

  return (
    <aside aria-labelledby="bk-title" className="card flex flex-col lg:sticky lg:top-0 lg:max-h-[calc(100dvh-7rem)]">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-4">
        <h2 id="bk-title" className="text-lg leading-[26px] font-bold text-ink">
          Booking #{booking.booking_id}
        </h2>
        {booking.reference_code && (
          <span className="font-mono text-[13px] font-semibold tracking-[0.02em] text-ink-secondary">{booking.reference_code}</span>
        )}
        <StatusBadge status={booking.status} icon />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-4">
        <section>
          <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink">Summary</h3>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
            <div>
              <dt className={LABEL}>Client</dt>
              <dd className={`${VALUE} font-semibold`}>{booking.client_name}</dd>
            </div>
            <div>
              <dt className={LABEL}>Booked</dt>
              <dd className={VALUE}>{booking.date ? formatDate(booking.date) : '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className={LABEL}>Route</dt>
              <dd className={VALUE}>
                {booking.pickup_location} → {booking.delivery_location}
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Rate</dt>
              <dd className={`${VALUE} tabular-nums`}>
                {bookingRateLabel(booking.trip_rates, booking.rate)}{' '}
                <span className="text-[13px] text-ink-muted">per trip</span>
              </dd>
            </div>
            <div>
              <dt className={LABEL}>Invoice no.</dt>
              <dd className={booking.invoice_number ? VALUE : `${VALUE} text-ink-muted`}>{booking.invoice_number || 'Not entered'}</dd>
            </div>
          </dl>
        </section>

        <section className="border border-line bg-slate-50 px-4 py-3.5">
          <h3 className="mb-2 text-sm font-semibold text-ink">Payment</h3>
          <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="text-ink-secondary">
              Contract value{' '}
              <span className="text-[13px] text-ink-muted">
                {booking.total_trips} {booking.total_trips === 1 ? 'trip' : 'trips'}
                {ratesDiffer(booking.trip_rates) ? ', rates differ by cargo' : ` × ${bookingRateLabel(booking.trip_rates, booking.rate)}`}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(booking.total_contract_value)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="text-ink-secondary">
              Billed so far{' '}
              <span className="text-[13px] text-ink-muted">
                {delivered} of {booking.total_trips} delivered
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatMoney(booking.billable_amount)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="text-ink-secondary">Paid</span>
            <span className="font-semibold tabular-nums">{formatMoney(booking.amount_paid)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 py-1 pt-2 text-sm">
            <span className="font-semibold text-ink">Balance due</span>
            <span className="flex items-center gap-2 font-bold tabular-nums">
              {formatMoney(Math.max(balance, 0))}
              {balance <= 0 && booking.billable_amount > 0 && <StatusBadge status="Paid" icon />}
              {balance < 0 && tripsToCome && <span className="text-[13px] font-medium text-ink-muted">paid ahead</span>}
            </span>
          </div>
        </section>

        <section>
          {/* Collapsed by default; open when a trip is linked (?trip=N) so it can be highlighted. */}
          <details open={highlightTripId != null}>
          <summary className="mb-3 cursor-pointer border-b border-slate-200 pb-2 text-sm font-semibold text-ink">
            Trips ({booking.total_trips}
            {booking.cancelled_trips ? ` · ${booking.cancelled_trips} cancelled` : ''})
          </summary>
          {error && <p className="text-sm text-red-700">{error}</p>}
          {!trips && !error && <p className="text-sm text-ink-muted">Loading trips…</p>}
          {trips && trips.length === 0 && <p className="text-sm text-ink-muted">No trips on this booking.</p>}
          <div className="flex flex-col gap-2.5">
            {trips?.map((t) => (
              <div
                key={t.itinerary_id}
                className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border px-3.5 py-3 ${
                  t.itinerary_id === highlightTripId ? 'border-2 border-primary bg-primary-soft' : 'border-line'
                }`}
              >
                <div className="text-sm font-bold text-ink">
                  Trip #{t.itinerary_id} <span className="font-medium text-ink-secondary">· {t.slot}</span>
                </div>
                <StatusBadge status={t.status} label={STATUS_LABELS[t.status]} icon />
              </div>
            ))}
          </div>
          </details>
        </section>
      </div>

      <div className="flex shrink-0 gap-3 border-t border-line px-5 py-4">
        <button type="button" onClick={onOpenFull} className="btn-secondary flex-1 px-4 text-sm font-medium">
          Full Details
        </button>
        {canRecordPayment && (
          <Link
            to={`/dashboard/financial-records?pay=${booking.booking_id}`}
            className="btn-primary flex flex-1 items-center justify-center px-4 text-sm"
          >
            Record Payment
          </Link>
        )}
      </div>
    </aside>
  )
}

export default BookingSummaryPane
