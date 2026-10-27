// ClientDashboard: the client portal's Home page (role `Client`; the
// canvas's Client Home board).
//
// The welcome line shows clients.client_name (the real business name on
// file), not users.username -- username is just a login handle. The other
// portal pages (bookings, payments, quotes, requests, profile) are in
// client/ClientPages.tsx, one per sidebar link.
//
// Home is a short preview that fits on one screen: three tiles (active
// bookings, balance due, next payment due), the first few active bookings
// and the next payments due, each with "View all". Offers waiting for an
// answer and quotes waiting for our price are mentioned too. Data from
// lib/clientPortal.ts -- the same loaders My Bookings and Payments use.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useClientProfile } from './client/useClientProfile'
import { NewQuoteButton } from './client/NewQuoteButton'
import PageHeader from '../../components/PageHeader'
import StatusBadge from '../../components/StatusBadge'
import { formatMoney, formatDate } from '../../lib/format'
import { formatDaysUntilDue } from '../../lib/paymentDue'
import { PAYMENT_STATE_STYLES } from '../../lib/clientPaymentState'
import {
  billableTrips,
  isActiveBooking,
  loadClientBookings,
  loadClientPaymentCards,
  loadOpenQuoteCounts,
  type ClientBooking,
  type PaymentCard,
} from '../../lib/clientPortal'

// How many bookings / payments Home shows before "View all".
const PREVIEW_ROWS = 3

function ViewAll({ to }: { to: string }) {
  return (
    <Link to={to} className="text-sm font-semibold text-primary hover:underline">
      View all
    </Link>
  )
}

