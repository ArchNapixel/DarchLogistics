// BookingDetailModal: full detail view for one booking -- the money
// summary passed in from the list (Booking), plus everything else loaded
// here on open: cargo, schedule, terms, exact addresses (with links to
// pinned spots), the source quote's reference, and the booking's trips
// (each itinerary with its status, driver, truck, trailer, documents).
// With `inline` it renders as a card in the page instead of a pop-up
// (the Bookings page's right pane). Layout: header (status, Cancel Booking),
// cancelled / downpayment-due banners, Cargo Per Trip + Money cards, a
// "Show Booking Details" toggle (route, schedule, hours per trip), then the
// trips table (cargo, crew, vehicles, expenses, documents). Finished bookings keep cargo + money inside the toggle.
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
import { Fragment, useCallback, useEffect, useState } from 'react'
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
import { tripCargoLabel, type TripCargo } from '../../../lib/quoteRequest'
import { formatMoney, formatDate, slotLines } from '../../../lib/format'
import { chainSlots } from '../../../lib/tripSchedule'
import { downpaymentStatus } from '../../../lib/downpayment'
import { STORAGE_BADGE, storageState } from '../../../lib/storageDeadline'
import { promptDialog } from '../../../components/ConfirmDialog'

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
  // Time slot (null on trips from before slots existed).
  trip_start_at: string | null
  trip_end_at: string | null
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
  // This trip's own cargo (itineraries.cargo_*, per trip since 2026-10-23).
  cargo: TripCargo
  // First time it was logged Picked Up (dispatch_status_logs) -- judges the
  // storage deadline (lib/storageDeadline.ts).
  picked_up_at: string | null
}

type Details = {
  reference_code: string | null
  invoice_number: string | null
  payment_terms: string | null
  pickup: string
  delivery: string
  // Optional landmarks for the driver (display only).
  pickup_landmark: string | null
  delivery_landmark: string | null
  pickup_pin: string | null
  delivery_pin: string | null
  estimated_distance_km: number | null
  // Length of each trip's time slot (bookings.hours_per_trip).
  hours_per_trip: number | null
  // Downpayment inputs (lib/downpayment.ts) and the Admin waiver, if any.
  cost_per_trip: number | null
  downpayment_waived_at: string | null
  downpayment_waive_reason: string | null
  // Shown as "Deadline date" (the latest day the client needs the cargo).
  preferred_delivery_date: string | null
  // Last free storage day (bookings.storage_deadline): every trip must be
  // Picked Up by 11:59 PM that day. Null = not an urgent booking.
  storage_deadline: string | null
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
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-[15px] text-slate-900">{value}</p>
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
  return <h4 className="col-span-full text-sm font-semibold text-slate-900">{children}</h4>
}

// One figure in the Money card: small label, big amount, optional note.
function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold tabular-nums text-slate-900">
        {value}
        {note && <span className="ml-1.5 text-xs font-normal text-slate-500">{note}</span>}
      </p>
    </div>
  )
}

// Small outline icons for the trips table buttons (24x24 paths).
const UPLOAD = 'M12 16V4M7 9l5-5 5 5M4 20h16'
function Icon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

