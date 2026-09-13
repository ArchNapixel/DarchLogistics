// IssueReportsSection: admin read-only view of driver-submitted issue
// reports (employee/ReportIssueModal.tsx). Not tied to a specific trip
// unless itinerary_id is set.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type IssueReport = {
  issue_report_id: number
  employee_name: string
  itinerary_id: number | null
  description: string
  severity: string
  notes: string | null
  reported_at: string
}

const SEVERITY_STYLES: Record<string, string> = {
  Minor: 'bg-yellow-100 text-yellow-700',
  Major: 'bg-red-100 text-red-700',
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles = SEVERITY_STYLES[severity] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {severity}
    </span>
  )
}

function IssueReportsSection() {
  const [reports, setReports] = useState<IssueReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const { data: rows, error: loadError } = await supabase
      .from('issue_reports')
      .select('issue_report_id, employee_id, itinerary_id, description, severity, notes, reported_at')
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
        description: row.description,
        severity: row.severity,
        notes: row.notes,
        reported_at: row.reported_at,
      })),
    )
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading issue reports...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (reports.length === 0) {
    return <p className="text-slate-500">No issue reports yet.</p>
  }

  return (
    <div className="grid gap-3">
      {reports.map((report) => (
        <div key={report.issue_report_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
        </div>
      ))}
    </div>
  )
}

export default IssueReportsSection
