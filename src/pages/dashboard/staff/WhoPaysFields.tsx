// WhoPaysFields: the "Who pays" choice for a damage record -- Client /
// Company / Insurance, and for Insurance the policy, how much it covers,
// claim status and reference (was InsuranceClaimModal). Admin only; used by
// the Report Damage form and the selected-damage panel on Damage Charges.
// Only fills in a WhoPaysInput -- decideDamage() in lib/damageCharges.ts
// checks it and builds the columns to save.
import type { WhoPaysInput, ChargeTo } from '../../../lib/damageCharges'
import type { InsuranceCompany } from '../../../lib/insuranceCompanies'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { formatDate, formatMoney } from '../../../lib/format'
import { CLAIM_STATUSES, policyChoice, type ClaimRow, type ClaimStatus } from '../../../lib/insuranceRules'

const field =
  'mt-1.5 block min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm font-medium text-ink-metric focus:border-primary'
const label = 'block text-sm font-semibold text-ink'
const segButton = (on: boolean) =>
  `min-h-11 flex-1 border px-2 text-sm font-semibold disabled:opacity-50 ${
    on ? 'relative border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-50'
  }`

function WhoPaysFields({
  value,
  onChange,
  cost,
  date,
  damageId,
  companies,
  claims,
  insuranceUnavailable,
  disabled,
}: {
  value: WhoPaysInput
  onChange: (next: WhoPaysInput) => void
  cost: number // estimated damage cost (0 while not typed yet)
  date: string // YYYY-MM-DD the damage was reported
  damageId?: number // set when re-deciding an existing record
  companies: InsuranceCompany[]
  claims: ClaimRow[]
  insuranceUnavailable: boolean // insurance companies failed to load
  disabled?: boolean
}) {
  const { offered, policy, left } = policyChoice(companies, claims, value.companyId, date, damageId)
  const covered = parseAmount(value.covered).value
  const companyPays = covered === null ? null : Math.max(0, cost - covered)

  function pick(chargeTo: ChargeTo) {
    // Insurance starts out covering the whole cost.
    const coveredDefault = chargeTo === 'Insurance' && !value.covered && cost > 0 ? String(cost) : value.covered
    onChange({ ...value, chargeTo, covered: coveredDefault })
  }

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className={`${label} pb-1.5`}>Who pays</legend>
      <div role="group" aria-label="Who pays" className="flex">
        {(['Client', 'Company', 'Insurance'] as const).map((choice, i) => (
          <button
            key={choice}
            type="button"
            aria-pressed={value.chargeTo === choice}
            onClick={() => pick(choice)}
            disabled={choice === 'Insurance' && insuranceUnavailable}
            className={`${i > 0 ? '-ml-px ' : ''}${segButton(value.chargeTo === choice)}`}
          >
            {choice}
          </button>
        ))}
      </div>

      {value.chargeTo === 'Insurance' &&
        (offered.length === 0 ? (
          <p className="bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            No insurance policy covers {formatDate(date)}. Add one under Insurance Companies on this page (or fix a
            policy's dates).
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${label} sm:col-span-2`}>
              Insurance company
              <select
                value={policy?.insurance_company_id ?? ''}
                onChange={(e) => onChange({ ...value, companyId: Number(e.target.value) })}
                className={field}
              >
                {offered.map((c) => (
                  <option key={c.insurance_company_id} value={c.insurance_company_id}>
                    {c.company_name} · {c.policy_number}
                  </option>
                ))}
              </select>
              {policy && (
                <span className="mt-1 block text-[13px] font-normal text-ink-muted">
                  {policy.limit_type === 'PerClaim'
                    ? `Covers up to ${formatMoney(left)} per claim.`
                    : `${formatMoney(left)} of ${formatMoney(policy.amount_insured)} left on this policy.`}
                </span>
              )}
            </label>
            <label className={label}>
              Insurance covers (₱)
              <input
                inputMode="decimal"
                value={value.covered}
                onChange={(e) => onChange({ ...value, covered: filterAmountInput(e.target.value) })}
                className={`${field} text-right tabular-nums`}
              />
            </label>
            <div className={label}>
              Company pays
              <p className="mt-1.5 flex min-h-11 items-center text-sm font-normal tabular-nums text-ink-metric">
                {companyPays === null ? '—' : formatMoney(companyPays)}
              </p>
            </div>
            <label className={label}>
              Claim status
              <select
                value={value.claimStatus}
                onChange={(e) => onChange({ ...value, claimStatus: e.target.value as ClaimStatus })}
                className={field}
              >
                {CLAIM_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              Claim reference <span className="text-[13px] font-normal text-ink-muted">optional</span>
              <input
                value={value.reference}
                maxLength={60}
                onChange={(e) => onChange({ ...value, reference: e.target.value })}
                className={field}
              />
            </label>
            <p className="text-[13px] text-ink-muted sm:col-span-2">
              The part the insurance doesn't cover (e.g. the deductible) is a company cost. If the claim is Denied, the
              company pays it all.
            </p>
          </div>
        ))}
    </fieldset>
  )
}

export default WhoPaysFields
