// ScheduleTimeline: the grid used by every Schedule Overview tab -- a time
// axis, one row per person/truck/..., trips drawn as bars and grey bands
// (leave, maintenance) behind them. Pure drawing: the page decides the
// window (from/to), the rows come from lib/scheduleData.ts. Clicking a bar
// opens that trip on Bookings & Trips.
//
// A trip on the road past its end is drawn up to "now" and red (Overdue).
// The red line with the "Now" tag is the current time.
import { useNavigate } from 'react-router-dom'
import { formatClock, formatSlot, formatTime } from '../../../lib/format'
import { DAY_MS, DAY_START_HOUR, HOUR_MS, type TimelineRow } from '../../../lib/scheduleData'
import { busyUntil, isOverdue } from '../../../lib/tripSchedule'
import { storageState } from '../../../lib/storageDeadline'

// One clear colour per status, each with a border so neighbouring bars
// stay separate. Awaiting is an outline (not started yet).
const BAR_STYLES: Record<string, string> = {
  Awaiting: 'border-slate-400 bg-white text-slate-700',
  Dispatched: 'border-amber-400 bg-amber-100 text-amber-900',
  PickedUp: 'border-sky-500 bg-sky-100 text-sky-900',
  InTransit: 'border-sky-800 bg-sky-700 text-white',
  Delivered: 'border-green-500 bg-green-100 text-green-900',
}
const OVERDUE_STYLE = 'border-red-800 bg-red-600 text-white'

type Props = {
  rows: TimelineRow[]
  // First column header, e.g. "Driver".
  columnLabel: string
  view: 'day' | 'week'
  from: number
  to: number
  now: number
}

