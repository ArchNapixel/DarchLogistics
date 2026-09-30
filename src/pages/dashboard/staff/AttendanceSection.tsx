// Weekly attendance sheet (Admin, Human Resource -> Attendance).
// One table per Sun-Sat week (same weeks payroll uses): a row per current
// employee (not Deactivated/Terminated, and not Drivers -- they're paid per
// trip) and a column per day. The table "generates itself" -- no rows are
// written until the admin marks someone. Use the arrows to open another week.
// Each day cell is a Present / Leave / Absent dropdown, saved on change via
// saveAttendanceRecord() (upsert on employee + date). Rules:
// - Future days are disabled.
// - Today with no record shows "—"; a day that is over with no record counts
//   as ABSENT automatically (worked out here, no row written -- payroll only
//   pays Present/Leave rows, so a missing row already means unpaid).
// - Never locked: admin can always correct a day, even one already on a
//   draft payslip. A draft doesn't change by itself, so after fixing a day
//   to Absent/Leave, use Edit or Regenerate on that payslip.
// - "All present" in a day's header marks that day's unmarked people Present.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadAttendanceRecords, saveAttendanceRecord, type AttendanceRecord, type AttendanceStatus } from '../../../lib/employeeAttendance'
import { toManilaDate } from '../../../lib/payslip'
import { supabase } from '../../../lib/supabaseClient'

type Employee = { employee_id: number; full_name: string; position: string }

const DEFAULT_HOURS = 8
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Move a YYYY-MM-DD date by N days (noon UTC avoids any DST/timezone edge).
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// The Sunday on or before a date.
function weekStartOf(date: string): string {
  return shiftDate(date, -new Date(`${date}T12:00:00Z`).getUTCDay())
}

function formatShort(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function AttendanceSection() {
  const { employeeId: recorderId } = useAuth()
  const today = toManilaDate(new Date())
  const thisWeekStart = weekStartOf(today)
  const [weekStart, setWeekStart] = useState(thisWeekStart)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<Map<string, AttendanceRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i))
  const weekEnd = days[6]

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [employeesResult, statusesResult, attendanceResult] = await Promise.all([
      supabase.from('employees').select('employee_id, full_name, position, employment_status_id').order('full_name'),
      supabase.from('employment_status').select('status_id, status_name'),
      loadAttendanceRecords(weekStart, shiftDate(weekStart, 6)),
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
    setEmployees(
      (employeesResult.data ?? []).filter((e) => !inactiveIds.has(e.employment_status_id) && e.position !== 'Driver'),
    )
    setRecords(new Map(attendanceResult.records.map((r) => [`${r.employee_id}|${r.attendance_date}`, r])))
    setLoading(false)
  }, [weekStart])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // Present saves 8 hours quietly -- hours aren't entered by hand any more,
  // legacy Hourly payslips still read them.
  function save(employeeId: number, date: string, status: AttendanceStatus) {
    return saveAttendanceRecord({
      employeeId,
      attendanceDate: date,
      status,
      hoursWorked: status === 'Present' ? DEFAULT_HOURS : null,
      notes: null,
      recordedBy: recorderId!,
    })
  }

  // Runs a batch of saves, then reloads the week.
  async function runSaves(saves: Promise<{ error: string | null }>[]) {
    if (!recorderId) {
      setError('Your account has no linked employee record, so attendance cannot be recorded.')
      return
    }
    setBusy(true)
    setError(null)
    const failed = (await Promise.all(saves)).find((r) => r.error)
    if (failed) setError(failed.error)
    await load()
    setBusy(false)
  }

  function handleMark(employeeId: number, date: string, status: AttendanceStatus) {
    return runSaves(recorderId ? [save(employeeId, date, status)] : [])
  }

  function handleAllPresent(date: string) {
    const unmarked = employees.filter((e) => !records.has(`${e.employee_id}|${date}`))
    return runSaves(recorderId ? unmarked.map((e) => save(e.employee_id, date, 'Present')) : [])
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Attendance</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setWeekStart(shiftDate(weekStart, -7))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">&larr; Previous week</button>
        <span className="text-sm font-medium text-slate-900">{formatShort(weekStart)} – {formatShort(weekEnd)}, {weekEnd.slice(0, 4)}</span>
        <button onClick={() => setWeekStart(shiftDate(weekStart, 7))} disabled={weekStart >= thisWeekStart} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next week &rarr;</button>
        {weekStart !== thisWeekStart && <button onClick={() => setWeekStart(thisWeekStart)} className="text-sm font-medium text-slate-700 underline">This week</button>}
      </div>

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
                {days.map((date, i) => (
                  <th key={date} className="px-2 py-3 text-center font-medium">
                    <div className={date === today ? 'text-slate-900' : ''}>{DAY_NAMES[i]} {formatShort(date).split(' ')[1]}</div>
                    {date <= today && (
                      <button onClick={() => void handleAllPresent(date)} disabled={busy} className="mt-1 text-xs font-normal text-slate-600 underline disabled:opacity-50">All present</button>
                    )}
                  </th>
                ))}
                <th className="px-4 py-3 text-center font-medium">Days present</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                let presentDays = 0
                return (
                  <tr key={e.employee_id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{e.full_name}</div>
                      <div className="text-xs text-slate-500">{e.position}</div>
                    </td>
                    {days.map((date) => {
                      const rec = records.get(`${e.employee_id}|${date}`)
                      // Day over + no record = Absent; today/future + no record = blank.
                      const shown: AttendanceStatus | '' = rec?.attendance_status ?? (date < today ? 'Absent' : '')
                      if (shown === 'Present') presentDays += 1
                      return (
                        <td key={date} className="px-2 py-3 text-center">
                          <select
                            value={shown}
                            disabled={busy || date > today}
                            onChange={(event) => void handleMark(e.employee_id, date, event.target.value as AttendanceStatus)}
                            className={`rounded-lg border px-1 py-1 text-sm disabled:opacity-60 ${shown === 'Present' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-700'}`}
                          >
                            {shown === '' && <option value="">—</option>}
                            <option>Present</option>
                            <option>Leave</option>
                            <option>Absent</option>
                          </select>
                        </td>
                      )
                    })}
                    <td className="px-4 py-3 text-center text-slate-900">{presentDays}</td>
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
