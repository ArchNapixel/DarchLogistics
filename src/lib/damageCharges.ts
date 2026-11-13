// damageCharges: damage recorded on delivered trips (delivery_damage_records)
// -- reporting it, and an Admin deciding who pays (Client / Company /
// Insurance) on the Damage Charges page. Approved Client damage is billed on
// top of the booking's delivery amount via loadExtraChargesByBooking()
// (lib/bookingCharges.ts); Company / Insurance damage is a company cost
// (companyDamageShare in insuranceRules.ts), counted in the month it was
// decided (approved_at).
import { supabase } from './supabaseClient'
import { parseAmount } from './amountInput'
import type { InsuranceCompany } from './insuranceCompanies'
import { coveredAmountError, policyChoice, type ClaimRow, type ClaimStatus } from './insuranceRules'

// ---- Reporting damage (the Report Damage form on the Damage Charges page;
// Mark Delivered no longer asks, since 2026-11-13) ----

export type DamageCondition = 'Damaged' | 'Partial' | 'Missing'

export type DamageInput = {
  condition: DamageCondition
  description: string
  cost: string // form value; converted on save
}

// Form check -- null when OK.
export function damageInputError(input: DamageInput): string | null {
  if (!input.description.trim() || !input.cost) {
    return 'Describe the problem and enter an estimated cost.'
  }
  // Number('.') is NaN -- the typing filter allows a lone dot.
  const cost = Number(input.cost)
  if (!Number.isFinite(cost)) return 'Enter a valid estimated cost.'
  if (cost < 0) return "Estimated cost can't be negative."
  return null
}

// Saves one delivery_damage_records row. Without `decision` it stays
// 'Reported' (Not decided yet); an Admin can pass decideDamage()'s columns
// to save it already decided. Returns an error message or null.
export async function insertDamageRecord(itineraryId: number, input: DamageInput, decision?: DecisionColumns) {
  const { error } = await supabase.from('delivery_damage_records').insert({
    itinerary_id: itineraryId,
    damage_description: `${input.condition}: ${input.description.trim()}`,
    estimated_damage_cost: Number(input.cost),
    ...decision,
  })
  return error?.message ?? null
}

// ---- Who pays (Admin only -- the DB's UPDATE policy is is_admin()) ----

export type ChargeTo = 'Client' | 'Company' | 'Insurance'

export type WhoPaysInput = {
  chargeTo: ChargeTo | null // null = not decided yet
  companyId: number | null // insurance policy; null = the first one offered
  covered: string // amount the insurance covers, form value
  claimStatus: ClaimStatus
  reference: string
}

export const UNDECIDED: WhoPaysInput = { chargeTo: null, companyId: null, covered: '', claimStatus: 'Filed', reference: '' }

export type DecisionColumns = {
  charge_to: ChargeTo
  damage_status: 'Approved'
  approved_by: number
  approved_at: string
  insurance_company_id: number | null
  insurance_covered_amount: number | null
  claim_status: ClaimStatus | null
  claim_reference: string | null
}

// The columns that record a who-pays decision, or why it can't be saved.
// Client / Company clear any insurance claim the record had.
export function decideDamage(
  input: WhoPaysInput,
  ctx: {
    cost: number
    date: string // YYYY-MM-DD the damage was reported
    damageId?: number // the record being re-decided, if it exists
    companies: InsuranceCompany[]
    claims: ClaimRow[]
    employeeId: number | null
  },
): { error: string } | { columns: DecisionColumns } {
  if (!ctx.employeeId) return { error: 'Your account is not linked to an employee record.' }
  if (!input.chargeTo) return { error: 'Choose who pays.' }
  const base = {
    charge_to: input.chargeTo,
    damage_status: 'Approved' as const,
    approved_by: ctx.employeeId,
    approved_at: new Date().toISOString(),
    insurance_company_id: null,
    insurance_covered_amount: null,
    claim_status: null,
    claim_reference: null,
  }
  if (input.chargeTo !== 'Insurance') return { columns: base }

  const { policy, left } = policyChoice(ctx.companies, ctx.claims, input.companyId, ctx.date, ctx.damageId)
  if (!policy) return { error: 'No insurance policy covers the day this damage was reported.' }
  const parsed = parseAmount(input.covered)
  if (parsed.error || parsed.value === null) return { error: parsed.error ?? 'Enter how much the insurance covers.' }
  const amountProblem = coveredAmountError(parsed.value, ctx.cost, left)
  if (amountProblem) return { error: amountProblem }
  return {
    columns: {
      ...base,
      insurance_company_id: policy.insurance_company_id,
      insurance_covered_amount: parsed.value,
      claim_status: input.claimStatus,
      claim_reference: input.reference.trim() || null,
    },
  }
}
