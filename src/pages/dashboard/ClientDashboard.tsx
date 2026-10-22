// ClientDashboard: shown to the Client role.
//
// The welcome banner shows clients.client_name (the real business name
// on file), not users.username -- username is just a login handle and
// can be set to anything at account creation (e.g. staff typed
// "client" as a placeholder), while client_name is the name a client
// can now edit themselves in "My Profile" below. Profile state lives
// here (not inside ClientProfileSection) so an edit there updates the
// welcome banner immediately, without a second fetch.
//
// Page order puts what clients check most (bookings, payments) first and
// the rarely-touched profile last. The summary strip at the top is built
// from the lists MyBookingsSection/ClientPaymentsSection already load
// (handed up via onLoaded) -- no extra queries.
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import RoleBadge from '../../components/RoleBadge'
import MyBookingsSection, {
  isActiveBooking,
  type Booking,
} from './client/MyBookingsSection'
import MyQuoteRequestsSection from './client/MyQuoteRequestsSection'
import { formatDaysUntilDue, type PaymentDueRow } from '../../lib/paymentDue'
import NewQuoteModal from './client/NewQuoteModal'
import ClientProfileSection, {
  type ClientProfile,
} from './client/ClientProfileSection'
import ClientPaymentsSection from './client/ClientPaymentsSection'
import MyStatusRequestsSection from './client/MyStatusRequestsSection'
import ClientReviewSection from './client/ClientReviewSection'
import PageHeader, { SectionHeader } from '../../components/PageHeader'
import { formatMoney, formatDate } from '../../lib/format'

function ClientDashboard() {
  const { username, role, clientId } = useAuth()
  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [showNewQuote, setShowNewQuote] = useState(false)
  const [statusRequestsRefreshKey, setStatusRequestsRefreshKey] = useState(0)
  const [quotesRefreshKey, setQuotesRefreshKey] = useState(0)
  // null = still loading, shown as "—" in the summary strip.
  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [paymentRows, setPaymentRows] = useState<PaymentDueRow[] | null>(null)

  useEffect(() => {
    if (clientId) {
      loadProfile(clientId)
    } else {
      setProfileLoading(false)
    }
  }, [clientId])

  async function loadProfile(id: number) {
    setProfileLoading(true)

    const { data, error: loadError } = await supabase
      .from('clients')
      .select('client_name, email, phone_number')
      .eq('client_id', id)
      .maybeSingle()

    if (loadError) {
      setProfileError(loadError.message)
      setProfileLoading(false)
      return
    }

    setProfile(data)
    setProfileError(null)
    setProfileLoading(false)
  }

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
      {/* Clients have no sidebar, so their page title is the greeting.
          Plain "Welcome" until the profile loads, so the login handle
          doesn't flash before the real business name. */}
      <PageHeader
        title={profileLoading ? 'Welcome' : `Welcome, ${profile?.client_name ?? username}`}
        subtitle="Your bookings, payments and requests in one place."
        actions={<RoleBadge role={role} />}
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

      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 border border-slate-200 bg-white p-8 shadow-sm">
          <SectionHeader
            title="My Bookings"
            actions={clientId && (
              <button
                onClick={() => setShowNewQuote(true)}
                className="btn-primary px-4 py-2 text-sm font-medium"
              >
                New Quote Request
              </button>
            )}
          />
          <div className="mt-4">
            <MyBookingsSection
              onLoaded={setBookings}
              onStatusRequested={() =>
                setStatusRequestsRefreshKey((key) => key + 1)
              }
            />
          </div>
        </div>

        <div className="w-full border border-slate-200 bg-white p-8 shadow-sm lg:max-w-sm">
          <SectionHeader title="Payments Due" />
          <div className="mt-4">
            {clientId && (
              <ClientPaymentsSection clientId={clientId} onLoaded={setPaymentRows} />
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="border border-slate-200 bg-white p-8 shadow-sm">
          <SectionHeader title="My Quote Requests" />
          <div className="mt-4">
            <MyQuoteRequestsSection key={quotesRefreshKey} />
          </div>
        </div>

        <div className="border border-slate-200 bg-white p-8 shadow-sm">
          <SectionHeader title="My Status Requests" />
          <div className="mt-4">
            <MyStatusRequestsSection key={statusRequestsRefreshKey} />
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="border border-slate-200 bg-white p-8 shadow-sm">
          <SectionHeader title="Rate Our Service" />
          <div className="mt-4">
            <ClientReviewSection />
          </div>
        </div>

        <div className="border border-slate-200 bg-white p-8 shadow-sm">
          <SectionHeader title="My Profile" />
          <div className="mt-4">
            {clientId && (
              <ClientProfileSection
                clientId={clientId}
                profile={profile}
                loading={profileLoading}
                error={profileError}
                onSaved={(updated) => setProfile(updated)}
              />
            )}
          </div>
        </div>
      </div>

      {showNewQuote && clientId && (
        <NewQuoteModal
          clientId={clientId}
          // NewQuoteModal shows its own confirmation (reference number,
          // summary, next steps) before calling this -- close it and
          // reload My Quote Requests so the new one shows up.
          onCreated={() => {
            setShowNewQuote(false)
            setQuotesRefreshKey((key) => key + 1)
          }}
        />
      )}
    </div>
  )
}

export default ClientDashboard
