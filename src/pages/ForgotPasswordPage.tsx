// ForgotPasswordPage: "/forgot-password". Asks for the account's email and
// has Supabase Auth email a reset link. The link opens /reset-password
// (see ResetPasswordPage), where the user picks a new password.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${window.location.origin}/reset-password` },
    )

    setSubmitting(false)

    if (resetError) {
      setError('Could not send the reset email. Please try again in a moment.')
      return
    }

    // Same message whether or not the email has an account, so this page
    // can't be used to find out who is registered.
    setSent(true)
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-bold text-slate-900">
          Reset your password
        </h1>

        {sent ? (
          <p className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
            If an account exists for {email}, a reset link is on its way.
            Check your inbox (and spam folder).
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <p className="text-sm text-slate-500">
              Enter your account email and we'll send you a link to set a new
              password.
            </p>

            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        )}

        <Link
          to="/login"
          className="mt-6 block text-center text-sm text-slate-500 hover:text-slate-900"
        >
          ← Back to login
        </Link>
      </div>
    </div>
  )
}

export default ForgotPasswordPage
