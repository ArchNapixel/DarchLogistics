// SignedInPanel: shown on a login page when someone is ALREADY logged in
// with an account that doesn't belong on that page (e.g. a saved Admin
// session on Client Login). Instead of silently redirecting into the wrong
// dashboard, it says who is logged in and offers Log out / Go to dashboard.
import { Link } from 'react-router-dom'
import { logOut, useAuth } from '../context/AuthContext'

function SignedInPanel({ hint }: { hint: string }) {
  const { username, role } = useAuth()

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">You're already logged in</h1>
        <p className="mt-2 text-sm text-slate-600">
          {role
            ? <>Logged in as <span className="font-semibold">{username ?? 'unknown'}</span> ({role}).</>
            : 'Logged in, but your account role could not be loaded.'}
        </p>
        <p className="mt-1 text-sm text-slate-600">{hint}</p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={logOut}
            className="btn-primary px-4 py-3 text-sm font-semibold"
          >
            Log out
          </button>
          {role && (
            <Link
              to="/dashboard"
              className="border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Go to my dashboard
            </Link>
          )}
        </div>
        <Link to="/" className="mt-6 block text-sm text-slate-500 hover:text-slate-900">
          ← Back to home
        </Link>
      </div>
    </div>
  )
}

export default SignedInPanel
