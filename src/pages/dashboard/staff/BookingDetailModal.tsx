// BookingDetailModal: full detail view for one booking -- the money
// summary passed in from the list (Booking), plus everything else loaded
// here on open: cargo, schedule, terms, exact addresses (with links to
// pinned spots), the source quote's reference, and the booking's trips
// (each itinerary with its status, driver, truck, trailer, documents).
// With `inline` it renders as a card in the page instead of a pop-up
// (the Bookings page's "full details" view).
//
// Also where a booking is cancelled (only when `onChanged` is passed --
// the Bookings page does, the read-only ClientBookingHistoryModal
// doesn't). Cancel rules:
//   - blocked while any trip is on the road (Dispatched/PickedUp/
//     InTransit) -- that has to be settled on the Dispatch Board first
//   - no trip delivered yet -> the booking becomes Cancelled and all its
//     Awaiting trips are cancelled too
//   - some trips already delivered -> only the remaining Awaiting trips
//     are cancelled; the booking itself then becomes Delivered on its
//     own (sync_booking_status trigger), so the delivered trips still get
//     billed -- a Cancelled booking is left out of Payments Due/revenue.
// Steps aren't in one DB transaction (same known limitation as
// QuoteReviewModal) -- a failure partway says exactly what was saved.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { isAdmin } from '../../../lib/roles'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import { freeVehicleIfIdle } from '../../../lib/fleetStatus'
import { formatLocationDisplay } from '../../../lib/locationReference'
import { PAYMENT_TERMS_LABELS } from '../../../lib/quoteRequest'
import type { Booking } from './BookingsSection'
import StatusBadge from '../../../components/StatusBadge'
import TripDocuments from './TripDocuments'
import { formatMoney, formatDate } from '../../../lib/format'

// Same labels/colors as the Dispatch Board's trip statuses (duplicated
// here rather than imported, like EmployeeDetailModal does).
const TRIP_STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked up',
  InTransit: 'In transit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
}
const ON_THE_ROAD = new Set(['Dispatched', 'PickedUp', 'InTransit'])

type Trip = {
  itinerary_id: number
  status: string
  trip_date_from: string | null
  plate_number: string | null
  trailer_id: number | null
  trailer_plate: string | null
  driver: string | null
  helper: string | null
  // Expenses the crew logged on this trip (itinerary_expenses, via the
  // driver's "Add Expense" button).
  expenses: { amount: number; description: string }[]
  // How many files are attached in itinerary_documents (DO photos/PDFs).
  document_count: number
}

type Details = {
  reference_code: string | null
  invoice_number: string | null
  cargo_type: string | null
  cargo_description: string | null
  weight: number | null
  container_type: string | null
  trailer_type: string | null
  payment_terms: string | null
  pickup: string
  delivery: string
  pickup_pin: string | null
  delivery_pin: string | null
  estimated_distance_km: number | null
  preferred_delivery_date: string | null
  is_priority: boolean
  cancellation_reason: string | null
  cancelled_at: string | null
  trips: Trip[]
}

function pinLink(lat: number | null, lng: number | null) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
}

