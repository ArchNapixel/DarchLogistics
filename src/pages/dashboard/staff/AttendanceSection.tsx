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
// Day view (the canvas's board): one day, with Time In / Time Out per person.
// Hours = out - in - 1 h lunch, overtime above 8 (lib/attendanceHours.ts);
// payroll pays that overtime. A Present day with no times still counts as 8
// hours, no overtime. The week view keeps a day's times when re-picking Present.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePaged } from '../../../lib/usePaged'
import { useAuth } from '../../../context/AuthContext'
import { loadAttendanceRecords, saveAttendanceRecord, type AttendanceRecord, type AttendanceStatus } from '../../../lib/employeeAttendance'
import { toManilaDate } from '../../../lib/payslip'
import { supabase } from '../../../lib/supabaseClient'
import LeaveRequestsSection from './LeaveRequestsSection'
import PageHeader from '../../../components/PageHeader'
import EmptyState from '../../../components/EmptyState'
import { confirmDialog } from '../../../components/ConfirmDialog'
import AttendanceDayTable, { type DayChange } from './AttendanceDayTable'
import { minutesToTime, overtimeHours, workedHours } from '../../../lib/attendanceHours'

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

// "How days are counted" -- the side panel's rules (same as payroll's).
const COUNT_RULES: [string, string][] = [
  ['Present', 'Paid day (8 hours if no times)'],
  ['Hours', 'Time out − time in − 1 h lunch'],
  ['Overtime', 'Hours above 8, paid × 1.25'],
  ['Leave (paid)', 'Paid -- uses the yearly leave balance'],
  ['Unpaid Leave', 'Approved, not paid'],
  ['Absent', 'Not paid'],
  ['Not marked', 'Counts as Absent once the day is over'],
]

// Drivers aren't on this sheet (they're paid per trip) -- the panel lists
// who has trips today instead.
function DriversToday({ today }: { today: string }) {
  const [rows, setRows] = useState<{ name: string; trips: number[] }[] | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: trips } = await supabase
        .from('itineraries')
        .select('itinerary_id')
        .eq('trip_date_from', today)
        .neq('itinerary_status', 'Cancelled')
      const tripIds = (trips ?? []).map((t) => t.itinerary_id)
      const { data: crew } = tripIds.length
        ? await supabase
            .from('itinerary_crews')
            .select('itinerary_id, employee_id')
            .eq('crew_role', 'Driver')
            .eq('is_active', true)
            .in('itinerary_id', tripIds)
        : { data: [] as { itinerary_id: number; employee_id: number }[] }
      const ids = [...new Set((crew ?? []).map((c) => c.employee_id))]
      const { data: people } = ids.length
        ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', ids)
        : { data: [] as { employee_id: number; full_name: string }[] }
      if (cancelled) return
      setRows(
        (people ?? [])
          .map((p) => ({
            name: p.full_name,
            trips: (crew ?? []).filter((c) => c.employee_id === p.employee_id).map((c) => c.itinerary_id).sort((a, b) => a - b),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    }
    load()
    return () => {
      cancelled = true
    }
  }, [today])

  return (
    <section>
      <h2 className="mb-1 border-b border-line pb-2 text-sm font-semibold text-ink">Drivers today</h2>
      {rows === null ? (
        <p className="py-2 text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="py-2 text-sm text-ink-muted">No driver has a trip today.</p>
      ) : (
        rows.map((r) => (
          <div key={r.name} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm">
            <span className="text-ink-secondary">{r.name}</span>
            <span className="font-semibold tabular-nums">
              {r.trips.length === 1 ? 'Trip' : 'Trips'} {r.trips.map((id) => `#${id}`).join(', ')}
            </span>
          </div>
        ))
      )}
      <Link to="/dashboard/schedule-overview" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
        Open Schedule Overview
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12h14 M13 6l6 6-6 6" />
        </svg>
      </Link>
    </section>
  )
}

