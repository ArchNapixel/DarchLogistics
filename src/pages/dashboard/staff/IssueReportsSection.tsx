// IssueReportsSection: admin read-only-turned-actionable view of
// driver-submitted issue reports (employee/ReportIssueModal.tsx). Not
// tied to a specific trip unless itinerary_id is set.
//
// Only shows reports where worked_on is false/null -- once a report is
// either converted to a work order or dismissed as "worked on", it
// drops off this list, but the row stays in issue_reports untouched
// otherwise (worked_on flips to true, nothing is deleted).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import ConvertIssueToWorkOrderModal, {
  type ConvertibleIssueReport,
} from './ConvertIssueToWorkOrderModal'

type IssueReport = ConvertibleIssueReport & {
  itinerary_id: number | null
}

const SEVERITY_STYLES: Record<string, string> = {
  Minor: 'bg-yellow-100 text-yellow-700',
  Major: 'bg-red-100 text-red-700',
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles = SEVERITY_STYLES[severity] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {severity}
    </span>
  )
}

function IssueReportsSection() {
  const [reports, setReports] = useState<IssueReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [convertingReport, setConvertingReport] = useState<IssueReport | null>(null)
  const [markingId, setMarkingId] = useState<number | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const { data: rows, error: loadError } = await supabase
      .from('issue_reports')
      .select('issue_report_id, employee_id, itinerary_id, plate_number, trailer_id, description, severity, notes, reported_at')
      .or('worked_on.is.null,worked_on.eq.false')
      .order('reported_at', { ascending: false })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    if (rows.length === 0) {
      setReports([])
      setError(null)
      setLoading(false)
      return
    }

    const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id)))
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('employee_id, full_name')
      .in('employee_id', employeeIds)

    if (employeesError) {
      setError(employeesError.message)
      setLoading(false)
      return
    }

    const nameById = new Map(employees.map((e) => [e.employee_id, e.full_name]))

    setReports(
      rows.map((row) => ({
        issue_report_id: row.issue_report_id,
        employee_name: nameById.get(row.employee_id) ?? `Employee #${row.employee_id}`,
        itinerary_id: row.itinerary_id,
        plate_number: row.plate_number,
        trailer_id: row.trailer_id,
        description: row.description,
        severity: row.severity,
        notes: row.notes,
        reported_at: row.reported_at,
      })),
    )
    setError(null)
    setLoading(false)
  }

  async function handleMarkWorkedOn(report: IssueReport) {
    if (!window.confirm(`Mark this report from ${report.employee_name} as worked on?`)) {
      return
    }

    setMarkingId(report.issue_report_id)
    setActionError(null)

    // .select().maybeSingle() so a blocked UPDATE (no matching RLS
    // policy -- succeeds with 0 rows touched, no error) is caught here
    // instead of silently reporting success.
    const { data, error: updateError } = await supabase
      .from('issue_reports')
      .update({ worked_on: true })
      .eq('issue_report_id', report.issue_report_id)
      .select('issue_report_id')
      .maybeSingle()

    setMarkingId(null)

    if (updateError) {
      setActionError(updateError.message)
      return
    }
    if (!data) {
      setActionError(
        'The report was not updated (0 rows affected) -- this usually means a database permission is missing. Nothing changed.',
      )
      return
    }

    setReports((prev) => prev.filter((r) => r.issue_report_id !== report.issue_report_id))
    setSuccessMessage('Report marked as worked on.')
  }

  if (loading) {
    return <p className="text-slate-500">Loading issue reports...</p>
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
      {successMessage && (
        <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          {successMessage}
        </p>
      )}

      {reports.length === 0 ? (
        <p className="text-slate-500">No open issue reports.</p>
      ) : (
        <div className="grid gap-3">
          {reports.map((report) => (
            <div
              key={report.issue_report_id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {report.employee_name}
                  {report.itinerary_id !== null && (
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      Itinerary #{report.itinerary_id}
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={report.severity} />
                  <span className="text-xs text-slate-500">
                    {new Date(report.reported_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-700">{report.description}</p>
              {report.notes && (
                <p className="mt-1 text-sm text-slate-500">Notes: {report.notes}</p>
              )}

              <div className="mt-3 flex gap-3 border-t border-slate-100 pt-3">
                <button
                  onClick={() => setConvertingReport(report)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Convert to Work Order
                </button>
                <button
                  onClick={() => handleMarkWorkedOn(report)}
                  disabled={markingId === report.issue_report_id}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {markingId === report.issue_report_id ? 'Saving...' : 'Mark as Worked On'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {convertingReport && (
        <ConvertIssueToWorkOrderModal
          report={convertingReport}
          onClose={() => setConvertingReport(null)}
          onConverted={() => {
            setReports((prev) =>
              prev.filter((r) => r.issue_report_id !== convertingReport.issue_report_id),
            )
            setSuccessMessage('Work order created and report marked as worked on.')
            setConvertingReport(null)
          }}
        />
      )}
    </div>
  )
}

export default IssueReportsSection
