// InsuranceCompanyModal: Admin adds or edits one insurance policy on the
// Damage Charges page -- company, insurance (policy) number, amount insured,
// how the limit works (total for the period or per claim), and the dates it
// covers. Valid until starts at one year after Valid from (editable).
import { useState } from 'react'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { splitManila } from '../../../lib/format'
import { saveInsuranceCompany, type InsuranceCompany } from '../../../lib/insuranceCompanies'
import { LIMIT_TYPE_LABELS, oneYearAfter, type LimitType } from '../../../lib/insuranceRules'

function InsuranceCompanyModal({
  company,
  onClose,
  onSaved,
}: {
  company: InsuranceCompany | null // null = add
  onClose: () => void
  onSaved: () => void
}) {
  const today = splitManila(new Date()).date
  const [name, setName] = useState(company?.company_name ?? '')
  const [policyNumber, setPolicyNumber] = useState(company?.policy_number ?? '')
  const [amount, setAmount] = useState(company ? String(company.amount_insured) : '')
  const [limitType, setLimitType] = useState<LimitType>(company?.limit_type ?? 'Total')
  const [validFrom, setValidFrom] = useState(company?.valid_from ?? today)
  const [validUntil, setValidUntil] = useState(company?.valid_until ?? oneYearAfter(today))
  // While adding, Valid until follows Valid from until the admin edits it.
  const [untilEdited, setUntilEdited] = useState(Boolean(company))
  const [note, setNote] = useState(company?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const parsed = parseAmount(amount)
    const problem = !name.trim()
      ? 'Enter the insurance company name.'
      : !policyNumber.trim()
        ? 'Enter the insurance number.'
        : parsed.error ?? (parsed.value === null ? 'Enter the amount insured.' : null) ??
          (!validFrom || !validUntil ? 'Enter both dates.' : validUntil < validFrom ? 'Valid until must be on or after Valid from.' : null)
    if (problem) return setError(problem)

    setSaving(true)
    setError(null)
    const saveError = await saveInsuranceCompany(
      {
        company_name: name.trim().replace(/\s+/g, ' '),
        policy_number: policyNumber.trim(),
        amount_insured: parsed.value as number,
        limit_type: limitType,
        valid_from: validFrom,
        valid_until: validUntil,
        note: note.trim() || null,
      },
      company?.insurance_company_id,
    )
    setSaving(false)
    if (saveError) return setError(saveError)
    onSaved()
  }

  const field =
    'mt-1.5 block min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 py-2 text-[15px] text-ink-metric placeholder:text-ink-muted focus:border-primary'
  const label = 'block text-sm font-semibold text-ink'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="insurer-form-title" className="card flex w-full max-w-lg flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id="insurer-form-title" className="text-lg font-bold text-ink">
            {company ? `Edit ${company.company_name}` : 'Add Insurance Company'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            ✕
          </button>
        </header>

        <form
          className="grid gap-4 px-6 py-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label className={`${label} sm:col-span-2`}>
            Insurance company
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Insurance number
            <input value={policyNumber} maxLength={60} onChange={(e) => setPolicyNumber(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Amount insured (₱)
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(filterAmountInput(e.target.value))}
              className={`${field} tabular-nums`}
            />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className={label}>How the amount works</legend>
            <div className="mt-1.5 flex flex-col gap-1.5 text-sm text-ink-secondary">
              {(Object.keys(LIMIT_TYPE_LABELS) as LimitType[]).map((type) => (
                <label key={type} className="flex min-h-11 items-center gap-2.5">
                  <input type="radio" name="limit-type" checked={limitType === type} onChange={() => setLimitType(type)} />
                  <span>
                    <strong className="text-ink">{LIMIT_TYPE_LABELS[type]}</strong>
                    {type === 'Total'
                      ? ' -- each claim uses part of it ("aggregate")'
                      : ' -- every claim can use up to the full amount ("any one occurrence")'}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className={label}>
            Valid from
            <input
              type="date"
              value={validFrom}
              onChange={(e) => {
                setValidFrom(e.target.value)
                if (!untilEdited && e.target.value) setValidUntil(oneYearAfter(e.target.value))
              }}
              className={field}
            />
          </label>
          <label className={label}>
            Valid until
            <input
              type="date"
              value={validUntil}
              onChange={(e) => {
                setValidUntil(e.target.value)
                setUntilEdited(true)
              }}
              className={field}
            />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Note <span className="text-[13px] font-normal text-ink-muted">optional</span>
            <textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} className={field} />
          </label>
          {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
          {/* Hidden submit so Enter saves. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary px-6 text-sm">
            {saving ? 'Saving...' : company ? 'Save Changes' : 'Add Company'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default InsuranceCompanyModal
