// InsuranceCompaniesPanel: the "Insurance Companies" list under the Damage
// Charges table -- each policy's insurance number, amount insured, dates,
// and (for a "total" limit) how much of it claims have used so far. Admin
// adds / edits / archives; Dispatchers only see it. 10 per page.
import { useState } from 'react'
import Pager from '../../../components/Pager'
import { formatDate, formatMoney, splitManila } from '../../../lib/format'
import { setInsuranceArchived, type InsuranceCompany } from '../../../lib/insuranceCompanies'
import { coverageLeft, coverageUsed, type ClaimRow } from '../../../lib/insuranceRules'
import { usePaged } from '../../../lib/usePaged'
import InsuranceCompanyModal from './InsuranceCompanyModal'

function InsuranceCompaniesPanel({
  companies,
  claims,
  isAdmin,
  onChanged,
}: {
  companies: InsuranceCompany[]
  claims: ClaimRow[]
  isAdmin: boolean
  onChanged: () => void
}) {
  const [showArchived, setShowArchived] = useState(false)
  const [editing, setEditing] = useState<InsuranceCompany | 'new' | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const today = splitManila(new Date()).date
  const visible = companies.filter((c) => showArchived || !c.archived_at)
  const paged = usePaged(visible, String(showArchived))
  const archivedCount = companies.filter((c) => c.archived_at).length

  async function toggleArchived(company: InsuranceCompany) {
    setBusyId(company.insurance_company_id)
    setError(null)
    const problem = await setInsuranceArchived(company.insurance_company_id, !company.archived_at)
    setBusyId(null)
    if (problem) return setError(problem)
    onChanged()
  }

  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'

  return (
    <section aria-labelledby="insurers-h" className="card flex min-w-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h2 id="insurers-h" className="font-semibold text-ink">
            Insurance Companies
          </h2>
          <p className="text-[13px] text-ink-muted">Policies that can take on damage recorded on trips.</p>
        </div>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && (
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived ({archivedCount})
            </label>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setEditing('new')} className="btn-primary px-4 text-sm">
              + Add Insurance Company
            </button>
          )}
        </div>
      </header>

      {error && <p className="mx-5 mt-3 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm text-ink-muted">
          <thead>
            <tr>
              <th className={TH}>Company</th>
              <th className={TH}>Insurance No.</th>
              <th className={`${TH} text-right`}>Amount Insured</th>
              <th className={TH}>Valid</th>
              <th className={`${TH} text-right`}>Used</th>
              <th className={`${TH} text-right`}>Remaining</th>
              {isAdmin && <th className={TH}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {paged.rows.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className="px-5 py-8 text-center">
                  <p className="font-semibold text-ink">No insurance companies yet.</p>
                  <p className="mt-1 text-[13px] text-ink-muted">
                    {isAdmin ? 'Add a policy to charge damage to insurance.' : 'An Admin can add one.'}
                  </p>
                </td>
              </tr>
            ) : (
              paged.rows.map((c) => {
                const expired = c.valid_until < today
                const perClaim = c.limit_type === 'PerClaim'
                return (
                  <tr key={c.insurance_company_id} className={`border-b border-slate-200 ${c.archived_at ? 'opacity-60' : ''}`}>
                    <td className={TD}>
                      <span className="block font-semibold text-ink-metric">{c.company_name}</span>
                      {c.note && <span className="block text-[13px] line-clamp-1" title={c.note}>{c.note}</span>}
                    </td>
                    <td className={TD}>{c.policy_number}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {formatMoney(c.amount_insured)}
                      <span className="block text-xs">{perClaim ? 'per claim' : 'total'}</span>
                    </td>
                    <td className={TD}>
                      {formatDate(c.valid_from)} – {formatDate(c.valid_until)}
                      {c.archived_at ? (
                        <span className="block text-xs font-medium text-ink-muted">Archived</span>
                      ) : (
                        expired && <span className="block text-xs font-medium text-amber-800">Expired</span>
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMoney(coverageUsed(c.insurance_company_id, claims))}</td>
                    <td className={`${TD} text-right tabular-nums`}>{perClaim ? '—' : formatMoney(coverageLeft(c, claims))}</td>
                    {isAdmin && (
                      <td className={TD}>
                        <span className="flex gap-2">
                          {!c.archived_at && (
                            <button type="button" onClick={() => setEditing(c)} className="btn-secondary px-3 text-sm font-medium">
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void toggleArchived(c)}
                            disabled={busyId === c.insurance_company_id}
                            className="btn-secondary px-3 text-sm font-medium"
                          >
                            {c.archived_at ? 'Restore' : 'Archive'}
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <Pager {...paged.pager} className="border-t border-line px-5 pb-3" />

      {editing && (
        <InsuranceCompanyModal
          company={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

export default InsuranceCompaniesPanel
