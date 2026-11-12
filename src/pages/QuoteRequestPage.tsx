// QuoteRequestPage: "/quote-request", where every "Get a Quote" button on
// the public site points. It has no form of its own -- quotes are only
// entered in the client portal (New Quote Request, /dashboard/quotes/new)
// or by staff. This page just forwards:
//   logged out        -> Sign Up, then on to the portal's quote form
//   logged-in client  -> the portal's quote form
//   any other account -> "you're already logged in" panel
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SignedInPanel from '../components/SignedInPanel'

const PORTAL_QUOTE_FORM = '/dashboard/quotes/new'

function QuoteRequestPage() {
  const { session, role, loading } = useAuth()

  if (loading) return null
  if (!session)
    return (
      <Navigate
        to={`/client-login?mode=signup&next=${encodeURIComponent(PORTAL_QUOTE_FORM)}`}
        replace
      />
    )
  if (role === 'Client') return <Navigate to={PORTAL_QUOTE_FORM} replace />
  return <SignedInPanel hint="Quote requests are sent from a client account. Staff can log quotes from Quotations in the dashboard." />
}

export default QuoteRequestPage
