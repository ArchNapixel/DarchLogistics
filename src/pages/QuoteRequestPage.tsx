// QuoteRequestPage: the "Get a Quote" page at /quote-request. Quotes need
// a client account now (so a rejected quote can come back to the client
// with the reason, and be edited and resubmitted from their portal):
// logged out -> a sign up / log in panel that returns here afterwards;
// logged in as a client -> ClientQuoteForm (the same form as the portal's
// New Quote). This page adds the header band and the "what happens next"
// content, matching the rest of the public site's look.
import { Link, useNavigate } from 'react-router-dom'
import NavBar from '../components/NavBar'
import Footer from '../components/Footer'
import ClientQuoteForm from './dashboard/client/ClientQuoteForm'
import { logOut, useAuth } from '../context/AuthContext'

const steps = [
  'We check your load against our trailers.',
  'We confirm escort and permit needs.',
  'We send you our rate -- accept it, counter it, or decline in your dashboard.',
]

// Where the login page sends people back to after signing in.
const loginLink = (mode: 'login' | 'signup') =>
  `/client-login?next=/quote-request${mode === 'signup' ? '&mode=signup' : ''}`

function QuoteRequestPage() {
  const { session, role, clientId, loading } = useAuth()
  const navigate = useNavigate()

  return (
    <div>
      <NavBar />

      <div
        className="relative bg-brand-navy bg-cover bg-center"
        style={{ backgroundImage: "url('/images/warehouse-loading.jpg')" }}
      >
        <div className="absolute inset-0 bg-brand-navy/85" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.2em] text-brand-steel uppercase">
            Quote Request
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold uppercase leading-tight text-white sm:text-5xl">
            Tell us what to move
          </h1>
          <p className="mt-4 max-w-xl text-slate-200">
            Rates the same business day.
          </p>
        </div>
      </div>

      <div className="bg-brand-paper py-14">
        {/* The form lays out its own two columns (steps + live quote
            summary); the "what happens next" panel and photo sit under
            that summary. */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {loading ? null : !session || role !== 'Client' || !clientId ? (
            <div className="mx-auto max-w-lg border border-slate-300 bg-white p-8 text-center">
              <h2 className="text-xl font-semibold text-slate-900">
                {session ? 'Log in with a client account' : 'Sign up to request a quote'}
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                {session
                  ? 'Quote requests are sent from a client account. Staff can log quotes from Quotations in the dashboard.'
                  : "It's free and takes a minute. Your account lets you follow your quote, see our reply, and fix and resend it if we can't accept it as is."}
              </p>
              {/* Logged in with a non-client account: offer a way out so
                  they can log in as a client (the login links would just
                  bounce while this session exists). */}
              {session && (
                <button
                  type="button"
                  onClick={logOut}
                  className="btn-primary mt-6 px-5 py-3 text-sm font-semibold"
                >
                  Log out
                </button>
              )}
              {!session && (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <Link to={loginLink('signup')} className="btn-primary px-5 py-3 text-sm font-semibold">
                    Create an account
                  </Link>
                  <Link
                    to={loginLink('login')}
                    className="border border-line-control px-5 py-3 text-sm font-semibold text-ink-metric hover:bg-slate-50 rounded-[2px]"
                  >
                    Log in
                  </Link>
                </div>
              )}
            </div>
          ) : (
          <ClientQuoteForm
            clientId={clientId}
            nextSteps={steps}
            actionLabel="Go to my dashboard"
            onDone={() => navigate('/dashboard')}
            aside={
              <>
                <div className="card p-5">
                  <p className="text-xs font-semibold tracking-[0.15em] text-brand-steel-dark uppercase">
                    Next Steps
                  </p>
                  <ol className="mt-3 flex flex-col gap-3 text-sm text-slate-700">
                    {steps.map((step, index) => (
                      <li key={step} className="flex gap-2">
                        <span className="font-semibold text-brand-steel-dark">
                          {index + 1}.
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <figure className="hidden overflow-hidden border border-slate-300 lg:block">
                  <img
                    src="/images/crane-lift.jpg"
                    alt="Rigging and load-out handled on site"
                    className="h-48 w-full object-cover grayscale"
                  />
                  <figcaption className="bg-white px-3 py-2 text-xs font-semibold tracking-[0.1em] text-slate-500 uppercase">
                    Rigging and load-out handled on site
                  </figcaption>
                </figure>
              </>
            }
          />
          )}
        </div>
      </div>

      <Footer />
    </div>
  )
}

export default QuoteRequestPage
