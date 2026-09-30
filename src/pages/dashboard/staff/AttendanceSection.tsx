// Daily attendance roster (Admin, Human Resource -> Attendance).
// Instead of picking an employee and typing a record, the page shows ONE
// table per day listing every current employee (not Deactivated/
// Terminated). The table "generates itself" -- no rows are created until
// the admin marks someone. Today, an unmarked row shows "Not marked"; once
// a day is over, anyone still unmarked counts as ABSENT automatically
// (worked out here, no row written -- payroll only pays Present/Leave rows,
// so a missing row already means unpaid). Admin can still fix it with the
// Action buttons (Present / Leave / Absent).
// Use the arrows / date box to open another day's table. Saves go through
// saveAttendanceRecord() (upsert on employee + date), so re-saving a day
// edits it. Days already used on a payslip are locked.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadAttendanceRecords, saveAttendanceRecord, type AttendanceRecord, type AttendanceStatus } from '../../../lib/employeeAttendance'
import { toManilaDate } from '../../../lib/payslip'
import { supabase } from '../../../lib/supabaseClient'

type Employee = { employee_id: number; full_name: string; position: string }
const DEFAULT_HOURS = '8'

// Move a YYYY-MM-DD date by N days (noon UTC avoids any DST/timezone edge).
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function AttendanceSection() {
  const { employeeId: recorderId } = useAuth()
  const today = toManilaDate(new Date())
  const [date, setDate] = useState(today)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<Map<number, AttendanceRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [employeesResult, statusesResult, attendanceResult] = await Promise.all([
      supabase.from('employees').select('employee_id, full_name, position, employment_status_id').order('full_name'),
      supabase.from('employment_status').select('status_id, status_name'),
      loadAttendanceRecords(date, date),
    ])
    const loadError = employeesResult.error?.message ?? statusesResult.error?.message ?? attendanceResult.error
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    const inactiveIds = new Set(
      (statusesResult.data ?? [])
        .filter((s) => s.status_name === 'Deactivated' || s.status_name === 'Terminated')
        .map((s) => s.status_id),
    )
    const active = (employeesResult.data ?? []).filter((e) => !inactiveIds.has(e.employment_status_id) && e.position !== 'Driver') // drivers are paid per trip, not attendance
    const byEmployee = new Map(attendanceResult.records.map((r) => [r.employee_id, r]))

    setEmployees(active)
    setRecords(byEmployee)
    setLoading(false)
  }, [date])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // Writes one row straight away (Present saves 8 hours quietly -- hours
  // aren't entered by hand any more, legacy Hourly payslips still read them).
  async function mark(id: number, status: AttendanceStatus) {
    if (!recorderId) {
      setError('Your account has no linked employee record, so attendance cannot be recorded.')
      return
    }
    setSavingId(id)
    setError(null)
    const { error: saveError } = await saveAttendanceRecord({
      employeeId: id,
      attendanceDate: date,
      status,
      hoursWorked: status === 'Present' ? Number(DEFAULT_HOURS) : null,
      notes: null,
      recordedBy: recorderId,
    })
    if (saveError) setError(saveError)
    else await load()
    setSavingId(null)
  }

  // Every row still "Not marked" becomes Present -- admin then just fixes the exceptions.
  async function handleMarkRestPresent() {
    const unmarked = employees.filter((e) => !records.has(e.employee_id))
    if (unmarked.length === 0) return
    setSavingId('all')
    setError(null)
    if (!recorderId) {
      setError('Your account has no linked employee record, so attendance cannot be recorded.')
      setSavingId(null)
      return
    }
    const results = await Promise.all(
      unmarked.map((e) =>
        saveAttendanceRecord({
          employeeId: e.employee_id,
          attendanceDate: date,
          status: 'Present',
          hoursWorked: Number(DEFAULT_HOURS),
          notes: null,
          recordedBy: recorderId,
        }),
      ),
    )
    const failed = results.find((r) => r.error)
    if (failed) setError(failed.error)
    await load()
    setSavingId(null)
  }

  // A day before today with no record = Absent (see header comment).
  const dayIsOver = date < today
  const counts = { Present: 0, Absent: 0, Leave: 0, notMarked: 0 }
  for (const e of employees) {
    const rec = records.get(e.employee_id)
    if (rec) counts[rec.attendance_status] += 1
    else if (dayIsOver) counts.Absent += 1
    else counts.notMarked += 1
  }
  const unmarkedCount = employees.filter((e) => !records.has(e.employee_id)).length

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Attendance</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setDate(shiftDate(date, -1))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">&larr; Previous day</button>
        <input type="date" value={date} max={today} onChange={(event) => event.target.value && setDate(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
        <button onClick={() => setDate(shiftDate(date, 1))} disabled={date >= today} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next day &rarr;</button>
        {date !== today && <button onClick={() => setDate(today)} className="text-sm font-medium text-slate-700 underline">Back to today</button>}
        <button onClick={handleMarkRestPresent} disabled={loading || savingId !== null || unmarkedCount === 0} className="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {savingId === 'all' ? 'Saving...' : `Mark ${unmarkedCount} unmarked as Present`}
        </button>
      </div>

      <p className="mt-3 text-sm text-slate-600">
        {new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
        {' · '}Present {counts.Present} · Absent {counts.Absent} · Leave {counts.Leave}{!dayIsOver && ` · Not marked ${counts.notMarked}`}
      </p>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-4 text-slate-500">Loading attendance...</p>
      ) : employees.length === 0 ? (
        <p className="mt-4 text-slate-500">No active employees.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const rec = records.get(e.employee_id)
                const locked = rec?.paid_payroll_id != null
                const busy = savingId !== null
                // What the row currently counts as (past + no record = Absent).
                const current = rec?.attendance_status ?? (dayIsOver ? 'Absent' : null)
                return (
                  <tr key={e.employee_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-900">{e.full_name}</td>
                    <td className="px-4 py-3 text-slate-600">{e.position}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap items-center gap-2">
                        {(['Present', 'Leave', 'Absent'] as AttendanceStatus[]).map((status) => (
                          <button
                            key={status}
                            onClick={() => void mark(e.employee_id, status)}
                            disabled={busy || locked || current === status}
                            className={`rounded-lg px-3 py-1 text-sm font-medium disabled:cursor-default ${current === status ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40'}`}
                          >
                            {savingId === e.employee_id && current !== status ? '...' : status}
                          </button>
                        ))}
                        {locked && <span className="text-xs text-slate-500">Paid — locked</span>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default AttendanceSection
