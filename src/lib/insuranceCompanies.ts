// insuranceCompanies: the insurance policies listed on the Damage Charges
// page (table insurance_companies, SQL given in chat 2026-11-12). Staff can
// read them; only Admin can add / edit / archive (RLS). Archived policies
// are kept (old damage records point at them) but can't be picked any more.
// The rules (cover left, who pays) are in insuranceRules.ts.
import { supabase } from './supabaseClient'
import type { LimitType } from './insuranceRules'

export type InsuranceCompany = {
  insurance_company_id: number
  company_name: string
  policy_number: string
  amount_insured: number
  limit_type: LimitType
  valid_from: string // YYYY-MM-DD
  valid_until: string
  note: string | null
  archived_at: string | null
}

const COLUMNS =
  'insurance_company_id, company_name, policy_number, amount_insured, limit_type, valid_from, valid_until, note, archived_at'

export async function loadInsuranceCompanies(): Promise<{ rows: InsuranceCompany[]; error: string | null }> {
  const { data, error } = await supabase.from('insurance_companies').select(COLUMNS).order('company_name')
  if (error) return { rows: [], error: error.message }
  return {
    rows: (data ?? []).map((r) => ({ ...r, amount_insured: Number(r.amount_insured) }) as InsuranceCompany),
    error: null,
  }
}

export type InsuranceCompanyInput = Omit<InsuranceCompany, 'insurance_company_id' | 'archived_at'>

// Add (no id) or edit. Returns an error message or null.
export async function saveInsuranceCompany(input: InsuranceCompanyInput, id?: number): Promise<string | null> {
  const result = id
    ? await supabase.from('insurance_companies').update(input).eq('insurance_company_id', id).select('insurance_company_id').maybeSingle()
    : await supabase.from('insurance_companies').insert(input).select('insurance_company_id').maybeSingle()
  if (result.error) {
    if (result.error.code === '23505') return 'That company already has a policy with this insurance number.'
    return result.error.message
  }
  // An update blocked by RLS reports no error but changes nothing.
  if (!result.data) return 'Not saved -- only an Admin can change insurance companies.'
  return null
}

export async function setInsuranceArchived(id: number, archived: boolean): Promise<string | null> {
  const { data, error } = await supabase
    .from('insurance_companies')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('insurance_company_id', id)
    .select('insurance_company_id')
    .maybeSingle()
  if (error) return error.message
  if (!data) return 'Not saved -- only an Admin can change insurance companies.'
  return null
}
