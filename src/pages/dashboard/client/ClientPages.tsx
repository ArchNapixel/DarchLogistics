// ClientPages: the client portal's sidebar pages (all but Home, which is
// ClientDashboard.tsx). Each one is just a page title around a section
// component that already does the real work -- one file so the portal's
// pages are easy to find together. Routes are in DashboardRouter.tsx.
// "Rate Us" is a card on My Profile, not its own page.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import PageHeader, { SectionHeader } from '../../../components/PageHeader'
import MyBookingsSection from './MyBookingsSection'
import ClientPaymentsSection from './ClientPaymentsSection'
import MyQuoteRequestsSection from './MyQuoteRequestsSection'
import MyStatusRequestsSection from './MyStatusRequestsSection'
import ClientReviewSection from './ClientReviewSection'
import ClientProfileSection, { useClientProfile } from './ClientProfileSection'
import ClientAccountSection from './ClientAccountSection'
import { NewQuoteButton } from './NewQuoteModal'

const card = 'border-2 border-line-card bg-white p-6'

export function ClientBookingsPage() {
  const { clientId } = useAuth()
  return (
    <div>
      <PageHeader
        title="My Bookings"
        subtitle="Your bookings and their trips. Open a booking to see each trip."
        actions={clientId && <NewQuoteButton clientId={clientId} />}
      />
      <MyBookingsSection />
    </div>
  )
}

export function ClientPaymentsPage() {
  const { clientId } = useAuth()
  return (
    <div>
      <PageHeader title="Payments" subtitle="What you owe per booking and when it's due." />
      <div className={card}>
        {clientId && <ClientPaymentsSection clientId={clientId} />}
      </div>
    </div>
  )
}

export function ClientQuotesPage() {
  const { clientId } = useAuth()
  // Bumped after a new quote is sent so the list reloads.
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div>
      <PageHeader
        title="My Quotes"
        subtitle="Quotes waiting for review or sent back to you. Approved ones move to My Bookings."
        actions={clientId && (
          <NewQuoteButton clientId={clientId} onCreated={() => setRefreshKey((k) => k + 1)} />
        )}
      />
      <div className={card}>
        <MyQuoteRequestsSection key={refreshKey} />
      </div>
    </div>
  )
}

export function ClientRequestsPage() {
  return (
    <div>
      <PageHeader
        title="My Requests"
        subtitle="Questions you sent about a trip's status. Ask one from a trip in My Bookings."
      />
      <div className={card}>
        <MyStatusRequestsSection />
      </div>
    </div>
  )
}

export function ClientProfilePage() {
  const { clientId } = useAuth()
  const { profile, loading, error, setProfile } = useClientProfile(clientId)
  return (
    <div>
      <PageHeader title="My Profile" />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className={card}>
          <SectionHeader title="Contact details" />
          <div className="mt-4">
            {clientId && (
              <ClientProfileSection
                clientId={clientId}
                profile={profile}
                loading={loading}
                error={error}
                onSaved={setProfile}
              />
            )}
          </div>
        </div>
        <div className={card}>
          <SectionHeader title="Login & Security" />
          <div className="mt-4">
            <ClientAccountSection />
          </div>
        </div>
        <div className={card}>
          <SectionHeader title="Rate Us" subtitle="Tell us how we did." />
          <div className="mt-4">
            <ClientReviewSection />
          </div>
        </div>
      </div>
    </div>
  )
}
