// Self-check for src/lib/insuranceRules.ts -- run with:
//   node scripts/check-insurance-rules.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import {
  companyDamageShare,
  coverageLeft,
  coverageUsed,
  coveredAmountError,
  oneYearAfter,
  policyChoice,
  policyCovers,
  type ClaimRow,
} from '../src/lib/insuranceRules.ts'

// Who pays.
assert.equal(companyDamageShare({ charge_to: 'Client', estimated_damage_cost: 5000 }), 0)
assert.equal(companyDamageShare({ charge_to: 'Company', estimated_damage_cost: '5000.50' }), 5000.5)
assert.equal(
  companyDamageShare({ charge_to: 'Insurance', estimated_damage_cost: 10000, insurance_covered_amount: 8000, claim_status: 'Filed' }),
  2000,
) // deductible stays with the company
assert.equal(
  companyDamageShare({ charge_to: 'Insurance', estimated_damage_cost: 10000, insurance_covered_amount: 10000, claim_status: 'Paid' }),
  0,
)
assert.equal(
  companyDamageShare({ charge_to: 'Insurance', estimated_damage_cost: 10000, insurance_covered_amount: 8000, claim_status: 'Denied' }),
  10000,
) // denied -> company pays it all

// Coverage used / left.
const claim = (id: number, company: number, covered: number, extra: Partial<ClaimRow> = {}): ClaimRow => ({
  damage_id: id,
  insurance_company_id: company,
  charge_to: 'Insurance',
  damage_status: 'Approved',
  claim_status: 'Filed',
  estimated_damage_cost: covered,
  insurance_covered_amount: covered,
  ...extra,
})
const claims = [
  claim(1, 7, 30000),
  claim(2, 7, 20000, { claim_status: 'Paid' }),
  claim(3, 7, 99999, { claim_status: 'Denied' }), // not counted
  claim(4, 7, 99999, { damage_status: 'Reported' }), // not decided yet
  claim(5, 8, 40000), // other policy
  claim(6, 7, 99999, { charge_to: 'Company' }), // switched away from insurance
]
assert.equal(coverageUsed(7, claims), 50000)
const total = { insurance_company_id: 7, amount_insured: 100000, limit_type: 'Total' as const }
assert.equal(coverageLeft(total, claims), 50000)
assert.equal(coverageLeft(total, claims, 1), 80000) // re-deciding record #1 frees its own 30k
assert.equal(coverageLeft({ ...total, amount_insured: 40000 }, claims), 0) // never negative
assert.equal(coverageLeft({ ...total, limit_type: 'PerClaim' }, claims), 100000)

// Covered amount checks.
assert.equal(coveredAmountError(8000, 10000, 50000), null)
assert.match(coveredAmountError(12000, 10000, 50000) ?? '', /more than the damage cost/)
assert.match(coveredAmountError(8000, 10000, 5000) ?? '', /cover is left/)

// Dates.
assert.equal(policyCovers({ valid_from: '2026-01-01', valid_until: '2026-12-31' }, '2026-12-31'), true)
assert.equal(policyCovers({ valid_from: '2026-01-01', valid_until: '2026-12-31' }, '2027-01-01'), false)
assert.equal(oneYearAfter('2026-11-12'), '2027-11-12')
assert.equal(oneYearAfter('2028-02-29'), '2029-03-01')

// Picking a policy for a damage date.
const policyA = { ...total, valid_from: '2026-01-01', valid_until: '2026-12-31', archived_at: null }
const policyB = { ...policyA, insurance_company_id: 8, archived_at: '2026-06-01' } // archived
const policyC = { ...policyA, insurance_company_id: 9, valid_from: '2027-01-01', valid_until: '2027-12-31' }
const pick = policyChoice([policyB, policyA, policyC], claims, null, '2026-11-13')
assert.deepEqual(pick.offered.map((p) => p.insurance_company_id), [7]) // archived / not yet valid left out
assert.equal(pick.policy?.insurance_company_id, 7) // none picked -> first offered
assert.equal(pick.left, 50000)
assert.equal(policyChoice([policyC], claims, 9, '2026-11-13').policy, null) // picked one doesn't cover the date

console.log('ok')
