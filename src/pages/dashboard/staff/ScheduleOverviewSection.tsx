// ScheduleOverviewSection: "Schedule Overview" (/dashboard/schedule-overview,
// Admin + Dispatcher) -- the canvas's "Driver Schedule" board. The default
// Resources view is one timeline for the day with a section each for
// Drivers, Helpers, Trucks and Trailers (gaps are free time). The Trips and
// Bookings views draw one lane per trip / booking instead, and Week shows
// Sunday to Saturday. Read-only: changes are made on the Dispatch Board.
// Every section is one loader in lib/scheduleData.ts feeding ScheduleTimeline.
//
// The Trips view also shows a one-line notice when open trips are missing a
// time slot, driver, truck or trailer (they can't be drawn, or can't run yet).
//
// A "day" runs 6 AM to 6 AM the next morning (DAY_START_HOUR), Week =
// Sunday 6 AM to the next Sunday 6 AM (Manila time).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../../components/PageHeader'
import EmptyState from '../../../components/EmptyState'
import { formatDate, manilaTimestamp } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { manilaWeek } from '../../../lib/tripSchedule'
import {
  DAY_MS,
  DAY_START_HOUR,
  HOUR_MS,
  loadSchedule,
  type AttentionItem,
  type TimelineRow,
} from '../../../lib/scheduleData'
import ScheduleTimeline, { ScheduleLegend, type TimelineSection } from './ScheduleTimeline'

type Span = 'day' | 'week'
type View = 'resources' | 'trips' | 'bookings'

const VIEWS: { view: View; label: string }[] = [
  { view: 'resources', label: 'Resources' },
  { view: 'trips', label: 'Trips' },
  { view: 'bookings', label: 'Bookings' },
]

// The schedule day `at` belongs to: before 6 AM still counts as the day before.
const scheduleDay = (at: number) => toManilaDate(new Date(at - DAY_START_HOUR * HOUR_MS))

// A lane whose leave / shop band covers this moment.
const bandedNow = (row: TimelineRow, now: number) => row.bands.some((b) => b.start <= now && now < b.end)

// Loads what one view draws: four sections for Resources, one for the others.
async function loadView(view: View, from: number, to: number, now: number): Promise<{ sections: TimelineSection[]; attention: AttentionItem[] }> {
  if (view === 'trips' || view === 'bookings') {
    const r = await loadSchedule(view === 'trips' ? 'Trip' : 'Booking', 'Truck', from, to)
    return { sections: [{ title: '', rows: r.rows }], attention: r.attention }
  }
  const [drivers, helpers, trucks, trailers] = await Promise.all([
    loadSchedule('Driver', 'Truck', from, to),
    loadSchedule('Helper', 'Truck', from, to),
    loadSchedule('Vehicle', 'Truck', from, to),
    loadSchedule('Vehicle', 'Trailer', from, to),
  ])
  const people = (rows: TimelineRow[], word: string) =>
    `${rows.length} ${word}${rows.length === 1 ? '' : 's'}${rows.some((r) => bandedNow(r, now)) ? ` · ${rows.filter((r) => bandedNow(r, now)).length} on leave now` : ''}`
  const fleet = (rows: TimelineRow[]) => `${rows.filter((r) => !bandedNow(r, now)).length} of ${rows.length} operational now`
  return {
    sections: [
      { title: 'Drivers', note: people(drivers.rows, 'driver'), rows: drivers.rows },
      { title: 'Helpers', note: people(helpers.rows, 'helper'), rows: helpers.rows },
      { title: 'Trucks', note: fleet(trucks.rows), rows: trucks.rows },
      { title: 'Trailers', note: fleet(trailers.rows), rows: trailers.rows },
    ],
    attention: [],
  }
}

