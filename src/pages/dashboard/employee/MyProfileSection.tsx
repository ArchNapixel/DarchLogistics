// MyProfileSection ("My Profile" page, /dashboard/profile): the logged-in
// employee (Driver, Mechanic, Helper, Dispatcher) views and edits their own
// phone, contact, emergency contact and government IDs. Name, position and
// hire date are shown read-only -- Admin changes those on the Employees page
// because they feed payroll and the dispatch lists.
//
// Saving sends only the fields that changed (so it can't overwrite something
// Admin edited meanwhile in a field this employee didn't touch), through the
// update_my_profile() database function (see lib/myProfile.ts, which also
// holds the length/format rules).
import { useEffect, useState, type FormEvent } from 'react'
import {
  EDITABLE_KEYS,
  MIN_BIRTH_DATE,
  PROFILE_MAX_LENGTH,
  cleanProfileForm,
  filterInput,
  loadMyProfile,
  profileToForm,
  saveMyProfile,
  validateProfileForm,
  type EditableKey,
  type MyProfile,
  type ProfileForm,
} from '../../../lib/myProfile'
import { toManilaDate } from '../../../lib/payslip'
import PageHeader from '../../../components/PageHeader'
import { showToast } from '../../../components/Toast'
import { formatDate } from '../../../lib/format'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'
const CARD_TITLE = 'mb-3 border-b border-line pb-2 text-base font-semibold text-ink'

function MyProfileSection() {
  const [profile, setProfile] = useState<MyProfile | null>(null)
  // What's in the boxes, and what's saved (cleaned) -- the difference is
  // what gets sent on Save.
  const [form, setForm] = useState<ProfileForm | null>(null)
  const [baseline, setBaseline] = useState<ProfileForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = toManilaDate(new Date())

  useEffect(() => {
    void loadMyProfile().then(({ profile: loaded, error: loadError }) => {
      setProfile(loaded)
      if (loaded) {
        const initial = profileToForm(loaded)
        setForm(initial)
        setBaseline(initial)
      }
      setError(loadError)
      setLoading(false)
    })
  }, [])

  // Which fields differ from what's saved (compared after cleaning).
  const changedKeys =
    form && baseline ? EDITABLE_KEYS.filter((key) => cleanProfileForm(form)[key] !== cleanProfileForm(baseline)[key]) : []
  const dirty = changedKeys.length > 0

  // Browser warning if they close/reload the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (loading) return <p className="text-ink-muted">Loading your profile...</p>
  if (!profile || !form || !baseline) {
    return (
      <p className={error ? 'text-red-700' : 'text-slate-500'}>
        {error ?? 'Your account has no linked employee record, so there is no profile to show.'}
      </p>
    )
  }

  // One text input bound to a form field.
  function field(key: EditableKey, label: string, type = 'text', placeholder?: string) {
    return (
      <label className={labelClasses}>
        {label}
        <input
          type={type}
          value={form![key]}
          maxLength={PROFILE_MAX_LENGTH[key]}
          // Date picker limits; the rest are checked in validateProfileForm.
          min={key === 'date_of_birth' ? MIN_BIRTH_DATE : undefined}
          max={key === 'date_of_birth' ? today : undefined}
          inputMode={type === 'tel' ? 'tel' : undefined}
          placeholder={placeholder}
          onChange={(e) => {
            // Typed or pasted characters the field can't hold are dropped here.
            setForm({ ...form!, [key]: filterInput(key, e.target.value) })
            setError(null)
          }}
          className={fieldClasses}
        />
      </label>
    )
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    const cleaned = cleanProfileForm(form!)
    const problem = validateProfileForm(cleaned, today)
    if (problem) {
      setError(problem)
      return
    }
    if (!dirty) {
      setError('Nothing to save -- you haven\'t changed anything.')
      return
    }

    setSaving(true)
    setError(null)
    const changes = Object.fromEntries(changedKeys.map((key) => [key, cleaned[key]]))
    const { error: saveError } = await saveMyProfile(changes)
    setSaving(false)
    if (saveError) {
      setError(saveError)
      return
    }
    // Show exactly what was stored (trimmed), and treat it as the new saved state.
    setForm(cleaned)
    setBaseline(cleaned)
    showToast('Your profile was saved.')
  }

  return (
    <form onSubmit={handleSave}>
      <PageHeader title="My Profile" subtitle="Keep your contact and government ID details up to date." />

      <section aria-labelledby="employment-h" className="card mb-4 px-5 py-4">
        <h2 id="employment-h" className="mb-3 text-base font-semibold text-ink">
          Employment <span className="font-medium text-ink-muted">· set by Admin</span>
        </h2>
        <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[13px] font-medium text-ink-muted">Name</dt>
            <dd className="m-0 text-[15px] font-semibold text-ink">{profile.full_name}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-medium text-ink-muted">Position</dt>
            <dd className="m-0 text-[15px] font-semibold text-ink">{profile.position}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-medium text-ink-muted">Hire date</dt>
            <dd className="m-0 text-[15px] font-semibold text-ink">{formatDate(profile.hire_date)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[13px] text-ink-muted">To change your name or position, ask an admin. Only your phone is required below.</p>
      </section>

      {error && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
        <section aria-labelledby="contact-h" className="card flex flex-col gap-3.5 px-5 py-4">
          <h2 id="contact-h" className={CARD_TITLE}>
            Contact
          </h2>
          {field('phone_number', 'Phone', 'tel', '09XX XXX XXXX')}
          {field('email', 'Personal email', 'email', 'name@example.com')}
          {field('date_of_birth', 'Birthday', 'date')}
          {field('address', 'Address')}
          <div className="grid grid-cols-2 gap-3">
            {field('city', 'City')}
            {field('province', 'Province')}
          </div>
          {field('zip_code', 'Zip code')}
        </section>

        <section aria-labelledby="emergency-h" className="card flex flex-col gap-3.5 px-5 py-4">
          <h2 id="emergency-h" className={CARD_TITLE}>
            Emergency contact
          </h2>
          {field('emergency_contact_name', 'Name')}
          {field('emergency_contact_number', 'Phone', 'tel', '09XX XXX XXXX')}
          <p className="text-[13px] text-ink-muted">Optional. Who we call if something happens on the job.</p>
        </section>

        <section aria-labelledby="ids-h" className="card flex flex-col gap-3.5 px-5 py-4">
          <h2 id="ids-h" className={CARD_TITLE}>
            Government IDs
          </h2>
          {field('sss_number', 'SSS no.')}
          {field('philhealth_number', 'PhilHealth no.')}
          {field('pagibig_number', 'Pag-IBIG no.')}
          {field('tin_number', 'TIN')}
        </section>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {dirty && <span className="mr-auto text-sm text-ink-muted">You have unsaved changes.</span>}
        <button
          type="button"
          onClick={() => {
            setForm(baseline)
            setError(null)
          }}
          disabled={saving || !dirty}
          className="btn-secondary px-5 text-sm font-medium"
        >
          Discard Changes
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 px-6 text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5 9-10" />
          </svg>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

export default MyProfileSection
