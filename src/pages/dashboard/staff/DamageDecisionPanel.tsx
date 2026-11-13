// DamageDecisionPanel: right-hand panel on Damage Charges when a row in the
// table is clicked. Shows the damage, and lets an Admin decide or change
// who pays (WhoPaysFields -- also where a claim's status is moved Filed ->
// Paid / Denied). Dispatchers see it read-only: only an Admin decides
// (the DB's UPDATE policy on delivery_damage_records is is_admin()).
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { decideDamage, UNDECIDED, type ChargeTo, type WhoPaysInput } from '../../../lib/damageCharges'
import type { InsuranceCompany } from '../../../lib/insuranceCompanies'
import { CLAIM_STATUSES, companyDamageShare, type ClaimRow, type ClaimStatus } from '../../../lib/insuranceRules'
import { formatDate, formatMoney, splitManila } from '../../../lib/format'
import { showToast } from '../../../components/Toast'
import WhoPaysFields from './WhoPaysFields'

export type DamageCharge = {
  damage_id: number
  itinerary_id: number
  booking_id: number
  client_name: string
  route: string
  damage_description: string
  estimated_damage_cost: number | null
  charge_to: ChargeTo
  damage_status: string
  created_at: string | null
  insurance_company_id: number | null
  insurance_covered_amount: number | null
  claim_status: string | null
  claim_reference: string | null
}

// The record's current decision as form values (nothing picked if undecided).
function currentChoice(damage: DamageCharge): WhoPaysInput {
  if (damage.damage_status !== 'Approved') return UNDECIDED
  return {
    chargeTo: damage.charge_to,
    companyId: damage.insurance_company_id,
    covered: damage.insurance_covered_amount === null ? '' : String(damage.insurance_covered_amount),
    claimStatus: (CLAIM_STATUSES as string[]).includes(damage.claim_status ?? '') ? (damage.claim_status as ClaimStatus) : 'Filed',
    reference: damage.claim_reference ?? '',
  }
}

function DamageDecisionPanel({
  damage,
  companies,
  claims,
  insuranceUnavailable,
  onBack,
  onSaved,
}: {
  damage: DamageCharge
  companies: InsuranceCompany[]
  claims: ClaimRow[]
  insuranceUnavailable: boolean
  onBack: () => void
  onSaved: () => void
}) {
  const { role, employeeId } = useAuth()
  const isAdmin = role === 'Admin'
  const [whoPays, setWhoPays] = useState<WhoPaysInput>(() => currentChoice(damage))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cost = Number(damage.estimated_damage_cost ?? 0)
  const date = splitManila(damage.created_at ?? new Date()).date
  const decided = damage.damage_status === 'Approved'
  const companyName = companies.find((c) => c.insurance_company_id === damage.insurance_company_id)?.company_name

  async function save() {
    const decision = decideDamage(whoPays, { cost, date, damageId: damage.damage_id, companies, claims, employeeId })
    if ('error' in decision) return setError(decision.error)

    setSaving(true)
    setError(null)
    // .select() so a silent RLS no-op shows as an error, not fake success.
    const { data: updated, error: updateError } = await supabase
      .from('delivery_damage_records')
      .update(decision.columns)
      .eq('damage_id', damage.damage_id)
      .select('damage_id')
      .maybeSingle()
    setSaving(false)

    if (updateError) return setError(updateError.message)
    if (!updated) return setError('The decision was not saved -- only an Admin can decide, or the record was removed. Reload the page.')
    showToast(`Booking #${damage.booking_id}: charged to ${decision.columns.charge_to}.`)
    onSaved()
  }

  const row = 'flex justify-between gap-4 border-b border-slate-200 py-2 text-sm'

  return (
    <section aria-labelledby="dd-h" className="card flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id="dd-h" className="text-lg leading-[26px] font-bold text-ink">
            Damage on Booking #{damage.booking_id}
          </h2>
          <p className="text-[13px] text-ink-muted">
            Trip #{damage.itinerary_id}
            {damage.created_at ? ` · reported ${formatDate(damage.created_at)}` : ''}
          </p>
        </div>
        <button type="button" onClick={onBack} className="btn-secondary shrink-0 px-3 text-sm font-medium">
          Report new damage
        </button>
      </div>

      <div className="flex flex-col gap-4 px-5 py-4">
        <dl>
          <div className={row}>
            <dt className="text-ink-muted">Client</dt>
            <dd className="text-right font-medium text-ink-metric">{damage.client_name}</dd>
          </div>
          <div className={row}>
            <dt className="text-ink-muted">Route</dt>
            <dd className="text-right text-ink-metric">{damage.route}</dd>
          </div>
          <div className={row}>
            <dt className="text-ink-muted">Damage</dt>
            <dd className="text-right text-ink-metric">{damage.damage_description}</dd>
          </div>
          <div className={row}>
            <dt className="text-ink-muted">Est. cost</dt>
            <dd className="text-right font-semibold tabular-nums text-ink-metric">{formatMoney(cost)}</dd>
          </div>
          <div className={`${row} border-b-0`}>
            <dt className="text-ink-muted">Who pays now</dt>
            <dd className="text-right font-medium text-ink-metric">
              {!decided ? (
                <span className="text-amber-800">Not decided yet</span>
              ) : damage.charge_to === 'Insurance' ? (
                <>
                  {companyName ?? 'Insurance'} {formatMoney(damage.insurance_covered_amount)} ({damage.claim_status ?? 'Filed'})
                  <span className="block text-[13px] font-normal text-ink-muted">
                    Company pays {formatMoney(companyDamageShare(damage))}
                  </span>
                </>
              ) : (
                damage.charge_to
              )}
            </dd>
          </div>
        </dl>

        {isAdmin ? (
          <>
            {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <WhoPaysFields
              value={whoPays}
              onChange={setWhoPays}
              cost={cost}
              date={date}
              damageId={damage.damage_id}
              companies={companies}
              claims={claims}
              insuranceUnavailable={insuranceUnavailable}
              disabled={saving}
            />
          </>
        ) : (
          <p className="bg-slate-50 px-4 py-3 text-sm text-ink-secondary">Only an Admin decides who pays for damage.</p>
        )}
      </div>

      {isAdmin && (
        <div className="flex justify-end gap-3 border-t border-line px-5 py-4">
          <button type="button" onClick={() => void save()} disabled={saving || !whoPays.chargeTo} className="btn-primary px-5 text-sm">
            {saving ? 'Saving...' : decided ? 'Save Changes' : 'Save Decision'}
          </button>
        </div>
      )}
    </section>
  )
}

export default DamageDecisionPanel
