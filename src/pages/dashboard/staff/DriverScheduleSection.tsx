// DriverScheduleSection: "Driver Schedule" (/dashboard/driver-schedule,
// Admin + Dispatcher) -- a timeline with one row per active driver (or
// helper, second tab) and their trips drawn as bars across the day or
// week, so dispatch can see who is free when. Read-only: changes are made
// on the Dispatch Board; clicking a bar opens that trip on Bookings &
// Trips (?booking=…&trip=…).
//
// Bars use the trip's slot (trip_start_at -> trip_end_at). A trip on the
// road past its end is drawn up to "now" and red (Overdue). Approved
// leave is a grey band. The red line with the "Now" tag is the current
// time (moves every minute). Deactivated/Terminated people are left out, same
// as the Dispatch Board's dropdowns. A "day" runs 6 AM to 6 AM the next
// morning (DAY_START_HOUR), Week = Sunday 6 AM to the next Sunday 6 AM
// (Manila time).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabaseClient'
import PageHeader from '../../../components/PageHeader'
import EmptyState from '../../../components/EmptyState'
import { formatClock, formatDate, formatSlot, formatTime, manilaTimestamp } from '../../../lib/format'
import { loadApprovedLeave, type LeaveRange } from '../../../lib/leaveRequests'
import { toManilaDate } from '../../../lib/payslip'
import { busyUntil, isOverdue, manilaWeek } from '../../../lib/tripSchedule'

type CrewRole = 'Driver' | 'Helper'
type View = 'day' | 'week'

type Bar = {
  itinerary_id: number
  booking_id: number
  status: string
  trip_start_at: string
  trip_end_at: string
  route: string
}

