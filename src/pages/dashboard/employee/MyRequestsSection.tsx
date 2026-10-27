// MyRequestsSection: "My Requests" on My Payslips -- the employee's own
// cash advance requests and payslip issue reports in one list, newest
// first, each with its status (and Admin's reason / reply when there is
// one). Self-contained (own useAuth()); MyPayslipPage.tsx remounts it
// (a changed `key`) after a new request or report so it reloads.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadCashAdvanceRequestsForEmployee } from '../../../lib/cashAdvanceRequests'
import { loadPayslipIssuesForEmployee } from '../../../lib/payslipIssueReports'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate, formatMoney } from '../../../lib/format'

type RequestRow = {
  key: string
  kind: 'Cash advance' | 'Payslip report'
  what: string
  status: string
  // Admin's rejection reason or resolution note.
  reply: string | null
  created_at: string
}

// Most recent rows shown.
const LIMIT = 10

function MyRequestsSection() {
  const { employeeId } = useAuth()
  const [rows, setRows] = useState<RequestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    void Promise.all([loadCashAdvanceRequestsForEmployee(employeeId), loadPayslipIssuesForEmployee(employeeId)]).then(
      ([advances, reports]) => {
        if (cancelled) return
        setError(advances.error ?? reports.error)
        setRows(
          [
            ...advances.requests.map((r) => ({
              key: `ca-${r.cash_advance_id}`,
              kind: 'Cash advance' as const,
              what: formatMoney(r.amount),
              status: r.status,
              reply: r.status === 'Rejected' ? r.rejection_reason : null,
              created_at: r.created_at,
            })),
            ...reports.reports.map((r) => ({
              key: `pr-${r.report_id}`,
              kind: 'Payslip report' as const,
              what: r.description,
              status: r.status,
              reply: r.resolution_note,
              created_at: r.created_at,
            })),
          ]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, LIMIT),
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [employeeId])

  return (
    <section aria-labelledby="my-requests-h" className="card flex flex-col">
      <h2 id="my-requests-h" className="border-b border-line px-5 py-4 text-base font-semibold text-ink">
        My Requests
      </h2>
      <div className="px-5 pb-2">
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {rows === null ? (
          <p className="py-3 text-sm text-ink-muted">Loading your requests...</p>
        ) : rows.length === 0 ? (
          <p className="py-3 text-sm text-ink-muted">No cash advance requests or payslip reports yet.</p>
        ) : (
          rows.map((r) => (
            <div key={r.key} className="flex items-start justify-between gap-3 border-b border-slate-200 py-3 text-sm last:border-0">
              <span className="min-w-0">
                <strong className="text-ink">{r.kind}</strong> · <span className="text-ink-secondary">{r.what}</span>
                <span className="block text-[13px] text-ink-muted">Sent {formatDate(r.created_at)}</span>
                {r.reply && <span className="mt-1 block text-[13px] text-ink-secondary">Admin: {r.reply}</span>}
              </span>
              <StatusBadge status={r.status} icon />
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export default MyRequestsSection
