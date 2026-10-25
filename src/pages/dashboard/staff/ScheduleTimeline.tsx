// ScheduleTimeline: the grid used by Schedule Overview (the canvas's
// "Driver Schedule" board) -- a time axis, then one section per kind of
// resource (Drivers, Helpers, Trucks, Trailers -- or one unnamed section for
// the Trips / Bookings views), one lane per person/vehicle with trips drawn
// as blocks and striped bands (leave, in the shop, service due) behind them.
// Pure drawing: the page decides the window (from/to), the rows come from
// lib/scheduleData.ts. Clicking a block opens that trip on Bookings & Trips.
//
// A trip on the road past its end is drawn up to "now" and red (Overdue).
// The red line with the "Now" tag is the current time.
import { useNavigate } from 'react-router-dom'
import { formatClock, formatSlot, formatTime } from '../../../lib/format'
import { DAY_MS, DAY_START_HOUR, HOUR_MS, type TimelineRow } from '../../../lib/scheduleData'
import { busyUntil, isOverdue } from '../../../lib/tripSchedule'
import { storageState } from '../../../lib/storageDeadline'

export type TimelineSection = {
  // '' = no section header row (Trips / Bookings views).
  title: string
  note?: string
  rows: TimelineRow[]
}

const STATUS_WORD: Record<string, string> = {
  Dispatched: 'Dispatched',
  PickedUp: 'Picked up',
  InTransit: 'In transit',
}

// Striped amber, like the canvas's "Not operational" lane.
const STRIPES = 'repeating-linear-gradient(45deg,#fef3c7 0 8px,#fde68a 8px 16px)'

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  )
}

// The legend row above the timeline.
export function ScheduleLegend() {
  const item = 'flex items-center gap-2 text-sm text-ink-secondary'
  return (
    <div aria-label="Legend" className="flex min-h-11 flex-wrap items-center gap-x-7 gap-y-2">
      <span className={item}>
        <span aria-hidden="true" className="h-4 w-7 border-2 border-primary bg-primary-soft" />
        Trip (select to open)
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-4 w-7 border-2 border-primary bg-white" />
        Not started
      </span>
      <span className={item}>
        <Check />
        Delivered
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-4 w-7 border-2 border-red-700 bg-red-50" />
        Overdue
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-4 w-7" style={{ background: STRIPES }} />
        Leave / in the shop / service due
      </span>
      <span className={item}>
        <span aria-hidden="true" className="h-4 w-7 border border-line bg-white" />
        Free
      </span>
    </div>
  )
}

type Props = {
  sections: TimelineSection[]
  // Header of the label column, e.g. "Resource".
  columnLabel: string
  view: 'day' | 'week'
  from: number
  to: number
  now: number
}

