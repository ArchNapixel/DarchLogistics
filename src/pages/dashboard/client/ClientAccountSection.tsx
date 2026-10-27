// ClientAccountSection: the "Login & Security" card on My Profile (the
// canvas's Client My Profile board) -- the client changes their own
// username or password. Both forms are always showing.
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
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'flex flex-col gap-1.5'
const labelText = 'text-sm font-semibold text-ink'

function ClientAccountSection() {
  const { username, session } = useAuth()
  // The name shown after a change (AuthContext only re-reads it on the next login).
  const [shownUsername, setShownUsername] = useState(username)

  const [newUsername, setNewUsername] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState<'username' | 'password' | null>(null)
  const [usernameProblem, setUsernameProblem] = useState<string | null>(null)
  const [passwordProblem, setPasswordProblem] = useState<string | null>(null)

  async function saveUsername(e: FormEvent) {
    e.preventDefault()
    const wanted = newUsername.trim()
    const problem = usernameError(wanted)
    if (problem) return setUsernameProblem(problem)
    if (wanted === shownUsername) return setUsernameProblem("That's already your username.")

    setSaving('username')
    setUsernameProblem(null)
    const { error: rpcError } = await supabase.rpc('change_my_username', { p_username: wanted })
    setSaving(null)
    if (rpcError) {
      // The function's own messages ("That username is already taken.") are written for people.
      return setUsernameProblem(rpcError.message)
    }
    setShownUsername(wanted)
    setNewUsername('')
    showToast('Username changed. Use the new one next time you log in.')
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault()
    if (!currentPassword) return setPasswordProblem('Enter your current password.')
    const problem = passwordError(newPassword, confirmPassword)
    if (problem) return setPasswordProblem(problem)
    const email = session?.user.email
    if (!email) return setPasswordProblem('Your login email could not be read. Log out and back in, then try again.')

    setSaving('password')
    setPasswordProblem(null)
    const { error: checkError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (checkError) {
      setSaving(null)
      return setPasswordProblem('Your current password is not correct.')
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
    setSaving(null)
    if (updateError) {
      return setPasswordProblem(
        updateError.message.toLowerCase().includes('different')
          ? 'Pick a password different from your current one.'
          : updateError.message,
      )
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    showToast('Password changed.')
  }

  const required = <span className="text-xs text-amber-800">Required</span>

  return (
    <section aria-labelledby="pf-s" className="card flex flex-col">
      <h2 id="pf-s" className="border-b border-line px-5 py-4 text-base font-semibold text-ink">
        Login &amp; Security
      </h2>

      <form onSubmit={saveUsername} className="flex flex-col gap-3 border-b border-line px-5 py-4">
        <p className="text-sm font-semibold text-ink">
          Username <span className="font-normal text-ink-muted">· now {shownUsername ?? '—'}</span>
        </p>
        <label className={labelClasses}>
          <span className={labelText}>New username</span>
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(filterUsername(e.target.value))}
            maxLength={ACCOUNT_MAX.username}
            placeholder={shownUsername ?? ''}
            autoComplete="username"
            className={fieldClasses}
          />
          <span className="text-[13px] text-ink-muted">3–{ACCOUNT_MAX.username} letters, numbers, dot, underscore or dash.</span>
        </label>
        {usernameProblem && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{usernameProblem}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={saving !== null || !newUsername.trim()} className="btn-secondary px-4 text-sm font-medium">
            {saving === 'username' ? 'Saving...' : 'Change Username'}
          </button>
        </div>
      </form>

      <form onSubmit={savePassword} className="flex flex-col gap-3 px-5 py-4">
        <p className="text-sm font-semibold text-ink">Password</p>
        {/* Hidden username field so password managers file the new password under the right account. */}
        <input type="text" autoComplete="username" value={shownUsername ?? ''} readOnly hidden />
        <label className={labelClasses}>
          <span className={`${labelText} flex justify-between gap-2`}>Current password {required}</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            maxLength={ACCOUNT_MAX.password}
            autoComplete="current-password"
            className={fieldClasses}
          />
        </label>
        <label className={labelClasses}>
          <span className={`${labelText} flex justify-between gap-2`}>New password {required}</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            maxLength={ACCOUNT_MAX.password}
            autoComplete="new-password"
            className={fieldClasses}
          />
        </label>
        <label className={labelClasses}>
          <span className={`${labelText} flex justify-between gap-2`}>Confirm new password {required}</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            maxLength={ACCOUNT_MAX.password}
            autoComplete="new-password"
            className={fieldClasses}
          />
        </label>
        {passwordProblem && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{passwordProblem}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={saving !== null} className="btn-secondary px-4 text-sm font-medium">
            {saving === 'password' ? 'Saving...' : 'Change Password'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default ClientAccountSection
