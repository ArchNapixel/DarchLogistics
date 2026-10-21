// ClientSetupPage: the second step of "Continue with Google" sign-up at
// "/client-setup". Google has already proven the email; here the client
// picks a username + password (so later logins work like staff: username
// and password, no Google needed) and gives their name and phone. The
// complete_client_signup database function (SQL given in chat) then
// creates the `clients` + `users` rows for the signed-in Google account.
import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { phoneDigits, phoneError, phoneInput } from '../lib/quoteRequest'

const fieldClasses =
  'w-full border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function ClientSetupPage() {
  const { session, role, loading } = useAuth()
  // Session is still null on first render, so the Google name can't seed
  // useState -- `name` holds only what the user typed; see googleName below.
  const [name, setName] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return null
  // Not signed in with Google yet -> back to the client login page.
  if (!session) return <Navigate to="/client-login" replace />
  // Account already complete -> nothing to set up.
  if (role) return <Navigate to="/dashboard" replace />

  // Name shown in the box: what they typed, else the Google profile name.
  const googleName = (session.user.user_metadata?.full_name as string) ?? ''
  const nameValue = name ?? googleName

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const user = username.trim()
    if (!nameValue.trim()) return setError('Enter your name or company name.')
    const pErr = phoneError(phone)
    if (pErr) return setError(pErr)
    if (user.length < 3 || user.includes('@') || /\s/.test(user))
      return setError('Username: at least 3 characters, no spaces or "@".')
    if (password.length < 6)
      return setError('Password must be at least 6 characters.')

    setSubmitting(true)
    // Password first: if the username turns out to be taken, the client
    // just picks another and the password is simply set again.
    const { error: pwError } = await supabase.auth.updateUser({ password })
    if (pwError) {
      setSubmitting(false)
      return setError(pwError.message)
    }

    const { error: rpcError } = await supabase.rpc('complete_client_signup', {
      p_username: user,
      p_name: nameValue.trim(),
      p_phone: phoneDigits(phone),
    })
    setSubmitting(false)
    if (rpcError) return setError(rpcError.message)

    // Full reload so AuthContext re-reads the new `users` row.
    window.location.assign('/dashboard')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-bold text-slate-900">
          Finish your account
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Signed in with Google as {session.user.email}. Choose a username and
          password — you'll use these to log in next time.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && (
            <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
          )}
          <label className={labelClasses}>
            Name or company
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setName(e.target.value)}
              required
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
              className={fieldClasses}
            />
          </label>
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
          <label className={labelClasses}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={fieldClasses}
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary mt-2 px-4 py-3 text-sm font-semibold"
          >
            {submitting ? 'Saving...' : 'Create Account'}
          </button>
        </form>

        {/* Escape hatch: abandon setup and sign the Google session out. */}
        <Link
          to="/client-login"
          onClick={() => supabase.auth.signOut()}
          className="mt-6 block text-center text-sm text-slate-500 hover:text-slate-900"
        >
          Cancel
        </Link>
      </div>
    </div>
  )
}

export default ClientSetupPage
