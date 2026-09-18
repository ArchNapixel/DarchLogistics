import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadAttendanceRecords, saveAttendanceRecord, type AttendanceRecord, type AttendanceStatus } from '../../../lib/employeeAttendance'
import { getDefaultPayPeriod } from '../../../lib/payslip'
import { supabase } from '../../../lib/supabaseClient'

type Employee = { employee_id: number; full_name: string; position: string }

function AttendanceSection() {
  const { employeeId: recorderId } = useAuth()
  const period = getDefaultPayPeriod()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState<AttendanceStatus>('Present')
  const [hours, setHours] = useState('8')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [employeesResult, attendanceResult] = await Promise.all([
      supabase.from('employees').select('employee_id, full_name, position').order('full_name'),
      loadAttendanceRecords(period.start, period.end),
    ])
    const loadError = employeesResult.error ?? attendanceResult.error
    if (loadError) {
      setError(typeof loadError === 'string' ? loadError : loadError.message)
      setLoading(false)
      return
    }
    setEmployees(employeesResult.data ?? [])
    setRecords(attendanceResult.records)
    if (!employeeId && employeesResult.data?.[0]) setEmployeeId(String(employeesResult.data[0].employee_id))
    setLoading(false)
  }, [employeeId, period.end, period.start])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function handleSave() {
    if (!recorderId || !employeeId || !date) {
      setError('Select an employee and attendance date.')
      return
    }
    const hoursValue = hours ? Number(hours) : null
    if (hoursValue !== null && (!Number.isFinite(hoursValue) || hoursValue < 0 || hoursValue > 24)) {
      setError('Hours worked must be between 0 and 24.')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    const { error: saveError } = await saveAttendanceRecord({
      employeeId: Number(employeeId),
      attendanceDate: date,
      status,
      hoursWorked: status === 'Present' ? hoursValue : null,
      notes: notes.trim() || null,
      recordedBy: recorderId,
    })
    setSaving(false)
    if (saveError) {
      setError(saveError)
      return
    }
    setMessage('Attendance saved.')
    setNotes('')
    const refreshed = await loadAttendanceRecords(period.start, period.end)
    if (!refreshed.error) setRecords(refreshed.records)
  }

  return (
    <div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="font-semibold text-slate-900">Record attendance</h3>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-3 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">{message}</p>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">Employee<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900">{employees.map((employee) => <option key={employee.employee_id} value={employee.employee_id}>{employee.full_name} ({employee.position})</option>)}</select></label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">Status<select value={status} onChange={(event) => setStatus(event.target.value as AttendanceStatus)} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900"><option>Present</option><option>Absent</option><option>Leave</option></select></label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">Hours<input type="number" min="0" max="24" step="0.25" value={hours} disabled={status !== 'Present'} onChange={(event) => setHours(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 disabled:bg-slate-100" /></label>
          <button onClick={handleSave} disabled={saving || loading || employees.length === 0} className="self-end rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save attendance'}</button>
        </div>
        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">Notes (optional)<input value={notes} onChange={(event) => setNotes(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900" /></label>
      </div>

      <h3 className="mt-6 font-semibold text-slate-900">Current pay-period records</h3>
      {loading ? <p className="mt-3 text-slate-500">Loading attendance...</p> : records.length === 0 ? <p className="mt-3 text-slate-500">No attendance records for the current pay period.</p> : <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-4 py-3 font-medium">Employee</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Hours</th><th className="px-4 py-3 font-medium">Notes</th></tr></thead><tbody>{records.map((record) => <tr key={record.attendance_id} className="border-b border-slate-100 last:border-0"><td className="px-4 py-3 text-slate-900">{record.employee_name}</td><td className="px-4 py-3 text-slate-600">{record.attendance_date}</td><td className="px-4 py-3 text-slate-600">{record.attendance_status}</td><td className="px-4 py-3 text-slate-600">{record.hours_worked ?? '—'}</td><td className="px-4 py-3 text-slate-600">{record.notes ?? '—'}</td></tr>)}</tbody></table></div>}
    </div>
  )
}

export default AttendanceSection
