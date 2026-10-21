// ClientLoginPage: login + sign-up for clients at "/client-login".
// One page, two modes (toggle at the bottom). Log in = Supabase Auth
// email + password. Sign up = supabase.auth.signUp with the name/phone
// passed as metadata; a database trigger (handle_client_signup, SQL given
// in chat) then creates the `clients` + `users` rows, so no extra insert
// from the browser is needed.
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { phoneDigits, phoneError, phoneInput } from '../lib/quoteRequest'

const fieldClasses =
  'w-full border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function ClientLoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
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
  // Signed in with Google but no account yet -> finish setup first.
  if (session && !role) return <Navigate to="/client-setup" replace />
  if (session) return <Navigate to="/dashboard" replace />

  const signingUp = mode === 'signup'

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (signingUp) {
      if (!name.trim()) return setError('Enter your name or company name.')
      const pErr = phoneError(phone)
      if (pErr) return setError(pErr)
      const u = username.trim()
      if (u.length < 3 || u.includes('@') || /\s/.test(u))
        return setError('Username: at least 3 characters, no spaces or "@".')
      if (password.length < 6)
        return setError('Password must be at least 6 characters.')
      if (password !== confirmPassword)
        return setError('Passwords do not match.')
    }

    setSubmitting(true)
    const cleanEmail = email.trim()

    if (signingUp) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          // Confirmation link lands here; this page forwards to the dashboard.
          emailRedirectTo: `${window.location.origin}/client-login`,
          data: {
            sign_up_as_client: true,
            client_name: name.trim(),
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
      navigate('/dashboard')
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
    const { error: signInError } = loginEmail
      ? await supabase.auth.signInWithPassword({ email: loginEmail, password })
      : { error: true }
    setSubmitting(false)
    if (signInError) {
      // Right password, but the sign-up email link hasn't been clicked yet.
      const notConfirmed =
        typeof signInError === 'object' && signInError.code === 'email_not_confirmed'
      return setError(
        notConfirmed
          ? 'Please confirm your email first — check your inbox for the link.'
          : 'Invalid username or password.',
      )
    }
    navigate('/dashboard')
  }

  // Google proves the email, then /client-setup asks for username + password.
  async function handleGoogle() {
    setError(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/client-setup` },
    })
    if (oauthError) setError(oauthError.message)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center bg-navy text-xl font-bold text-white">
          D
        </div>
        <h1 className="mt-3 text-center text-xl font-bold text-slate-900">
          Darch Logistics
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          {signingUp ? 'Create your client account' : 'Client login'}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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
                onChange={(e) => setEmail(e.target.value)}
                required
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
                onChange={(e) => setUsername(e.target.value)}
                required
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
              autoComplete={signingUp ? 'new-password' : 'current-password'}
              className={fieldClasses}
            />
            {!signingUp && (
              <Link
                to="/forgot-password"
                className="self-end text-xs font-normal text-slate-500 hover:text-slate-900"
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
                  autoComplete="new-password"
                  className={fieldClasses}
                />
              </label>
              <label className={labelClasses}>
                Name or company
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className={fieldClasses}
                />
              </label>
              <label className={labelClasses}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
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

          <button
            type="submit"
            disabled={submitting}
            className="btn-primary mt-2 px-4 py-3 text-sm font-semibold"
          >
            {submitting
              ? 'Please wait...'
              : signingUp
                ? 'Sign Up'
                : 'Log In'}
          </button>
        </form>

        {signingUp && (
          <button
            type="button"
            onClick={handleGoogle}
            className="mt-3 w-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Continue with Google
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(signingUp ? 'login' : 'signup')
            setError(null)
            setNotice(null)
          }}
          className="mt-4 block w-full text-center text-sm text-slate-600 hover:text-slate-900"
        >
          {signingUp
            ? 'Already have an account? Log in'
            : 'New client? Create an account'}
        </button>

        <Link
          to="/"
          className="mt-4 block text-center text-sm text-slate-500 hover:text-slate-900"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  )
}

export default ClientLoginPage