function InfoRow({
  label,
  value,
  pin,
  wide = false,
}: {
  label: string
  value: string
  pin?: string | null
  wide?: boolean
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-slate-900">{value}</p>
      {pin && (
        <a
          href={pin}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
        >
          View pinned spot on map
        </a>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h4 className="col-span-full mt-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
      {children}
    </h4>
  )
}

async function loadDetails(bookingId: number): Promise<{ details?: Details; error?: string }> {
  const { data: b, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'quote_request_id, cargo_type, cargo_description, weight, container_type, trailer_type, payment_terms, place_of_pickup_id, place_of_delivery_id, pickup_address_detail, delivery_address_detail, pickup_lat, pickup_lng, delivery_lat, delivery_lng, estimated_distance_km, cancellation_reason, cancelled_at, invoice_number',
    )
    .eq('booking_id', bookingId)
    .single()
  if (bookingError || !b) return { error: bookingError?.message ?? 'Booking not found.' }

  const [placesResult, quoteResult, tripsResult] = await Promise.all([
    supabase
      .from('places')
      .select('place_id, place_name, city, barangay')
      .in('place_id', [b.place_of_pickup_id, b.place_of_delivery_id]),
    b.quote_request_id !== null
      ? supabase
          .from('quote_requests')
          .select('reference_code, preferred_delivery_date, is_last_day_of_port_storage')
          .eq('quote_request_id', b.quote_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('itineraries')
      .select('itinerary_id, itinerary_status, trip_date_from, plate_number, trailer_id')
      .eq('booking_id', bookingId)
      .order('itinerary_id', { ascending: true }),
  ])
  const firstError = placesResult.error ?? quoteResult.error ?? tripsResult.error
  if (firstError) return { error: firstError.message }

  const trips = tripsResult.data ?? []
  const tripIds = trips.map((t) => t.itinerary_id)
  const trailerIds = trips.map((t) => t.trailer_id).filter((id): id is number => id !== null)

  const [crewsResult, trailersResult, expensesResult, documentsResult] = await Promise.all([
    tripIds.length > 0
      ? supabase
          .from('itinerary_crews')
          .select('itinerary_id, employee_id, crew_role')
          .in('itinerary_id', tripIds)
          .eq('is_active', true)
      : Promise.resolve({
          data: [] as { itinerary_id: number; employee_id: number; crew_role: string }[],
          error: null,
        }),
    trailerIds.length > 0
      ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[], error: null }),
    tripIds.length > 0
      ? supabase
          .from('itinerary_expenses')
          .select('itinerary_id, amount, description')
          .in('itinerary_id', tripIds)
          .order('created_at', { ascending: true })
      : Promise.resolve({
          data: [] as { itinerary_id: number; amount: number; description: string }[],
          error: null,
        }),
    tripIds.length > 0
      ? supabase.from('itinerary_documents').select('itinerary_id').in('itinerary_id', tripIds)
      : Promise.resolve({ data: [] as { itinerary_id: number }[], error: null }),
  ])
  const extraError =
    crewsResult.error ?? trailersResult.error ?? expensesResult.error ?? documentsResult.error
  if (extraError) {
    return { error: extraError.message }
  }

  const crews = crewsResult.data ?? []
  const employeeIds = Array.from(new Set(crews.map((c) => c.employee_id)))
  const { data: employees, error: employeesError } =
    employeeIds.length > 0
      ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds)
      : { data: [] as { employee_id: number; full_name: string }[], error: null }
  if (employeesError) return { error: employeesError.message }

  const nameById = new Map((employees ?? []).map((e) => [e.employee_id, e.full_name]))
  const trailerPlateById = new Map((trailersResult.data ?? []).map((t) => [t.trailer_id, t.plate_number]))
  const crewName = (tripId: number, role: string) => {
    const crew = crews.find((c) => c.itinerary_id === tripId && c.crew_role === role)
    return crew ? (nameById.get(crew.employee_id) ?? `Employee #${crew.employee_id}`) : null
  }

  const placeById = new Map((placesResult.data ?? []).map((p) => [p.place_id, p]))
  const location = (placeId: number, detail: string | null) => {
    const place = placeById.get(placeId)
    if (!place) return detail || '—'
    if (!place.city || !place.barangay) {
      return [detail, place.place_name].filter(Boolean).join(', ') || '—'
    }
    return formatLocationDisplay({ city: place.city, barangay: place.barangay, detail })
  }

  return {
    details: {
      reference_code: quoteResult.data?.reference_code ?? null,
      invoice_number: b.invoice_number,
      cargo_type: b.cargo_type,
      cargo_description: b.cargo_description,
      weight: b.weight,
      container_type: b.container_type,
      trailer_type: b.trailer_type,
      payment_terms: b.payment_terms,
      pickup: location(b.place_of_pickup_id, b.pickup_address_detail),
      delivery: location(b.place_of_delivery_id, b.delivery_address_detail),
      pickup_pin: pinLink(b.pickup_lat, b.pickup_lng),
      delivery_pin: pinLink(b.delivery_lat, b.delivery_lng),
      estimated_distance_km: b.estimated_distance_km,
      preferred_delivery_date: quoteResult.data?.preferred_delivery_date ?? null,
      is_priority: quoteResult.data?.is_last_day_of_port_storage === true,
      cancellation_reason: b.cancellation_reason,
      cancelled_at: b.cancelled_at,
      trips: trips.map((t) => ({
        itinerary_id: t.itinerary_id,
        status: t.itinerary_status ?? 'Awaiting',
        trip_date_from: t.trip_date_from,
        plate_number: t.plate_number,
        trailer_id: t.trailer_id,
        trailer_plate: t.trailer_id !== null ? (trailerPlateById.get(t.trailer_id) ?? null) : null,
        driver: crewName(t.itinerary_id, 'Driver'),
        helper: crewName(t.itinerary_id, 'Helper'),
        expenses: (expensesResult.data ?? []).filter((e) => e.itinerary_id === t.itinerary_id),
        document_count: (documentsResult.data ?? []).filter((d) => d.itinerary_id === t.itinerary_id).length,
      })),
    },
  }
}

