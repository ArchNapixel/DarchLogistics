// ClientProfileSection: view/edit form for the logged-in client's own
// contact info (clients.client_name/email/phone_number). Profile state
// and loading/error come from useClientProfile() (below) in the parent
// page, since the Home page's welcome banner also needs client_name --
// this component just renders what it's given and reports back the
// updated row on save, via onSaved.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { phoneDigits, phoneError, phoneInput as formatPhone } from '../../../lib/quoteRequest'

export type ClientProfile = {
  client_name: string
  email: string | null
  phone_number: string | null
}

// Loads the client's own profile row. Used by the Home page (welcome
// banner) and the My Profile page.
export function useClientProfile(clientId: number | null) {
  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clientId) {
      setLoading(false)
      return
    }
    supabase
      .from('clients')
      .select('client_name, email, phone_number')
      .eq('client_id', clientId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError(loadError.message)
        } else {
          setProfile(data)
          setError(null)
        }
        setLoading(false)
      })
  }, [clientId])

  return { profile, loading, error, setProfile }
}

const fieldClasses =
  'border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-slate-900">{value}</p>
    </div>
  )
}

function ClientProfileSection({
  clientId,
  profile,
  loading,
  error,
  onSaved,
}: {
  clientId: number
  profile: ClientProfile | null
  loading: boolean
  error: string | null
  onSaved: (profile: ClientProfile) => void
}) {
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function startEditing() {
    if (!profile) {
      return
    }
    setNameInput(profile.client_name)
    setEmailInput(profile.email ?? '')
    setPhoneInput(formatPhone(profile.phone_number ?? ''))
    setSaveError(null)
    setEditing(true)
  }

  async function handleSave() {
    if (!nameInput.trim()) {
      setSaveError('Enter a name.')
      return
    }
    const phoneProblem = phoneError(phoneInput)
    if (phoneProblem) {
      setSaveError(phoneProblem)
      return
    }
    // Loose check only -- catches typos like a missing "@" or ".com".
    if (emailInput.trim() && !/^\S+@\S+\.\S+$/.test(emailInput.trim())) {
      setSaveError('Enter a valid email address, e.g. name@company.com.')
      return
    }

    setSaving(true)
    setSaveError(null)

    const { data, error: updateError } = await supabase
      .from('clients')
      .update({
        client_name: nameInput.trim(),
        email: emailInput.trim() || null,
        phone_number: phoneDigits(phoneInput),
      })
      .eq('client_id', clientId)
      .select('client_name, email, phone_number')
      .single()

    setSaving(false)

    if (updateError || !data) {
      setSaveError(updateError?.message ?? 'Could not save your profile.')
      return
    }

    onSaved(data)
    setEditing(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your profile...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (!profile) {
    return <p className="text-slate-500">No profile information on file yet.</p>
  }

  if (!editing) {
    return (
      <div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Client name" value={profile.client_name} />
          <Field label="Email" value={profile.email ?? '—'} />
          <Field label="Phone number" value={profile.phone_number ?? '—'} />
        </div>
        <button
          onClick={startEditing}
          className="mt-4 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          Edit profile
        </button>
      </div>
    )
  }

  return (
    <div>
      {saveError && (
        <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className={labelClasses}>
          Client name
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            className={fieldClasses}
          />
        </label>

        <label className={labelClasses}>
          Email
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            className={fieldClasses}
          />
        </label>

        <label className={labelClasses}>
          Phone number
          <input
            type="tel"
            inputMode="numeric"
            maxLength={13}
            value={phoneInput}
            onChange={(e) => setPhoneInput(formatPhone(e.target.value))}
            className={fieldClasses}
          />
        </label>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary px-4 py-2 text-sm font-medium"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

export default ClientProfileSection
