// AttendanceDayTable: the Attendance page's Day view (the canvas's
// Attendance board) -- one row per staff member for one day: Time In, Time
// Out, Total Hours, Overtime and Status. Times are optional: a day can still
// just be marked Present (8 hours, no overtime). Entering times makes the
// row Present and works out the hours live (lib/attendanceHours.ts: minus
// 1 hour lunch, overtime above 8). Nothing saves until "Save Attendance",
// which hands every changed row to the page (AttendanceSection does the
// saving and the "already on a payslip" warning).
import { useState } from 'react'
import TimeInput12 from '../../../components/TimeInput12'
import StatusBadge from '../../../components/StatusBadge'
import { overtimeHours, timeToMinutes, workedHours } from '../../../lib/attendanceHours'
import type { AttendanceRecord, AttendanceStatus } from '../../../lib/employeeAttendance'

export type DayChange = {
  employeeId: number
  status: AttendanceStatus
  timeIn: number | null
  timeOut: number | null
}

type Draft = { status: AttendanceStatus | ''; timeIn: number | null; timeOut: number | null }

// Times a new row starts with when "Add times" is clicked: 8 AM - 5 PM.
const DEFAULT_IN = 8 * 60
const DEFAULT_OUT = 17 * 60

const STATUS_STYLE: Record<string, string> = {
  Present: 'border-primary bg-primary text-white',
  Absent: 'border-red-300 bg-red-50 text-red-800',
  Leave: 'border-line-control bg-primary-soft text-primary',
  'Unpaid Leave': 'border-amber-600 bg-amber-100 text-amber-900',
}

