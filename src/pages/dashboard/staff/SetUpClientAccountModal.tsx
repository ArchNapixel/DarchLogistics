// SetUpClientAccountModal: creates a real login for a client in one
// step -- calls the create-user-account Edge Function (which holds the
// service-role key server-side, never in browser code) to create the
// actual Supabase Auth account AND the linked `public.users` row
// together, with auth_user_id already attached. No more manual
// "go create it in the Dashboard" step.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { extractEdgeFunctionErrorMessage } from '../../../lib/edgeFunctionError'
import {
  ACCOUNT_MAX,
  filterUsername,
  passwordError,
  usernameError,
} from '../../../lib/clientAccount'

const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'
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
  // Same username rules as the client's own sign-up (lib/clientAccount.ts),
  // so the name can be typed at Client Login -- the company name with its
  // spaces removed is just a starting suggestion.
  const [username, setUsername] = useState(filterUsername(client.client_name).slice(0, ACCOUNT_MAX.username))
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit() {
    if (!email.trim() || !username.trim() || !password.trim()) {
      setError('Enter an email, username, and password.')
      return
    }
    const ruleError = usernameError(username) ?? passwordError(password, password)
    if (ruleError) {
      setError(ruleError)
      return
    }

    setSubmitting(true)
    setError(null)

    const { data, error: invokeError } = await supabase.functions.invoke(
      'create-user-account',
      {
        body: {
          // Lowercased like the client sign-up does, so Foo@x.com = foo@x.com.
          email: email.trim().toLowerCase(),
          username: username.trim(),
          password,
          user_role: 'Client',
          client_id: client.client_id,
        },
      },
    )

    setSubmitting(false)

    if (invokeError || data?.error) {
      setError(
        data?.error ??
          (await extractEdgeFunctionErrorMessage(
            invokeError,
            'Could not create account.',
          )),
      )
      return
    }

    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        {done ? (
          <>
            <h3 className="text-lg font-bold text-slate-900">
              Account created
            </h3>
            <p className="mt-3 text-sm text-slate-600">
              {client.client_name} can now log in with{' '}
              <span className="font-medium text-slate-900">{email}</span>{' '}
              and the password you just set. Share those credentials with
              them directly.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => onCreated(client.client_id)}
                className="btn-primary px-4 py-2 text-sm font-medium"
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
              <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                  onChange={(e) => setUsername(filterUsername(e.target.value))}
                  maxLength={ACCOUNT_MAX.username}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Password
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className={fieldClasses}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn-primary px-4 py-2 text-sm font-medium"
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