function Icon({ d, className = '' }: { d: string; className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const LEFT = 'M15 6l-6 6 6 6'
const RIGHT = 'M9 6l6 6-6 6'
const CALENDAR = 'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M8 2v4 M16 2v4'
const REFRESH = 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15'

function ScheduleOverviewSection() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('resources')
  const [span, setSpan] = useState<Span>('day')
  // The day being looked at (Manila YYYY-MM-DD); week view shows its Sun–Sat week.
  const [day, setDay] = useState(() => scheduleDay(Date.now()))
  const [data, setData] = useState<{ sections: TimelineSection[]; attention: AttentionItem[] } | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const dateInputRef = useRef<HTMLInputElement>(null)
  // Bumped by every button that clears the timeline, so it always loads
  // again -- clicking Today (or the view already shown) changes nothing
  // else, and used to leave it on "Loading" forever.
  const [reloadKey, setReloadKey] = useState(0)

  const dayStart = new Date(manilaTimestamp(day, DAY_START_HOUR * 60)).getTime()
  const from = span === 'day' ? dayStart : manilaWeek(dayStart).from + DAY_START_HOUR * HOUR_MS
  const to = span === 'day' ? from + DAY_MS : from + 7 * DAY_MS
  const today = scheduleDay(now)

  useEffect(() => {
    let cancelled = false
    loadView(view, from, to, Date.now())
      .then((r) => {
        if (cancelled) return
        setData(r)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [view, from, to, reloadKey])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Bookings made while this page sat open: load again when the browser tab
  // is shown again (quietly -- the old schedule stays until the new one arrives).
  useEffect(() => {
    const onShow = () => document.visibilityState === 'visible' && setReloadKey((k) => k + 1)
    document.addEventListener('visibilitychange', onShow)
    return () => document.removeEventListener('visibilitychange', onShow)
  }, [])

  // Clear the timeline and load again (the loading text shows meanwhile).
  function reload() {
    setData(null)
    setReloadKey((k) => k + 1)
  }

  // Move one day or one week.
  function shift(direction: -1 | 1) {
    reload()
    setDay(toManilaDate(new Date(dayStart + direction * (span === 'day' ? 1 : 7) * DAY_MS + 12 * HOUR_MS)))
  }

  const dateText = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  const title =
    span === 'day'
      ? `${day === today ? 'Today · ' : ''}${dateText}`
      : `${formatDate(toManilaDate(new Date(from + 12 * HOUR_MS)))} – ${formatDate(toManilaDate(new Date(to - 12 * HOUR_MS)))}`

  const toggle = (active: boolean) =>
    `h-11 rounded-[2px] border px-4 text-sm font-semibold ${active ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'}`
  const squareButton =
    'flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50'

  // Search matches a lane's name, its trip / booking numbers and routes.
  const q = search.trim().toLowerCase()
  const matches = (row: TimelineRow) =>
    !q ||
    [row.label, row.sublabel ?? '', ...row.bars.flatMap((b) => [`trip #${b.itinerary_id}`, `booking #${b.booking_id}`, b.route])]
      .join(' ')
      .toLowerCase()
      .includes(q)
  const sections = (data?.sections ?? []).map((s) => ({ ...s, rows: s.rows.filter(matches) }))
  const laneCount = sections.reduce((n, s) => n + s.rows.length, 0)
  const attention = data?.attention ?? []

  return (
    <div>
      <PageHeader
        title="Schedule Overview"
        subtitle="Who and what is booked, hour by hour. Gaps are free time slots."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label={span === 'day' ? 'Previous day' : 'Previous week'} onClick={() => shift(-1)} className={squareButton}>
              <Icon d={LEFT} />
            </button>
            {/* The date: click it to pick any day. */}
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
              <Icon d={CALENDAR} className="text-primary" />
              {title}
            </button>
            <input
              ref={dateInputRef}
              type="date"
              aria-label="Pick a day"
              value={day}
              onChange={(e) => {
                if (!e.target.value) return
                reload()
                setDay(e.target.value)
              }}
              className="sr-only"
            />
            <button type="button" aria-label={span === 'day' ? 'Next day' : 'Next week'} onClick={() => shift(1)} className={squareButton}>
              <Icon d={RIGHT} />
            </button>
            {day !== today && (
              <button
                type="button"
                onClick={() => {
                  reload()
                  setDay(today)
                }}
                className="btn-secondary px-4 text-sm font-medium"
              >
                Today
              </button>
            )}
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="btn-secondary ml-2 flex items-center gap-2 px-4 text-sm font-medium"
            >
              <Icon d={REFRESH} />
              Refresh
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <ScheduleLegend />
        <div className="flex flex-wrap items-center gap-2">
          {VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              aria-pressed={view === v.view}
              className={toggle(view === v.view)}
              onClick={() => {
                reload()
                setView(v.view)
              }}
            >
              {v.label}
            </button>
          ))}
          <span className="mx-1 h-6 border-l border-line" aria-hidden="true" />
          {(['day', 'week'] as Span[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={span === s}
              className={toggle(span === s)}
              onClick={() => {
                reload()
                setSpan(s)
              }}
            >
              {s === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the schedule"
            placeholder="Name, plate, trip # or booking #"
            className="min-h-11 w-64 max-w-full rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm text-ink-metric placeholder:text-ink-muted focus:border-primary"
          />
        </div>
      </div>

      {attention.length > 0 && (
        <p className="mb-4 border border-amber-600 bg-amber-100 px-4 py-3 text-sm text-amber-900">
          There are trips that need assignment.{' '}
          <button type="button" onClick={() => navigate('/dashboard/dispatch')} className="font-semibold underline">
            Open Dispatch Board
          </button>
        </p>
      )}

      {error ? (
        <p className="text-red-700">{error}</p>
      ) : data === null ? (
        <p className="text-ink-muted">Loading schedule…</p>
      ) : laneCount === 0 && (q || view !== 'resources') ? (
        <EmptyState
          message={q ? 'Nothing matches your search.' : view === 'trips' ? 'No trips in this period.' : 'No bookings with trips in this period.'}
        />
      ) : (
        <ScheduleTimeline
          sections={sections.filter((s) => !q || s.rows.length > 0)}
          columnLabel={view === 'trips' ? 'Trip' : view === 'bookings' ? 'Booking' : 'Resource'}
          view={span}
          from={from}
          to={to}
          now={now}
        />
      )}
    </div>
  )
}

export default ScheduleOverviewSection
