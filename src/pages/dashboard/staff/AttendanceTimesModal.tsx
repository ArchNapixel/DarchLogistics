// AttendanceTimesModal: the Attendance week table's "Edit times"
// pop-up for one Present day -- Time In and Time Out only. Hours and
// overtime aren't shown here on purpose (they only show on the payslip);
// AttendanceSection works them out when saving (lib/attendanceHours.ts).
// "Clear times" goes back to a plain Present day (8 hours).
import { useState } from 'react'
import TimeInput12 from '../../../components/TimeInput12'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { workedHours } from '../../../lib/attendanceHours'

// A new day starts at 8 AM - 5 PM.
const DEFAULT_IN = 8 * 60
const DEFAULT_OUT = 17 * 60
// Longer than this is usually AM/PM picked wrong (8 AM -> 5 AM = 20 h).
const MAX_NORMAL_HOURS = 14

export type AttendanceTimes = { timeIn: number | null; timeOut: number | null }

function AttendanceTimesModal({
  employeeName,
  dateLabel,
  timeIn,
  timeOut,
  busy,
  onSave,
  onClose,
}: {
  employeeName: string
  dateLabel: string
  // Saved times in minutes after midnight, null when none yet.
  timeIn: number | null
  timeOut: number | null
  busy: boolean
  onSave: (times: AttendanceTimes) => void
  onClose: () => void
}) {
  const hadTimes = timeIn !== null && timeOut !== null
  const [inMin, setInMin] = useState(timeIn ?? DEFAULT_IN)
  const [outMin, setOutMin] = useState(timeOut ?? DEFAULT_OUT)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    // Same time in and out would be read as a 23-hour night shift -- always a typo.
    if (inMin === outMin) {
      setError('Time in and time out are the same. Fix the times first.')
      return
    }
    if (workedHours(inMin, outMin) > MAX_NORMAL_HOURS) {
      const ok = await confirmDialog({
        title: 'Check these times',
        message:
          `That's a shift of more than ${MAX_NORMAL_HOURS} hours, counted as going past midnight, with the extra paid as overtime. ` +
          'Check AM / PM before saving.',
        confirmLabel: 'Save anyway',
        danger: true,
      })
      if (!ok) return
    }
    onSave({ timeIn: inMin, timeOut: outMin })
  }

  const label = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="attendance-times-title" className="card flex w-full max-w-md flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id="attendance-times-title" className="text-lg font-bold text-ink">Time In / Out</h2>
            <p className="text-[13px] text-ink-muted">{employeeName} · {dateLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            ✕
          </button>
        </header>

        <div className="grid gap-4 px-6 py-5">
          <div className={label}>
            Time in
            <TimeInput12 label={`Time in, ${employeeName}`} value={inMin} onChange={setInMin} />
          </div>
          <div className={label}>
            Time out
            <TimeInput12 label={`Time out, ${employeeName}`} value={outMin} onChange={setOutMin} />
          </div>
          {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <footer className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">
          {hadTimes && (
            <button
              type="button"
              onClick={() => onSave({ timeIn: null, timeOut: null })}
              disabled={busy}
              className="btn-secondary mr-auto px-5 text-sm font-medium"
            >
              Clear times
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} className="btn-primary px-6 text-sm">
            {busy ? 'Saving...' : 'Save Times'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AttendanceTimesModal
