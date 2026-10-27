// MyBookingsSection: the client's My Bookings page (the canvas's Client My
// Bookings board). Active / Past tabs; one row per booking -- booking # and
// quote reference, route, date, rate per trip, trips, total, payment state
// -- and "Show trips" opens that booking's trips: date, time window, cargo,
// status and Ask About This Trip (a question to Dispatch, per trip, answered
// in My Requests). A booking with its downpayment still owed shows how much
// is left under its row.
//
// Data comes from lib/clientPortal.ts (loadClientBookings for the bookings,
// loadClientPaymentCards for the Payment column). Relies on the
// itineraries_select_own_client RLS policy. No truck, trailer or driver is
// shown on purpose -- that's internal fleet info.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import ClientStatusRequestModal from './ClientStatusRequestModal'
import StatusBadge from '../../../components/StatusBadge'
import { formatMoney, formatDate, slotLines } from '../../../lib/format'
import { bookingRateLabel, sumRates } from '../../../lib/lineRates'
import { showToast } from '../../../components/Toast'
import { tripCargoLabel } from '../../../lib/quoteRequest'
import {
  billableTrips,
  bookingDownpayment,
  isActiveBooking,
  loadClientBookings,
  loadClientPaymentCards,
  loadOpenQuoteCounts,
  type ClientBooking,
  type ClientTrip,
} from '../../../lib/clientPortal'
import { PAYMENT_STATE_STYLES, type PaymentState } from '../../../lib/clientPaymentState'

const COLS = 'grid grid-cols-[150px_minmax(0,1fr)_120px_120px_90px_130px_150px_130px] items-center gap-x-4'
const TH = 'text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase'

