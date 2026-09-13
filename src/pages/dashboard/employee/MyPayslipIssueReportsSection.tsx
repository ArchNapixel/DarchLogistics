// MyPayslipIssueReportsSection: the employee's own payslip-issue-report
// history -- same self-contained pattern as
// MyCashAdvanceRequestsSection.tsx (own useAuth(), own refresh).
// Submitting a new report happens via ReportPayslipIssueModal.tsx from
// MyPayslipSection.tsx elsewhere on the page; MyPayslipPage.tsx forces
// this section to reload by remounting it (a changed `key`) when that
// happens, same trick EmployeeDashboard.tsx uses for the Task Board.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPayslipIssuesForEmployee,
  type PayslipIssueReport,
} from '../../../lib/payslipIssueReports'

const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-orange-100 text-orange-700',
  Resolved: 'bg-green-100 text-green-700',
}

function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function MyPayslipIssueReportsSection() {
  const { employeeId } = useAuth()
  const [reports, setReports] = useState<PayslipIssueReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (employeeId) {
      load(employeeId)
    } else {
      setLoading(false)
    }
  }, [employeeId])

  async function load(id: number) {
    setLoading(true)

    const { reports: loaded, error: loadError } = await loadPayslipIssuesForEmployee(id)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setReports(loaded)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading your reports...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (reports.length === 0) {
    return <p className="text-slate-500">No payslip issues reported yet.</p>
  }

  return (
    <div className="grid gap-3">
      {reports.map((report) => (
        <div key={report.report_id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">
              {new Date(report.created_at).toLocaleDateString()}
            </p>
            <StatusBadge status={report.status} />
          </div>
          <p className="mt-2 text-sm text-slate-900">{report.description}</p>
          {report.resolution_note && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Resolution
              </p>
              <p className="mt-1 text-sm text-slate-700">{report.resolution_note}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default MyPayslipIssueReportsSection