async function loadDetails(bookingId: number): Promise<{ details?: Details; error?: string }> {
  const { data: b, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'quote_request_id, payment_terms, place_of_pickup_id, place_of_delivery_id, pickup_address_detail, delivery_address_detail, pickup_landmark, delivery_landmark, pickup_lat, pickup_lng, delivery_lat, delivery_lng, estimated_distance_km, hours_per_trip, cost_per_trip, downpayment_waived_at, downpayment_waive_reason, cancellation_reason, cancelled_at, invoice_number, storage_deadline',
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
          .select('reference_code, preferred_delivery_date')
          .eq('quote_request_id', b.quote_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('itineraries')
      .select(
        'itinerary_id, itinerary_status, trip_date_from, trip_start_at, trip_end_at, plate_number, trailer_id, cargo_type, container_type, trailer_type, weight, cargo_description',
      )
      .eq('booking_id', bookingId)
      .order('itinerary_id', { ascending: true }),
  ])
  const firstError = placesResult.error ?? quoteResult.error ?? tripsResult.error
  if (firstError) return { error: firstError.message }

  const trips = tripsResult.data ?? []
  const tripIds = trips.map((t) => t.itinerary_id)
  const trailerIds = trips.map((t) => t.trailer_id).filter((id): id is number => id !== null)

  const [crewsResult, trailersResult, expensesResult, documentsResult, pickupLogsResult] = await Promise.all([
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
    // When each trip was picked up -- only needed for the storage deadline.
    tripIds.length > 0 && b.storage_deadline
      ? supabase
          .from('dispatch_status_logs')
          .select('itinerary_id, status_changed_at')
          .in('itinerary_id', tripIds)
          .eq('new_status', 'PickedUp')
          .order('status_changed_at', { ascending: true })
      : Promise.resolve({ data: [] as { itinerary_id: number; status_changed_at: string }[], error: null }),
  ])
  const extraError =
    crewsResult.error ??
    trailersResult.error ??
    expensesResult.error ??
    documentsResult.error ??
    pickupLogsResult.error
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
  // Oldest first, so the first pickup time per trip wins.
  const pickedUpAt = new Map<number, string>()
  for (const log of pickupLogsResult.data ?? []) {
    if (!pickedUpAt.has(log.itinerary_id)) pickedUpAt.set(log.itinerary_id, log.status_changed_at)
  }
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
      payment_terms: b.payment_terms,
      pickup: location(b.place_of_pickup_id, b.pickup_address_detail),
      delivery: location(b.place_of_delivery_id, b.delivery_address_detail),
      pickup_landmark: b.pickup_landmark,
      delivery_landmark: b.delivery_landmark,
      pickup_pin: pinLink(b.pickup_lat, b.pickup_lng),
      delivery_pin: pinLink(b.delivery_lat, b.delivery_lng),
      estimated_distance_km: b.estimated_distance_km,
      hours_per_trip: b.hours_per_trip,
      cost_per_trip: b.cost_per_trip,
      downpayment_waived_at: b.downpayment_waived_at,
      downpayment_waive_reason: b.downpayment_waive_reason,
      preferred_delivery_date: quoteResult.data?.preferred_delivery_date ?? null,
      storage_deadline: b.storage_deadline,
      cancellation_reason: b.cancellation_reason,
      cancelled_at: b.cancelled_at,
      trips: trips.map((t) => ({
        itinerary_id: t.itinerary_id,
        status: t.itinerary_status ?? 'Awaiting',
        trip_date_from: t.trip_date_from,
        trip_start_at: t.trip_start_at,
        trip_end_at: t.trip_end_at,
        plate_number: t.plate_number,
        trailer_id: t.trailer_id,
        trailer_plate: t.trailer_id !== null ? (trailerPlateById.get(t.trailer_id) ?? null) : null,
        driver: crewName(t.itinerary_id, 'Driver'),
        helper: crewName(t.itinerary_id, 'Helper'),
        expenses: (expensesResult.data ?? []).filter((e) => e.itinerary_id === t.itinerary_id),
        document_count: (documentsResult.data ?? []).filter((d) => d.itinerary_id === t.itinerary_id).length,
        picked_up_at: pickedUpAt.get(t.itinerary_id) ?? null,
        cargo: {
          cargo_type: t.cargo_type,
          container_type: t.container_type,
          trailer_type: t.trailer_type,
          weight: t.weight,
          cargo_description: t.cargo_description,
        },
      })),
    },
  }
}

