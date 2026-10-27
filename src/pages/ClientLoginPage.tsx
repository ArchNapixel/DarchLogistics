// ClientLoginPage: login + sign-up for clients at "/client-login" (the
// canvas's Client Login & Sign Up board): the public nav bar, a short
// "about the client portal" panel, and a card with Log In / Sign Up tabs. Log in = Supabase Auth
// email + password. Sign up = supabase.auth.signUp with the name/phone
// passed as metadata; a database trigger (handle_client_signup, SQL given
// in chat) then creates the `clients` + `users` rows, so no extra insert
// from the browser is needed.
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import SignedInPanel from '../components/SignedInPanel'
import NavBar from '../components/NavBar'
import { phoneDigits, phoneError, phoneInput } from '../lib/quoteRequest'
import { ACCOUNT_MAX as MAX, filterUsername, passwordError, usernameError } from '../lib/clientAccount'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'

// What the portal is for (left panel).
const PORTAL_POINTS = [
  'Request a quote and answer our offer online',
  'Follow each trip of your booking',
  "See what you owe and when it's due",
]

// Typing filters, so bad characters never get into the boxes at all.
// Username rules (and the max lengths) live in lib/clientAccount.ts,
// shared with the portal's "change username".
// Name or company: letters (any language), digits, and . , ' & ( ) / -
// plus single spaces (companies like "3M Trading Co., Inc." must fit).
const filterName = (v: string) =>
  v.replace(/\s/g, ' ').replace(/[^\p{L}\p{M}0-9 .,'’&()/-]/gu, '').replace(/ {2,}/g, ' ')
// Email / username-or-email: no spaces anywhere.
const filterNoSpaces = (v: string) => v.replace(/\s/g, '')

function ClientLoginPage() {
  // ?next=/quote-request sends them back there after logging in; only
  // same-site paths are allowed ("//evil.com" would leave the site).
  // ?mode=signup opens the sign-up form straight away.
  const [params] = useSearchParams()
  const nextParam = params.get('next') ?? ''
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'
  const [mode, setMode] = useState<'login' | 'signup'>(
    params.get('mode') === 'signup' ? 'signup' : 'login',
  )
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const { session, role, loading } = useAuth()

  if (loading) return null
  // Only a CLIENT session skips the form. Any other saved session (e.g. an
  // Admin who never logged out) gets a "you're logged in as..." panel
  // instead of being dropped into the staff dashboard from Client Login.
  if (session && role === 'Client') return <Navigate to={next} replace />
  if (session)
    return <SignedInPanel hint="Log out first to log in with a client account." />

  const signingUp = mode === 'signup'

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (signingUp) {
      if (!name.trim()) return setError('Enter your name or company name.')
      const pErr = phoneError(phone)
      if (pErr) return setError(pErr)
      if (name.trim().length > MAX.name)
        return setError(`Name is too long (max ${MAX.name} characters).`)
      const uErr = usernameError(username)
      if (uErr) return setError(uErr)
      if (email.trim().length > MAX.email)
        return setError(`Email is too long (max ${MAX.email} characters).`)
      const pwErr = passwordError(password, confirmPassword)
      if (pwErr) return setError(pwErr)
    }

    setSubmitting(true)
    // Emails are lowercased so Foo@x.com and foo@x.com are one account.
    // A username (no "@") is left as typed -- its lookup decides the case rule.
    const cleanEmail = email.includes('@') ? email.trim().toLowerCase() : email.trim()

    if (signingUp) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          // Confirmation link lands here; this page forwards to the dashboard.
          emailRedirectTo: `${window.location.origin}/client-login?next=${encodeURIComponent(next)}`,
          data: {
            sign_up_as_client: true,
            client_name: name.trim().replace(/\s+/g, ' '),
            username: username.trim(),
            phone_number: phoneDigits(phone),
          },
        },
      })
      setSubmitting(false)
      if (signUpError) {
        // Supabase hides the trigger's own message (e.g. "That username is
        // already taken") behind this generic one.
        return setError(
          signUpError.message.includes('Database error saving new user')
            ? 'Could not create the account. That username may already be taken — try another.'
            : signUpError.message,
        )
      }
      // Email already registered: with "Confirm email" on, Supabase returns
      // a fake user with no identities instead of an error.
      if (data.user?.identities?.length === 0)
        return setError('An account with this email already exists. Log in instead.')
      // No session = Supabase is waiting for the email to be confirmed.
      if (!data.session) {
        setMode('login')
        setNotice('Account created. Check your email to confirm it, then log in.')
        return
      }
      navigate(next)
      return
    }

    // Same as staff login: a username is turned into its account email
    // first; anything with "@" is used as the email directly.
    let loginEmail: string | null = cleanEmail
    if (!cleanEmail.includes('@')) {
      const { data } = await supabase.rpc('get_login_email', {
        p_username: cleanEmail,
      })
      loginEmail = data ?? null
    }
    const { data: signInData, error: signInError } = loginEmail
      ? await supabase.auth.signInWithPassword({ email: loginEmail, password })
      : { data: null, error: true }

    // Staff accounts belong on Staff Login: sign them straight back out.
    // No users row found (an old staff-created client account claimed on
    // first login by AuthContext) is let through -- only a known non-Client
    // role is refused.
    if (!signInError && signInData?.user) {
      const { data: userRow } = await supabase
        .from('users')
        .select('user_role')
        .eq('auth_user_id', signInData.user.id)
        .maybeSingle()
      if (userRow && userRow.user_role !== 'Client') {
        await supabase.auth.signOut()
        setSubmitting(false)
        return setError('This is a staff account — please use Staff Login.')
      }
    }

    setSubmitting(false)
    if (signInError) {
      // Right password, but the sign-up email link hasn't been clicked yet.
      const code = typeof signInError === 'object' ? signInError.code : null
      return setError(
        code === 'email_not_confirmed'
          ? 'Please confirm your email first — check your inbox for the link.'
          : // Banned by set_client_active() when staff deactivate the client.
            code === 'user_banned'
            ? 'This account has been deactivated. Please contact Darch Logistics.'
            : 'Invalid username or password.',
      )
    }
    navigate(next)
  }

  // Switch tabs; a typed password never carries over to the other form.
  function switchMode(to: 'login' | 'signup') {
    setMode(to)
    setPassword('')
    setConfirmPassword('')
    setError(null)
    setNotice(null)
  }

  const tab = (label: string, to: 'login' | 'signup') => {
    const on = (to === 'signup') === signingUp
    return (
      <button
        type="button"
        role="tab"
        aria-selected={on}
        onClick={() => switchMode(to)}
        className={`min-h-11 flex-1 border text-sm font-semibold ${
          on ? 'relative border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-50'
        } [&:not(:first-child)]:-ml-px`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <NavBar />
      <main className="mx-auto grid w-full max-w-[1040px] flex-1 items-center gap-6 px-4 py-10 md:grid-cols-[minmax(0,1fr)_440px]">
        <section aria-label="About the client portal" className="hidden bg-navy px-8 py-10 text-white md:block">
          <h1 className="text-3xl leading-tight font-bold">
            Your shipments,
            <br />
            in one place
          </h1>
          <ul className="mt-6 flex flex-col gap-3 text-[15px] text-slate-200">
            {PORTAL_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden="true">
                  <path d="M5 12l5 5 9-10" />
                </svg>
                {point}
              </li>
            ))}
          </ul>
        </section>

      <div className="card w-full p-6 sm:p-8">
        <h2 className="sr-only">{signingUp ? 'Create your client account' : 'Client login'}</h2>
        <div role="tablist" aria-label="Log in or sign up" className="flex">
          {tab('Log In', 'login')}
          {tab('Sign Up', 'signup')}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          {error && (
            <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}
          {notice && (
            <p className="bg-green-50 px-4 py-3 text-sm text-green-700">
              {notice}
            </p>
          )}

          {/* Login mode: one field that takes a username or an email. */}
          {!signingUp && (
            <label className={labelClasses}>
              Username or email
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(filterNoSpaces(e.target.value))}
                required
                maxLength={MAX.email}
                autoComplete="username"
                className={fieldClasses}
              />
            </label>
          )}
          {signingUp && (
            <label className={labelClasses}>
              Username
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(filterUsername(e.target.value))}
                required
                maxLength={MAX.username}
                autoComplete="username"
                className={fieldClasses}
              />
            </label>
          )}

          <label className={labelClasses}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={MAX.password}
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              className={fieldClasses}
            />
            {!signingUp && (
              <Link
                to="/forgot-password"
                className="self-end text-[13px] font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </label>

          {signingUp && (
            <>
              <label className={labelClasses}>
                Confirm password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  maxLength={MAX.password}
                  autoComplete="new-password"
                  className={fieldClasses}
                />
              </label>
              <label className={labelClasses}>
                Name or company
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(filterName(e.target.value))}
                  required
                  maxLength={MAX.name}
                  autoComplete="name"
                  className={fieldClasses}
                />
              </label>
              <label className={labelClasses}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(filterNoSpaces(e.target.value))}
                  required
                  maxLength={MAX.email}
                  autoComplete="email"
                  className={fieldClasses}
                />
              </label>
              <label className={labelClasses}>
                Phone number
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(phoneInput(e.target.value))}
                  required
                  placeholder="0966 047 5467"
                  autoComplete="tel"
                  className={fieldClasses}
                />
              </label>
            </>
          )}

          <button type="submit" disabled={submitting} className="btn-primary mt-2 px-4 text-sm">
            {submitting ? 'Please wait...' : signingUp ? 'Create Account' : 'Log In'}
          </button>
          <p className="text-center text-[13px] text-ink-muted">
            {signingUp ? (
              "We'll email you a confirmation link. It brings you back here to log in."
            ) : (
              <>
                Staff accounts can't log in here. Use{' '}
                <Link to="/login" className="font-semibold text-primary hover:underline">
                  Staff Login
                </Link>
                .
              </>
            )}
          </p>
        </form>
      </div>
      </main>
    </div>
  )
}

export default ClientLoginPage