function MyBookingsSection() {
  const { clientId } = useAuth()
  const [bookings, setBookings] = useState<ClientBooking[] | null>(null)
  const [paymentByBooking, setPaymentByBooking] = useState<Map<number, PaymentState>>(new Map())
  const [waitingQuotes, setWaitingQuotes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)
  // The trip the client is asking about (questions are per trip).
  const [asking, setAsking] = useState<{ booking: ClientBooking; trip: ClientTrip } | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    Promise.all([loadClientBookings(clientId), loadClientPaymentCards(clientId), loadOpenQuoteCounts(clientId)]).then(
      ([bookingResult, paymentResult, quotes]) => {
        if (cancelled) return
        setError(bookingResult.error)
        setBookings(bookingResult.bookings)
        setPaymentByBooking(new Map(paymentResult.cards.map((c) => [c.row.booking_id, c.state])))
        setWaitingQuotes([...quotes.offers, ...quotes.waitingForPrice])
        // Past tab first when there's nothing active (the canvas's default).
        if (!bookingResult.bookings.some(isActiveBooking) && bookingResult.bookings.length > 0) setShowPast(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [clientId])

  if (!clientId) return <p className="text-ink-muted">Your login isn't linked to a client account.</p>
  if (error) return <p className="text-red-700">{error}</p>
  if (!bookings) return <p className="text-ink-muted">Loading your bookings...</p>

  const activeCount = bookings.filter(isActiveBooking).length
  const visible = bookings.filter((b) => isActiveBooking(b) !== showPast)

  const tab = (label: string, count: number, past: boolean) => (
    <button
      type="button"
      aria-pressed={showPast === past}
      onClick={() => setShowPast(past)}
      className={`flex h-11 items-center gap-2 rounded-[2px] border px-4 text-sm font-semibold ${
        showPast === past ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-50'
      }`}
    >
      {label}
      <span className={`rounded-[2px] px-1.5 text-xs ${showPast === past ? 'bg-white text-primary' : 'bg-primary text-white'}`}>{count}</span>
    </button>
  )

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {tab('Active', activeCount, false)}
        {tab('Past', bookings.length - activeCount, true)}
      </div>

      <section aria-label="Bookings" className="card">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="font-semibold text-ink">{showPast ? 'No delivered or cancelled bookings yet' : 'No active bookings right now'}</p>
            {!showPast && waitingQuotes.length > 0 && (
              <>
                <p className="text-sm text-ink-secondary">
                  {waitingQuotes.length === 1 ? '1 quote is' : `${waitingQuotes.length} quotes are`} open: {waitingQuotes.join(', ')}
                </p>
                <Link to="/dashboard/quotes" className="btn-primary mt-2 inline-flex items-center px-5 text-sm">
                  Go to My Quotes
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1100px]">
              <div className={`${COLS} border-b border-line bg-slate-100 px-5 py-2.5`}>
                <span className={TH}>Booking</span>
                <span className={TH}>Route</span>
                <span className={TH}>Date</span>
                <span className={`${TH} text-right`}>Rate per trip</span>
                <span className={`${TH} text-right`}>Trips</span>
                <span className={`${TH} text-right`}>Total</span>
                <span className={TH}>Payment</span>
                <span className="sr-only">Trips</span>
              </div>

              {visible.map((booking) => {
                const isOpen = openId === booking.booking_id
                const trips = billableTrips(booking)
                // Each trip has its own rate (cargo lines can be priced differently).
                const tripRates = trips.map((t) => t.trip_rate ?? booking.rate_of_delivery_service ?? 0)
                const cancelledTrips = booking.itineraries.length - trips.length
                const downpayment = bookingDownpayment(booking)
                const payment = paymentByBooking.get(booking.booking_id)
                return (
                  <article key={booking.booking_id} aria-label={`Booking ${booking.booking_id}`} className="border-b border-slate-200 last:border-0">
                    <div className={`${COLS} min-h-[68px] px-5 py-2 text-sm text-ink-metric ${isOpen ? 'bg-primary-soft' : ''}`}>
                      <span>
                        <span className="flex items-center gap-2 font-bold text-ink">
                          #{booking.booking_id}
                          <StatusBadge status={booking.booking_status} />
                        </span>
                        <span className="block font-mono text-[13px] text-ink-muted">{booking.quote_reference ?? '—'}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate" title={booking.pickup_place_name}>
                          {booking.pickup_place_name}
                        </span>
                        <span className="block truncate text-ink-muted" title={booking.delivery_place_name}>
                          → {booking.delivery_place_name}
                        </span>
                      </span>
                      <span>{formatDate(booking.booking_date)}</span>
                      <span className="text-right tabular-nums">{bookingRateLabel(tripRates, booking.rate_of_delivery_service)}</span>
                      <span className="text-right tabular-nums">
                        {trips.length}
                        {cancelledTrips > 0 && <span className="block text-[13px] text-ink-muted">{cancelledTrips} cancelled</span>}
                      </span>
                      <span className="text-right font-semibold text-ink tabular-nums">
                        {booking.rate_of_delivery_service != null ? formatMoney(sumRates(tripRates)) : '—'}
                      </span>
                      <span>
                        {payment ? (
                          <span className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold ${PAYMENT_STATE_STYLES[payment.key].chip}`}>
                            {payment.label}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </span>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpenId(isOpen ? null : booking.booking_id)}
                        className="btn-secondary inline-flex items-center justify-center gap-1.5 px-3 text-sm font-medium"
                      >
                        {isOpen ? 'Hide trips' : 'Show trips'}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                          <path d={isOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
                        </svg>
                      </button>
                    </div>

                    {/* Only while it matters: before trips start (a waived one isn't the client's business). */}
                    {downpayment && !downpayment.met && !downpayment.waived && (
                      <p className="mx-5 mb-3 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <span className="font-semibold">Downpayment: {formatMoney(downpayment.required)}</span> · Paid{' '}
                        {formatMoney(downpayment.paid)} · {formatMoney(downpayment.missing)} to go. Your trips start once it's paid; the rest is
                        due after delivery under your payment terms.
                      </p>
                    )}

                    {isOpen && (
                      <div className="mx-5 mb-4 border border-line">
                        {booking.itineraries.length === 0 ? (
                          <p className="px-4 py-3 text-sm text-ink-muted">No trips scheduled yet for this booking.</p>
                        ) : (
                          <table className="w-full text-left text-sm text-ink-metric">
                            <thead>
                              <tr>
                                <th className="px-4 py-2">Trip</th>
                                <th className="px-4 py-2">Date</th>
                                <th className="px-4 py-2">Time window</th>
                                <th className="px-4 py-2">Cargo</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2">
                                  <span className="sr-only">Action</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {booking.itineraries.map((trip) => {
                                const slot = trip.trip_start_at ? slotLines(trip.trip_start_at, trip.trip_end_at) : null
                                return (
                                    <tr key={trip.itinerary_id} className="h-14 border-t border-slate-200">
                                      <td className="px-4 py-2 font-semibold text-ink">#{trip.itinerary_id}</td>
                                      <td className="px-4 py-2">{slot ? slot.date : formatDate(trip.trip_date_from)}</td>
                                      <td className="px-4 py-2">{slot ? slot.time : <span className="text-ink-muted">Not set yet</span>}</td>
                                      <td className="px-4 py-2">
                                        {tripCargoLabel(trip.cargo)}
                                        {trip.cargo.cargo_description && (
                                          <span className="block text-[13px] text-ink-muted">{trip.cargo.cargo_description}</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-2">
                                        <StatusBadge status={trip.itinerary_status} icon />
                                      </td>
                                      <td className="px-4 py-2 text-right">
                                        {/* Nothing to ask about on a cancelled trip. */}
                                        {trip.itinerary_status !== 'Cancelled' && (
                                          <button
                                            type="button"
                                            onClick={() => setAsking({ booking, trip })}
                                            className="btn-secondary px-3.5 text-sm font-medium"
                                          >
                                            Ask About This Trip
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {asking && (
        <ClientStatusRequestModal
          clientId={clientId}
          bookingId={asking.booking.booking_id}
          itineraryId={asking.trip.itinerary_id}
          date={asking.trip.trip_start_at ? slotLines(asking.trip.trip_start_at, asking.trip.trip_end_at).date : formatDate(asking.trip.trip_date_from)}
          timeWindow={asking.trip.trip_start_at ? slotLines(asking.trip.trip_start_at, asking.trip.trip_end_at).time : null}
          onClose={() => setAsking(null)}
          onRequested={() => {
            setAsking(null)
            showToast('Question sent. Dispatch will answer in My Requests.')
          }}
        />
      )}
    </div>
  )
}

export default MyBookingsSection