function ScheduleTimeline({ sections, columnLabel, view, from, to, now }: Props) {
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
  // Faint hour lines (every 6 h in week view), drawn as a background.
  const gridCount = view === 'day' ? 24 : 28
  const trackGrid = {
    backgroundImage: 'linear-gradient(to right,#e2e8f0 1px,transparent 1px)',
    backgroundSize: `calc(100% / ${gridCount}) 100%`,
  }
  const nowInWindow = now >= from && now < to

  return (
    <section aria-label="Schedule" className="card overflow-x-auto">
      <div className="min-w-[860px]">
        {/* Time axis */}
        <div className="grid h-10 grid-cols-[240px_minmax(0,1fr)] border-b border-line">
          <div className="flex items-center border-r border-line px-4 text-xs leading-4 font-semibold tracking-[0.04em] text-ink-secondary uppercase">
            {columnLabel}
          </div>
          <div className="relative">
            {ticks.map((t) => (
              <span
                key={t.at}
                className="absolute inset-y-0 flex items-center border-l border-line-card pl-1.5 text-xs leading-4 font-semibold whitespace-nowrap text-ink-secondary"
                style={{ left: `${pct(t.at)}%` }}
              >
                {t.label}
              </span>
            ))}
            {nowInWindow && (
              <span
                className="absolute bottom-0 z-10 -translate-x-1/2 bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase"
                style={{ left: `${pct(now)}%` }}
              >
                Now
              </span>
            )}
          </div>
        </div>

        {sections.map((section, sectionIndex) => (
          <div key={section.title || sectionIndex}>
            {section.title && (
              <div className="grid grid-cols-[240px_minmax(0,1fr)] border-b border-line bg-slate-100">
                <span className="px-4 py-2 text-xs leading-4 font-semibold tracking-[0.04em] text-ink-secondary uppercase">
                  {section.title}
                </span>
                <span className="px-4 py-2 text-xs leading-4 font-medium text-ink-secondary">{section.note}</span>
              </div>
            )}
            {section.rows.length === 0 && section.title && (
              <p className="border-b border-slate-200 px-4 py-4 text-sm text-ink-muted">None on file.</p>
            )}
            {section.rows.map((row) => (
              <div key={row.id} className="grid min-h-[72px] grid-cols-[240px_minmax(0,1fr)] border-b border-slate-200">
                <div className="flex min-w-0 flex-col justify-center border-r border-line px-4 text-sm leading-5">
                  <span className="truncate font-semibold text-ink" title={row.label}>
                    {row.label}
                  </span>
                  {row.sublabel && (
                    <span className="truncate text-[13px] leading-[18px] text-ink-muted" title={row.sublabel}>
                      {row.sublabel}
                    </span>
                  )}
                </div>
                <div className="relative" style={trackGrid}>
                  {row.bands.map((band) => {
                    if (band.end <= from || band.start >= to) return null
                    return (
                      <div
                        key={band.key}
                        className="absolute inset-y-2 flex items-center overflow-hidden px-3.5 text-sm font-semibold whitespace-nowrap text-amber-900"
                        style={{ left: `${pct(band.start)}%`, width: `${pct(band.end) - pct(band.start)}%`, background: STRIPES }}
                        title={band.label}
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
                      storage === 'pending' ? ' · Pick up by 11:59 PM' : storage === 'missed' ? ' · Storage missed' : ''
                    const overdue = !storageNote && isOverdue(bar, now)
                    const late = overdue || storage === 'missed'
                    const delivered = bar.status === 'Delivered'
                    const notStarted = bar.status === 'Awaiting'
                    return (
                      <button
                        key={bar.itinerary_id}
                        type="button"
                        onClick={() => navigate(`/dashboard/bookings?booking=${bar.booking_id}&trip=${bar.itinerary_id}`)}
                        aria-label={`Trip #${bar.itinerary_id}, ${formatSlot(bar.trip_start_at, bar.trip_end_at)}, ${bar.status}`}
                        title={`Trip #${bar.itinerary_id} · ${bar.route}\n${formatSlot(bar.trip_start_at, bar.trip_end_at)}${overdue ? ' · OVERDUE' : ''}${storageNote}`}
                        // 2px gap each side so back-to-back trips read as separate blocks.
                        className={`absolute inset-y-2 flex flex-col justify-center gap-0.5 overflow-hidden border-2 px-2.5 py-1 text-left text-[13px] leading-[18px] whitespace-nowrap text-ink ${
                          late
                            ? 'border-red-700 bg-red-50 hover:bg-red-100'
                            : notStarted
                              ? 'border-primary bg-white hover:bg-primary-soft'
                              : 'border-primary bg-primary-soft hover:bg-[#dbe5ee]'
                        }`}
                        style={{
                          left: `calc(${pct(start)}% + 2px)`,
                          width: `calc(${Math.max(pct(end) - pct(start), 0.8)}% - 4px)`,
                        }}
                      >
                        <span className="flex items-center gap-1.5 font-bold">
                          Trip #{bar.itinerary_id}
                          {delivered && <Check />}
                          {late && <span className="text-red-700">{overdue ? 'Overdue' : 'Storage missed'}</span>}
                        </span>
                        <span className="truncate text-ink-secondary">
                          {formatTime(bar.trip_start_at)} – {formatTime(bar.trip_end_at)}
                          {STATUS_WORD[bar.status] ? ` · ${STATUS_WORD[bar.status]}` : ''}
                          {storage === 'pending' ? storageNote : ''} · {bar.route}
                        </span>
                      </button>
                    )
                  })}
                  {nowInWindow && (
                    <span
                      className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-red-600"
                      style={{ left: `${pct(now)}%` }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

export default ScheduleTimeline