function BookingDetailModal({
  booking,
  onClose = () => {},
  onChanged,
  inline = false,
  highlightTripId = null,
}: {
  // Trip to highlight + scroll to in the trips table (a trip # link/search).
  highlightTripId?: number | null
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
  // "Show Booking Details" toggle: route, schedule (+ cargo/money when finished).
  const [showDetails, setShowDetails] = useState(false)
  // Hours-per-trip editor (staff Bookings only): null = not editing.
  const [hoursDraft, setHoursDraft] = useState<string | null>(null)
  const [hoursSaving, setHoursSaving] = useState(false)
  const [hoursError, setHoursError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  // Which trip's documents panel is open under the trips table (null = none).
  const [docsTripId, setDocsTripId] = useState<number | null>(null)
  // Time the card opened -- enough for the storage badges (render must stay pure).
  const [now] = useState(() => Date.now())

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

  // Downpayment (null = no requirement): non-cancelled trips only.
  const downpayment = details
    ? downpaymentStatus({
        ratePerTrip: booking.rate,
        costPerTrip: details.cost_per_trip,
        trips: details.trips.filter((t) => t.status !== 'Cancelled').length,
        amountPaid: booking.amount_paid,
        waivedAt: details.downpayment_waived_at,
      })
    : null

  // Changing hours per trip also re-times the trips that haven't left yet:
  // from the first Awaiting trip that has a slot, every Awaiting trip after
  // it gets the new length, back to back (chainSlots). Trips already on the
  // road keep their slot. The database re-checks each trip's crew, so an
  // overlap stops that trip's update with a message naming the clash.
  async function saveHoursPerTrip() {
    const hours = Number(hoursDraft)
    if (!(hours > 0) || hours > 72) {
      setHoursError('Enter more than 0 and up to 72 hours.')
      return
    }
    setHoursSaving(true)
    setHoursError(null)
    const { data: updated, error: bookingError } = await supabase
      .from('bookings')
      .update({ hours_per_trip: hours })
      .eq('booking_id', booking.booking_id)
      .select('booking_id')
      .maybeSingle()
    if (bookingError || !updated) {
      setHoursSaving(false)
      setHoursError(bookingError?.message ?? 'The booking was not updated.')
      return
    }

    const failures: string[] = []
    const awaiting = (details?.trips ?? [])
      .filter((t) => t.status === 'Awaiting')
      .sort((a, b) => a.itinerary_id - b.itinerary_id)
    const firstTimed = awaiting.findIndex((t) => t.trip_start_at !== null)
    if (firstTimed !== -1) {
      const toChain = awaiting.slice(firstTimed)
      // Storage-deadline bookings run their trips side by side: each keeps
      // its own start, only the length changes. Others stay back to back.
      const slots = details?.storage_deadline
        ? toChain.map((t) => {
            const start = new Date(t.trip_start_at ?? toChain[0].trip_start_at!).getTime()
            return { start, end: start + hours * 3_600_000 }
          })
        : chainSlots(
            new Date(toChain[0].trip_start_at!).getTime(),
            toChain.map(() => hours * 3_600_000),
          )
      for (let i = 0; i < toChain.length; i++) {
        // Only while the trip is STILL Awaiting (the list above is from
        // when this opened -- a trip dispatched since keeps its slot), and
        // check a row really changed.
        const { data: moved, error: tripError } = await supabase
          .from('itineraries')
          .update({
            trip_start_at: new Date(slots[i].start).toISOString(),
            trip_end_at: new Date(slots[i].end).toISOString(),
          })
          .eq('itinerary_id', toChain[i].itinerary_id)
          .eq('itinerary_status', 'Awaiting')
          .select('itinerary_id')
          .maybeSingle()
        if (tripError) failures.push(`trip #${toChain[i].itinerary_id}: ${tripError.message}`)
        else if (!moved) failures.push(`trip #${toChain[i].itinerary_id}: no longer Awaiting, left as is`)
      }
    }
    setHoursSaving(false)
    if (failures.length > 0) {
      setHoursError(`Hours per trip saved, but some trips kept their old time slot (${failures.join('; ')}).`)
    } else {
      setHoursDraft(null)
    }
    reload()
  }

  // Admin only: let this booking's trips start without the downpayment.
  // waive_downpayment() checks the caller is an Admin and records who/when/why.
  async function waiveDownpayment() {
    const reason = await promptDialog({
      title: 'Allow trips without downpayment',
      message: 'Why can this booking start before the client pays the downpayment?',
      confirmLabel: 'Allow trips',
    })
    if (reason === null) return
    if (!reason.trim()) {
      showToast('A reason is required.', 'error')
      return
    }
    const { error: waiveError } = await supabase.rpc('waive_downpayment', {
      p_booking_id: booking.booking_id,
      p_reason: reason.trim(),
    })
    if (waiveError) {
      showToast(waiveError.message, 'error')
      return
    }
    showToast('Trips can now start without the downpayment.')
    reload()
  }

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

    setCancelling(true)
    setCancelError(null)

    // Re-read the trips NOW -- the ones on screen are from when this was
    // opened, and a trip may have been dispatched or delivered since
    // (Dispatch Board / driver). Every decision below uses these.
    const { data: freshTrips, error: freshError } = await supabase
      .from('itineraries')
      .select('itinerary_id, itinerary_status')
      .eq('booking_id', booking.booking_id)
    if (freshError) {
      setCancelling(false)
      setCancelError(freshError.message)
      return
    }
    const onRoadNow = freshTrips.filter((t) => ON_THE_ROAD.has(t.itinerary_status ?? ''))
    const deliveredNow = freshTrips.some((t) => t.itinerary_status === 'Delivered')
    const awaitingNow = freshTrips.filter((t) => (t.itinerary_status ?? 'Awaiting') === 'Awaiting')

    if (onRoadNow.length > 0) {
      setCancelling(false)
      setCancelError(
        `Trip ${onRoadNow.map((t) => `#${t.itinerary_id}`).join(', ')} is already on the road. ` +
          'Finish or reset it on the Dispatch Board before cancelling.',
      )
      reload()
      return
    }
    // A trip was delivered (or reset) since this opened: what "Cancel"
    // means changed, so show the new state and ask again.
    if (deliveredNow !== anyDelivered || (deliveredNow && awaitingNow.length === 0)) {
      setCancelling(false)
      setCancelError(
        deliveredNow && awaitingNow.length === 0
          ? 'Every trip is delivered now -- there is nothing left to cancel.'
          : deliveredNow
            ? 'A trip was delivered since you opened this booking, so only the remaining trips can be cancelled. Check and click again.'
            : 'The trips changed since you opened this booking. Check and click again.',
      )
      reload()
      return
    }

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
    if (awaitingNow.length > 0) {
      const { data, error: tripsError } = await supabase
        .from('itineraries')
        .update({ itinerary_status: 'Cancelled' })
        .in('itinerary_id', awaitingNow.map((t) => t.itinerary_id))
        .eq('itinerary_status', 'Awaiting')
        .select('itinerary_id, plate_number, trailer_id')

      if (tripsError) {
        setCancelling(false)
        // A toast, not cancelError: onChanged() below closes this modal
        // (or reloads the inline list), which would wipe an in-modal message.
        showToast(
          `Booking #${booking.booking_id} was marked cancelled, but its trips couldn't be ` +
            `(${tripsError.message}). This needs manual review on the Dispatch Board.`,
          'error',
        )
        onChanged?.()
        return
      }
      cancelledTrips = data ?? []

      // Take the driver/helper off the cancelled trips (same as a reassign
      // on the Dispatch Board: deactivate, keep the row as history). Frees
      // their time slot, and the itinerary_crews_notify trigger tells them.
      if (cancelledTrips.length > 0) {
        const { error: crewError } = await supabase
          .from('itinerary_crews')
          .update({ is_active: false, completed_at: now })
          .in('itinerary_id', cancelledTrips.map((t) => t.itinerary_id))
          .eq('is_active', true)
        if (crewError) {
          showToast(
            `Trips cancelled, but their driver/helper couldn't be unassigned (${crewError.message}). Remove them on the Dispatch Board.`,
            'error',
          )
        }
      }

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

    if (cancelledTrips.length < awaitingNow.length) {
      showToast(
        `Cancelled, but ${awaitingNow.length - cancelledTrips.length} trip(s) changed status in the ` +
          'meantime and were left as they are. Check them on the Dispatch Board.',
        'error',
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

  // ---- Pieces of the card ------------------------------------------------
  const tripsAlive = trips.filter((t) => t.status !== 'Cancelled')
  const cancelledCount = trips.length - tripsAlive.length
  const tripsTitle =
    trips.length > 0 && tripsAlive.length === 0
      ? `${cancelledCount} cancelled`
      : `${booking.completed_trips} of ${booking.total_trips} delivered${cancelledCount ? ` · ${cancelledCount} cancelled` : ''}`
  // "3 × Container · 20ft flatbed · 15 t" per kind of cargo (cancelled left out).
  const cargoCounts = new Map<string, number>()
  for (const t of tripsAlive) {
    const label = tripCargoLabel(t.cargo)
    cargoCounts.set(label, (cargoCounts.get(label) ?? 0) + 1)
  }
  const showDownpaymentDue = !!downpayment && !downpayment.met && !downpayment.waived && !isClosed
  const billingLink = isAdmin(role) ? `/dashboard/billing/${booking.booking_id}` : null

  const cargoCard = (
    <section className="border-2 border-slate-300 bg-white px-5 py-4">
      <h4 className="text-base font-semibold text-slate-900">Cargo Per Trip</h4>
      {!details ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : cargoCounts.size === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No cargo recorded.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 text-[15px] text-slate-900">
          {[...cargoCounts].map(([label, n]) => (
            <li key={label}>
              <span className="mr-2 font-semibold">{n} ×</span>
              {label}
            </li>
          ))}
        </ul>
      )}
    </section>
  )

  const moneyCard = (
    <section className="border-2 border-slate-300 bg-white px-5 py-4">
      <h4 className="text-base font-semibold text-slate-900">Money</h4>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Figure label="Rate Per Trip" value={formatMoney(booking.rate)} />
        <Figure
          label="Total Contract Value"
          value={formatMoney(booking.total_contract_value)}
          note={`${booking.total_trips} ${booking.total_trips === 1 ? 'trip' : 'trips'}`}
        />
        <Figure
          label="Billable So Far"
          value={formatMoney(booking.billable_amount)}
          note={booking.amount_to_pay !== null ? 'manually set' : undefined}
        />
        <Figure label="Amount Paid" value={formatMoney(booking.amount_paid)} />
        <Figure label="Balance Due" value={formatMoney(booking.balance_due)} />
        {booking.damage_charges > 0 && <Figure label="Incl. Damage Charges" value={formatMoney(booking.damage_charges)} />}
      </div>
      <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
        <span>
          Payment Terms{' '}
          <span className="font-semibold text-slate-900">
            {details?.payment_terms
              ? (PAYMENT_TERMS_LABELS[details.payment_terms as keyof typeof PAYMENT_TERMS_LABELS] ?? details.payment_terms)
              : '—'}
          </span>
        </span>
        <span>
          Invoice No. <span className="font-semibold text-slate-900">{details?.invoice_number || '—'}</span>
        </span>
        {/* Billing lives in the banner while a downpayment is due. */}
        {billingLink && !showDownpaymentDue && (
          <Link to={billingLink} className="font-semibold text-primary underline">
            Open Billing
          </Link>
        )}
      </p>
      {downpayment && !showDownpaymentDue && (downpayment.met || downpayment.waived) && (
        <p className={`mt-3 px-3 py-2 text-sm ${downpayment.met ? 'bg-green-50 text-green-800' : 'bg-slate-50 text-slate-700'}`}>
          Downpayment {formatMoney(downpayment.required)}
          {downpayment.met
            ? ' · ✓ received'
            : ` · waived by Admin${details?.downpayment_waive_reason ? ` -- ${details.downpayment_waive_reason}` : ''}`}
        </p>
      )}
    </section>
  )

  const detailsSection = (
    <div className="grid gap-4 border-x-2 border-b-2 border-slate-300 bg-white px-5 py-4 sm:grid-cols-2">
      <SectionTitle>Route</SectionTitle>
      <InfoRow label="Pickup" value={details?.pickup ?? booking.pickup_location} pin={details?.pickup_pin} />
      <InfoRow label="Delivery" value={details?.delivery ?? booking.delivery_location} pin={details?.delivery_pin} />
      {details?.pickup_landmark && <InfoRow label="Pickup landmark" value={details.pickup_landmark} />}
      {details?.delivery_landmark && <InfoRow label="Delivery landmark" value={details.delivery_landmark} />}
      {details?.estimated_distance_km != null && (
        <InfoRow label="Estimated distance" value={`${details.estimated_distance_km.toLocaleString()} km`} />
      )}

      <SectionTitle>Schedule</SectionTitle>
      <InfoRow label="Pickup date" value={booking.date ? formatDate(booking.date) : '—'} />
      <div>
        <p className="text-xs text-slate-500">Hours per trip</p>
        {hoursDraft === null ? (
          <p className="text-[15px] text-slate-900">
            {details?.hours_per_trip != null ? `${details.hours_per_trip} h` : '—'}
            {onChanged && details && (
              <button
                type="button"
                onClick={() => {
                  setHoursDraft(details.hours_per_trip != null ? String(details.hours_per_trip) : '')
                  setHoursError(null)
                }}
                className="ml-2 text-xs font-medium text-slate-600 underline hover:text-slate-900"
              >
                Edit
              </button>
            )}
          </p>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <input
              type="number"
              min="0.5"
              max="72"
              step="0.5"
              aria-label="Hours per trip"
              value={hoursDraft}
              onChange={(e) => setHoursDraft(e.target.value)}
              className="w-20 border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={saveHoursPerTrip}
              disabled={hoursSaving}
              className="btn-primary px-3 py-1 text-xs font-medium"
            >
              {hoursSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setHoursDraft(null)}
              className="px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        )}
        {hoursError && <p className="mt-1 text-xs text-red-700">{hoursError}</p>}
      </div>
      <InfoRow
        label="Deadline date"
        value={details?.preferred_delivery_date ? formatDate(details.preferred_delivery_date) : '—'}
      />
      {details?.storage_deadline && (
        <div>
          <p className="text-xs text-slate-500">Storage deadline</p>
          <p className="text-[15px] text-slate-900">{formatDate(details.storage_deadline)}, 11:59 PM</p>
          <p className="text-xs text-slate-500">Last free storage day -- every trip picked up by then.</p>
        </div>
      )}

      {/* Finished bookings keep cargo + money in here (active ones show them as cards). */}
      {isClosed && (
        <div className="col-span-full grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {cargoCard}
          {moneyCard}
        </div>
      )}
    </div>
  )

  return (
    <div
      className={
        inline
          ? ''
          : 'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center'
      }
    >
      <div className={inline ? 'flex flex-col gap-4' : 'flex max-h-[92vh] w-full max-w-5xl flex-col gap-4 overflow-y-auto bg-white p-6 shadow-lg'}>
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-xl font-bold text-slate-900">Booking #{booking.booking_id}</h3>
            {details?.reference_code && (
              <span className="font-mono text-xs font-semibold text-slate-600">{details.reference_code}</span>
            )}
            <span className="text-[15px] font-medium text-slate-900">{booking.client_name}</span>
            <StatusBadge status={booking.status} icon />
          </div>
          <div className="flex items-center gap-2">
            {canCancel && !showCancel && (
              <button
                type="button"
                onClick={() => setShowCancel(true)}
                className="flex items-center gap-2 border-2 border-red-700 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
              >
                <span aria-hidden="true">✕</span> {anyDelivered ? 'Cancel Remaining Trips…' : 'Cancel Booking…'}
              </button>
            )}
            {!inline && (
              <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700">
                ✕
              </button>
            )}
          </div>
        </div>

        {showCancel && (
          <div className="border-2 border-red-200 bg-red-50/50 p-4">
            <p className="text-sm font-semibold text-slate-900">
              {anyDelivered
                ? `Cancel the ${awaitingTrips.length} trip(s) that haven't started?`
                : `Cancel booking #${booking.booking_id}?`}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {anyDelivered
                ? 'Delivered trips stay on the booking and are still billed.'
                : "Its trips are cancelled too and any assigned truck or trailer is freed. This can't be undone from the app."}
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

        {details?.cancellation_reason && (
          <p className="flex items-start gap-2 bg-red-100 px-4 py-3 text-sm text-red-800">
            <span aria-hidden="true" className="font-bold">ⓘ</span>
            <span>
              <span className="font-semibold">
                {booking.status === 'Cancelled' ? 'Cancelled' : 'Remaining trips cancelled'}
                {details.cancelled_at && ` on ${formatDate(details.cancelled_at)}`}.
              </span>{' '}
              Reason: {details.cancellation_reason}
            </span>
          </p>
        )}

        {loadError && (
          <p className="bg-red-50 px-4 py-3 text-sm text-red-700">Couldn't load the full details ({loadError}).</p>
        )}

        {showDownpaymentDue && downpayment && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-amber-300 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="text-xl leading-none text-amber-800">⚠</span>
              <div>
                <p className="font-semibold text-amber-900">
                  Downpayment due: {formatMoney(downpayment.required)} · {formatMoney(downpayment.paid)} paid ·{' '}
                  {formatMoney(downpayment.missing)} to go
                </p>
                <p className="text-sm text-amber-900">
                  Trip cost + 25% of the rest of the contract. No trip can start until it is paid.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Admin only (the Bills Receivable page is in the Admin routes). */}
              {billingLink && (
                <Link
                  to={`/dashboard/financial-records?downpayment=${booking.booking_id}`}
                  className="text-sm font-semibold text-amber-900 underline"
                >
                  Record Downpayment
                </Link>
              )}
              {isAdmin(role) && onChanged && (
                <button
                  type="button"
                  onClick={waiveDownpayment}
                  className="border-2 border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                >
                  Allow Trips Without Downpayment…
                </button>
              )}
            </div>
          </div>
        )}

        {/* Active bookings: cargo + money up front. */}
        {!isClosed && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            {cargoCard}
            {moneyCard}
          </div>
        )}

        {/* Route, schedule (and, when finished, cargo + money) behind a toggle. */}
        <div>
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="flex w-full items-center justify-between border-2 border-slate-300 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:bg-slate-50"
          >
            {showDetails ? 'Hide Booking Details' : 'Show Booking Details'}
            <span aria-hidden="true">{showDetails ? '▴' : '▾'}</span>
          </button>
          {showDetails && detailsSection}
        </div>

        {/* Trips */}
        <section className="border-2 border-slate-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <h4 className="text-base font-semibold text-slate-900">Trips · {tripsTitle}</h4>
            {!isClosed && onChanged && (
              <Link to="/dashboard/dispatch" className="text-sm font-semibold text-primary hover:underline">
                Assign in Dispatch Board →
              </Link>
            )}
          </div>
          {loadError ? (
            <p className="px-4 pb-4 text-sm text-slate-500">Trips couldn't be loaded.</p>
          ) : !details ? (
            <p className="px-4 pb-4 text-sm text-slate-500">Loading trips…</p>
          ) : trips.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-500">This booking has no trips. It may need manual review.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold tracking-wider text-slate-600 uppercase">
                  <tr>
                    <th className="px-4 py-3">Trip</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Time Slot</th>
                    <th className="px-3 py-3">Cargo</th>
                    <th className="px-3 py-3">Driver</th>
                    <th className="px-3 py-3">Truck / Trailer</th>
                    <th className="px-3 py-3">Exp.</th>
                    <th className="px-3 py-3">Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => {
                    const cancelled = trip.status === 'Cancelled'
                    const toRun = !cancelled && trip.status !== 'Delivered'
                    // "Not assigned" only needs attention on a trip still to run.
                    const notAssigned = toRun ? 'font-medium text-orange-700' : 'text-slate-500'
                    const storage = storageState({
                      deadline: details.storage_deadline,
                      status: trip.status,
                      pickedUpAt: trip.picked_up_at,
                      now,
                    })
                    const slot = trip.trip_start_at ? slotLines(trip.trip_start_at, trip.trip_end_at) : null
                    const expenseTotal = trip.expenses.reduce((sum, e) => sum + Number(e.amount), 0)
                    return (
                      <Fragment key={trip.itinerary_id}>
                      <tr
                        id={`trip-row-${trip.itinerary_id}`}
                        className={`border-t border-slate-200 align-middle ${
                          trip.itinerary_id === highlightTripId ? 'bg-amber-50 outline-2 -outline-offset-2 outline-amber-400' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          #{trip.itinerary_id}
                          {trip.itinerary_id === highlightTripId && (
                            <span className="block text-xs font-medium text-amber-700">Found</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={trip.status} label={TRIP_STATUS_LABELS[trip.status]} icon />
                          {storage && (
                            <span className={`mt-1 block w-fit px-1.5 py-0.5 text-xs font-medium ${STORAGE_BADGE[storage].className}`}>
                              {STORAGE_BADGE[storage].label}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-900">
                          {slot ? (
                            <>
                              {slot.date}
                              <span className="block text-slate-500">{slot.time}</span>
                            </>
                          ) : (
                            <>
                              {trip.trip_date_from ? formatDate(trip.trip_date_from) : '—'}
                              <span className="block text-xs text-amber-700">No time set</span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-900">
                          {tripCargoLabel(trip.cargo)}
                          {trip.cargo.cargo_description && (
                            <span className="block max-w-56 text-primary">{trip.cargo.cargo_description}</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {trip.driver ?? <span className={notAssigned}>Not assigned</span>}
                          {trip.helper && <span className="block text-xs text-slate-500">Helper: {trip.helper}</span>}
                        </td>
                        <td className="px-3 py-3 text-slate-900">
                          {trip.plate_number || trip.trailer_id !== null ? (
                            <>
                              {trip.plate_number ?? <span className={notAssigned}>No truck</span>}
                              {' / '}
                              {trip.trailer_id !== null
                                ? (trip.trailer_plate ?? `Trailer #${trip.trailer_id}`)
                                : <span className={notAssigned}>no trailer</span>}
                            </>
                          ) : (
                            <span className={notAssigned}>Not assigned</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-600">
                          {trip.expenses.length === 0 ? (
                            'None'
                          ) : (
                            <span title={trip.expenses.map((e) => `${formatMoney(Number(e.amount))} · ${e.description}`).join('\n')}>
                              {formatMoney(expenseTotal)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {cancelled ? (
                            <span className="text-slate-500">—</span>
                          ) : (
                            <>
                              {/* Opens the upload box right under this row. Upload
                                  only where staff can act (the Bookings page); the
                                  read-only client-history view can just look. */}
                              <button
                                type="button"
                                onClick={() => setDocsTripId(docsTripId === trip.itinerary_id ? null : trip.itinerary_id)}
                                aria-label={`${onChanged ? 'Upload or view' : 'View'} trip #${trip.itinerary_id} documents`}
                                title={onChanged ? 'Documents' : 'View documents'}
                                className={`flex h-10 w-10 items-center justify-center border-2 ${
                                  docsTripId === trip.itinerary_id
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                <Icon path={UPLOAD} />
                              </button>
                              {trip.document_count > 0 ? (
                                <span className="mt-1 block text-xs text-slate-500">
                                  {trip.document_count} {trip.document_count === 1 ? 'file' : 'files'}
                                </span>
                              ) : trip.status === 'Delivered' ? (
                                <span className="mt-1 inline-block bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                                  No DO yet
                                </span>
                              ) : null}
                            </>
                          )}
                        </td>
                      </tr>
                      {/* The trip's documents, right under its row -- the same box as the
                          DO upload in Mark Delivered. It closes by itself once an upload
                          has gone through (TripDocuments onUploaded). */}
                      {docsTripId === trip.itinerary_id && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-4 pt-2 pb-4">
                            <div className="mb-2 flex items-center justify-between">
                              <span className="text-sm font-semibold text-slate-900">
                                Trip #{trip.itinerary_id} · {onChanged ? 'Attach DO / documents' : 'Documents'}
                              </span>
                              <button
                                type="button"
                                onClick={() => setDocsTripId(null)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-900"
                              >
                                Close
                              </button>
                            </div>
                            <TripDocuments
                              itineraryId={trip.itinerary_id}
                              canEdit={!!onChanged}
                              onCountChange={updateDocumentCount}
                              onUploaded={() => setDocsTripId(null)}
                            />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

        </section>

        {!inline && (
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm font-medium">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default BookingDetailModal
