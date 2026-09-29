// PayslipIssueReportsSection: pending payslip-issue reports from
// employees (employee/ReportPayslipIssueModal.tsx), with a Resolve
// action. Same shell as CashAdvanceRequestsSection.tsx.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPendingPayslipIssues,
  resolvePayslipIssue,
  type PendingPayslipIssue,
} from '../../../lib/payslipIssueReports'
import { promptDialog } from '../../../components/ConfirmDialog'

function PayslipIssueReportsSection({ onChanged }: { onChanged?: () => void }) {
  const { employeeId } = useAuth()
  const [reports, setReports] = useState<PendingPayslipIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { reports: loaded, error: loadError } = await loadPendingPayslipIssues()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setReports(loaded)
    setError(null)
    setLoading(false)
  }

  async function handleResolve(report: PendingPayslipIssue) {
    if (!employeeId) {
      setActionError(
        'Could not determine your own employee record, so this cannot be recorded as resolved by you. Contact an admin.',
      )
      return
    }

    const input = await promptDialog({
      title: `Resolve ${report.employee_name}'s report`,
      message: 'Add a note on how it was resolved.',
      confirmLabel: 'Resolve',
    })
    if (input === null) return

    setResolvingId(report.report_id)
    setActionError(null)

    const { error: resolveError } = await resolvePayslipIssue({
      reportId: report.report_id,
      resolutionNote: input.trim(),
      resolvedByEmployeeId: employeeId,
    })

    setResolvingId(null)

    if (resolveError) {
      setActionError(resolveError)
      return
    }

    setReports((prev) => prev.filter((r) => r.report_id !== report.report_id))
    onChanged?.()
  }

  if (loading) {
    return <p className="text-slate-500">Loading pending reports...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  return (
    <div>
      {actionError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </p>
      )}

      {reports.length === 0 ? (
        <p className="text-slate-500">No pending payslip issue reports.</p>
      ) : (
        <div className="grid gap-3">
          {reports.map((report) => (
            <div
              key={report.report_id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">{report.employee_name}</p>
                <span className="text-xs text-slate-500">
                  {new Date(report.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Payslip: {report.payroll_period}
              </p>
              <p className="mt-2 text-sm text-slate-700">{report.description}</p>
              <button
                onClick={() => handleResolve(report)}
                disabled={resolvingId === report.report_id}
                className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {resolvingId === report.report_id ? 'Saving...' : 'Resolve'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PayslipIssueReportsSection
