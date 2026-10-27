// DriverTasks: the Dashboard's "My Tasks" for a driver (or helper) -- the
// canvas's Driver Dashboard board. Shows the trips they're assigned to that
// aren't finished yet. itinerary_crews is the link table between an
// employee and an itinerary; we filter it to this crew role and to
// is_active = true -- the Dispatch Board keeps a reassigned driver's old
// row as is_active: false, and that trip isn't theirs any more.
//
// Trips already on the road are listed first ("On the road", one wide card
// each), then the ones not started yet ("Upcoming", two cards per row).
// Beside them: the trip steps and their last two delivered trips. Only a
// Driver can advance status or add expenses; a Helper sees the same list
// read-only.
//
// Report Issue / Inspection and Issue Maintenance Request live in the
// EmployeeDashboard header, not here. Picked Up / In Transit trips show
// whether the client's payment allows unloading (TripPaymentBanner).
import { useEffect, useEffectEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import UpdateStatusControl from './UpdateStatusControl'
import { DRIVER_TRIP_STATUS_LABELS as TRIP_STATUS_LABELS } from '../../../lib/driverTripStatus'
import AddExpenseModal from './AddExpenseModal'
import TripPaymentBanner from './TripPaymentBanner'
import TripStorageBanner from './TripStorageBanner'
import StatusBadge from '../../../components/StatusBadge'
import { formatMoney, formatDate, formatSlot } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import { tripCargoLabel, type TripCargo } from '../../../lib/quoteRequest'
import { tripOnRoad } from '../../../lib/tripSchedule'

type Trip = {
  itinerary_id: number
  booking_id: number
  trip_date_from: string
  trip_date_to: string | null
  // Time slot set by dispatch (null on trips from before slots existed).
  trip_start_at: string | null
  trip_end_at: string | null
  itinerary_status: string
  pickup_place_name: string
  delivery_place_name: string
  plate_number: string | null
  trailer_label: string | null
  expenses: { amount: number; description: string }[]
  // What this trip carries (itineraries.cargo_*).
  cargo: TripCargo
}

// A delivered trip for the "Recent trips" panel.
type RecentTrip = { itinerary_id: number; booking_id: number; slot: string; plate: string | null }

const LABEL = 'text-[13px] leading-[18px] font-medium text-ink-muted'
const VALUE = 'm-0 text-[15px] leading-[22px] font-semibold text-ink'
const GROUP_HEADING = 'flex items-center gap-2 text-xs font-semibold tracking-[0.06em] text-ink-secondary uppercase'

// The four steps a driver moves a trip through (Delivered is set by dispatch).
const STEPS: { status: string; tone: string }[] = [
  { status: 'Awaiting', tone: 'bg-amber-100 text-amber-900' },
  { status: 'Dispatched', tone: 'bg-primary-soft text-primary' },
  { status: 'PickedUp', tone: 'bg-violet-100 text-violet-800' },
  { status: 'InTransit', tone: 'bg-green-100 text-green-800' },
]

function Field({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: 1 | 2 | 4 }) {
  return (
    <div className={span === 4 ? 'col-span-full' : span === 2 ? 'col-span-2' : ''}>
      <dt className={LABEL}>{label}</dt>
      <dd className={VALUE}>{children}</dd>
    </div>
  )
}

function DriverTasks({ crewRole }: { crewRole: 'Driver' | 'Helper' }) {
  const { employeeId } = useAuth()
  const isDriver = crewRole === 'Driver'
  const [trips, setTrips] = useState<Trip[]>([])
  const [recent, setRecent] = useState<RecentTrip[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expenseTripId, setExpenseTripId] = useState<number | null>(null)

  async function loadTrips(crewEmployeeId: number) {
    setLoading(true)

    // 1. Which itineraries is this person currently assigned to?
    const { data: crewRows, error: crewError } = await supabase
      .from('itinerary_crews')
      .select('itinerary_id')
      .eq('employee_id', crewEmployeeId)
      .eq('crew_role', crewRole)
      .eq('is_active', true)

    if (crewError) {
      setError(crewError.message)
      setLoading(false)
      return
    }

    const itineraryIds = crewRows.map((row) => row.itinerary_id)
    if (itineraryIds.length === 0) {
      setTrips([])
      setRecent([])
      setError(null)
      setLoading(false)
      return
    }

    // 2. Load those itineraries, skipping finished/cancelled ones -- plus
    // the two most recently delivered, for the "Recent trips" panel.
    const [openResult, recentResult] = await Promise.all([
      supabase
        .from('itineraries')
        .select(
          'itinerary_id, booking_id, trip_date_from, trip_date_to, trip_start_at, trip_end_at, itinerary_status, place_of_pickup_id, place_of_delivery_id, plate_number, trailer_id, cargo_type, container_type, trailer_type, weight, cargo_description',
        )
        .in('itinerary_id', itineraryIds)
        .not('itinerary_status', 'in', '(Delivered,Cancelled)')
        .order('trip_date_from', { ascending: true }),
      supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, trip_date_from, trip_start_at, trip_end_at, plate_number')
        .in('itinerary_id', itineraryIds)
        .eq('itinerary_status', 'Delivered')
        .order('trip_date_from', { ascending: false })
        .order('itinerary_id', { ascending: false })
        .limit(2),
    ])

    if (openResult.error) {
      setError(openResult.error.message)
      setLoading(false)
      return
    }
    const itineraries = openResult.data
    setRecent(
      (recentResult.data ?? []).map((t) => ({
        itinerary_id: t.itinerary_id,
        booking_id: t.booking_id,
        slot: t.trip_start_at ? formatSlot(t.trip_start_at, t.trip_end_at) : formatDate(t.trip_date_from),
        plate: t.plate_number,
      })),
    )

    // 3. Place names, trailer plates, and this person's own logged
    // expenses (itineraries only stores IDs) -- in parallel.
    const placeIds = Array.from(
      new Set(itineraries.flatMap((trip) => [trip.place_of_pickup_id, trip.place_of_delivery_id])),
    )
    const trailerIds = itineraries.map((trip) => trip.trailer_id).filter((id): id is number => id !== null)
    const openIds = itineraries.map((trip) => trip.itinerary_id)

    const [placesResult, trailersResult, expensesResult] = await Promise.all([
      placeIds.length > 0
        ? supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
        : Promise.resolve({ data: [] as { place_id: number; place_name: string }[], error: null }),
      trailerIds.length > 0
        ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
        : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[], error: null }),
      openIds.length > 0
        ? supabase
            .from('itinerary_expenses')
            .select('itinerary_id, amount, description')
            .in('itinerary_id', openIds)
            .eq('employee_id', crewEmployeeId)
            .order('created_at', { ascending: true })
        : Promise.resolve({
            data: [] as { itinerary_id: number; amount: number; description: string }[],
            error: null,
          }),
    ])

    const lookupError = placesResult.error ?? trailersResult.error ?? expensesResult.error
    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }

    const placeNameById = new Map((placesResult.data ?? []).map((place) => [place.place_id, place.place_name]))
    const trailerPlateById = new Map((trailersResult.data ?? []).map((t) => [t.trailer_id, t.plate_number]))

    setTrips(
      itineraries.map((trip) => ({
        itinerary_id: trip.itinerary_id,
        booking_id: trip.booking_id,
        trip_date_from: trip.trip_date_from,
        trip_date_to: trip.trip_date_to,
        trip_start_at: trip.trip_start_at,
        trip_end_at: trip.trip_end_at,
        itinerary_status: trip.itinerary_status,
        pickup_place_name: placeNameById.get(trip.place_of_pickup_id) ?? '—',
        delivery_place_name: placeNameById.get(trip.place_of_delivery_id) ?? '—',
        plate_number: trip.plate_number,
        trailer_label:
          trip.trailer_id !== null ? (trailerPlateById.get(trip.trailer_id) ?? `Trailer #${trip.trailer_id}`) : null,
        expenses: (expensesResult.data ?? []).filter((e) => e.itinerary_id === trip.itinerary_id),
        cargo: {
          cargo_type: trip.cargo_type,
          container_type: trip.container_type,
          trailer_type: trip.trailer_type,
          weight: trip.weight,
          cargo_description: trip.cargo_description,
        },
      })),
    )
    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever employeeId changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    if (employeeId) {
      loadTrips(employeeId)
    } else {
      // Account has no linked employees row (users.employee_id is null)
      // -- nothing to look up, don't sit on "Loading..." forever.
      setLoading(false)
    }
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [employeeId])

  // Called by UpdateStatusControl after a successful status change.
  // "Delivered" trips drop out of this list entirely (matches the
  // Delivered/Cancelled exclusion in loadTrips); other changes just
  // update the badge in place.
  function handleStatusChanged(itineraryId: number, newStatus: string) {
    if (newStatus === 'Delivered') {
      setTrips((prev) => prev.filter((t) => t.itinerary_id !== itineraryId))
      return
    }
    setTrips((prev) => prev.map((t) => (t.itinerary_id === itineraryId ? { ...t, itinerary_status: newStatus } : t)))
  }

  if (!employeeId) {
    return (
      <p className="text-red-700">
        Your account is not linked to an employee record, so no trips can be shown. Ask an admin to fix it.
      </p>
    )
  }

  const expenseTotal = (trip: Trip) => trip.expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  function renderTrip(trip: Trip, wide: boolean) {
    const slot = trip.trip_start_at ? (
      formatSlot(trip.trip_start_at, trip.trip_end_at)
    ) : (
      <>
        {formatDate(trip.trip_date_from)}
        {trip.trip_date_to ? ` – ${formatDate(trip.trip_date_to)}` : ''}
      </>
    )
    const noVehicles = trip.plate_number === null || trip.trailer_label === null
    const vehicles = noVehicles ? (
      <span className="text-amber-900">
        {trip.plate_number || trip.trailer_label ? `${trip.plate_number ?? '—'} · ${trip.trailer_label ?? '—'}` : 'Not assigned yet'}
      </span>
    ) : (
      `${trip.plate_number} · ${trip.trailer_label}`
    )

    return (
      <article
        key={trip.itinerary_id}
        aria-label={`Trip #${trip.itinerary_id}`}
        className={`flex flex-col gap-3 border-2 bg-white px-[18px] py-4 ${wide ? 'border-primary' : 'border-line-card'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className={`font-bold text-ink ${wide ? 'text-[17px] leading-6' : 'text-base'}`}>
            Trip #{trip.itinerary_id} · Booking #{trip.booking_id}
          </span>
          <StatusBadge status={trip.itinerary_status} label={TRIP_STATUS_LABELS[trip.itinerary_status]} icon />
        </div>

        <dl className={`grid gap-x-5 gap-y-2.5 ${wide ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-2'}`}>
          <Field label="Route" span={wide ? 2 : 4}>
            {trip.pickup_place_name} → {trip.delivery_place_name}
          </Field>
          <Field label="Time slot">{slot}</Field>
          <Field label="Truck · Trailer">{vehicles}</Field>
          {wide && (
            <Field label="Cargo" span={2}>
              {tripCargoLabel(trip.cargo)}
              {trip.cargo.cargo_description && (
                <span className="block text-sm font-medium text-ink-muted">{trip.cargo.cargo_description}</span>
              )}
            </Field>
          )}
          {isDriver && (wide || trip.expenses.length > 0) && (
            <Field label="Your expenses" span={2}>
              {formatMoney(expenseTotal(trip))}
            </Field>
          )}
        </dl>

        {/* Still at the port: last-free-storage-day deadline, if any (#15). */}
        {(trip.itinerary_status === 'Awaiting' || trip.itinerary_status === 'Dispatched') && (
          <TripStorageBanner itineraryId={trip.itinerary_id} />
        )}
        {/* Once the cargo is on board: may it be unloaded? (#13) */}
        {(trip.itinerary_status === 'PickedUp' || trip.itinerary_status === 'InTransit') && (
          <TripPaymentBanner key={trip.itinerary_status} itineraryId={trip.itinerary_id} />
        )}
        {trip.itinerary_status === 'Awaiting' && noVehicles && (
          <p className="flex items-center gap-2.5 border border-dashed border-line-control bg-slate-50 px-3.5 py-2.5 text-sm text-ink-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8h.01 M11 12h1v5h1" />
            </svg>
            Dispatch still needs to assign a truck and trailer.
          </p>
        )}

        {isDriver ? (
          <UpdateStatusControl
            itineraryId={trip.itinerary_id}
            currentStatus={trip.itinerary_status}
            hasTruck={!noVehicles}
            busyOnTripId={
              tripOnRoad(
                trips.map((t) => ({ itinerary_id: t.itinerary_id, status: t.itinerary_status })),
                trip.itinerary_id,
              )?.itinerary_id ?? null
            }
            summary={`${trip.pickup_place_name} → ${trip.delivery_place_name} · ${trip.plate_number ?? 'no truck'} · ${trip.trailer_label ?? 'no trailer'}`}
            onStatusChanged={handleStatusChanged}
          >
            <button type="button" onClick={() => setExpenseTripId(trip.itinerary_id)} className="btn-secondary px-4 text-sm font-medium">
              + Add Expense
            </button>
          </UpdateStatusControl>
        ) : (
          <p className="text-[13px] text-ink-muted">Only the driver can update this trip.</p>
        )}
      </article>
    )
  }

  const onTheRoad = trips.filter((t) => t.itinerary_status !== 'Awaiting')
  const upcoming = trips.filter((t) => t.itinerary_status === 'Awaiting')
  const expenseTrip = trips.find((t) => t.itinerary_id === expenseTripId)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
      <section aria-labelledby="my-tasks-h" className="flex min-w-0 flex-col gap-3">
        <h2 id="my-tasks-h" className="text-base font-semibold text-ink">
          My Tasks <span className="font-medium text-ink-muted">· only trips you're assigned to</span>
        </h2>

        {loading ? (
          <p className="text-ink-muted">Loading your trips...</p>
        ) : error ? (
          <p className="text-red-700">{error}</p>
        ) : trips.length === 0 ? (
          <EmptyState message="Nothing assigned yet." hint="New trips show up here when dispatch assigns you." />
        ) : (
          <>
            {onTheRoad.length > 0 && (
              <>
                <h3 className={GROUP_HEADING}>
                  <span className="h-2.5 w-2.5 bg-violet-800" aria-hidden="true" />
                  On the road
                </h3>
                {onTheRoad.map((trip) => renderTrip(trip, true))}
              </>
            )}
            {upcoming.length > 0 && (
              <>
                <h3 className={`${GROUP_HEADING} mt-1`}>
                  <span className="h-2.5 w-2.5 bg-amber-600" aria-hidden="true" />
                  Upcoming
                </h3>
                <div className="grid gap-3 lg:grid-cols-2">{upcoming.map((trip) => renderTrip(trip, false))}</div>
              </>
            )}
          </>
        )}
      </section>

      <aside className="flex flex-col gap-4">
        <section aria-labelledby="steps-h" className="card px-5 py-4">
          <h2 id="steps-h" className="mb-2.5 text-base font-semibold text-ink">
            Trip steps
          </h2>
          <ol className="flex flex-col gap-2 text-sm">
            {STEPS.map((step, i) => (
              <li key={step.status} className="flex items-center gap-2.5">
                <span className={`rounded-[2px] px-2 py-0.5 text-xs font-semibold ${step.tone}`}>{i + 1}</span>
                {TRIP_STATUS_LABELS[step.status]}
              </li>
            ))}
          </ol>
          <p className="mt-2.5 text-[13px] leading-[18px] text-ink-muted">
            {isDriver
              ? "Move a trip one step at a time. You can't skip a step or go back. Dispatch confirms Delivered on the Dispatch Board."
              : 'The driver moves the trip forward. You see the same steps.'}
          </p>
        </section>

        <section aria-labelledby="recent-h" className="card px-5 py-4">
          <h2 id="recent-h" className="mb-1 text-base font-semibold text-ink">
            Recent trips
          </h2>
          {recent === null ? (
            <p className="py-2 text-sm text-ink-muted">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="py-2 text-sm text-ink-muted">No delivered trips yet.</p>
          ) : (
            recent.map((r) => (
              <div key={r.itinerary_id} className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 text-sm">
                <span>
                  <strong className="text-ink">
                    Trip #{r.itinerary_id} · Booking #{r.booking_id}
                  </strong>
                  <span className="block text-[13px] text-ink-muted">
                    {r.slot}
                    {r.plate ? ` · ${r.plate}` : ''}
                  </span>
                </span>
                <StatusBadge status="Delivered" icon />
              </div>
            ))
          )}
          <Link to="/dashboard/history" className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
            {isDriver ? 'Open My Trips History' : 'Open My History'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14 M13 6l6 6-6 6" />
            </svg>
          </Link>
        </section>
      </aside>

      {expenseTrip && (
        <AddExpenseModal
          itineraryId={expenseTrip.itinerary_id}
          spentSoFar={expenseTotal(expenseTrip)}
          onClose={() => {
            setExpenseTripId(null)
            // Refresh so a just-added expense shows on the trip card.
            loadTrips(employeeId)
          }}
        />
      )}
    </div>
  )
}

export default DriverTasks
