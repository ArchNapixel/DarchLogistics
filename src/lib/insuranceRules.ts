// insuranceRules: who carries the cost of a damage record, and how much
// cover an insurance policy has left. Pure functions (self-check:
// node scripts/check-insurance-rules.ts).
//
// A damage record (delivery_damage_records) is decided on Damage Charges:
//   Client    -> billed to the client (lib/damageCharges.ts), company pays 0
//   Company   -> the company pays the whole estimated cost
//   Insurance -> the insurer pays insurance_covered_amount, the company pays
//                the rest (deductible / anything not covered); a Denied
//                claim falls back to the company in full.
import { cents } from './amountInput.ts'

export type ClaimStatus = 'Filed' | 'Paid' | 'Denied'
export const CLAIM_STATUSES: ClaimStatus[] = ['Filed', 'Paid', 'Denied']

// 'Total' = the amount insured is for the whole policy period, each claim
// uses part of it (aggregate). 'PerClaim' = every claim can use up to the
// full amount (limit per occurrence / conveyance).
export type LimitType = 'Total' | 'PerClaim'
export const LIMIT_TYPE_LABELS: Record<LimitType, string> = {
  Total: 'Total for the policy period',
  PerClaim: 'Per claim',
}

export type DamageCostRow = {
  charge_to: string | null
  estimated_damage_cost: number | string | null
  insurance_covered_amount?: number | string | null
  claim_status?: string | null
}

// What the COMPANY pays for one approved damage record.
export function companyDamageShare(row: DamageCostRow): number {
  const cost = Number(row.estimated_damage_cost ?? 0)
  if (row.charge_to === 'Company') return cents(cost)
  if (row.charge_to !== 'Insurance') return 0
  if (row.claim_status === 'Denied') return cents(cost)
  return cents(Math.max(0, cost - Number(row.insurance_covered_amount ?? 0)))
}

// Insurance claims already counted against one policy: approved,
// charged to it, not Denied. (A policy is only offered for damage inside
// its valid dates, so every claim on it is inside the period.)
export type ClaimRow = DamageCostRow & {
  damage_id: number
  damage_status: string | null
  insurance_company_id: number | null
}

export function coverageUsed(companyId: number, claims: ClaimRow[], exceptDamageId?: number): number {
  return cents(
    claims
      .filter(
        (c) =>
          c.insurance_company_id === companyId &&
          c.charge_to === 'Insurance' &&
          c.damage_status === 'Approved' &&
          c.claim_status !== 'Denied' &&
          c.damage_id !== exceptDamageId,
      )
      .reduce((sum, c) => sum + Number(c.insurance_covered_amount ?? 0), 0),
  )
}

// Most a new claim on this policy may cover. exceptDamageId: the record
// being re-decided, so its own old claim doesn't count against it.
export function coverageLeft(
  policy: { insurance_company_id: number; amount_insured: number; limit_type: LimitType },
  claims: ClaimRow[],
  exceptDamageId?: number,
): number {
  if (policy.limit_type === 'PerClaim') return cents(policy.amount_insured)
  return cents(Math.max(0, policy.amount_insured - coverageUsed(policy.insurance_company_id, claims, exceptDamageId)))
}

// The policy covers damage reported on this date (YYYY-MM-DD).
export const policyCovers = (policy: { valid_from: string; valid_until: string }, date: string) =>
  policy.valid_from <= date && date <= policy.valid_until

// Covered-amount check -- null when OK.
export function coveredAmountError(covered: number, damageCost: number, left: number): string | null {
  if (covered > cents(damageCost)) return "The insurance can't cover more than the damage cost."
  if (covered > left) return `Only ₱${left.toLocaleString('en-PH', { minimumFractionDigits: 2 })} of cover is left on this policy.`
  return null
}

// "2026-11-12" -> "2027-11-12" (Feb 29 -> Mar 1). Default valid-until.
export function oneYearAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}
