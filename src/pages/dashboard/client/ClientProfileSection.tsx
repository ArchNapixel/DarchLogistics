// ClientProfileSection: the "Contact details" card on My Profile (the
// canvas's Client My Profile board) -- the logged-in client's own contact
// info (clients.client_name / phone_number / email / address), always
// editable, with Discard Changes and Save Changes. Profile state
// and loading/error come from useClientProfile() (useClientProfile.ts) in the parent
// page, since the Home page's welcome banner also needs client_name --
// this component just renders what it's given and reports back the
// updated row on save, via onSaved.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import type { ClientProfile } from './useClientProfile'
import { phoneDigits, phoneError, phoneInput as formatPhone } from '../../../lib/quoteRequest'
import { showToast } from '../../../components/Toast'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'

function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <span className="flex justify-between gap-2 text-sm font-semibold text-ink">
      <span>
        {text}
        {!required && <span className="font-normal text-ink-muted"> (optional)</span>}
      </span>
      {required && <span className="text-xs text-amber-800">Required</span>}
    </span>
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
  const [nameInput, setNameInput] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [addressInput, setAddressInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Fill the form from what's on file (and again after Discard / Save).
  function reset(from: ClientProfile) {
    setNameInput(from.client_name)
    setEmailInput(from.email ?? '')
    setPhoneInput(formatPhone(from.phone_number ?? ''))
    setAddressInput(from.address ?? '')
    setSaveError(null)
  }

  // Loaded once by the page; fill the form when it arrives.
  const [filledFrom, setFilledFrom] = useState<ClientProfile | null>(null)
  if (profile && profile !== filledFrom) {
    setFilledFrom(profile)
    reset(profile)
  }

  const changed =
    !!profile &&
    (nameInput !== profile.client_name ||
      emailInput !== (profile.email ?? '') ||
      phoneDigits(phoneInput) !== (profile.phone_number ?? '') ||
      addressInput !== (profile.address ?? ''))

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
        address: addressInput.trim() || null,
      })
      .eq('client_id', clientId)
      .select('client_name, email, phone_number, address')
      .single()

    setSaving(false)

    if (updateError || !data) {
      setSaveError(updateError?.message ?? 'Could not save your profile.')
      return
    }

    onSaved(data)
    showToast('Contact details saved.')
  }

  return (
    <section aria-labelledby="pf-c" className="card flex flex-col">
      <h2 id="pf-c" className="border-b border-line px-5 py-4 text-base font-semibold text-ink">
        Contact details
      </h2>
      {loading ? (
        <p className="px-5 py-4 text-ink-muted">Loading your profile...</p>
      ) : error ? (
        <p className="px-5 py-4 text-red-700">{error}</p>
      ) : !profile ? (
        <p className="px-5 py-4 text-ink-muted">No profile information on file yet.</p>
      ) : (
        <>
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSave()
            }}
          >
            {saveError && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}
            <label className="flex flex-col gap-1.5">
              <Label text="Name or company" required />
              <input type="text" value={nameInput} maxLength={150} onChange={(e) => setNameInput(e.target.value)} autoComplete="organization" className={fieldClasses} />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label text="Phone" required />
              <input
                type="tel"
                inputMode="numeric"
                maxLength={13}
                value={phoneInput}
                onChange={(e) => setPhoneInput(formatPhone(e.target.value))}
                placeholder="09XX XXX XXXX"
                autoComplete="tel"
                className={fieldClasses}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label text="Email" />
              <input type="email" value={emailInput} maxLength={150} onChange={(e) => setEmailInput(e.target.value)} autoComplete="email" className={fieldClasses} />
            </label>
            <label className="flex flex-col gap-1.5">
              <Label text="Address" />
              <textarea
                value={addressInput}
                maxLength={250}
                rows={3}
                onChange={(e) => setAddressInput(e.target.value)}
                className={`${fieldClasses} resize-none py-2.5`}
              />
            </label>
          </form>
          <div className="mt-auto flex justify-end gap-3 border-t border-line px-5 py-4">
            <button type="button" onClick={() => reset(profile)} disabled={saving || !changed} className="btn-secondary px-4 text-sm font-medium">
              Discard Changes
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saving || !changed} className="btn-primary px-5 text-sm">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default ClientProfileSection
