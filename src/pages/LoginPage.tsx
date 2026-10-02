// LoginPage: sign-in at "/login" for every role (staff, employees, clients).
// Uses Supabase Auth's signInWithPassword. On success, sends the user to
// /dashboard. If someone is already logged in, skips straight to /dashboard.
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

const fieldClasses =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function LoginPage() {
  const [identifier, setIdentifier] = useState('') // username or email
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const { session } = useAuth()

  // Already logged in? No reason to show the form.
  if (session) return <Navigate to="/dashboard" replace />

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    // Supabase Auth only signs in with an email, so a username is first
    // turned into its account's email by the get_login_email database
    // function. Anything containing "@" is treated as an email directly
    // (usernames can't contain "@" -- see create-user-account).
    const typed = identifier.trim()
    let loginEmail: string | null = typed
    if (!typed.includes('@')) {
      const { data } = await supabase.rpc('get_login_email', {
        p_username: typed,
      })
      loginEmail = data ?? null
    }

    // Unknown username -> same message as a wrong password, so the form
    // doesn't reveal which usernames exist.
    const { error: signInError } = loginEmail
      ? await supabase.auth.signInWithPassword({ email: loginEmail, password })
      : { error: true }

    setSubmitting(false)

    if (signInError) {
      // Note: we don't clear the fields here, so the user can just fix a
      // typo and retry instead of retyping everything.
      setError('Invalid username or password.')
      return
    }

    navigate('/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-xl font-bold text-white">
          D
        </div>
        <h1 className="mt-3 text-center text-xl font-bold text-slate-900">
          Darch Logistics
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <label className={labelClasses}>
            Username or email
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
              autoComplete="username"
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Password
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className={`${fieldClasses} pr-16`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-slate-500 hover:text-slate-900"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <Link
              to="/forgot-password"
              className="self-end text-xs font-normal text-slate-500 hover:text-slate-900"
            >
              Forgot password?
            </Link>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <Link
          to="/"
          className="mt-6 block text-center text-sm text-slate-500 hover:text-slate-900"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  )
}

export default LoginPage
