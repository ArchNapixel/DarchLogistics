// InsuranceClaimModal: "Insurance" on a Damage Charges row. Staff pick the
// policy that covers the damage, how much of it the insurer pays (the rest
// stays a company cost -- e.g. the deductible), and the claim's reference /
// status. Only policies that aren't archived and whose dates include the
// day the damage was reported are offered. Saving approves the record.
// ponytail: the "cover left" check runs in the browser -- two people
// approving claims on one policy in the same second could go past its
// total. Move it into a database function if that ever matters.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { formatDate, formatMoney, splitManila } from '../../../lib/format'
import type { InsuranceCompany } from '../../../lib/insuranceCompanies'
import {
  CLAIM_STATUSES,
  coverageLeft,
  coveredAmountError,
  policyCovers,
  type ClaimRow,
  type ClaimStatus,
} from '../../../lib/insuranceRules'

export type ClaimTarget = {
  damage_id: number
  booking_id: number
  itinerary_id: number
  estimated_damage_cost: number | null
  created_at: string | null
  insurance_company_id: number | null
  insurance_covered_amount: number | null
  claim_status: string | null
  claim_reference: string | null
}

function InsuranceClaimModal({
  damage,
  companies,
  claims,
  onClose,
  onSaved,
}: {
  damage: ClaimTarget
  companies: InsuranceCompany[]
  claims: ClaimRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const { employeeId } = useAuth()
  const cost = Number(damage.estimated_damage_cost ?? 0)
  const damageDate = splitManila(damage.created_at ?? new Date()).date
  const offered = companies.filter((c) => !c.archived_at && policyCovers(c, damageDate))

  const [companyId, setCompanyId] = useState<number | null>(
    offered.some((c) => c.insurance_company_id === damage.insurance_company_id)
      ? damage.insurance_company_id
      : (offered[0]?.insurance_company_id ?? null),
  )
  const [covered, setCovered] = useState(String(damage.insurance_covered_amount ?? cost))
  const [claimStatus, setClaimStatus] = useState<ClaimStatus>(
    (CLAIM_STATUSES as string[]).includes(damage.claim_status ?? '') ? (damage.claim_status as ClaimStatus) : 'Filed',
  )
  const [reference, setReference] = useState(damage.claim_reference ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const policy = offered.find((c) => c.insurance_company_id === companyId) ?? null
  const left = policy ? coverageLeft(policy, claims, damage.damage_id) : 0
  const parsed = parseAmount(covered)
  const companyPays = parsed.value === null ? null : Math.max(0, cost - parsed.value)

  async function save() {
    if (!employeeId) return setError('Your account is not linked to an employee record.')
    if (!policy) return setError('Pick the insurance company.')
    if (parsed.error || parsed.value === null) return setError(parsed.error ?? 'Enter how much the insurance covers.')
    const amountProblem = coveredAmountError(parsed.value, cost, left)
    if (amountProblem) return setError(amountProblem)

    setSaving(true)
    setError(null)
    const { data, error: updateError } = await supabase
      .from('delivery_damage_records')
      .update({
        charge_to: 'Insurance',
        damage_status: 'Approved',
        approved_by: employeeId,
        approved_at: new Date().toISOString(),
        insurance_company_id: policy.insurance_company_id,
        insurance_covered_amount: parsed.value,
        claim_status: claimStatus,
        claim_reference: reference.trim() || null,
      })
      .eq('damage_id', damage.damage_id)
      .select('damage_id')
      .maybeSingle()
    setSaving(false)
    if (updateError) return setError(updateError.message)
    // .select() so a silent RLS no-op shows as an error, not fake success.
    if (!data) return setError('The decision was not saved -- you may not have permission, or the record was removed. Reload the page.')
    onSaved()
  }

  const field =
    'mt-1.5 block min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 py-2 text-[15px] text-ink-metric placeholder:text-ink-muted focus:border-primary'
  const label = 'block text-sm font-semibold text-ink'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="claim-title" className="card flex w-full max-w-lg flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id="claim-title" className="text-lg font-bold text-ink">
              Charge to insurance
            </h2>
            <p className="text-[13px] text-ink-muted">
              Booking #{damage.booking_id} · Trip #{damage.itinerary_id} · reported {formatDate(damageDate)} · damage{' '}
              {formatMoney(cost)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            ✕
          </button>
        </header>

        {offered.length === 0 ? (
          <p className="px-6 py-5 text-sm text-ink-secondary">
            No insurance policy covers {formatDate(damageDate)}. An Admin can add one under Insurance Companies on this
            page (or fix a policy's dates).
          </p>
        ) : (
          <form
            className="grid gap-4 px-6 py-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <label className={`${label} sm:col-span-2`}>
              Insurance company
              <select
                value={companyId ?? ''}
                onChange={(e) => setCompanyId(Number(e.target.value))}
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
                value={covered}
                onChange={(e) => setCovered(filterAmountInput(e.target.value))}
                className={`${field} tabular-nums`}
              />
            </label>
            <div className={label}>
              Company pays
              <p className="mt-1.5 flex min-h-11 items-center text-[15px] font-normal tabular-nums text-ink-metric">
                {companyPays === null ? '—' : formatMoney(companyPays)}
              </p>
            </div>
            <label className={label}>
              Claim status
              <select value={claimStatus} onChange={(e) => setClaimStatus(e.target.value as ClaimStatus)} className={field}>
                {CLAIM_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className={label}>
              Claim reference <span className="text-[13px] font-normal text-ink-muted">optional</span>
              <input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className={field} />
            </label>
            <p className="text-[13px] text-ink-muted sm:col-span-2">
              The part the insurance doesn't cover (e.g. the deductible) is a company cost. If the claim is Denied, the
              company pays it all.
            </p>
            {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        )}

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          {offered.length > 0 && (
            <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary px-6 text-sm">
              {saving ? 'Saving...' : 'Charge to Insurance'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}

export default InsuranceClaimModal
