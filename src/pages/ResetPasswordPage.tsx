// ResetPasswordPage: "/reset-password". The emailed reset link lands here.
// Supabase turns the link into a temporary session automatically (AuthContext
// picks it up), so "has a session" = "the link was valid". Then we just call
// updateUser to save the new password.
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

const fieldClasses =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'
const MIN_LENGTH = 6 // Supabase's default minimum; raise it in the dashboard if you change it there

function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    navigate('/dashboard')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-bold text-slate-900">
          Choose a new password
        </h1>

        {loading ? (
          <p className="mt-6 text-center text-sm text-slate-500">Loading...</p>
        ) : !session ? (
          // No session = the link was already used, expired, or never opened.
          <div className="mt-6 flex flex-col gap-4">
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              This reset link is invalid or has expired.
            </p>
            <Link
              to="/forgot-password"
              className="text-center text-sm font-semibold text-slate-900 hover:underline"
            >
              Request a new link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <label className={labelClasses}>
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                className={fieldClasses}
              />
            </label>

            <label className={labelClasses}>
              Confirm new password
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className={fieldClasses}
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default ResetPasswordPage
