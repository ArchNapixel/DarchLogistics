// MyAttendanceSection ("My Attendance" page, the canvas's Mechanic / Helper
// Attendance board): the logged-in employee's own attendance. Read-only --
// admin records it on Human Resource -> Attendance. Shown to Mechanic,
// Helper and Dispatcher (Drivers are paid per trip, so they have no
// attendance). A finished day with no record counts as Absent, same rule as
// the admin sheet.
//
// Three month tiles (Present / Leave / Absent so far this month), one
// Sun-Sat week as a list (same weeks payroll uses; time in / out, hours and
// overtime when Admin recorded them), and a month calendar beside it.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadAttendanceRecords, type AttendanceRecord } from '../../../lib/employeeAttendance'
import { overtimeHours, timeToMinutes } from '../../../lib/attendanceHours'
import { formatClock } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import MyAttendanceCalendar from './MyAttendanceCalendar'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'

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

const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })

// "8:00 AM" from a stored "08:00:00".
function clock(time: string | null): string | null {
  const minutes = timeToMinutes(time)
  return minutes === null ? null : formatClock(Math.floor(minutes / 60), minutes % 60)
}

function MyAttendanceSection() {
  const { employeeId } = useAuth()
  const today = toManilaDate(new Date())
  const thisWeekStart = weekStartOf(today)
  const [weekStart, setWeekStart] = useState(thisWeekStart)
  const [records, setRecords] = useState<Map<string, AttendanceRecord>>(new Map())
  // This month's records, for the tiles.
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => shiftDate(weekStart, i))
  const month = today.slice(0, 7)

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

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    void loadAttendanceRecords(`${month}-01`, today, employeeId).then(({ records: loaded }) => {
      if (!cancelled) setMonthRecords(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [employeeId, month, today])

  if (!employeeId) {
    return <p className="text-ink-muted">Your account has no linked employee record, so there is no attendance to show.</p>
  }

  // Day over + no record = Absent; today/future + no record = not marked yet.
  const statusOf = (date: string) => records.get(date)?.attendance_status ?? (date < today ? 'Absent' : null)

  // Month so far: recorded days by status, plus finished days with no record (Absent).
  const monthName = fmt(`${month}-01`, { month: 'long' })
  const monthCounts = (() => {
    if (!monthRecords) return null
    const byDate = new Map(monthRecords.map((r) => [r.attendance_date, r.attendance_status]))
    let present = 0
    let leave = 0
    let absent = 0
    for (let d = `${month}-01`; d <= today; d = shiftDate(d, 1)) {
      const status = byDate.get(d) ?? (d < today ? 'Absent' : null)
      if (status === 'Present') present += 1
      else if (status === 'Leave' || status === 'Unpaid Leave') leave += 1
      else if (status === 'Absent') absent += 1
    }
    return { present, leave, absent }
  })()

  const tiles = [
    { label: `Present in ${monthName}`, value: monthCounts?.present, dot: 'bg-green-700' },
    { label: `Leave in ${monthName}`, value: monthCounts?.leave, dot: 'bg-primary' },
    { label: `Absent in ${monthName}`, value: monthCounts?.absent, dot: 'bg-red-700' },
  ]

  return (
    <div>
      <PageHeader
        title={
          <>
            My Attendance{' '}
            <span className="ml-1 rounded-[2px] bg-slate-200 px-2 py-0.5 align-middle text-xs font-semibold text-ink-secondary">View only</span>
          </>
        }
        subtitle="You're paid weekly by attendance. A finished day with nothing recorded counts as Absent. More than 8 hours in a day adds an Overtime line to your payslip."
      />

      <section aria-label={`${monthName} totals`} className="mb-4 grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="card px-[18px] py-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-ink-secondary">
              <span className={`h-2.5 w-2.5 ${tile.dot}`} aria-hidden="true" />
              {tile.label}
            </p>
            <p className="text-[28px] leading-9 font-bold tracking-[-0.01em] text-ink tabular-nums">
              {tile.value === undefined ? '…' : `${tile.value} ${tile.value === 1 ? 'day' : 'days'}`}
            </p>
          </div>
        ))}
      </section>

      {error && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section aria-labelledby="week-h" className="card flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 id="week-h" className="text-base font-semibold text-ink">
              {fmt(days[0], { month: 'short', day: 'numeric' })} – {fmt(days[6], { month: 'short', day: 'numeric' })}, {days[6].slice(0, 4)}
            </h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setWeekStart(shiftDate(weekStart, -7))} className="btn-secondary px-3.5 text-sm font-medium">
                ‹ Previous Week
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(thisWeekStart)}
                disabled={weekStart === thisWeekStart}
                className="btn-secondary px-3.5 text-sm font-medium"
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(shiftDate(weekStart, 7))}
                disabled={weekStart >= thisWeekStart}
                className="btn-secondary px-3.5 text-sm font-medium"
              >
                Next Week ›
              </button>
            </div>
          </div>
          {loading ? (
            <p className="px-5 py-4 text-ink-muted">Loading attendance...</p>
          ) : (
            <ul>
              {days.map((date) => {
                const status = statusOf(date)
                const rec = records.get(date)
                const timeIn = clock(rec?.time_in ?? null)
                const timeOut = clock(rec?.time_out ?? null)
                const ot = timeIn && timeOut ? overtimeHours(rec?.hours_worked ?? null) : 0
                const note =
                  date === today && !status
                    ? 'Today · not marked yet'
                    : date > today
                      ? 'Not yet'
                      : timeIn && timeOut
                        ? `${timeIn} – ${timeOut} · ${rec?.hours_worked ?? 0} h${ot > 0 ? ` · OT ${ot} h` : ''}`
                        : date === today
                          ? 'Today'
                          : ''
                return (
                  <li
                    key={date}
                    className={`grid min-h-16 grid-cols-[130px_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200 px-5 text-sm last:border-0 ${
                      date === today ? 'bg-primary-soft' : ''
                    }`}
                  >
                    <span className="font-semibold text-ink">{fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    <span className={`text-ink-muted ${ot > 0 ? 'font-medium text-primary' : ''}`}>{note}</span>
                    {status ? (
                      <StatusBadge status={status} icon />
                    ) : (
                      <span className="rounded-[2px] bg-slate-200 px-2 py-0.5 text-xs font-semibold text-ink-secondary">Upcoming</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <MyAttendanceCalendar employeeId={employeeId} today={today} />
      </div>
    </div>
  )
}

export default MyAttendanceSection