function ScheduleTimeline({ rows, columnLabel, view, from, to, now }: Props) {
  const navigate = useNavigate()
  const pct = (t: number) => ((Math.min(Math.max(t, from), to) - from) / (to - from)) * 100
  const ticks =
    view === 'day'
      ? Array.from({ length: 8 }, (_, i) => ({
          at: from + i * 3 * HOUR_MS,
          label: formatClock((DAY_START_HOUR + i * 3) % 24, 0),
        }))
      : Array.from({ length: 7 }, (_, i) => ({
          at: from + i * DAY_MS,
          label: new Date(from + i * DAY_MS + 12 * HOUR_MS).toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'Asia/Manila',
          }),
        }))
  // Faint hour lines between the labelled ones (every 6 h in week view).
  const minorStep = view === 'day' ? HOUR_MS : 6 * HOUR_MS
  const minorLines = Array.from({ length: Math.round((to - from) / minorStep) }, (_, i) => from + i * minorStep)
  const nowInWindow = now >= from && now < to

  return (
    <>
      <div className="mt-4 overflow-x-auto border border-slate-200 bg-white">
        <div className="min-w-[760px]">
          {/* Time axis */}
          <div className="flex border-b-2 border-slate-300 bg-slate-50 text-xs font-medium text-slate-600">
            <div className="w-44 shrink-0 border-r border-slate-300 px-3 py-2.5 font-semibold text-slate-800">{columnLabel}</div>
            <div className="relative h-10 flex-1">
              {ticks.map((t) => (
                <span key={t.at} className="absolute inset-y-0 border-l border-slate-300 pt-2.5 pl-1.5" style={{ left: `${pct(t.at)}%` }}>
                  {t.label}
                </span>
              ))}
              {nowInWindow && (
                <span
                  className="absolute bottom-0 -translate-x-1/2 bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase"
                  style={{ left: `${pct(now)}%` }}
                >
                  Now
                </span>
              )}
            </div>
          </div>

          {rows.map((row, index) => (
            <div
              key={row.id}
              className={`flex border-b border-slate-200 last:border-0 ${index % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}`}
            >
              <div className="flex w-44 shrink-0 flex-col justify-center border-r border-slate-300 px-3 leading-tight">
                <span className="truncate text-sm font-semibold text-slate-900" title={row.label}>
                  {row.label}
                </span>
                {row.sublabel && (
                  <span className="truncate text-[11px] text-slate-500" title={row.sublabel}>
                    {row.sublabel}
                  </span>
                )}
              </div>
              <div className="relative h-16 flex-1">
                {minorLines.map((at) => (
                  <span key={`m${at}`} className="absolute inset-y-0 border-l border-slate-100" style={{ left: `${pct(at)}%` }} />
                ))}
                {ticks.map((t) => (
                  <span key={t.at} className="absolute inset-y-0 border-l border-slate-300" style={{ left: `${pct(t.at)}%` }} />
                ))}
                {row.bands.map((band) => {
                  if (band.end <= from || band.start >= to) return null
                  return (
                    <div
                      key={band.key}
                      className="absolute inset-y-1.5 flex items-center border border-dashed border-slate-400 bg-slate-100 px-2 text-[11px] font-medium text-slate-600"
                      style={{ left: `${pct(band.start)}%`, width: `${pct(band.end) - pct(band.start)}%` }}
                    >
                      {band.label}
                    </div>
                  )
                })}
                {row.bars.map((bar) => {
                  const start = new Date(bar.trip_start_at).getTime()
                  const end = busyUntil(bar, now) ?? new Date(bar.trip_end_at).getTime()
                  if (end <= from || start >= to) return null
                  // Still at the port on a storage-deadline booking: that
                  // deadline replaces "overdue" until pickup.
                  const storage = storageState({ deadline: bar.storage_deadline, status: bar.status, pickedUpAt: null, now })
                  const storageNote =
                    storage === 'pending' ? ' · PICK UP BY 11:59 PM' : storage === 'missed' ? ' · STORAGE MISSED' : ''
                  const overdue = !storageNote && isOverdue(bar, now)
                  return (
                    <button
                      key={bar.itinerary_id}
                      type="button"
                      onClick={() => navigate(`/dashboard/bookings?booking=${bar.booking_id}&trip=${bar.itinerary_id}`)}
                      title={`Trip #${bar.itinerary_id} · ${bar.route}\n${formatSlot(bar.trip_start_at, bar.trip_end_at)}${overdue ? ' · OVERDUE' : ''}${storageNote}`}
                      // 2px gap each side so back-to-back trips read as separate blocks.
                      className={`absolute inset-y-2 flex flex-col justify-center overflow-hidden border-l-4 border-y border-r px-2 text-left leading-tight whitespace-nowrap shadow-sm hover:brightness-95 ${
                        overdue || storage === 'missed' ? OVERDUE_STYLE : (BAR_STYLES[bar.status] ?? BAR_STYLES.Awaiting)
                      }`}
                      style={{
                        left: `calc(${pct(start)}% + 2px)`,
                        width: `calc(${Math.max(pct(end) - pct(start), 0.8)}% - 4px)`,
                      }}
                    >
                      <span className="truncate text-[11px] font-bold">
                        #{bar.itinerary_id} · {formatTime(bar.trip_start_at)} – {formatTime(bar.trip_end_at)}
                        {overdue ? ' · OVERDUE' : ''}
                        {storageNote}
                      </span>
                      <span className="truncate text-[11px] opacity-90">{bar.route}</span>
                    </button>
                  )
                })}
                {nowInWindow && (
                  <span className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-red-600" style={{ left: `${pct(now)}%` }} aria-hidden="true" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {Object.entries({ Awaiting: 'Awaiting', Dispatched: 'Dispatched', PickedUp: 'Picked up', InTransit: 'In transit', Delivered: 'Delivered' }).map(
          ([status, label]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className={`inline-block h-3.5 w-5 border border-l-4 ${BAR_STYLES[status]}`} /> {label}
            </span>
          ),
        )}
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-3.5 w-5 border border-l-4 ${OVERDUE_STYLE}`} /> Overdue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 border border-dashed border-slate-400 bg-slate-100" /> Leave / in shop / service due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 border-l-2 border-red-600" /> Now
        </span>
      </div>
    </>
  )
}

export default ScheduleTimeline
