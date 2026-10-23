// ClientDashboard: the client portal's Home page (role `Client`).
//
// The welcome banner shows clients.client_name (the real business name
// on file), not users.username -- username is just a login handle and
// can be set to anything at account creation. The other portal pages
// (bookings, payments, quotes, requests, review, profile) are in
// client/ClientPages.tsx, one per sidebar link.
//
// Home is a short preview so it fits on one screen: the summary strip,
// the latest few active bookings and the next payments due, each with a
// link to its full page. The summary strip is built from the lists
// MyBookingsSection/ClientPaymentsSection already load (handed up via
// onLoaded) -- no extra queries.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import MyBookingsSection, {
  isActiveBooking,
  type Booking,
} from './client/MyBookingsSection'
import { formatDaysUntilDue, type PaymentDueRow } from '../../lib/paymentDue'
import { useClientProfile } from './client/ClientProfileSection'
import ClientPaymentsSection from './client/ClientPaymentsSection'
import MyQuoteRequestsSection from './client/MyQuoteRequestsSection'
import { NewQuoteButton } from './client/NewQuoteModal'
import PageHeader, { SectionHeader } from '../../components/PageHeader'
import { formatMoney, formatDate } from '../../lib/format'

// How many bookings / payments Home shows before "View all".
const PREVIEW_ROWS = 3

function ViewAll({ to }: { to: string }) {
  return (
    <Link to={to} className="text-sm font-medium text-primary hover:underline">
      View all →
    </Link>
  )
}

function ClientDashboard() {
  const { username, clientId } = useAuth()
  const { profile, loading: profileLoading } = useClientProfile(clientId)
  // null = still loading, shown as "—" in the summary strip.
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [paymentRows, setPaymentRows] = useState<PaymentDueRow[] | null>(null)

  const unpaidRows = (paymentRows ?? []).filter((row) => row.balance_due > 0)
  const totalBalanceDue = unpaidRows.reduce((sum, row) => sum + row.balance_due, 0)
  // Rows come sorted soonest-due first from lib/paymentDue.ts.
  const nextDue = unpaidRows.find((row) => row.due_date !== null)

  const summary = [
    {
      label: 'Active bookings',
      value: bookings ? String(bookings.filter(isActiveBooking).length) : '—',
    },
    {
      label: 'Balance due',
      value: paymentRows ? `${formatMoney(totalBalanceDue)}` : '—',
    },
    {
      label: 'Next payment due',
      value: !paymentRows
        ? '—'
        : nextDue?.due_date
          ? `${formatDate(nextDue.due_date)} · ${formatDaysUntilDue(nextDue.days_until_due).label}`
          : 'Nothing due',
    },
  ]

  return (
    <div>
      {/* Plain "Welcome" until the profile loads, so the login handle
          doesn't flash before the real business name. */}
      <PageHeader
        title={profileLoading ? 'Welcome' : `Welcome, ${profile?.client_name ?? username}`}
        subtitle="Your bookings, payments and requests in one place."
        actions={clientId && <NewQuoteButton clientId={clientId} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {summary.map((item) => (
          <div
            key={item.label}
            className="border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {item.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* Pending / Rejected quotes, above bookings */}
      <div className="mt-8 border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader
          title="My Quote Requests"
          actions={<ViewAll to="/dashboard/quotes" />}
        />
        <div className="mt-4">
          <MyQuoteRequestsSection />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="min-w-0 border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader
            title="Active Bookings"
            actions={<ViewAll to="/dashboard/bookings" />}
          />
          <div className="mt-4">
            <MyBookingsSection onLoaded={setBookings} limit={PREVIEW_ROWS} />
          </div>
        </div>

        <div className="border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader
            title="Next Payments Due"
            actions={<ViewAll to="/dashboard/payments" />}
          />
          <div className="mt-4">
            {clientId && (
              <ClientPaymentsSection
                clientId={clientId}
                onLoaded={setPaymentRows}
                limit={PREVIEW_ROWS}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ClientDashboard
