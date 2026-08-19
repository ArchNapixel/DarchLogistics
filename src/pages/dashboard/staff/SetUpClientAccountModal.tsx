// SetUpClientAccountModal: creates a pending `users` row for a client
// (email, username, user_role = 'Client', linked via client_id) with no
// login attached yet -- auth_user_id stays NULL. The actual Supabase
// Auth login has to be created manually afterward (Dashboard ->
// Authentication -> Users, same email), since creating real accounts
// requires a secret key that can never live in browser code.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type Client = {
  client_id: number
  client_name: string
  email: string | null
}

function SetUpClientAccountModal({
  client,
  onClose,
  onCreated,
}: {
  client: Client
  onClose: () => void
  onCreated: (clientId: number) => void
}) {
  const [email, setEmail] = useState(client.email ?? '')
  const [username, setUsername] = useState(client.client_name)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit() {
    if (!email.trim() || !username.trim()) {
      setError('Enter both an email and a username.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: insertError } = await supabase.from('users').insert({
      email,
      username,
      user_role: 'Client',
      client_id: client.client_id,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        {done ? (
          <>
            <h3 className="text-lg font-bold text-slate-900">
              Account record created
            </h3>
            <p className="mt-3 text-sm text-slate-600">
              One more step: go to Supabase Dashboard → Authentication →
              Users → Add user, and create a login for{' '}
              <span className="font-medium text-slate-900">{email}</span>{' '}
              with a temporary password. Then share those credentials with{' '}
              {client.client_name} directly -- the app will link their
              account automatically the first time they log in.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => onCreated(client.client_id)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-lg font-bold text-slate-900">
              Set Up Account for {client.client_name}
            </h3>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-4 grid gap-4">
              <label className={labelClasses}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Username
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={fieldClasses}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Create Account Record'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default SetUpClientAccountModal