function AttendanceSection() {
  const { employeeId: recorderId } = useAuth()
  const today = toManilaDate(new Date())
  const thisWeekStart = weekStartOf(today)
  const [view, setView] = useState<'day' | 'week'>('day')
  // The day the Day view shows; the loaded week is always the one holding it.
  const [day, setDayState] = useState(today)
  const [weekStart, setWeekStartState] = useState(thisWeekStart)
  function setDay(date: string) {
    setDayState(date)
    setWeekStartState(weekStartOf(date))
  }
  // Week arrows move the day by a week (never past today).
  const setWeekStart = (start: string) => setDay(start >= thisWeekStart ? today : start)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<Map<string, AttendanceRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

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

  // Present with no times saves 8 hours; with times, the worked hours
  // (minus lunch). Picking Present in the week view keeps a day's saved times.
  function save(employeeId: number, date: string, status: AttendanceStatus, times?: { timeIn: number | null; timeOut: number | null }) {
    const rec = records.get(`${employeeId}|${date}`)
    const timeIn = times ? (times.timeIn === null ? null : minutesToTime(times.timeIn)) : (rec?.time_in ?? null)
    const timeOut = times ? (times.timeOut === null ? null : minutesToTime(times.timeOut)) : (rec?.time_out ?? null)
    const hasTimes = timeIn !== null && timeOut !== null
    return saveAttendanceRecord({
      employeeId,
      attendanceDate: date,
      status,
      hoursWorked:
        status !== 'Present'
          ? null
          : !hasTimes
            ? DEFAULT_HOURS
            : times
              ? workedHours(times.timeIn!, times.timeOut!)
              : (rec?.hours_worked ?? DEFAULT_HOURS),
      timeIn: hasTimes ? timeIn : null,
      timeOut: hasTimes ? timeOut : null,
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

  async function handleMark(employeeId: number, date: string, status: AttendanceStatus) {
    // A day already counted on a payslip: changing it here does NOT change
    // that payslip, so make sure that's understood first.
    if (records.get(`${employeeId}|${date}`)?.paid_payroll_id != null) {
      const ok = await confirmDialog({
        title: 'This day is already on a payslip',
        message:
          `Changing it to ${status} won't change the payslip that already paid it. ` +
          'If that payslip is still a draft, use Regenerate on the Payroll page afterwards; ' +
          'if it is finalized, correct the pay by hand.',
        confirmLabel: 'Change anyway',
        danger: true,
      })
      if (!ok) return
    }
    return runSaves(recorderId ? [save(employeeId, date, status)] : [])
  }

  // Day view's "Save Attendance": every changed row in one go.
  async function handleSaveDay(changes: DayChange[]) {
    if (changes.length === 0) return
    const onPayslip = changes.filter((c) => records.get(`${c.employeeId}|${day}`)?.paid_payroll_id != null)
    if (onPayslip.length > 0) {
      const ok = await confirmDialog({
        title: onPayslip.length === 1 ? 'One of these days is already on a payslip' : `${onPayslip.length} of these days are already on a payslip`,
        message:
          "Changing them won't change the payslip that already paid them. " +
          'If that payslip is still a draft, use Regenerate on the Payroll page afterwards; ' +
          'if it is finalized, correct the pay by hand.',
        confirmLabel: 'Save anyway',
        danger: true,
      })
      if (!ok) return
    }
    return runSaves(recorderId ? changes.map((c) => save(c.employeeId, day, c.status, c)) : [])
  }

  function handleAllPresent(date: string) {
    const unmarked = employees.filter((e) => !records.has(`${e.employee_id}|${date}`))
    return runSaves(recorderId ? unmarked.map((e) => save(e.employee_id, date, 'Present')) : [])
  }

  // One page at a time (back to page 1 when the filters change).
  const paged = usePaged(employees, weekStart)
  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Record time in / out or mark Present, Leave or Absent. Drivers are paid per trip and aren't on this sheet."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="View" className="flex gap-2">
              {(['day', 'week'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`min-h-11 rounded-[2px] border-2 px-4 text-sm font-semibold ${
                    view === v ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-secondary hover:bg-slate-50'
                  }`}
                >
                  {v === 'day' ? 'Day' : 'Week'}
                </button>
              ))}
            </div>
            <button
              onClick={() => (view === 'day' ? setDay(shiftDate(day, -1)) : setWeekStart(shiftDate(weekStart, -7)))}
              aria-label={view === 'day' ? 'Previous day' : 'Previous week'}
              className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            {/* The week: click it to pick any date (no future dates). */}
            <button
              type="button"
              onClick={() => {
                const input = dateInputRef.current
                if (!input) return
                try {
                  input.showPicker()
                } catch {
                  input.focus()
                }
              }}
              className="flex h-11 items-center gap-2 border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-slate-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary" aria-hidden="true">
                <path d="M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M8 2v4 M16 2v4" />
              </svg>
              {view === 'day' ? (
                <>
                  {day === today ? 'Today · ' : ''}
                  {new Date(`${day}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                </>
              ) : (
                <>
                  {weekStart === thisWeekStart ? 'This week · ' : ''}
                  {formatShort(weekStart)} – {formatShort(weekEnd)}, {weekEnd.slice(0, 4)}
                </>
              )}
            </button>
            <input
              ref={dateInputRef}
              type="date"
              aria-label="Jump to date"
              max={today}
              value={view === 'day' ? day : weekStart}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="sr-only"
            />
            <button
              onClick={() => (view === 'day' ? setDay(shiftDate(day, 1)) : setWeekStart(shiftDate(weekStart, 7)))}
              disabled={view === 'day' ? day >= today : weekStart >= thisWeekStart}
              aria-label={view === 'day' ? 'Next day' : 'Next week'}
              className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-muted"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            {(view === 'day' ? day !== today : weekStart !== thisWeekStart) && (
              <button onClick={() => setDay(today)} className="btn-secondary px-4 text-sm font-medium">
                {view === 'day' ? 'Today' : 'This Week'}
              </button>
            )}
          </div>
        }
      />

      {error && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
      {loading ? (
        <p className="text-ink-muted">Loading attendance...</p>
      ) : employees.length === 0 ? (
        <EmptyState message="No active employees." />
      ) : view === 'day' ? (
        // Remounted per day and after each reload, so unsaved edits start clean.
        <AttendanceDayTable
          key={`${day}|${records.size}|${[...records.values()].map((r) => r.attendance_id).join(',')}`}
          date={day}
          today={today}
          employees={employees}
          records={records}
          busy={busy}
          onSave={(changes) => void handleSaveDay(changes)}
        />
      ) : (
        <section aria-label="Staff attendance" className="card flex min-h-[calc(100dvh-15rem)] flex-col">
          <div className="flex-1 overflow-x-auto">
          <table className="w-full text-left text-sm text-ink-metric">
            <thead>
              <tr>
                <th className="px-5 py-2.5">Employee</th>
                {days.map((date, i) => (
                  <th key={date} className="px-2 py-2.5 text-center">
                    <div className={date === today ? 'text-primary' : ''}>{DAY_NAMES[i]} {formatShort(date).split(' ')[1]}</div>
                    {/* Not on Sundays: weekly salary pays (salary / 6) per
                        day present, so a whole-staff Sunday click would pay
                        everyone 7/6 of a week. A real Sunday shift can still
                        be marked per person. */}
                    {date <= today && i !== 0 && (
                      <button onClick={() => void handleAllPresent(date)} disabled={busy} className="mt-1 text-xs font-medium tracking-normal text-primary normal-case underline disabled:opacity-50">All present</button>
                    )}
                  </th>
                ))}
                <th className="px-5 py-2.5 text-center">Days present</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((e) => {
                let presentDays = 0
                return (
                  <tr key={e.employee_id} className="h-[60px] border-b border-slate-200">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-ink">{e.full_name}</div>
                      <div className="text-[13px] text-ink-muted">{e.position}</div>
                    </td>
                    {days.map((date) => {
                      const rec = records.get(`${e.employee_id}|${date}`)
                      // Day over + no record = Absent; today/future + no record = blank.
                      const shown: AttendanceStatus | '' = rec?.attendance_status ?? (date < today ? 'Absent' : '')
                      if (shown === 'Present') presentDays += 1
                      const ot = rec?.time_in && rec.time_out ? overtimeHours(rec.hours_worked) : 0
                      return (
                        <td key={date} className="px-2 py-3 text-center">
                          <select
                            value={shown}
                            disabled={busy || date > today}
                            onChange={(event) => void handleMark(e.employee_id, date, event.target.value as AttendanceStatus)}
                            className={`min-h-11 rounded-[2px] border px-1 py-1 text-sm font-medium disabled:opacity-60 ${
                              shown === 'Present'
                                ? 'border-primary bg-primary text-white'
                                : shown === 'Absent'
                                  ? 'border-red-300 bg-red-50 text-red-800'
                                  : shown === 'Leave'
                                    ? 'border-line-control bg-primary-soft text-primary'
                                    : shown === 'Unpaid Leave'
                                      ? 'border-amber-600 bg-amber-100 text-amber-900'
                                      : 'border-line-control bg-white text-ink-metric'
                            }`}
                          >
                            {shown === '' && <option value="">—</option>}
                            <option>Present</option>
                            <option value="Leave">Leave (paid)</option>
                            <option>Unpaid Leave</option>
                            <option>Absent</option>
                          </select>
                          {shown === 'Present' && rec?.time_in && rec.time_out && (
                            <div className="mt-0.5 text-xs text-ink-muted tabular-nums">
                              {rec.hours_worked} h{ot > 0 && <span className="font-semibold text-primary"> · OT {ot}</span>}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-5 py-3 text-center font-semibold tabular-nums">{presentDays}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
            <span>
              {employees.length} staff
              {days.includes(today) &&
                ` · ${employees.filter((e) => records.has(`${e.employee_id}|${today}`)).length} of ${employees.length} marked today`}
            </span>
            {paged.pager.pageCount > 1 && (
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                  disabled={paged.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                  disabled={paged.pager.page >= paged.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            )}
          </div>
        </section>
      )}

        <aside className="card flex flex-col gap-5 px-5 py-4">
          <section>
            <h2 className="mb-1 border-b border-line pb-2 text-sm font-semibold text-ink">How days are counted</h2>
            {COUNT_RULES.map(([status, rule]) => (
              <div key={status} className="flex items-baseline justify-between gap-3 border-b border-slate-200 py-2 text-sm">
                <span className="text-ink-secondary">{status}</span>
                <span className="text-right font-semibold">{rule}</span>
              </div>
            ))}
            <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
              Day view saves with Save Attendance; the week view saves as soon as you pick. A day already on a payslip doesn't change that payslip -- use Regenerate on Payroll.
            </p>
          </section>
          <DriversToday today={today} />
        </aside>
      </div>

      {/* Pending leave requests -- approving one marks its days as Leave above. */}
      <div className="mt-6">
        <LeaveRequestsSection onDecided={() => void load()} />
      </div>
    </div>
  )
}

export default AttendanceSection
