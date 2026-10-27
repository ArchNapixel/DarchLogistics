// MyScheduleSection: "My Schedule" for Drivers and Helpers
// (/dashboard/schedule, the canvas's Driver Schedule board) -- their
// upcoming trips with each trip's time slot, grouped by day (Today,
// Tomorrow, then dates), and beside it their latest trip updates (the same
// notifications as the header bell). Read-only; the trips themselves are
// worked from My Tasks on the Dashboard.
//
// Same "whose trip is it" rule as DriverTasks: active itinerary_crews
// rows for this person (a reassigned-off trip isn't theirs any more),
// skipping Delivered/Cancelled trips.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import EmptyState from '../../../components/EmptyState'
import { formatDateTime, formatTime, splitManila } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { fetchNotifications, message, type TripNotification } from '../../../lib/tripNotifications'
import { DRIVER_TRIP_STATUS_LABELS as TRIP_STATUS_LABELS } from '../../../lib/driverTripStatus'

type ScheduleTrip = {
  itinerary_id: number
  booking_id: number
  status: string
  trip_date_from: string
  trip_start_at: string | null
  trip_end_at: string | null
  route: string
  truck: string | null
  trailer: string | null
}

async function fetchMySchedule(employeeId: number): Promise<ScheduleTrip[]> {
  const { data: crewRows, error: crewError } = await supabase
    .from('itinerary_crews')
    .select('itinerary_id')
    .eq('employee_id', employeeId)
    .eq('is_active', true)
    .in('crew_role', ['Driver', 'Helper'])
  if (crewError) throw new Error(crewError.message)
  const ids = crewRows.map((r) => r.itinerary_id)
  if (ids.length === 0) return []

  const { data: trips, error: tripsError } = await supabase
    .from('itineraries')
    .select(
      'itinerary_id, booking_id, itinerary_status, trip_date_from, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id, plate_number, trailer_id',
    )
    .in('itinerary_id', ids)
    .not('itinerary_status', 'in', '(Delivered,Cancelled)')
  if (tripsError) throw new Error(tripsError.message)

  const placeIds = Array.from(new Set(trips.flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])))
  const trailerIds = Array.from(new Set(trips.map((t) => t.trailer_id).filter((id): id is number => id !== null)))
  const [{ data: places }, { data: trailers }] = await Promise.all([
    placeIds.length
      ? supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
      : Promise.resolve({ data: [] as { place_id: number; place_name: string }[] }),
    trailerIds.length
      ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[] }),
  ])
  const placeName = new Map((places ?? []).map((p) => [p.place_id, p.place_name]))
  const trailerPlate = new Map((trailers ?? []).map((t) => [t.trailer_id, t.plate_number]))

  return trips
    .map((t) => ({
      itinerary_id: t.itinerary_id,
      booking_id: t.booking_id,
      status: t.itinerary_status ?? 'Awaiting',
      trip_date_from: t.trip_date_from,
      trip_start_at: t.trip_start_at,
      trip_end_at: t.trip_end_at,
      route: `${placeName.get(t.place_of_pickup_id) ?? '—'} → ${placeName.get(t.place_of_delivery_id) ?? '—'}`,
      truck: t.plate_number,
      trailer: t.trailer_id !== null ? (trailerPlate.get(t.trailer_id) ?? `Trailer #${t.trailer_id}`) : null,
    }))
    .sort((a, b) =>
      (a.trip_start_at ?? `${a.trip_date_from}T23:59`).localeCompare(b.trip_start_at ?? `${b.trip_date_from}T23:59`),
    )
}

const NOTE_ICON: Record<TripNotification['kind'], string> = {
  assigned: 'M12 5v14 M5 12h14',
  rescheduled: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
  removed: 'M5 12h14',
}
const NOTE_TITLE: Record<TripNotification['kind'], string> = {
  assigned: 'Assigned to a trip',
  rescheduled: 'Time slot changed',
  removed: 'Removed from a trip',
}

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'

