// GovernmentRatesSettings: the SSS / PhilHealth / Pag-IBIG rates and the BIR
// weekly tax table, edited at the bottom of the Settings page. Rows live in
// `government_rates`, one per date they take effect from (payroll uses the
// latest one on or before each payslip's period end).
//
// Saving with the SAME "Takes effect from" date fixes that rate set (e.g. a
// typo); a NEW date adds a new set, so payslips before it keep the old rates.
import { useEffect, useEffectEvent, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import { clearShortCache } from '../../../lib/shortCache'
import { loadGovernmentRateSets } from '../../../lib/payslip'
import { todayDateString } from '../../../lib/quoteRequest'
import { formatDate } from '../../../lib/format'
import {
  governmentRatesError,
  ratesFor,
  RATE_NUMBER_KEYS,
  type GovernmentRates,
  type RateNumberKey,
} from '../../../lib/governmentContributions'

type FieldRow = [key: RateNumberKey, label: string, unit: '₱' | '%']

const SECTIONS: { title: string; fields: FieldRow[] }[] = [
  {
    title: 'SSS',
    fields: [
      ['sss_msc_min', 'Lowest salary credit', '₱'],
      ['sss_msc_max', 'Highest salary credit', '₱'],
      ['sss_msc_step', 'Salary credit step', '₱'],
      ['sss_ee_rate', 'Employee share', '%'],
      ['sss_er_rate', 'Employer share', '%'],
      ['sss_ec_threshold', 'EC: higher amount from this salary credit', '₱'],
      ['sss_ec_low', 'EC below that', '₱'],
      ['sss_ec_high', 'EC from that', '₱'],
    ],
  },
  {
    title: 'PhilHealth',
    fields: [
      ['philhealth_floor', 'Salary floor', '₱'],
      ['philhealth_ceiling', 'Salary ceiling', '₱'],
      ['philhealth_ee_rate', 'Employee share', '%'],
      ['philhealth_er_rate', 'Employer share', '%'],
    ],
  },
  {
    title: 'Pag-IBIG',
    fields: [
      ['pagibig_salary_cap', 'Salary cap', '₱'],
      ['pagibig_low_salary', 'Low-salary line', '₱'],
      ['pagibig_ee_rate_low', 'Employee share at or below the line', '%'],
      ['pagibig_ee_rate', 'Employee share above the line', '%'],
      ['pagibig_er_rate', 'Employer share', '%'],
    ],
  },
]

type BracketInput = { over: string; fixed: string; rate: string }
type Form = { effectiveFrom: string; values: Record<RateNumberKey, string>; brackets: BracketInput[] }

const UNIT = 'w-8 shrink-0 text-sm text-slate-400'
const INPUT =
  'min-w-0 flex-1 border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'

function toForm(set: GovernmentRates): Form {
  return {
    effectiveFrom: set.effective_from,
    values: Object.fromEntries(RATE_NUMBER_KEYS.map((key) => [key, String(set[key])])) as Record<RateNumberKey, string>,
    brackets: [...set.weekly_tax_brackets]
      .sort((a, b) => a.over - b.over)
      .map((b) => ({ over: String(b.over), fixed: String(b.fixed), rate: String(b.rate) })),
  }
}

// Blank box = NaN, so governmentRatesError catches it.
const num = (text: string) => (text.trim() === '' ? NaN : Number(text))

function fromForm(form: Form): GovernmentRates {
  return {
    effective_from: form.effectiveFrom,
    ...(Object.fromEntries(RATE_NUMBER_KEYS.map((key) => [key, num(form.values[key])])) as Record<RateNumberKey, number>),
    weekly_tax_brackets: form.brackets.map((b) => ({ over: num(b.over), fixed: num(b.fixed), rate: num(b.rate) })),
  }
}

function GovernmentRatesSettings() {
  const [sets, setSets] = useState<GovernmentRates[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function load() {
    const result = await loadGovernmentRateSets()
    setSets(result.sets)
    setError(result.error)
    // Start on the rates in force today (else the newest set).
    const current = ratesFor(result.sets, todayDateString()) ?? result.sets[0]
    setForm(current ? toForm(current) : null)
    setLoading(false)
  }

  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    void load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

  const existing = form ? sets.find((s) => s.effective_from === form.effectiveFrom) : undefined

  function setValue(key: RateNumberKey, text: string) {
    setForm((f) => (f ? { ...f, values: { ...f.values, [key]: text } } : f))
  }
  function setBracket(index: number, field: keyof BracketInput, text: string) {
    setForm((f) =>
      f ? { ...f, brackets: f.brackets.map((b, i) => (i === index ? { ...b, [field]: text } : b)) } : f,
    )
  }

  async function save() {
    if (!form) return
    const rates = fromForm(form)
    const problem = governmentRatesError(rates)
    if (problem) {
      setSaveError(problem)
      return
    }
    setSaving(true)
    setSaveError(null)
    const { effective_from, ...columns } = rates
    // Same date as a saved set = fix that set; otherwise a new set from that date.
    const { data, error: writeError } = existing?.rate_set_id
      ? await supabase
          .from('government_rates')
          .update(columns)
          .eq('rate_set_id', existing.rate_set_id)
          .select('rate_set_id')
          .maybeSingle()
      : await supabase
          .from('government_rates')
          .insert({ effective_from, ...columns })
          .select('rate_set_id')
          .maybeSingle()
    setSaving(false)
    if (writeError || !data) {
      setSaveError(writeError?.message ?? 'Nothing was saved -- only an Admin can change government rates.')
      return
    }
    clearShortCache() // Payroll keeps rates for a few seconds -- read fresh ones next time.
    showToast(existing ? 'Government rates updated.' : `New government rates saved, from ${formatDate(effective_from)}.`)
    void load()
  }

  if (loading) return <p className="mt-6 text-slate-500">Loading government rates...</p>

  return (
    <section aria-labelledby="government-rates-heading" className="mt-6 border-2 border-line-card bg-white p-6">
      <h2 id="government-rates-heading" className="text-base font-semibold text-ink">
        Government contributions &amp; tax
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Used for every payslip&apos;s SSS, PhilHealth, Pag-IBIG and withholding tax. When a rate changes by law,
        enter the new numbers with the date they start -- payslips before that date keep the old rates.
      </p>

      {error && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!error && !form && (
        <p className="mt-4 text-sm text-slate-600">No government rates yet -- run the government_rates SQL first.</p>
      )}

      {form && (
        <>
          <div className="mt-4 grid grid-cols-1 items-end gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Takes effect from
              <input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                className={INPUT}
              />
            </label>
            <p className="text-sm text-slate-600 xl:col-span-2">
              {existing
                ? `Saving changes the rates used from ${formatDate(form.effectiveFrom)}. To keep older payslips as they were, pick the date the new rates start.`
                : `Saving adds new rates from ${form.effectiveFrom ? formatDate(form.effectiveFrom) : 'that date'}; earlier payslips keep the old ones.`}
              {sets.length > 1 && ` Saved rate sets start: ${sets.map((s) => formatDate(s.effective_from)).join(', ')}.`}
            </p>
          </div>

          {SECTIONS.map((section) => (
            <fieldset key={section.title} className="mt-6">
              <legend className="mb-3 text-sm font-semibold text-ink">{section.title}</legend>
              <div className="grid grid-cols-1 items-end gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                {section.fields.map(([key, label, unit]) => (
                  <label key={key} className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                    {label}
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.values[key]}
                        onChange={(e) => setValue(key, e.target.value)}
                        className={INPUT}
                      />
                      <span className={UNIT}>{unit}</span>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset className="mt-6">
            <legend className="mb-1 text-sm font-semibold text-ink">BIR weekly withholding tax</legend>
            <p className="mb-3 text-sm text-slate-600">
              Tax = fixed amount + rate × the part of weekly taxable pay above &quot;Over&quot;. Pay at or below the lowest
              &quot;Over&quot; has no tax.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-2 text-left">Over (₱)</th>
                    <th className="px-2 py-2 text-left">Fixed tax (₱)</th>
                    <th className="px-2 py-2 text-left">Rate on the excess (%)</th>
                    <th className="px-2 py-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {form.brackets.map((bracket, index) => (
                    <tr key={index} className="border-b border-line">
                      {(['over', 'fixed', 'rate'] as const).map((field) => (
                        <td key={field} className="px-2 py-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            aria-label={`Bracket ${index + 1} ${field}`}
                            value={bracket[field]}
                            onChange={(e) => setBracket(index, field, e.target.value)}
                            className={`${INPUT} w-full`}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, brackets: form.brackets.filter((_, i) => i !== index) })}
                          className="btn-danger px-3 py-2 text-sm"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={() => setForm({ ...form, brackets: [...form.brackets, { over: '', fixed: '', rate: '' }] })}
              className="btn-secondary mt-3 px-4 py-2 text-sm font-medium"
            >
              + Add Bracket
            </button>
          </fieldset>

          {saveError && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</p>}

          <button onClick={() => void save()} disabled={saving} className="btn-primary mt-6 px-4 py-2 text-sm font-medium">
            {saving ? 'Saving...' : existing ? 'Save Government Rates' : 'Save New Government Rates'}
          </button>
        </>
      )}
    </section>
  )
}

export default GovernmentRatesSettings
