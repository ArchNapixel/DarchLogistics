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
  'border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

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

  if (loading) return <p className="text-slate-500">Loading your profile...</p>
  if (!profile || !form || !baseline) {
    return (
      <p className={error ? 'text-red-700' : 'text-slate-500'}>
        {error ?? 'Your account has no linked employee record, so there is no profile to show.'}
      </p>
    )
  }

  // One text input bound to a form field.
  function field(key: EditableKey, label: string, type = 'text', wide = false) {
    return (
      <label className={`${labelClasses} ${wide ? 'sm:col-span-2' : ''}`}>
        {label}
        <input
          type={type}
          value={form![key]}
          maxLength={PROFILE_MAX_LENGTH[key]}
          // Date picker limits; the rest are checked in validateProfileForm.
          min={key === 'date_of_birth' ? MIN_BIRTH_DATE : undefined}
          max={key === 'date_of_birth' ? today : undefined}
          inputMode={type === 'tel' ? 'tel' : undefined}
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
    <form onSubmit={handleSave} className="max-w-2xl">
      <PageHeader title="My Profile" subtitle="Keep your contact details and government IDs up to date." />

      <div className="grid gap-3 border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Name</p>
          <p className="text-slate-900">{profile.full_name}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Position</p>
          <p className="text-slate-900">{profile.position}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Hire date</p>
          <p className="text-slate-900">{formatDate(profile.hire_date)}</p>
        </div>
        <p className="text-xs text-slate-500 sm:col-span-3">
          To change your name or position, ask an admin.
        </p>
      </div>

      {error && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <h3 className="mt-6 text-sm font-semibold text-slate-700">Contact</h3>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        {field('phone_number', 'Phone number', 'tel')}
        {field('email', 'Personal email (optional)', 'email')}
        {field('date_of_birth', 'Date of birth (optional)', 'date')}
        <span className="hidden sm:block" />
        {field('address', 'Address (optional)', 'text', true)}
        {field('city', 'City (optional)')}
        {field('province', 'Province (optional)')}
        {field('zip_code', 'Zip code (optional)')}
      </div>

      <h3 className="mt-6 text-sm font-semibold text-slate-700">Emergency contact</h3>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        {field('emergency_contact_name', 'Name (optional)')}
        {field('emergency_contact_number', 'Phone number (optional)', 'tel')}
      </div>

      <h3 className="mt-6 text-sm font-semibold text-slate-700">Government IDs</h3>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        {field('tin_number', 'TIN (optional)')}
        {field('sss_number', 'SSS number (optional)')}
        {field('philhealth_number', 'PhilHealth number (optional)')}
        {field('pagibig_number', 'Pag-IBIG number (optional)')}
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="btn-primary px-4 py-2 text-sm font-medium"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </form>
  )
}

export default MyProfileSection