function MyScheduleSection() {
  const { employeeId } = useAuth()
  const [trips, setTrips] = useState<ScheduleTrip[] | null>(null)
  const [notes, setNotes] = useState<TripNotification[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    fetchMySchedule(employeeId)
      .then((t) => !cancelled && setTrips(t))
      .catch((e: Error) => !cancelled && setError(e.message))
    fetchNotifications(employeeId)
      .then((n) => !cancelled && setNotes(n.slice(0, 6)))
      .catch(() => !cancelled && setNotes([]))
    return () => {
      cancelled = true
    }
  }, [employeeId])

  // "Today"/"Tomorrow" as of when the page opened (Manila dates).
  const [{ today, tomorrow }] = useState(() => {
    const now = Date.now()
    return { today: toManilaDate(new Date(now)), tomorrow: toManilaDate(new Date(now + 86_400_000)) }
  })

  // Group by the trip's Manila day.
  const dayOf = (t: ScheduleTrip) => (t.trip_start_at ? splitManila(t.trip_start_at).date : t.trip_date_from)
  const weekday = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  const days: { day: string; trips: ScheduleTrip[] }[] = []
  for (const t of trips ?? []) {
    const d = dayOf(t)
    const group = days.find((g) => g.day === d)
    if (group) group.trips.push(t)
    else days.push({ day: d, trips: [t] })
  }

  return (
    <div>
      <PageHeader
        title={
          <>
            My Schedule{' '}
            <span className="ml-1 rounded-[2px] bg-slate-200 px-2 py-0.5 align-middle text-xs font-semibold text-ink-secondary">View only</span>
          </>
        }
        subtitle="Your upcoming trips and their time slots."
      />

      {!employeeId ? (
        <p className="text-ink-muted">Your account isn't linked to an employee record.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
          <section aria-label="Upcoming trips" className="card flex min-h-[calc(100dvh-14rem)] flex-col">
            <div className="flex-1 overflow-x-auto">
              {error ? (
                <p className="p-5 text-red-700">{error}</p>
              ) : trips === null ? (
                <p className="p-5 text-ink-muted">Loading your schedule…</p>
              ) : trips.length === 0 ? (
                <EmptyState message="No upcoming trips." hint="New trips appear here when dispatch assigns you." className="m-5" />
              ) : (
                <table className="w-full min-w-[820px] text-left text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className={TH}>Time Slot</th>
                      <th className={TH}>Trip</th>
                      <th className={TH}>Route</th>
                      <th className={TH}>Truck · Trailer</th>
                      <th className={TH}>Status</th>
                    </tr>
                  </thead>
                  {days.map((group) => (
                    <tbody key={group.day}>
                      <tr className="border-b border-line bg-slate-50">
                        <th scope="rowgroup" colSpan={5} className="px-5 py-2 text-left text-sm font-semibold text-ink normal-case tracking-normal">
                          {group.day === today ? 'Today' : group.day === tomorrow ? 'Tomorrow' : weekday(group.day)}
                          {(group.day === today || group.day === tomorrow) && (
                            <span className="ml-2 font-medium text-ink-muted">{weekday(group.day)}</span>
                          )}
                        </th>
                      </tr>
                      {group.trips.map((t) => (
                        <tr key={t.itinerary_id} className="h-[60px] border-b border-slate-200">
                          <td className={`${TD} font-semibold text-ink`}>
                            {t.trip_start_at
                              ? `${formatTime(t.trip_start_at)}${t.trip_end_at ? ` – ${formatTime(t.trip_end_at)}` : ''}`
                              : 'Time not set yet'}
                          </td>
                          <td className={TD}>
                            Trip #{t.itinerary_id} · Booking #{t.booking_id}
                          </td>
                          <td className={TD}>{t.route}</td>
                          <td className={TD}>
                            {t.truck || t.trailer ? (
                              `${t.truck ?? '—'} · ${t.trailer ?? '—'}`
                            ) : (
                              <span className="text-amber-900">Not assigned yet</span>
                            )}
                          </td>
                          <td className={TD}>
                            <StatusBadge status={t.status} label={TRIP_STATUS_LABELS[t.status]} icon />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              )}
            </div>
            <p className="border-t border-line px-5 py-3 text-sm text-ink-secondary">
              Dispatch sets time slots. When one changes, the trip bell lets you know.
            </p>
          </section>

          <aside aria-labelledby="updates-h" className="card px-5 py-4">
            <h2 id="updates-h" className="text-base font-semibold text-ink">
              Trip updates
            </h2>
            <p className="text-[13px] text-ink-muted">Checked every minute. Opening the bell marks these as read.</p>
            {notes === null ? (
              <p className="py-3 text-sm text-ink-muted">Loading…</p>
            ) : notes.length === 0 ? (
              <p className="py-3 text-sm text-ink-muted">No trip updates yet.</p>
            ) : (
              <ul className="mt-2">
                {notes.map((n) => (
                  <li key={n.notification_id} className="flex gap-3 border-b border-slate-200 py-3 text-sm last:border-0">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-primary" aria-hidden="true">
                      <path d={NOTE_ICON[n.kind]} />
                    </svg>
                    <span>
                      <strong className="text-ink">{NOTE_TITLE[n.kind]}</strong>
                      {n.read_at === null && <span className="ml-2 rounded-[2px] bg-primary-soft px-1.5 text-xs font-semibold text-primary">New</span>}
                      <span className="block text-ink-secondary">{message(n)}</span>
                      <span className="block text-[13px] text-ink-muted">{formatDateTime(n.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

export default MyScheduleSection
