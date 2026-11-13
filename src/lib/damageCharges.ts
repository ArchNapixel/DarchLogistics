// damageCharges: damage the client has to pay for. A delivery_damage_records
// row counts once staff approved it with charge_to 'Client' on the Damage
// Charges page. It's added ON TOP of the booking's delivery amount
// (amount_to_pay override, or rate x delivered trips) everywhere a
// balance is shown -- Bookings, Financial Records, Payments Due, the
// client portal. amount_to_pay itself never includes it, so an override
// can't swallow or double-count a damage charge.
import { supabase } from './supabaseClient'
import { fetchIn } from './dashboardExpenses'
import { parseAmount } from './amountInput'
import type { InsuranceCompany } from './insuranceCompanies'
import { coveredAmountError, policyChoice, type ClaimRow, type ClaimStatus } from './insuranceRules'

// booking_id -> total approved Client damage (bookings with none are absent).
export async function loadClientDamageChargesByBooking(bookingIds: number[]): Promise<{
  byBooking: Map<number, number>
  error: string | null
}> {
  const byBooking = new Map<number, number>()
  if (bookingIds.length === 0) return { byBooking, error: null }

  // fetchIn: ids in chunks (a long list makes the URL too big) and every
  // page past Supabase's 1000-row cap.
  const { rows: trips, error: tripsError } = await fetchIn<{ itinerary_id: number; booking_id: number }>(
    bookingIds,
    (chunk, from, to) =>
      supabase.from('itineraries').select('itinerary_id, booking_id').in('booking_id', chunk).range(from, to),
  )
  if (tripsError) return { byBooking, error: tripsError }
  if (trips.length === 0) return { byBooking, error: null }

  const { rows: damageRows, error: damageError } = await fetchIn<{
    itinerary_id: number
    estimated_damage_cost: number | string | null
  }>(
    trips.map((t) => t.itinerary_id),
    (chunk, from, to) =>
      supabase
        .from('delivery_damage_records')
        .select('itinerary_id, estimated_damage_cost')
        .in('itinerary_id', chunk)
        .eq('damage_status', 'Approved')
        .eq('charge_to', 'Client')
        .range(from, to),
  )
  if (damageError) return { byBooking, error: damageError }

  const bookingByTrip = new Map(trips.map((t) => [t.itinerary_id, t.booking_id]))
  for (const row of damageRows) {
    const bookingId = bookingByTrip.get(row.itinerary_id)
    if (bookingId === undefined) continue
    byBooking.set(bookingId, (byBooking.get(bookingId) ?? 0) + Number(row.estimated_damage_cost ?? 0))
  }
  return { byBooking, error: null }
}

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
