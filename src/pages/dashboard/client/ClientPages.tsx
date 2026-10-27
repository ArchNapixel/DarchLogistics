// ClientPages: the client portal's sidebar pages (all but Home, which is
// ClientDashboard.tsx), laid out like the canvas's Client boards. Each one
// is a page title around a section component that does the real work --
// one file so the portal's pages are easy to find together. Routes are in
// DashboardRouter.tsx. "Rate Us" is a card on My Profile, not its own page.
//
// ClientNewQuotePage (/dashboard/quotes/new) is the quote form as a page.
// With ?resubmit=<quote id> it loads that Rejected quote pre-filled
// ("Edit & Resubmit" on My Quotes); the fields staff flagged show red.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import PageHeader from '../../../components/PageHeader'
import MyBookingsSection from './MyBookingsSection'
import ClientPaymentsSection from './ClientPaymentsSection'
import MyQuoteRequestsSection from './MyQuoteRequestsSection'
import MyStatusRequestsSection from './MyStatusRequestsSection'
import ClientReviewSection from './ClientReviewSection'
import ClientProfileSection from './ClientProfileSection'
import { useClientProfile } from './useClientProfile'
import ClientAccountSection from './ClientAccountSection'
import ClientQuoteForm, { type ResubmitTarget } from './ClientQuoteForm'
import { NewQuoteButton } from './NewQuoteButton'
import { SHIPMENT_COLUMNS, quoteToForm, rejectionErrors } from '../../../lib/quoteRequest'

export function ClientBookingsPage() {
  return (
    <div>
      <PageHeader
        title="My Bookings"
        subtitle="Bookings are made when you accept an offer. Open a booking to see its trips."
        actions={<NewQuoteButton />}
      />
      <MyBookingsSection />
    </div>
  )
}

export function ClientPaymentsPage() {
  const { clientId } = useAuth()
  return (
    <div>
      <PageHeader title="Payments" subtitle="One card per booking. Pay the downpayment before pickup and the rest by the due date." />
      {clientId && <ClientPaymentsSection clientId={clientId} />}
    </div>
  )
}

export function ClientQuotesPage() {
  return (
    <div>
      <PageHeader title="My Quotes" subtitle="Offers waiting for your answer are listed first." actions={<NewQuoteButton />} />
      <MyQuoteRequestsSection />
    </div>
  )
}

// The steps the client sees after sending (the "sent" screen).
const NEXT_STEPS = [
  'We review your route and cargo, then send you our rate per trip.',
  'You accept it, counter it with your own rate or dates, or decline it, under My Quotes.',
  'Once you accept, it appears in My Bookings.',
]

export function ClientNewQuotePage() {
  const { clientId } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const resubmitId = Number(params.get('resubmit')) || null
  const [resubmit, setResubmit] = useState<ResubmitTarget | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Resubmit: the quote's shipment fields plus why it was rejected.
  useEffect(() => {
    if (!resubmitId) return
    let cancelled = false
    async function load(id: number) {
      const [fieldsResult, statusResult] = await Promise.all([
        supabase.from('quote_requests').select(SHIPMENT_COLUMNS).eq('quote_request_id', id).maybeSingle(),
        supabase
          .from('quote_requests')
          .select('reference_code, request_status, rejection_tag, rejection_reason')
          .eq('quote_request_id', id)
          .maybeSingle(),
      ])
      if (cancelled) return
      const fields = fieldsResult.data
      const status = statusResult.data
      if (fieldsResult.error || statusResult.error || !fields || !status) {
        setLoadError(fieldsResult.error?.message ?? statusResult.error?.message ?? 'Could not open that quote.')
        return
      }
      if (status.request_status !== 'Rejected') {
        setLoadError('Only a rejected quote can be edited and resubmitted.')
        return
      }
      setResubmit({
        quoteId: id,
        referenceCode: status.reference_code,
        form: quoteToForm(fields),
        errors: rejectionErrors(status.rejection_tag, status.rejection_reason),
      })
    }
    void load(resubmitId)
    return () => {
      cancelled = true
    }
  }, [resubmitId])

  const title = resubmitId ? 'Edit & Resubmit Quote' : 'New Quote Request'
  const subtitle = resubmitId
    ? 'Fix what we flagged in red, then send it again. It keeps its reference code.'
    : "Four short steps. You'll get a reference code like Q-7F3K9A when you send it."

  return (
    <div>
      <PageHeader title={title} subtitle={subtitle} />
      {!clientId ? (
        <p className="text-ink-muted">Your login isn't linked to a client account.</p>
      ) : loadError ? (
        <div className="card px-5 py-4 text-sm">
          <p className="text-red-700">{loadError}</p>
          <Link to="/dashboard/quotes" className="mt-2 inline-block font-semibold text-primary hover:underline">
            Back to My Quotes
          </Link>
        </div>
      ) : resubmitId && !resubmit ? (
        <p className="text-ink-muted">Loading your quote...</p>
      ) : (
        <ClientQuoteForm
          // key: a fresh form once the resubmit quote has loaded
          key={resubmit?.quoteId ?? 'new'}
          clientId={clientId}
          resubmit={resubmit ?? undefined}
          nextSteps={NEXT_STEPS}
          actionLabel="View My Quotes"
          onDone={() => navigate('/dashboard/quotes')}
          secondaryLabel="Back to Home"
          onSecondary={() => navigate('/dashboard')}
          onCancel={() => navigate('/dashboard/quotes')}
        />
      )}
    </div>
  )
}

export function ClientRequestsPage() {
  return (
    <div>
      <PageHeader title="My Requests" subtitle="Questions you asked about a trip, and Dispatch's answers." />
      <p className="mb-4 border border-line bg-white px-4 py-3 text-sm text-ink-secondary">
        To ask something new, open a booking in{' '}
        <Link to="/dashboard/bookings" className="font-semibold text-primary hover:underline">
          My Bookings
        </Link>
        , show its trips, and choose Ask About This Trip.
      </p>
      <MyStatusRequestsSection />
    </div>
  )
}

export function ClientProfilePage() {
  const { clientId } = useAuth()
  const { profile, loading, error, setProfile } = useClientProfile(clientId)
  return (
    <div>
      <PageHeader title="My Profile" subtitle="Your contact details, login and review." />
      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        {clientId && (
          <ClientProfileSection clientId={clientId} profile={profile} loading={loading} error={error} onSaved={setProfile} />
        )}
        <ClientAccountSection />
        <ClientReviewSection />
      </div>
    </div>
  )
}