function AttendanceDayTable({
  date,
  today,
  employees,
  records,
  busy,
  onSave,
}: {
  date: string
  today: string
  employees: { employee_id: number; full_name: string; position: string }[]
  // `${employee_id}|${date}` -> saved row
  records: Map<string, AttendanceRecord>
  busy: boolean
  onSave: (changes: DayChange[]) => void
}) {
  const future = date > today
  const saved = (employeeId: number): Draft => {
    const rec = records.get(`${employeeId}|${date}`)
    return {
      status: rec?.attendance_status ?? '',
      timeIn: timeToMinutes(rec?.time_in ?? null),
      timeOut: timeToMinutes(rec?.time_out ?? null),
    }
  }
  // Edits not saved yet, per employee (the page remounts this per day / reload).
  const [drafts, setDrafts] = useState<Map<number, Draft>>(new Map())
  const current = (employeeId: number) => drafts.get(employeeId) ?? saved(employeeId)
  const edit = (employeeId: number, change: Partial<Draft>) =>
    setDrafts((prev) => new Map(prev).set(employeeId, { ...current(employeeId), ...change }))

  const changed = employees.filter((e) => {
    const d = drafts.get(e.employee_id)
    if (!d) return false
    const s = saved(e.employee_id)
    return d.status !== s.status || d.timeIn !== s.timeIn || d.timeOut !== s.timeOut
  })
  const recordedCount = employees.filter((e) => current(e.employee_id).status !== '').length

  function save() {
    onSave(
      changed
        .map((e) => ({ employeeId: e.employee_id, ...current(e.employee_id) }))
        .filter((c): c is DayChange => c.status !== ''),
    )
  }

  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'

  return (
    <section aria-label={`Staff attendance for ${date}`} className="card flex min-h-[calc(100dvh-15rem)] flex-col">
      <div className="flex-1 overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm text-ink-metric">
          <thead>
            <tr>
              <th className={TH}>Employee</th>
              <th className={TH}>Time In</th>
              <th className={TH}>Time Out</th>
              <th className={`${TH} text-right`}>Total Hours</th>
              <th className={`${TH} text-right`}>Overtime</th>
              <th className={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const d = current(e.employee_id)
              const hasTimes = d.timeIn !== null && d.timeOut !== null
              const hours = hasTimes ? workedHours(d.timeIn!, d.timeOut!) : d.status === 'Present' ? 8 : null
              const ot = hasTimes ? overtimeHours(hours) : 0
              const isChanged = changed.some((c) => c.employee_id === e.employee_id)
              return (
                <tr key={e.employee_id} className={`h-16 border-b border-slate-200 ${isChanged ? 'bg-primary-soft' : ''}`}>
                  <td className={TD}>
                    <span className="block font-semibold text-ink">{e.full_name}</span>
                    <span className="block text-[13px] text-ink-muted">{e.position}</span>
                  </td>
                  {hasTimes ? (
                    <>
                      <td className={TD}>
                        <TimeInput12
                          label={`Time in, ${e.full_name}`}
                          value={d.timeIn!}
                          onChange={(m) => edit(e.employee_id, { timeIn: m, status: 'Present' })}
                        />
                      </td>
                      <td className={TD}>
                        <span className="flex items-center gap-2">
                          <TimeInput12
                            label={`Time out, ${e.full_name}`}
                            value={d.timeOut!}
                            onChange={(m) => edit(e.employee_id, { timeOut: m, status: 'Present' })}
                          />
                          <button
                            type="button"
                            onClick={() => edit(e.employee_id, { timeIn: null, timeOut: null })}
                            aria-label={`Clear times for ${e.full_name}`}
                            title="Clear times"
                            className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
                          >
                            ✕
                          </button>
                        </span>
                      </td>
                    </>
                  ) : (
                    <td className={TD} colSpan={2}>
                      <button
                        type="button"
                        disabled={future || busy}
                        onClick={() => edit(e.employee_id, { timeIn: DEFAULT_IN, timeOut: DEFAULT_OUT, status: 'Present' })}
                        className="btn-secondary px-4 text-sm font-medium"
                      >
                        Add time in / out
                      </button>
                    </td>
                  )}
                  <td className={`${TD} text-right font-semibold tabular-nums ${hours === null ? 'text-ink-muted' : ''}`}>
                    {hours === null ? '— h' : `${hours} h`}
                  </td>
                  <td className={`${TD} text-right tabular-nums ${ot > 0 ? 'font-semibold text-primary' : 'text-ink-muted'}`}>
                    {ot > 0 ? `${ot} h` : '— h'}
                  </td>
                  <td className={TD}>
                    {future ? (
                      <StatusBadge status="Not Set Up" label="Not yet" />
                    ) : (
                      <select
                        value={d.status}
                        disabled={busy}
                        aria-label={`Status, ${e.full_name}`}
                        onChange={(event) => {
                          const status = event.target.value as AttendanceStatus
                          // Only a Present day keeps its times.
                          edit(e.employee_id, status === 'Present' ? { status } : { status, timeIn: null, timeOut: null })
                        }}
                        className={`min-h-11 rounded-[2px] border px-2 py-1 text-sm font-medium ${
                          STATUS_STYLE[d.status] ?? 'border-line-control bg-white text-ink-metric'
                        }`}
                      >
                        {d.status === '' && <option value="">Not recorded</option>}
                        <option>Present</option>
                        <option value="Leave">Leave (paid)</option>
                        <option>Unpaid Leave</option>
                        <option>Absent</option>
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
        <span>
          {employees.length} staff · {recordedCount} of {employees.length} recorded
          {changed.length > 0 && ` · ${changed.length} not saved yet`}
        </span>
        <span className="flex gap-2">
          {changed.length > 0 && (
            <button type="button" onClick={() => setDrafts(new Map())} disabled={busy} className="btn-secondary px-4 text-sm font-medium">
              Undo Changes
            </button>
          )}
          <button type="button" onClick={save} disabled={busy || future || changed.length === 0} className="btn-primary flex items-center gap-2 px-5 text-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
            {busy ? 'Saving...' : 'Save Attendance'}
          </button>
        </span>
      </div>
    </section>
  )
}

export default AttendanceDayTable