function ClientDashboard() {
  const { username, clientId } = useAuth()
  const { profile, loading: profileLoading } = useClientProfile(clientId)
  // null = still loading, shown as "…" in the tiles.
  const [bookings, setBookings] = useState<ClientBooking[] | null>(null)
  const [payments, setPayments] = useState<PaymentCard[] | null>(null)
  const [quotes, setQuotes] = useState<{ waitingForPrice: string[]; offers: string[] }>({ waitingForPrice: [], offers: [] })

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    void loadClientBookings(clientId).then(({ bookings: loaded }) => !cancelled && setBookings(loaded))
    void loadClientPaymentCards(clientId).then(({ cards }) => !cancelled && setPayments(cards))
    void loadOpenQuoteCounts(clientId).then((counts) => !cancelled && setQuotes(counts))
    return () => {
      cancelled = true
    }
  }, [clientId])

  const active = (bookings ?? []).filter(isActiveBooking)
  const owing = (payments ?? []).filter((c) => c.row.balance_due > 0)
  const totalDue = owing.reduce((sum, c) => sum + c.row.balance_due, 0)
  const overdue = owing.filter((c) => c.state.key === 'overdue').length
  // Rows come sorted soonest-due first from lib/paymentDue.ts.
  const nextDue = owing.find((c) => c.row.due_date !== null)

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  })
  // Plain "Welcome" until the profile loads, so the login handle doesn't
  // flash before the real business name.
  const name = profileLoading ? '' : (profile?.client_name ?? username ?? '')

  const tiles = [
    { label: 'Active bookings', value: bookings ? String(active.length) : '…', note: '', noteClass: '' },
    {
      label: 'Balance due',
      value: payments ? formatMoney(totalDue) : '…',
      note: !payments ? '' : overdue > 0 ? `${overdue} overdue` : totalDue > 0 ? 'Not overdue' : 'Paid up',
      noteClass: overdue > 0 ? 'text-red-700' : 'text-green-800',
    },
    {
      label: 'Next payment due',
      value: !payments ? '…' : nextDue?.row.due_date ? formatDate(nextDue.row.due_date) : 'None',
      note: nextDue ? formatDaysUntilDue(nextDue.row.days_until_due, nextDue.row.balance_due).label : '',
      noteClass: 'text-ink-muted',
    },
  ]

  const quoteLine = (refs: string[], text: string) =>
    refs.length > 0 && (
      <p className="text-sm text-ink-secondary">
        {refs.length === 1 ? `1 quote ${text}` : `${refs.length} quotes ${text}`}:{' '}
        <Link to="/dashboard/quotes" className="font-mono font-semibold text-primary hover:underline">
          {refs.join(', ')}
        </Link>
      </p>
    )

  return (
    <div>
      <PageHeader title="Home" subtitle={name ? `Welcome, ${name} · ${today}` : today} actions={<NewQuoteButton />} />

      {quotes.offers.length > 0 && (
        <Link
          to="/dashboard/quotes"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 border-2 border-amber-600 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
        >
          <span className="font-semibold">
            You have {quotes.offers.length === 1 ? '1 offer' : `${quotes.offers.length} offers`} to answer.
          </span>
          <span className="font-semibold underline">Open My Quotes</span>
        </Link>
      )}

      <section aria-label="Summary" className="mb-4 grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="card px-[18px] py-3.5">
            <p className="text-sm font-medium text-ink-secondary">{tile.label}</p>
            <p className="text-[28px] leading-9 font-bold tracking-[-0.01em] text-ink tabular-nums">{tile.value}</p>
            {tile.note && <p className={`text-[13px] font-medium ${tile.noteClass}`}>{tile.note}</p>}
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start">
        <section aria-labelledby="ab-h" className="card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 id="ab-h" className="text-base font-semibold text-ink">
              Active bookings
            </h2>
            <ViewAll to="/dashboard/bookings" />
          </div>
          {!bookings ? (
            <p className="px-5 py-4 text-ink-muted">Loading...</p>
          ) : active.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-5 py-8 text-center">
              <p className="font-semibold text-ink">No active bookings right now</p>
              {quoteLine(quotes.waitingForPrice, 'is waiting for our price')}
            </div>
          ) : (
            <ul>
              {active.slice(0, PREVIEW_ROWS).map((booking) => {
                const trips = billableTrips(booking)
                const delivered = trips.filter((t) => t.itinerary_status === 'Delivered').length
                return (
                  <li key={booking.booking_id} className="flex min-h-[68px] items-center justify-between gap-3 border-b border-slate-200 px-5 py-2 last:border-0">
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold text-ink">
                        Booking #{booking.booking_id}
                        {booking.quote_reference && <span className="ml-2 font-mono text-[13px] font-medium text-ink-muted">{booking.quote_reference}</span>}
                      </p>
                      <p className="truncate text-ink-metric">
                        {booking.pickup_place_name} → {booking.delivery_place_name}
                      </p>
                      <p className="text-[13px] text-ink-muted">
                        {delivered} of {trips.length} {trips.length === 1 ? 'trip' : 'trips'} delivered
                      </p>
                    </div>
                    <StatusBadge status={booking.booking_status} icon />
                  </li>
                )
              })}
              {quotes.waitingForPrice.length > 0 && <li className="px-5 py-3">{quoteLine(quotes.waitingForPrice, 'is waiting for our price')}</li>}
            </ul>
          )}
        </section>

        <section aria-labelledby="np-h" className="card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 id="np-h" className="text-base font-semibold text-ink">
              Next payments due
            </h2>
            <ViewAll to="/dashboard/payments" />
          </div>
          {!payments ? (
            <p className="px-5 py-4 text-ink-muted">Loading...</p>
          ) : owing.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-5 py-8 text-center">
              <p className="font-semibold text-ink">Nothing due</p>
              <p className="text-sm text-ink-secondary">You're paid up on every booking.</p>
            </div>
          ) : (
            <ul>
              {owing.slice(0, PREVIEW_ROWS).map(({ row, state }) => (
                <li key={row.booking_id} className="flex flex-col gap-1 border-b border-slate-200 px-5 py-3 text-sm last:border-0">
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-ink">Booking #{row.booking_id}</span>
                    <span className="font-bold text-ink tabular-nums">{formatMoney(row.balance_due)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold ${PAYMENT_STATE_STYLES[state.key].chip}`}>{state.label}</span>
                    <span className="text-[13px] text-ink-muted">{state.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export default ClientDashboard
