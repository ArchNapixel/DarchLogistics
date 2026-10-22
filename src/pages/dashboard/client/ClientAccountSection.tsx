// ClientAccountSection: "Login & security" in the client portal -- the
// client changes their own username or password.
//
// Username: clients can't edit `users` directly (RLS), so it goes through
// the change_my_username() database function (SQL given in chat), which
// re-checks the format, refuses a name someone else has (any letter
// case), and only ever touches the caller's own row. Logging in by
// username keeps working because get_login_email looks the new name up.
//
// Password: re-checks the current password first (a signed-in session
// left open on a shared computer shouldn't be enough to take over the
// account), then supabase.auth.updateUser. Forgot it entirely? The
// "Forgot password?" link on the login page sends a reset email.
import { useState, type FormEvent } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import { ACCOUNT_MAX, filterUsername, passwordError, usernameError } from '../../../lib/clientAccount'

const fieldClasses =
  'w-full border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function ClientAccountSection() {
  const { username, session } = useAuth()
  // The name shown after a change (AuthContext only re-reads it on the next login).
  const [shownUsername, setShownUsername] = useState(username)
  const [editing, setEditing] = useState<'username' | 'password' | null>(null)

  const [newUsername, setNewUsername] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open(which: 'username' | 'password') {
    setEditing(which)
    setError(null)
    setNewUsername(shownUsername ?? '')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  async function saveUsername(e: FormEvent) {
    e.preventDefault()
    const wanted = newUsername.trim()
    const problem = usernameError(wanted)
    if (problem) return setError(problem)
    if (wanted === shownUsername) return setEditing(null)

    setSaving(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('change_my_username', { p_username: wanted })
    setSaving(false)
    if (rpcError) {
      // The function's own messages ("That username is already taken.") are written for people.
      return setError(rpcError.message)
    }
    setShownUsername(wanted)
    setEditing(null)
    showToast('Username changed. Use the new one next time you log in.')
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    const problem = passwordError(newPassword, confirmPassword)
    if (problem) return setError(problem)
    const email = session?.user.email
    if (!email) return setError('Your login email could not be read. Log out and back in, then try again.')

    setSaving(true)
    setError(null)
    const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (checkError) {
      setSaving(false)
      return setError('Your current password is not correct.')
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(false)
    if (updateError) {
      return setError(
        updateError.message.toLowerCase().includes('different')
          ? 'Pick a password different from your current one.'
          : updateError.message,
      )
    }
    setEditing(null)
    showToast('Password changed.')
  }

  return (
    <div>
      {editing === null && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Username</p>
            <p className="mt-0.5 text-slate-900">{shownUsername ?? '—'}</p>
            <button
              type="button"
              onClick={() => open('username')}
              className="mt-1 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Change username
            </button>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Password</p>
            <p className="mt-0.5 text-slate-900">••••••••</p>
            <button
              type="button"
              onClick={() => open('password')}
              className="mt-1 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Change password
            </button>
          </div>
        </div>
      )}

      {editing === 'username' && (
        <form onSubmit={saveUsername} className="flex max-w-sm flex-col gap-4">
          <label className={labelClasses}>
            New username
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(filterUsername(e.target.value))}
              maxLength={ACCOUNT_MAX.username}
              autoComplete="username"
              required
              className={fieldClasses}
            />
            <span className="text-xs font-normal text-slate-500">
              3–{ACCOUNT_MAX.username} letters, numbers, dot, underscore or dash.
            </span>
          </label>
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm font-medium">
              {saving ? 'Saving...' : 'Save username'}
            </button>
          </div>
        </form>
      )}

      {editing === 'password' && (
        <form onSubmit={savePassword} className="flex max-w-sm flex-col gap-4">
          {/* Hidden username field so password managers file the new password under the right account. */}
          <input type="text" autoComplete="username" value={shownUsername ?? ''} readOnly hidden />
          <label className={labelClasses}>
            Current password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              maxLength={ACCOUNT_MAX.password}
              autoComplete="current-password"
              required
              className={fieldClasses}
            />
          </label>
          <label className={labelClasses}>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              maxLength={ACCOUNT_MAX.password}
              autoComplete="new-password"
              required
              className={fieldClasses}
            />
          </label>
          <label className={labelClasses}>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              maxLength={ACCOUNT_MAX.password}
              autoComplete="new-password"
              required
              className={fieldClasses}
            />
          </label>
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => setEditing(null)} disabled={saving} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary px-4 py-2 text-sm font-medium">
              {saving ? 'Saving...' : 'Save password'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default ClientAccountSection
