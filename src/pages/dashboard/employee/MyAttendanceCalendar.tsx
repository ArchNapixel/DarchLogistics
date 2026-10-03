// MyAttendanceCalendar: a month calendar next to the weekly table on the
// "My Attendance" page. A day is highlighted green when the logged-in
// employee was marked Present. Read-only; loads its own month of records.
import { useEffect, useState } from 'react'
import { loadAttendanceRecords } from '../../../lib/employeeAttendance'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Move a YYYY-MM month by N months (noon UTC avoids timezone edges).
function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + by)
  return d.toISOString().slice(0, 7)
}

function MyAttendanceCalendar({ employeeId, today }: { employeeId: number; today: string }) {
  const thisMonth = today.slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [presentDates, setPresentDates] = useState<Set<string>>(new Set())

  const first = new Date(`${month}-01T12:00:00Z`)
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const blanks = first.getUTCDay() // empty cells before the 1st (week starts Sunday)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { records } = await loadAttendanceRecords(`${month}-01`, `${month}-${String(daysInMonth).padStart(2, '0')}`, employeeId)
      if (cancelled) return
      setPresentDates(new Set(records.filter((r) => r.attendance_status === 'Present').map((r) => r.attendance_date)))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [employeeId, month, daysInMonth])

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50">&larr;</button>
        <span className="text-sm font-semibold text-slate-900">
          {first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
        </span>
        <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">&rarr;</button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-sm">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1 text-xs font-medium text-slate-500">{d}</div>
        ))}
        {Array.from({ length: blanks }, (_, i) => (
          <div key={`b${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`
          const present = presentDates.has(date)
          return (
            <div
              key={date}
              className={`rounded-lg py-2 ${
                present ? 'bg-green-500 font-semibold text-white' : 'text-slate-700'
              } ${date === today && !present ? 'border border-slate-900' : ''}`}
            >
              {i + 1}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default MyAttendanceCalendar
