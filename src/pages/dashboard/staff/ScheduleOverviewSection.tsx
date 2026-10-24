// ScheduleOverviewSection: "Schedule Overview" (/dashboard/schedule-overview,
// Admin + Dispatcher) -- the old Driver Schedule grown into one page with a
// tab per thing that gets scheduled: Drivers, Helpers, Trucks (with a
// Trucks/Trailers switch), Trips and Bookings. Read-only: changes are made
// on the Dispatch Board. Each tab is one loader in lib/scheduleData.ts
// feeding the same ScheduleTimeline.
//
// The Trips tab also shows a one-line notice when open trips are missing a
// time slot, driver, truck or trailer (they can't be drawn, or can't run yet).
//
// A "day" runs 6 AM to 6 AM the next morning (DAY_START_HOUR), Week =
// Sunday 6 AM to the next Sunday 6 AM (Manila time).
import { useEffect, useState } from 'react'
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
  type ScheduleData,
  type ScheduleTab,
  type VehicleKind,
} from '../../../lib/scheduleData'
import ScheduleTimeline from './ScheduleTimeline'

type View = 'day' | 'week'

// columnLabel = header of the first column; empty = what to say with no rows.
const TABS: { tab: ScheduleTab; label: string; columnLabel: string; empty: string }[] = [
  { tab: 'Driver', label: 'Drivers', columnLabel: 'Driver', empty: 'No active drivers.' },
  { tab: 'Helper', label: 'Helpers', columnLabel: 'Helper', empty: 'No active helpers.' },
  { tab: 'Vehicle', label: 'Trucks', columnLabel: 'Vehicle', empty: 'No vehicles yet.' },
  { tab: 'Trip', label: 'Trips', columnLabel: 'Trip', empty: 'No trips in this period.' },
  { tab: 'Booking', label: 'Bookings', columnLabel: 'Booking', empty: 'No bookings with trips in this period.' },
]

// The schedule day `at` belongs to: before 6 AM still counts as the day before.
const scheduleDay = (at: number) => toManilaDate(new Date(at - DAY_START_HOUR * HOUR_MS))

function ScheduleOverviewSection() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<ScheduleTab>('Driver')
  const [kind, setKind] = useState<VehicleKind>('Truck')
  const [view, setView] = useState<View>('day')
  // The day being looked at (Manila YYYY-MM-DD); week view shows its Sun–Sat week.
  const [day, setDay] = useState(() => scheduleDay(Date.now()))
  const [data, setData] = useState<ScheduleData | null>(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Bumped by every button that clears the timeline, so it always loads
  // again -- clicking Today (or the tab already shown) changes nothing
  // else, and used to leave it on "Loading" forever.
  const [reloadKey, setReloadKey] = useState(0)

  const dayStart = new Date(manilaTimestamp(day, DAY_START_HOUR * 60)).getTime()
  const from = view === 'day' ? dayStart : manilaWeek(dayStart).from + DAY_START_HOUR * HOUR_MS
  const to = view === 'day' ? from + DAY_MS : from + 7 * DAY_MS

  useEffect(() => {
    let cancelled = false
    loadSchedule(tab, kind, from, to)
      .then((r) => {
        if (cancelled) return
        setData(r)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [tab, kind, from, to, reloadKey])

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
    setDay(toManilaDate(new Date(dayStart + direction * (view === 'day' ? 1 : 7) * DAY_MS + 12 * HOUR_MS)))
  }

  const title =
    view === 'day'
      ? formatDate(day)
      : `${formatDate(toManilaDate(new Date(from + 12 * HOUR_MS)))} – ${formatDate(toManilaDate(new Date(to - 12 * HOUR_MS)))}`

  const toggle = (active: boolean) =>
    `px-3 py-1.5 text-sm font-medium ${active ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`
  const current = TABS.find((t) => t.tab === tab) ?? TABS[0]
  const columnLabel = tab === 'Vehicle' ? kind : current.columnLabel

  // Search matches the row's name, its trip / booking numbers and routes.
  const q = search.trim().toLowerCase()
  const rows = (data?.rows ?? []).filter(
    (row) =>
      !q ||
      [row.label, row.sublabel ?? '', ...row.bars.flatMap((b) => [`trip #${b.itinerary_id}`, `booking #${b.booking_id}`, b.route])]
        .join(' ')
        .toLowerCase()
        .includes(q),
  )
  const attention = data?.attention ?? []

  return (
    <div>
      <PageHeader title="Schedule Overview" subtitle="Who and what is on which trip, and when. Changes are made on the Dispatch Board." />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.tab} type="button" className={toggle(tab === t.tab)} onClick={() => { reload(); setTab(t.tab) }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['day', 'week'] as View[]).map((v) => (
            <button key={v} type="button" className={toggle(view === v)} onClick={() => { reload(); setView(v) }}>
              {v === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous" onClick={() => shift(-1)} className="border border-slate-300 px-2 py-1 hover:bg-slate-50">
            ‹
          </button>
          <span className="min-w-44 text-center text-sm font-semibold text-slate-900">{title}</span>
          <button type="button" aria-label="Next" onClick={() => shift(1)} className="border border-slate-300 px-2 py-1 hover:bg-slate-50">
            ›
          </button>
          <button
            type="button"
            onClick={() => { reload(); setDay(scheduleDay(Date.now())) }}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Refresh
          </button>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search the schedule"
          placeholder="Search name, plate, trip # or booking #"
          className="ml-auto w-72 max-w-full border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      {tab === 'Vehicle' && (
        <div className="mt-3 flex gap-1">
          {(['Truck', 'Trailer'] as VehicleKind[]).map((k) => (
            <button key={k} type="button" className={toggle(kind === k)} onClick={() => { reload(); setKind(k) }}>
              {k}s
            </button>
          ))}
        </div>
      )}

      {attention.length > 0 && (
        <div className="mt-4 border border-orange-300 bg-orange-50 px-4 py-3">
          <p className="text-sm text-orange-900">
            There are trips that need assignment.{' '}
            <button type="button" onClick={() => navigate('/dashboard/dispatch')} className="font-semibold underline">
              Open Dispatch Board
            </button>
          </p>
        </div>
      )}

      {error ? (
        <p className="mt-4 text-red-700">{error}</p>
      ) : data === null ? (
        <p className="mt-4 text-slate-500">Loading schedule…</p>
      ) : rows.length === 0 ? (
        <EmptyState message={q ? 'Nothing matches your search.' : current.empty} className="mt-4" />
      ) : (
        <ScheduleTimeline rows={rows} columnLabel={columnLabel} view={view} from={from} to={to} now={now} />
      )}
    </div>
  )
}

export default ScheduleOverviewSection