type PersonRow = {
  employee_id: number
  full_name: string
  bars: Bar[]
  leave: LeaveRange[]
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
// The timeline's day starts at 6 AM, not midnight.
const DAY_START_HOUR = 6

// The schedule day `at` belongs to: before 6 AM still counts as the day before.
const scheduleDay = (at: number) => toManilaDate(new Date(at - DAY_START_HOUR * HOUR_MS))

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

async function fetchSchedule(role: CrewRole, from: number, to: number): Promise<PersonRow[]> {
  // Everyone whose Employees-page position is Driver (or Helper) -- with
  // or without a login yet (an employee is added before Set Up Account).
  const [employeesResult, statusesResult, leaveResult] = await Promise.all([
    supabase.from('employees').select('employee_id, full_name, employment_status_id').eq('position', role),
    supabase.from('employment_status').select('status_id, status_name'),
    loadApprovedLeave(toManilaDate(new Date(from))),
  ])
  if (employeesResult.error) throw new Error(employeesResult.error.message)
  if (statusesResult.error) throw new Error(statusesResult.error.message)
  if (leaveResult.error) throw new Error(leaveResult.error)

  const inactive = new Set(
    statusesResult.data
      .filter((st) => st.status_name === 'Deactivated' || st.status_name === 'Terminated')
      .map((st) => st.status_id),
  )
  const people = employeesResult.data
    .filter((e) => e.employment_status_id === null || !inactive.has(e.employment_status_id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  // Trips starting before the window ends; the 3-day look-back catches
  // long trips that began earlier and spill into it. Trips still ON THE
  // ROAD are added whenever they started -- an overdue trip from a week
  // ago still keeps its driver busy now.
  const columns = 'itinerary_id, booking_id, itinerary_status, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id'
  const [windowResult, onRoadResult] = await Promise.all([
    supabase
      .from('itineraries')
      .select(columns)
      .neq('itinerary_status', 'Cancelled')
      .not('trip_start_at', 'is', null)
      .lt('trip_start_at', new Date(to).toISOString())
      .gte('trip_start_at', new Date(from - 3 * DAY_MS).toISOString()),
    supabase
      .from('itineraries')
      .select(columns)
      .in('itinerary_status', ['Dispatched', 'PickedUp', 'InTransit'])
      .not('trip_start_at', 'is', null)
      .lt('trip_start_at', new Date(to).toISOString()),
  ])
  if (windowResult.error) throw new Error(windowResult.error.message)
  if (onRoadResult.error) throw new Error(onRoadResult.error.message)
  // Same trip can come back from both queries -- keep it once.
  const trips = [...new Map([...windowResult.data, ...onRoadResult.data].map((t) => [t.itinerary_id, t])).values()]

  const tripIds = trips.map((t) => t.itinerary_id)
  const placeIds = Array.from(new Set(trips.flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])))
  const [crewResult, placesResult] = await Promise.all([
    tripIds.length
      ? supabase
          .from('itinerary_crews')
          .select('itinerary_id, employee_id')
          .eq('crew_role', role)
          .eq('is_active', true)
          .in('itinerary_id', tripIds)
      : Promise.resolve({ data: [] as { itinerary_id: number; employee_id: number }[], error: null }),
    placeIds.length
      ? supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
      : Promise.resolve({ data: [] as { place_id: number; place_name: string }[], error: null }),
  ])
  if (crewResult.error) throw new Error(crewResult.error.message)
  const placeName = new Map((placesResult.data ?? []).map((p) => [p.place_id, p.place_name]))
  const tripById = new Map(trips.map((t) => [t.itinerary_id, t]))

  return people.map((p) => ({
    employee_id: p.employee_id,
    full_name: p.full_name,
    leave: leaveResult.byEmployee.get(p.employee_id) ?? [],
    bars: crewResult.data
      .filter((c) => c.employee_id === p.employee_id)
      .map((c) => tripById.get(c.itinerary_id))
      .filter((t) => t !== undefined)
      .map((t) => ({
        itinerary_id: t.itinerary_id,
        booking_id: t.booking_id,
        status: t.itinerary_status ?? 'Awaiting',
        trip_start_at: t.trip_start_at as string,
        trip_end_at: t.trip_end_at as string,
        route: `${placeName.get(t.place_of_pickup_id) ?? '—'} → ${placeName.get(t.place_of_delivery_id) ?? '—'}`,
      })),
  }))
}

function DriverScheduleSection() {
  const navigate = useNavigate()
  const [role, setRole] = useState<CrewRole>('Driver')
  const [view, setView] = useState<View>('day')
  // The day being looked at (Manila YYYY-MM-DD); week view shows its Sun–Sat week.
  const [day, setDay] = useState(() => scheduleDay(Date.now()))
  const [rows, setRows] = useState<PersonRow[] | null>(null)
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
    fetchSchedule(role, from, to)
      .then((r) => {
        if (cancelled) return
        setRows(r)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [role, from, to, reloadKey])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Move one day or one week; the loading text shows until the new window arrives.
  function shift(direction: -1 | 1) {
    setRows(null)
    setReloadKey((k) => k + 1)
    setDay(toManilaDate(new Date(dayStart + direction * (view === 'day' ? 1 : 7) * DAY_MS + 12 * HOUR_MS)))
  }

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
  const title =
    view === 'day'
      ? formatDate(day)
      : `${formatDate(toManilaDate(new Date(from + 12 * HOUR_MS)))} – ${formatDate(toManilaDate(new Date(to - 12 * HOUR_MS)))}`
  const nowInWindow = now >= from && now < to

  const toggle = (active: boolean) =>
    `px-3 py-1.5 text-sm font-medium ${active ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-50'}`

  return (
    <div>
      <PageHeader title="Driver Schedule" subtitle="Who is on which trip, and when. Changes are made on the Dispatch Board." />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['Driver', 'Helper'] as CrewRole[]).map((r) => (
            <button key={r} type="button" className={toggle(role === r)} onClick={() => { setRows(null); setReloadKey((k) => k + 1); setRole(r) }}>
              {r}s
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['day', 'week'] as View[]).map((v) => (
            <button key={v} type="button" className={toggle(view === v)} onClick={() => { setRows(null); setReloadKey((k) => k + 1); setView(v) }}>
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
            onClick={() => { setRows(null); setReloadKey((k) => k + 1); setDay(scheduleDay(Date.now())) }}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            Today
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-red-700">{error}</p>
      ) : rows === null ? (
        <p className="mt-4 text-slate-500">Loading schedule…</p>
      ) : rows.length === 0 ? (
        <EmptyState message={`No active ${role.toLowerCase()}s.`} className="mt-4" />
      ) : (
        <div className="mt-4 overflow-x-auto border border-slate-200 bg-white">
          <div className="min-w-[760px]">
            {/* Time axis */}
            <div className="flex border-b-2 border-slate-300 bg-slate-50 text-xs font-medium text-slate-600">
              <div className="w-44 shrink-0 border-r border-slate-300 px-3 py-2.5 font-semibold text-slate-800">{role}</div>
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

            {rows.map((person, index) => (
              <div
                key={person.employee_id}
                className={`flex border-b border-slate-200 last:border-0 ${index % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}`}
              >
                <div className="flex w-44 shrink-0 items-center border-r border-slate-300 px-3 text-sm font-semibold text-slate-900">
                  <span className="truncate">{person.full_name}</span>
                </div>
                <div className="relative h-16 flex-1">
                  {minorLines.map((at) => (
                    <span key={`m${at}`} className="absolute inset-y-0 border-l border-slate-100" style={{ left: `${pct(at)}%` }} />
                  ))}
                  {ticks.map((t) => (
                    <span key={t.at} className="absolute inset-y-0 border-l border-slate-300" style={{ left: `${pct(t.at)}%` }} />
                  ))}
                  {person.leave.map((l) => {
                    const ls = new Date(manilaTimestamp(l.start_date, 0)).getTime()
                    const le = new Date(manilaTimestamp(l.end_date, 0)).getTime() + DAY_MS
                    if (le <= from || ls >= to) return null
                    return (
                      <div
                        key={`${l.start_date}-${l.end_date}`}
                        className="absolute inset-y-1.5 flex items-center border border-dashed border-slate-400 bg-slate-100 px-2 text-[11px] font-medium text-slate-600"
                        style={{ left: `${pct(ls)}%`, width: `${pct(le) - pct(ls)}%` }}
                      >
                        On leave
                      </div>
                    )
                  })}
                  {person.bars.map((bar) => {
                    const start = new Date(bar.trip_start_at).getTime()
                    const end = busyUntil(bar, now) ?? new Date(bar.trip_end_at).getTime()
                    if (end <= from || start >= to) return null
                    const overdue = isOverdue(bar, now)
                    return (
                      <button
                        key={bar.itinerary_id}
                        type="button"
                        onClick={() => navigate(`/dashboard/bookings?booking=${bar.booking_id}&trip=${bar.itinerary_id}`)}
                        title={`Trip #${bar.itinerary_id} · ${bar.route}\n${formatSlot(bar.trip_start_at, bar.trip_end_at)}${overdue ? ' · OVERDUE' : ''}`}
                        // 2px gap each side so back-to-back trips read as separate blocks.
                        className={`absolute inset-y-2 flex flex-col justify-center overflow-hidden border-l-4 border-y border-r px-2 text-left leading-tight whitespace-nowrap shadow-sm hover:brightness-95 ${
                          overdue ? OVERDUE_STYLE : (BAR_STYLES[bar.status] ?? BAR_STYLES.Awaiting)
                        }`}
                        style={{
                          left: `calc(${pct(start)}% + 2px)`,
                          width: `calc(${Math.max(pct(end) - pct(start), 0.8)}% - 4px)`,
                        }}
                      >
                        <span className="truncate text-[11px] font-bold">
                          #{bar.itinerary_id} · {formatTime(bar.trip_start_at)} – {formatTime(bar.trip_end_at)}
                          {overdue ? ' · OVERDUE' : ''}
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
      )}

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
          <span className="inline-block h-3.5 w-5 border border-dashed border-slate-400 bg-slate-100" /> On leave
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3.5 border-l-2 border-red-600" /> Now
        </span>
      </div>
    </div>
  )
}

export default DriverScheduleSection
