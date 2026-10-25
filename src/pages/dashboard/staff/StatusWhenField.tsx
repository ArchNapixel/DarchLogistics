// StatusWhenField: date + 12-hour time pickers for "When did it happen?" on a
// status change (StatusTimeModal, MarkDeliveredModal). The value is epoch ms;
// it defaults to now, and the "Now" link puts it back.
import TimeInput12 from '../../../components/TimeInput12'
import { manilaTimestamp, splitManila } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { nowRounded } from '../../../lib/statusTime'

function StatusWhenField({
  value,
  onChange,
  label = 'When did it happen?',
}: {
  value: number
  onChange: (ms: number) => void
  label?: string
}) {
  const parts = splitManila(value)
  const toMs = (date: string, minutes: number) => new Date(manilaTimestamp(date, minutes)).getTime()

  return (
    <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      {label}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          aria-label={`${label} (date)`}
          value={parts.date}
          max={toManilaDate(new Date())}
          onChange={(e) => e.target.value && onChange(toMs(e.target.value, parts.minutes))}
          className="border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11"
        />
        <TimeInput12 label={`${label} (time)`} value={parts.minutes} onChange={(minutes) => onChange(toMs(parts.date, minutes))} />
        <button type="button" onClick={() => onChange(nowRounded())} className="text-xs font-medium text-slate-600 underline hover:text-slate-900">
          Now
        </button>
      </div>
    </div>
  )
}

export default StatusWhenField
