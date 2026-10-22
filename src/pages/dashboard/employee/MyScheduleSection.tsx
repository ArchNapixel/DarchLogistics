// MyScheduleSection: "My Schedule" for Drivers and Helpers
// (/dashboard/schedule) -- their upcoming trips with each trip's time
// slot, grouped by day (Today, Tomorrow, then dates). Read-only; the
// trips themselves are worked from My Tasks on the Dashboard.
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
import { formatDate, formatSlot, splitManila } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'

type ScheduleTrip = {
  itinerary_id: number
  status: string
  trip_date_from: string
  trip_start_at: string | null
  trip_end_at: string | null
  route: string
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
    .select('itinerary_id, itinerary_status, trip_date_from, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id')
    .in('itinerary_id', ids)
    .not('itinerary_status', 'in', '(Delivered,Cancelled)')
  if (tripsError) throw new Error(tripsError.message)

  const placeIds = Array.from(new Set(trips.flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])))
  const { data: places } = placeIds.length
    ? await supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
    : { data: [] as { place_id: number; place_name: string }[] }
  const placeName = new Map((places ?? []).map((p) => [p.place_id, p.place_name]))

  return trips
    .map((t) => ({
      itinerary_id: t.itinerary_id,
      status: t.itinerary_status ?? 'Awaiting',
      trip_date_from: t.trip_date_from,
      trip_start_at: t.trip_start_at,
      trip_end_at: t.trip_end_at,
      route: `${placeName.get(t.place_of_pickup_id) ?? '—'} → ${placeName.get(t.place_of_delivery_id) ?? '—'}`,
    }))
    .sort((a, b) =>
      (a.trip_start_at ?? `${a.trip_date_from}T23:59`).localeCompare(b.trip_start_at ?? `${b.trip_date_from}T23:59`),
    )
}

function MyScheduleSection() {
  const { employeeId } = useAuth()
  const [trips, setTrips] = useState<ScheduleTrip[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employeeId) return
    let cancelled = false
    fetchMySchedule(employeeId)
      .then((t) => !cancelled && setTrips(t))
      .catch((e: Error) => !cancelled && setError(e.message))
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
  const dayLabel = (d: string) => (d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : formatDate(d))
  const days: { day: string; trips: ScheduleTrip[] }[] = []
  for (const t of trips ?? []) {
    const d = dayOf(t)
    const group = days.find((g) => g.day === d)
    if (group) group.trips.push(t)
    else days.push({ day: d, trips: [t] })
  }

  return (
    <div>
      <PageHeader title="My Schedule" subtitle="Your upcoming trips and their time slots." />

      {!employeeId ? (
        <p className="mt-4 text-slate-500">Your account isn't linked to an employee record.</p>
      ) : error ? (
        <p className="mt-4 text-red-700">{error}</p>
      ) : trips === null ? (
        <p className="mt-4 text-slate-500">Loading your schedule…</p>
      ) : trips.length === 0 ? (
        <EmptyState message="No upcoming trips." hint="New trips appear here when dispatch assigns you." className="mt-4" />
      ) : (
        <div className="mt-4 grid gap-6">
          {days.map((group) => (
            <section key={group.day}>
              <h3 className="text-sm font-semibold text-slate-900">{dayLabel(group.day)}</h3>
              <ul className="mt-2 divide-y divide-slate-100 border border-slate-200 bg-white">
                {group.trips.map((t) => (
                  <li key={t.itinerary_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {t.trip_start_at ? formatSlot(t.trip_start_at, t.trip_end_at) : 'Time not set yet'}
                      </p>
                      <p className="text-xs text-slate-500">
                        Trip #{t.itinerary_id} · {t.route}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

export default MyScheduleSection