function BookingDetailModal({
  booking,
  onClose = () => {},
  onChanged,
  inline = false,
  onMinimize,
  highlightTripId = null,
}: {
  // Trip to highlight + scroll to in the trips table (Bookings' "Find trip").
  highlightTripId?: number | null
  // Inline only: shows a "Minimize" button that collapses the card.
  onMinimize?: () => void
  booking: Booking
  // Not needed when inline (there's nothing to close).
  onClose?: () => void
  // Render as a card in the page (Bookings "full details" view) instead
  // of a pop-up -- same content, no backdrop or Close buttons.
  inline?: boolean
  // When given, staff can cancel the booking from here; called after a
  // cancellation so the list can reload.
  onChanged?: () => void
}) {
  const { employeeId, role } = useAuth()
  const [details, setDetails] = useState<Details | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  // Which trip's documents panel is open under the trips table (null = none).
  const [docsTripId, setDocsTripId] = useState<number | null>(null)

  // Once the trips have loaded, bring the highlighted trip's row into view.
  useEffect(() => {
    if (details && highlightTripId) {
      document.getElementById(`trip-row-${highlightTripId}`)?.scrollIntoView({ block: 'center' })
    }
  }, [details, highlightTripId])

  // Keeps the "N files" label in the table in step with uploads/deletes.
  const updateDocumentCount = useCallback((itineraryId: number, count: number) => {
    setDetails((d) =>
      d && {
        ...d,
        trips: d.trips.map((t) => (t.itinerary_id === itineraryId ? { ...t, document_count: count } : t)),
      },
    )
  }, [])

  const reload = useCallback(() => {
    loadDetails(booking.booking_id).then(({ details: loaded, error }) => {
      if (error) {
        setLoadError(error)
        return
      }
      setDetails(loaded ?? null)
    })
  }, [booking.booking_id])

  useEffect(() => {
    reload()
  }, [reload])

  const trips = details?.trips ?? []
  const awaitingTrips = trips.filter((t) => t.status === 'Awaiting')
  const tripsOnRoad = trips.filter((t) => ON_THE_ROAD.has(t.status))
  const anyDelivered = trips.some((t) => t.status === 'Delivered')
  const isClosed = booking.status === 'Cancelled' || booking.status === 'Delivered'
  // Partial cancel (some trips delivered) only makes sense with trips left to cancel.
  const canCancel = !!onChanged && !!details && !isClosed && (!anyDelivered || awaitingTrips.length > 0)
  const cancelLabel = anyDelivered ? 'Cancel remaining trips' : 'Cancel booking'

  async function handleCancel() {
    if (!details) return
    if (!cancelReason.trim()) {
      setCancelError('Enter a reason for cancelling.')
      return
    }
    if (tripsOnRoad.length > 0) {
      setCancelError(
        `Trip ${tripsOnRoad.map((t) => `#${t.itinerary_id}`).join(', ')} is already on the road. ` +
          'Finish or reset it on the Dispatch Board before cancelling.',
      )
      return
    }

    setCancelling(true)
    setCancelError(null)
    const now = new Date().toISOString()

    // 1. The booking. Full cancel sets Cancelled (guarded so two staff
    // can't both "win"); partial cancel only records the reason -- its
    // status becomes Delivered via the trigger in step 2.
    const { data: updated, error: bookingError } = await supabase
      .from('bookings')
      .update({
        ...(anyDelivered ? {} : { booking_status: 'Cancelled' }),
        cancellation_reason: cancelReason.trim(),
        cancelled_at: now,
      })
      .eq('booking_id', booking.booking_id)
      .neq('booking_status', 'Cancelled')
      .select('booking_id')
      .maybeSingle()

    if (bookingError) {
      setCancelling(false)
      setCancelError(bookingError.message)
      return
    }
    if (!updated) {
      setCancelling(false)
      setCancelError('This booking was already cancelled, or you don\'t have permission to change it. Refresh to see its current state.')
      return
    }

    // 2. Its trips that haven't started. Only rows still Awaiting are
    // touched, so a trip dispatched in the meantime is left alone.
    let cancelledTrips: { itinerary_id: number; plate_number: string | null; trailer_id: number | null }[] = []
    if (awaitingTrips.length > 0) {
      const { data, error: tripsError } = await supabase
        .from('itineraries')
        .update({ itinerary_status: 'Cancelled' })
        .in('itinerary_id', awaitingTrips.map((t) => t.itinerary_id))
        .eq('itinerary_status', 'Awaiting')
        .select('itinerary_id, plate_number, trailer_id')

      if (tripsError) {
        setCancelling(false)
        setCancelError(
          `Booking #${booking.booking_id} was marked cancelled, but its trips couldn't be ` +
            `(${tripsError.message}). This needs manual review on the Dispatch Board.`,
        )
        onChanged?.()
        return
      }
      cancelledTrips = data ?? []

      // Free any truck/trailer that was assigned to a cancelled trip --
      // only if it's In Transit and not on another active trip
      // (lib/fleetStatus.ts), so a vehicle in the shop or out on a
      // different booking is left alone. Best effort.
      for (const trip of cancelledTrips) {
        if (trip.plate_number) {
          const err = await freeVehicleIfIdle(trip.plate_number, null)
          if (err) console.error('Failed to free up truck status:', err)
        }
        if (trip.trailer_id !== null) {
          const err = await freeVehicleIfIdle(null, trip.trailer_id)
          if (err) console.error('Failed to free up trailer status:', err)
        }
      }

      // Log each change like every other trip status change.
      if (cancelledTrips.length > 0) {
        const { error: logError } = await supabase.from('dispatch_status_logs').insert(
          cancelledTrips.map((trip) => ({
            itinerary_id: trip.itinerary_id,
            previous_status: 'Awaiting',
            new_status: 'Cancelled',
            changed_by: employeeId,
          })),
        )
        if (logError) console.error('Failed to log trip cancellations:', logError)
      }
    }

    setCancelling(false)

    if (cancelledTrips.length < awaitingTrips.length) {
      setCancelError(
        `Cancelled, but ${awaitingTrips.length - cancelledTrips.length} trip(s) changed status in the ` +
          'meantime and were left as they are. Check them on the Dispatch Board.',
      )
      onChanged?.()
      return
    }

    // The parent closes this modal in onChanged, so the confirmation has
    // to be a global toast rather than something inside the modal.
    showToast(
      anyDelivered
        ? `Remaining trips for booking #${booking.booking_id} have been cancelled.`
        : `Booking #${booking.booking_id} has been cancelled.`,
    )
    onChanged?.()
  }

  return (
    <div
      className={
        inline
          ? ''
          : 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center'
      }
    >
      <div
        className={
          inline
            ? 'border border-slate-200 bg-white p-5 shadow-sm'
            : 'max-h-[92vh] w-full max-w-3xl overflow-y-auto bg-white p-6 shadow-lg'
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Booking #{booking.booking_id}
              {details?.reference_code && (
                <span className="ml-2 font-mono text-sm font-medium text-slate-500">
                  {details.reference_code}
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-sm text-slate-600">{booking.client_name}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={booking.status} />
            {inline && onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                aria-expanded={true}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Minimize ▴
              </button>
            )}
            {!inline && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {details?.cancellation_reason && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span className="font-semibold">
              {booking.status === 'Cancelled' ? 'Cancelled' : 'Remaining trips cancelled'}
              {details.cancelled_at && ` on ${formatDate(details.cancelled_at)}`}:
            </span>{' '}
            {details.cancellation_reason}
          </p>
        )}

        {loadError && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn't load the full details ({loadError}).
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SectionTitle>Route</SectionTitle>
          <InfoRow label="Pickup" value={details?.pickup ?? booking.pickup_location} pin={details?.pickup_pin} />
          <InfoRow label="Delivery" value={details?.delivery ?? booking.delivery_location} pin={details?.delivery_pin} />
          {details?.estimated_distance_km != null && (
            <InfoRow label="Estimated distance" value={`${details.estimated_distance_km.toLocaleString()} km`} />
          )}

          <SectionTitle>Schedule</SectionTitle>
          <InfoRow label="Pickup date" value={booking.date ? formatDate(booking.date) : '—'} />
          <InfoRow
            label="Delivery date"
            value={
              details?.is_priority
                ? 'Priority (last day of free port storage)'
                : details?.preferred_delivery_date
                  ? formatDate(details.preferred_delivery_date)
                  : '—'
            }
          />

          {details && (
            <>
              <SectionTitle>Cargo</SectionTitle>
              <InfoRow
                label="Type"
                value={[
                  details.cargo_type === 'Loose' ? 'Loose cargo' : details.cargo_type,
                  details.container_type &&
                    `${details.container_type}${details.trailer_type ? ` ${details.trailer_type.toLowerCase()}` : ''} trailer`,
                  details.weight != null && `${details.weight} t`,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              />
              <InfoRow label="Description" value={details.cargo_description || '—'} />
            </>
          )}

          <SectionTitle>Money</SectionTitle>
          <InfoRow label="Rate per trip" value={formatMoney(booking.rate)} />
          <InfoRow
            label="Payment terms"
            value={
              details?.payment_terms
                ? (PAYMENT_TERMS_LABELS[details.payment_terms as keyof typeof PAYMENT_TERMS_LABELS] ??
                  details.payment_terms)
                : '—'
            }
          />
          <InfoRow
            label="Total contract value"
            value={`${formatMoney(booking.total_contract_value)} (${booking.total_trips} ${
              booking.total_trips === 1 ? 'trip' : 'trips'
            })`}
          />
          <InfoRow
            label="Billable so far"
            value={
              formatMoney(booking.billable_amount) +
              (booking.amount_to_pay !== null ? ' (manually set)' : '')
            }
          />
          {booking.damage_charges > 0 && (
            <InfoRow
              label="Incl. damage charges"
              value={formatMoney(booking.damage_charges)}
            />
          )}
          <InfoRow label="Amount paid" value={formatMoney(booking.amount_paid)} />
          <InfoRow label="Balance due" value={formatMoney(booking.balance_due)} />
          <InfoRow label="Invoice no." value={details?.invoice_number || '—'} />
        </div>
        {/* Admin only: the Billing page exists only in the Admin routes */}
        {isAdmin(role) && (
          <Link
            to={`/dashboard/billing/${booking.booking_id}`}
            className="mt-3 inline-block text-sm font-medium text-slate-700 underline hover:text-slate-900"
          >
            Billing
          </Link>
        )}

        <div className="mt-6">
          <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Trips ({booking.completed_trips}/{booking.total_trips} delivered)
          </h4>
          {loadError ? (
            <p className="mt-2 text-sm text-slate-500">Trips couldn't be loaded.</p>
          ) : !details ? (
            <p className="mt-2 text-sm text-slate-500">Loading trips…</p>
          ) : trips.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              This booking has no trips. It may need manual review.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Trip</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Driver</th>
                    <th className="px-3 py-2 font-medium">Truck / trailer</th>
                    <th className="px-3 py-2 font-medium">Expenses</th>
                    <th className="px-3 py-2 font-medium">Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr
                      key={trip.itinerary_id}
                      id={`trip-row-${trip.itinerary_id}`}
                      className={`border-b border-slate-100 last:border-0 ${
                        trip.itinerary_id === highlightTripId ? 'bg-amber-50 outline-2 -outline-offset-2 outline-amber-400' : ''
                      }`}
                    >
                      <td className="px-3 py-2 text-slate-900">
                        #{trip.itinerary_id}
                        {trip.itinerary_id === highlightTripId && (
                          <span className="block text-xs font-medium text-amber-700">Found</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={trip.status} label={TRIP_STATUS_LABELS[trip.status]} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {trip.trip_date_from ? formatDate(trip.trip_date_from) : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {trip.driver ?? <span className="text-slate-400">Not assigned</span>}
                        {trip.helper && (
                          <span className="block text-xs text-slate-500">Helper: {trip.helper}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {trip.plate_number ?? <span className="text-slate-400">No truck</span>}
                        {' / '}
                        {trip.trailer_id !== null
                          ? (trip.trailer_plate ?? `Trailer #${trip.trailer_id}`)
                          : <span className="text-slate-400">no trailer</span>}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {trip.expenses.length === 0 ? (
                          <span className="text-slate-400">None</span>
                        ) : (
                          <>
                            <span className="font-medium text-slate-900">
                              {formatMoney(trip.expenses.reduce((sum, e) => sum + Number(e.amount), 0))}
                            </span>
                            {trip.expenses.map((e, i) => (
                              <span key={i} className="block text-xs text-slate-500">
                                {formatMoney(Number(e.amount))} · {e.description}
                              </span>
                            ))}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {/* Opens this trip's documents panel below the table. Upload
                            only where staff can act (the Bookings page); the
                            read-only client-history view can just look. */}
                        <button
                          type="button"
                          onClick={() =>
                            setDocsTripId(docsTripId === trip.itinerary_id ? null : trip.itinerary_id)
                          }
                          className={`whitespace-nowrap border px-3 py-1 text-xs font-medium ${
                            docsTripId === trip.itinerary_id
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-300 text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {onChanged ? 'Upload Document' : 'View Documents'}
                        </button>
                        {trip.document_count > 0 ? (
                          <span className="mt-1 block text-xs text-slate-500">
                            {trip.document_count} {trip.document_count === 1 ? 'file' : 'files'}
                          </span>
                        ) : trip.status === 'Delivered' ? (
                          <span className="mt-1 block text-xs font-medium text-amber-700">No DO yet</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {docsTripId !== null && trips.some((t) => t.itinerary_id === docsTripId) && (
            <div className="mt-3 border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h5 className="text-sm font-semibold text-slate-900">Trip #{docsTripId} documents</h5>
                <button
                  type="button"
                  onClick={() => setDocsTripId(null)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>
              <TripDocuments
                key={docsTripId}
                itineraryId={docsTripId}
                canEdit={!!onChanged}
                onCountChange={updateDocumentCount}
              />
            </div>
          )}
        </div>

        {showCancel && (
          <div className="mt-6 border border-red-200 bg-red-50/50 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {anyDelivered
                ? `Cancel the ${awaitingTrips.length} trip(s) that haven't started?`
                : `Cancel booking #${booking.booking_id}?`}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {anyDelivered
                ? 'Delivered trips stay on the booking and are still billed.'
                : 'Its trips are cancelled too and any assigned truck or trailer is freed. This can\'t be undone from the app.'}
            </p>
            <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
              Reason
              <textarea
                value={cancelReason}
                onChange={(e) => {
                  setCancelReason(e.target.value)
                  setCancelError(null)
                }}
                rows={2}
                placeholder="e.g. Client called off the shipment"
                className="border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900 focus:border-slate-500 focus:outline-none"
              />
            </label>
            {cancelError && (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {cancelError}
              </p>
            )}
            <div className="mt-3 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowCancel(false)
                  setCancelError(null)
                }}
                disabled={cancelling}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Keep booking
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : cancelLabel}
              </button>
            </div>
          </div>
        )}

        {/* Inline cards only need this footer when there's a cancel button. */}
        {(!inline || (canCancel && !showCancel)) && (
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
            {canCancel && !showCancel ? (
              <button
                type="button"
                onClick={() => setShowCancel(true)}
                className="border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                {cancelLabel}…
              </button>
            ) : (
              <span />
            )}
            {!inline && (
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary px-4 py-2 text-sm font-medium"
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default BookingDetailModal
