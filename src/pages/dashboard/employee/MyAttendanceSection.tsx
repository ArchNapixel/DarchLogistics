// MyAttendanceSection ("My Attendance" page): the logged-in employee's own
// attendance, one Sun-Sat week at a time (same weeks payroll uses). Read-only
// -- admin records it on Human Resource -> Attendance. Shown to Mechanic,
// Helper and Dispatcher (Drivers are paid per trip, so they have no
// attendance). A finished day with no record counts as Absent, same rule as
// the admin sheet.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadAttendanceRecords, type AttendanceRecord } from '../../../lib/employeeAttendance'
import { toManilaDate } from '../../../lib/payslip'
import MyAttendanceCalendar from './MyAttendanceCalendar'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

const STATUS_STYLES: Record<string, string> = {
  Present: 'bg-green-100 text-green-700',
  Leave: 'bg-blue-100 text-blue-700',
  Absent: 'bg-red-100 text-red-700',
}

function MyAttendanceSection() {
  const { employeeId } = useAuth()
  const today = toManilaDate(new Date())
  const thisWeekStart = weekStartOf(today)
  const [weekStart, setWeekStart] = useState(thisWeekStart)
  const [records, setRecords] = useState<Map<string, AttendanceRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i))

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    async function load(id: number) {
      setLoading(true)
      const { records: loaded, error: loadError } = await loadAttendanceRecords(weekStart, shiftDate(weekStart, 6), id)
      if (cancelled) return
      setError(loadError)
      setRecords(new Map(loaded.map((r) => [r.attendance_date, r])))
      setLoading(false)
    }
    void load(employeeId)
    return () => {
      cancelled = true
    }
  }, [employeeId, weekStart])

  if (!employeeId) {
    return <p className="text-slate-500">Your account has no linked employee record, so there is no attendance to show.</p>
  }

  // Day over + no record = Absent; today/future + no record = not marked yet.
  const statusOf = (date: string) => records.get(date)?.attendance_status ?? (date < today ? 'Absent' : null)
  const presentDays = days.filter((date) => statusOf(date) === 'Present').length
  const leaveDays = days.filter((date) => statusOf(date) === 'Leave').length
  const absentDays = days.filter((date) => statusOf(date) === 'Absent').length

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My Attendance</h2>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setWeekStart(shiftDate(weekStart, -7))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">&larr; Previous week</button>
        <span className="text-sm font-medium text-slate-900">{formatShort(days[0])} – {formatShort(days[6])}, {days[6].slice(0, 4)}</span>
        <button onClick={() => setWeekStart(shiftDate(weekStart, 7))} disabled={weekStart >= thisWeekStart} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">Next week &rarr;</button>
        {weekStart !== thisWeekStart && <button onClick={() => setWeekStart(thisWeekStart)} className="text-sm font-medium text-slate-700 underline">This week</button>}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {loading ? (
        <p className="mt-4 text-slate-500">Loading attendance...</p>
      ) : (
        <>
          <p className="mt-4 text-sm text-slate-600">
            Present: <span className="font-semibold text-slate-900">{presentDays}</span> · Leave:{' '}
            <span className="font-semibold text-slate-900">{leaveDays}</span> · Absent:{' '}
            <span className="font-semibold text-slate-900">{absentDays}</span>
          </p>
          <div className="mt-4 grid items-start gap-6 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-300 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Day</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {days.map((date, i) => {
                  const status = statusOf(date)
                  return (
                    <tr key={date} className="border-b border-slate-300 last:border-0">
                      <td className="px-4 py-3 text-slate-900">{DAY_NAMES[i]}</td>
                      <td className="px-4 py-3 text-slate-600">{formatShort(date)}, {date.slice(0, 4)}</td>
                      <td className="px-4 py-3">
                        {status ? (
                          <span className={`px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>{status}</span>
                        ) : (
                          <span className="text-slate-400">{date === today ? 'Not marked yet' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <MyAttendanceCalendar employeeId={employeeId} today={today} />
          </div>
        </>
      )}
    </div>
  )
}

export default MyAttendanceSection
