// CompanySettings: the company's details (the one `company_profile` row),
// edited on the Settings page. Name / address / phone / email / TIN are
// printed on Billing and Statements and shown in the public footer; the
// base city + barangay is where every truck leaves from and returns to
// (odometer km on Truck Monitoring).
import { useEffect, useEffectEvent, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import { clearShortCache } from '../../../lib/shortCache'
import { formatPhone, loadCompany, type Company } from '../../../lib/company'
import { emailError, phoneDigits, phoneError, phoneInput } from '../../../lib/quoteRequest'
import { barangaysForCity, citiesFrom, loadLocationReference, type LocationReferenceRow } from '../../../lib/locationReference'

const INPUT =
  'min-w-0 border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'
const LABEL = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function CompanySettings() {
  const [form, setForm] = useState<Company | null>(null)
  const [locations, setLocations] = useState<LocationReferenceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function load() {
    const [companyResult, locationResult] = await Promise.all([loadCompany(), loadLocationReference()])
    setError(companyResult.error ?? locationResult.error)
    // The phone box shows spaces (0966 047 5467); they're removed on save.
    setForm({ ...companyResult.company, phone_number: formatPhone(companyResult.company.phone_number) })
    setLocations(locationResult.rows)
  }

  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    void load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

  function set(field: keyof Company, value: string) {
    setForm((f) => (f ? { ...f, [field]: value } : f))
  }

  async function save() {
    if (!form) return
    const problem =
      (!form.company_name.trim() && 'Enter the company name.') ||
      (!form.address.trim() && 'Enter the address.') ||
      phoneError(form.phone_number) ||
      emailError(form.email ?? '') ||
      ((!form.base_city || !form.base_barangay) && 'Pick the base city and barangay.') ||
      null
    if (problem) {
      setSaveError(problem)
      return
    }
    setSaving(true)
    setSaveError(null)
    const { data, error: updateError } = await supabase
      .from('company_profile')
      .update({
        company_name: form.company_name.trim(),
        address: form.address.trim(),
        phone_number: phoneDigits(form.phone_number),
        email: form.email?.trim() || null,
        tin_number: form.tin_number?.trim() || null,
        base_city: form.base_city,
        base_barangay: form.base_barangay,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)
      .select('id')
      .maybeSingle()
    setSaving(false)
    // No row back = RLS blocked it (or the row is missing) -- don't claim it saved.
    if (updateError || !data) {
      setSaveError(updateError?.message ?? 'Nothing was saved -- only an Admin can change the company details.')
      return
    }
    clearShortCache()
    showToast('Company details saved.')
    void load()
  }

  if (!form) return <p className="mt-6 text-slate-500">Loading company details...</p>

  const cities = citiesFrom(locations)
  const barangays = form.base_city ? barangaysForCity(locations, form.base_city) : []

  return (
    <section aria-labelledby="company-heading" className="mt-6 border-2 border-line-card bg-white p-6">
      <h2 id="company-heading" className="text-base font-semibold text-ink">
        Company details
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Printed on Billing and Statements of Account, and shown in the website footer.
      </p>
      {error && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className={LABEL}>
          Company name
          <input value={form.company_name} onChange={(e) => set('company_name', e.target.value)} className={INPUT} />
        </label>
        <label className={`${LABEL} xl:col-span-2`}>
          Address
          <input value={form.address} onChange={(e) => set('address', e.target.value)} className={INPUT} />
        </label>
        <label className={LABEL}>
          Phone number
          <input
            type="tel"
            inputMode="numeric"
            value={form.phone_number}
            onChange={(e) => set('phone_number', phoneInput(e.target.value))}
            className={INPUT}
          />
        </label>
        <label className={LABEL}>
          Email (optional)
          <input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} className={INPUT} />
        </label>
        <label className={LABEL}>
          TIN (optional)
          <input value={form.tin_number ?? ''} onChange={(e) => set('tin_number', e.target.value)} className={INPUT} />
        </label>
      </div>

      <fieldset className="mt-6">
        <legend className="mb-1 text-sm font-semibold text-ink">Truck base</legend>
        <p className="mb-3 text-sm text-slate-600">
          Where every truck leaves from and returns to -- used for the drive out and drive back on the odometer.
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className={LABEL}>
            City
            <select
              value={form.base_city}
              onChange={(e) => setForm({ ...form, base_city: e.target.value, base_barangay: '' })}
              className={INPUT}
            >
              <option value="">Select a city</option>
              {cities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Barangay
            <select
              value={form.base_barangay}
              onChange={(e) => set('base_barangay', e.target.value)}
              disabled={!form.base_city}
              className={INPUT}
            >
              <option value="">Select a barangay</option>
              {barangays.map((barangay) => (
                <option key={barangay} value={barangay}>{barangay}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      {saveError && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}

      <button onClick={() => void save()} disabled={saving} className="btn-primary mt-6 px-4 py-2 text-sm font-medium">
        {saving ? 'Saving...' : 'Save Company Details'}
      </button>
    </section>
  )
}

export default CompanySettings
