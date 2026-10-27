// MyAttendanceCalendar: a month calendar next to the week list on the
// "My Attendance" page. Each finished day shows its status -- Present
// (green), Leave (blue), Absent (red; also a finished day with nothing
// recorded) -- and today is outlined. Read-only; loads its own month of
// records, ‹ › to change month (not past this month).
import { useEffect, useState } from 'react'
import { loadAttendanceRecords, type AttendanceStatus } from '../../../lib/employeeAttendance'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Move a YYYY-MM month by N months (noon UTC avoids timezone edges).
function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return d.toISOString().slice(0, 7)
}

const CELL_STYLE: Record<string, string> = {
  Present: 'bg-green-100 text-green-900',
  Leave: 'bg-primary-soft text-primary',
  'Unpaid Leave': 'bg-amber-100 text-amber-900',
  Absent: 'bg-red-50 text-red-800',
}

function MyAttendanceCalendar({ employeeId, today }: { employeeId: number; today: string }) {
  const thisMonth = today.slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [statusByDate, setStatusByDate] = useState<Map<string, AttendanceStatus>>(new Map())

  const first = new Date(`${month}-01T12:00:00Z`)
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const blanks = first.getUTCDay() // empty cells before the 1st (week starts Sunday)
  const monthLabel = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { records } = await loadAttendanceRecords(`${month}-01`, `${month}-${String(daysInMonth).padStart(2, '0')}`, employeeId)
      if (cancelled) return
      setStatusByDate(new Map(records.map((r) => [r.attendance_date, r.attendance_status])))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [employeeId, month, daysInMonth])

  const squareButton =
    'flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-line disabled:text-ink-muted'

  return (
    <section aria-labelledby="month-h" className="card flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id="month-h" className="text-base font-semibold text-ink">
          {monthLabel}
        </h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className={squareButton}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month" className={squareButton}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1 text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase">
              {d}
            </div>
          ))}
        </div>
        <div role="grid" aria-label={monthLabel} className="grid grid-cols-7 gap-1 text-center">
          {Array.from({ length: blanks }, (_, i) => (
            <div key={`b${i}`} className="min-h-14 bg-slate-50" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, '0')}`
            // Day over + no record = Absent, same rule as the week list.
            const status = statusByDate.get(date) ?? (date < today ? 'Absent' : null)
            const isToday = date === today
            return (
              <div
                key={date}
                role="gridcell"
                aria-label={`${date}${status ? `: ${status}` : ''}`}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 border border-slate-200 ${
                  status ? CELL_STYLE[status] : 'bg-white text-ink-muted'
                } ${isToday ? 'outline-2 -outline-offset-2 outline-primary' : ''}`}
              >
                <span className={`text-sm ${isToday ? 'font-bold' : 'font-semibold'}`}>{i + 1}</span>
                <span className="text-[11px] leading-[14px] font-medium">{isToday && !status ? 'Today' : (status ?? '')}</span>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-muted">
          <span className="rounded-[2px] bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-900">Present</span>
          <span className="rounded-[2px] bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">Leave</span>
          <span className="rounded-[2px] bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800">Absent</span>
          <span>Today is outlined.</span>
        </div>
      </div>
    </section>
  )
}

export default MyAttendanceCalendar
