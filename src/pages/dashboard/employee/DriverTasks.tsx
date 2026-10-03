// DriverTasks: shows the logged-in driver's (or helper's) assigned trips
// that aren't finished yet. itinerary_crews is the link table between an
// employee and an itinerary; we filter it to this crew role and to
// is_active = true -- the Dispatch Board keeps a reassigned driver's old
// row as is_active: false, and that trip isn't theirs any more.
//
// Trips already on the road are listed first ("On the road"), then the
// ones not started yet ("Upcoming"). Only a Driver can advance status;
// a Helper sees the same list read-only (no status changes, no expenses).
//
// Report Issue / Inspection and Issue Maintenance Request live in the
// EmployeeDashboard header, not here.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { formatDate } from '../../../lib/quoteRequest'
import UpdateStatusControl, { TRIP_STATUS_LABELS } from './UpdateStatusControl'
import AddExpenseModal from './AddExpenseModal'

type Trip = {
  itinerary_id: number
  trip_date_from: string
  trip_date_to: string | null
  itinerary_status: string
  pickup_place_name: string
  delivery_place_name: string
  plate_number: string | null
  trailer_label: string | null
  expenses: { amount: number; description: string }[]
}

const STATUS_STYLES: Record<string, string> = {
  Awaiting: 'bg-gray-100 text-gray-700',
  Dispatched: 'bg-blue-100 text-blue-700',
  PickedUp: 'bg-purple-100 text-purple-700',
  InTransit: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

export function StatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`px-3 py-1 text-xs font-semibold ${styles}`}>
      {TRIP_STATUS_LABELS[status] ?? status}
    </span>
  )
}

function DriverTasks({ crewRole }: { crewRole: 'Driver' | 'Helper' }) {
  const { employeeId } = useAuth()
  const [trips, setTrips] = useState<Trip[]>([])
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
      setError(null)
      setLoading(false)
      return
    }

    // 2. Load those itineraries, skipping finished/cancelled ones.
    const { data: itineraries, error: itineraryError } = await supabase
      .from('itineraries')
      .select(
        'itinerary_id, trip_date_from, trip_date_to, itinerary_status, place_of_pickup_id, place_of_delivery_id, plate_number, trailer_id',
      )
      .in('itinerary_id', itineraryIds)
      .not('itinerary_status', 'in', '(Delivered,Cancelled)')
      .order('trip_date_from', { ascending: true })

    if (itineraryError) {
      setError(itineraryError.message)
      setLoading(false)
      return
    }

    // 3. Place names, trailer plates, and this person's own logged
    // expenses (itineraries only stores IDs) -- in parallel.
    const placeIds = Array.from(
      new Set(
        itineraries.flatMap((trip) => [
          trip.place_of_pickup_id,
          trip.place_of_delivery_id,
        ]),
      ),
    )
    const trailerIds = itineraries
      .map((trip) => trip.trailer_id)
      .filter((id): id is number => id !== null)
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

    const placeNameById = new Map(
      (placesResult.data ?? []).map((place) => [place.place_id, place.place_name]),
    )
    const trailerPlateById = new Map(
      (trailersResult.data ?? []).map((t) => [t.trailer_id, t.plate_number]),
    )

    setTrips(
      itineraries.map((trip) => ({
        itinerary_id: trip.itinerary_id,
        trip_date_from: trip.trip_date_from,
        trip_date_to: trip.trip_date_to,
        itinerary_status: trip.itinerary_status,
        pickup_place_name: placeNameById.get(trip.place_of_pickup_id) ?? '—',
        delivery_place_name:
          placeNameById.get(trip.place_of_delivery_id) ?? '—',
        plate_number: trip.plate_number,
        trailer_label:
          trip.trailer_id !== null
            ? (trailerPlateById.get(trip.trailer_id) ?? `Trailer #${trip.trailer_id}`)
            : null,
        expenses: (expensesResult.data ?? []).filter((e) => e.itinerary_id === trip.itinerary_id),
      })),
    )
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    if (employeeId) {
      loadTrips(employeeId)
    } else {
      // Account has no linked employees row (users.employee_id is null)
      // -- nothing to look up, don't sit on "Loading..." forever.
      setLoading(false)
    }
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
    setTrips((prev) =>
      prev.map((t) =>
        t.itinerary_id === itineraryId
          ? { ...t, itinerary_status: newStatus }
          : t,
      ),
    )
  }

  if (!employeeId) {
    return (
      <p className="text-red-700">
        Your account is not linked to an employee record, so no trips can be
        shown. Ask an admin to fix it.
      </p>
    )
  }
  if (loading) return <p className="text-slate-500">Loading your trips...</p>
  if (error) return <p className="text-red-700">{error}</p>
  if (trips.length === 0) {
    return <p className="text-slate-500">Nothing assigned yet.</p>
  }

  function renderTrip(trip: Trip) {
    const onTheRoad = trip.itinerary_status !== 'Awaiting'
    const expenseTotal = trip.expenses.reduce((sum, e) => sum + Number(e.amount), 0)

    return (
      <div
        key={trip.itinerary_id}
        className={`rounded-xl border p-5 ${
          onTheRoad ? 'border-slate-900' : 'border-slate-200'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-semibold text-slate-900">
            {trip.pickup_place_name} → {trip.delivery_place_name}
          </p>
          <StatusBadge status={trip.itinerary_status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {formatDate(trip.trip_date_from)}
          {trip.trip_date_to ? ` – ${formatDate(trip.trip_date_to)}` : ''}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Truck:{' '}
          {trip.plate_number ?? <span className="text-slate-400">not assigned yet</span>}
          {' · '}Trailer:{' '}
          {trip.trailer_label ?? <span className="text-slate-400">none</span>}
        </p>

        {crewRole === 'Driver' && (
          <UpdateStatusControl
            itineraryId={trip.itinerary_id}
            currentStatus={trip.itinerary_status}
            hasTruck={trip.plate_number !== null}
            onStatusChanged={handleStatusChanged}
          />
        )}

        {/* Expenses are Driver-only: a Helper doesn't see or add them */}
        {crewRole === 'Driver' && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          {trip.expenses.length > 0 && (
            <div className="mb-2 text-sm text-slate-600">
              <p className="font-medium text-slate-700">
                Your expenses: ₱{expenseTotal.toLocaleString()}
              </p>
              {trip.expenses.map((e, i) => (
                <p key={i} className="text-xs text-slate-500">
                  ₱{Number(e.amount).toLocaleString()} · {e.description}
                </p>
              ))}
            </div>
          )}
          <button
            onClick={() => setExpenseTripId(trip.itinerary_id)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Add Expense
          </button>
        </div>
        )}
      </div>
    )
  }

  const onTheRoad = trips.filter((t) => t.itinerary_status !== 'Awaiting')
  const upcoming = trips.filter((t) => t.itinerary_status === 'Awaiting')

  return (
    <div className="grid gap-6">
      {onTheRoad.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            On the road
          </h3>
          <div className="grid gap-4">{onTheRoad.map(renderTrip)}</div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Upcoming
          </h3>
          <div className="grid gap-4">{upcoming.map(renderTrip)}</div>
        </div>
      )}

      {expenseTripId !== null && (
        <AddExpenseModal
          itineraryId={expenseTripId}
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
