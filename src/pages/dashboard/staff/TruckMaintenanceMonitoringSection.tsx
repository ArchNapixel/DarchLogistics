// TruckMaintenanceMonitoringSection: Truck Monitoring (Maintenance ->
// Truck Monitoring, the canvas's board). One screen for "which trucks can
// run": fleet tiles, the Trucks table (status, odometer, last trips, next
// maintenance), Alerts worked out from data the app already keeps (truck /
// trailer not operational, service date due, a schedule due soon, a work
// order past its scheduled date) and "Confirm odometer readings" -- the
// suggested reading after each delivered trip (base -> pickup + trip +
// delivery -> base), which staff confirm, optionally typing the real
// reading instead. Maintenance schedules (and Assign Schedule) moved to the
// Maintenance page's Schedules tab.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import { fetchAll, fetchIn } from '../../../lib/dashboardExpenses'
import { fetchDrivingDistanceKm, geocodePlace } from '../../../lib/geocoding'
import {
  formatScheduleDueDate,
  loadPendingMaintenanceSchedules,
  type PendingMaintenanceSchedule,
} from '../../../lib/maintenanceSchedules'
import { toManilaDate } from '../../../lib/payslip'
import { filterAmountInput } from '../../../lib/amountInput'
import CreateWorkOrderModal, { type PreselectedVehicle } from './CreateWorkOrderModal'
import PageHeader from '../../../components/PageHeader'
import StatusBadge from '../../../components/StatusBadge'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

type OdometerSuggestion = {
  itinerary_id: number
  plate_number: string
  trip_date: string
  // Base -> pickup. 0 (and flagged) when it couldn't be routed.
  out_km: number
  out_is_fallback: boolean
  trip_km: number
  return_km: number
  // True when the drive back to base couldn't be routed and the trip
  // distance was used for it instead (same road back).
  return_is_fallback: boolean
  current_odometer: number
  suggested_odometer: number
}

type Truck = {
  plate_number: string
  model: string | null
  current_status: string | null
  current_odometer: number | null
  next_service_date: string | null
}

type Trailer = { trailer_id: number; plate_number: string | null; current_status: string | null }

type RecentTrip = { itinerary_id: number; plate_number: string; trip_date_from: string | null }

type OpenWorkOrder = {
  work_order_id: number
  work_order_number: string
  plate_number: string | null
  trailer_id: number | null
  maintenance_type: string
  work_order_status: string
  scheduled_start_date: string | null
}

type Alert = {
  key: string
  title: string
  detail: string
  tone: 'bad' | 'warn'
  // Where the alert's button goes: an open work order, a schedule list, or
  // "Create Work Order" for that vehicle.
  action: { kind: 'link'; label: string; to: string } | { kind: 'create'; vehicle: PreselectedVehicle }
}

// Same open statuses as the Maintenance page.
const OPEN_WORK_ORDER_STATUSES = ['Created', 'Scheduled', 'In Progress', 'On Hold']
const NOT_OPERATIONAL = ['Under Maintenance', 'Out of Service']
// A service date / schedule this close counts as an alert.
const DUE_SOON_DAYS = 14

const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
const TD = 'px-2 py-2 first:pl-5 last:pr-5'
const PANEL_HEAD = 'flex min-h-[56px] flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-5 py-3'

const daysUntil = (date: string, today: string) =>
  Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000)

// Every truck leaves from and heads back to here, so the odometer moves
// by base -> pickup + the delivery trip + delivery -> base. Only this
// odometer feature uses the two base legs -- the quote's profitability
// estimate stays one-way (bookings.estimated_distance_km) on purpose.
const BASE = { city: 'Panabo City', barangay: 'J.P. Laurel' }

// One end of a booking: its places row plus the exact pin, if any.
type Stop = {
  placeId: number | null
  place: { city: string | null; barangay: string | null } | undefined
  lat: number | null
  lng: number | null
}

// Driving km between a booking's stop (pickup or delivery) and BASE:
// a distance already cached in route_cache for that barangay pair if
// there is one, else routed from the stop's pin (or its barangay's
// centre when there's no pin) to the base barangay's centre. Road
// distance is treated as the same both ways, same as route_cache.
// Null when nothing works (no place, geocode/routing failure).
async function baseLegKm(
  stop: Stop,
  basePlaceId: number | null,
  basePoint: { lat: number; lon: number } | null,
): Promise<number | null> {
  if (stop.placeId !== null && basePlaceId !== null) {
    const [low, high] = [stop.placeId, basePlaceId].sort((a, b) => a - b)
    const { data: cached } = await supabase
      .from('route_cache')
      .select('distance_km')
      .eq('place_id_a', low)
      .eq('place_id_b', high)
      .maybeSingle()
    if (cached?.distance_km !== undefined && cached?.distance_km !== null) {
      return Number(cached.distance_km)
    }
  }

  if (!basePoint) return null
  try {
    const from =
      typeof stop.lat === 'number' && typeof stop.lng === 'number'
        ? { lat: stop.lat, lon: stop.lng }
        : stop.place?.city && stop.place?.barangay
          ? await geocodePlace(`Barangay ${stop.place.barangay}, ${stop.place.city}, Philippines`)
          : null
    if (!from) return null
    return await fetchDrivingDistanceKm(from, basePoint)
  } catch {
    return null
  }
}

async function loadOdometerSuggestions(): Promise<{ suggestions: OdometerSuggestion[]; error: string | null }> {
  // Every page (fetchAll) -- past Supabase's 1000-row cap a truck's
  // latest delivered trip could otherwise be missing. Logs oldest first,
  // so the Map below ends up holding each trip's LATEST Delivered time.
  const [trucksResult, itinerariesResult, logsResult] = await Promise.all([
    supabase.from('truck_profiles').select('plate_number, current_odometer, updated_at').eq('is_active', true),
    fetchAll<{ itinerary_id: number; booking_id: number; trip_date_from: string; plate_number: string }>(
      (from, to) =>
        supabase
          .from('itineraries')
          .select('itinerary_id, booking_id, trip_date_from, plate_number')
          .eq('itinerary_status', 'Delivered')
          .not('plate_number', 'is', null)
          .order('itinerary_id', { ascending: true })
          .range(from, to),
    ),
    fetchAll<{ itinerary_id: number; status_changed_at: string }>((from, to) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .eq('new_status', 'Delivered')
        .order('status_changed_at', { ascending: true })
        .order('itinerary_id', { ascending: true })
        .range(from, to),
    ),
  ])

  const firstError = trucksResult.error?.message ?? itinerariesResult.error ?? logsResult.error
  if (firstError) return { suggestions: [], error: firstError }

  const deliveredItineraries = itinerariesResult.rows
  const bookingIds = Array.from(new Set(deliveredItineraries.map((row) => row.booking_id)))
  const { rows: bookingRows, error: bookingsError } = await fetchIn<{
    booking_id: number
    estimated_distance_km: number | null
    place_of_pickup_id: number | null
    pickup_lat: number | null
    pickup_lng: number | null
    place_of_delivery_id: number | null
    delivery_lat: number | null
    delivery_lng: number | null
  }>(bookingIds, (chunk, from, to) =>
    supabase
      .from('bookings')
      .select(
        'booking_id, estimated_distance_km, place_of_pickup_id, pickup_lat, pickup_lng, place_of_delivery_id, delivery_lat, delivery_lng',
      )
      .in('booking_id', chunk)
      .range(from, to),
  )

  if (bookingsError) return { suggestions: [], error: bookingsError }

  const truckByPlate = new Map((trucksResult.data ?? []).map((truck) => [truck.plate_number, truck]))
  const bookingById = new Map(bookingRows.map((booking) => [booking.booking_id, booking]))
  const deliveredAtByItinerary = new Map(logsResult.rows.map((log) => [log.itinerary_id, log.status_changed_at]))
  const latestByTruck = new Map<string, (typeof deliveredItineraries)[number]>()

  deliveredItineraries.forEach((itinerary) => {
    if (!itinerary.plate_number || !deliveredAtByItinerary.get(itinerary.itinerary_id)) return
    const existing = latestByTruck.get(itinerary.plate_number)
    if (!existing || itinerary.trip_date_from > existing.trip_date_from) {
      latestByTruck.set(itinerary.plate_number, itinerary)
    }
  })

  const candidates = Array.from(latestByTruck.values()).flatMap((itinerary) => {
    const truck = truckByPlate.get(itinerary.plate_number)
    const booking = bookingById.get(itinerary.booking_id)
    const tripKm = Number(booking?.estimated_distance_km ?? 0)
    const deliveredAt = deliveredAtByItinerary.get(itinerary.itinerary_id)
    if (!truck || !booking || !tripKm || !deliveredAt || deliveredAt <= truck.updated_at) return []
    return [{ itinerary, truck, booking, tripKm }]
  })

  // Base leg lookups (base -> pickup, delivery -> base), only for the
  // trucks that actually have a pending suggestion (at most one per truck).
  const stopPlaceIds = Array.from(
    new Set(
      candidates
        .flatMap((c) => [c.booking.place_of_pickup_id, c.booking.place_of_delivery_id])
        .filter((id): id is number => id !== null),
    ),
  )
  const [placesResult, baseResult, basePoint] = await Promise.all([
    stopPlaceIds.length > 0
      ? supabase.from('places').select('place_id, city, barangay').in('place_id', stopPlaceIds)
      : Promise.resolve({ data: [] as { place_id: number; city: string | null; barangay: string | null }[] }),
    supabase
      .from('places')
      .select('place_id')
      .ilike('city', BASE.city)
      .ilike('barangay', BASE.barangay)
      .maybeSingle(),
    candidates.length > 0
      ? geocodePlace(`Barangay ${BASE.barangay}, ${BASE.city}, Philippines`)
      : Promise.resolve(null),
  ])
  const placeById = new Map((placesResult.data ?? []).map((place) => [place.place_id, place]))
  const basePlaceId = baseResult.data?.place_id ?? null
  const stop = (placeId: number | null, lat: number | null, lng: number | null): Stop => ({
    placeId,
    place: placeId !== null ? placeById.get(placeId) : undefined,
    lat,
    lng,
  })
  const round = (km: number) => Math.round(km * 100) / 100

  const nextSuggestions: OdometerSuggestion[] = []
  for (const { itinerary, truck, booking, tripKm } of candidates) {
    const routedOutKm = await baseLegKm(
      stop(booking.place_of_pickup_id, booking.pickup_lat, booking.pickup_lng),
      basePlaceId,
      basePoint,
    )
    const routedReturnKm = await baseLegKm(
      stop(booking.place_of_delivery_id, booking.delivery_lat, booking.delivery_lng),
      basePlaceId,
      basePoint,
    )
    // Can't route the drive out -> leave it out (flagged) rather than
    // guess. Can't route the drive back -> assume the same road back.
    const outKm = routedOutKm ?? 0
    const returnKm = routedReturnKm ?? tripKm
    const current = Number(truck.current_odometer ?? 0)
    nextSuggestions.push({
      itinerary_id: itinerary.itinerary_id,
      plate_number: itinerary.plate_number,
      trip_date: itinerary.trip_date_from,
      out_km: round(outKm),
      out_is_fallback: routedOutKm === null,
      trip_km: tripKm,
      return_km: round(returnKm),
      return_is_fallback: routedReturnKm === null,
      current_odometer: current,
      suggested_odometer: round(current + outKm + tripKm + returnKm),
    })
  }

  return { suggestions: nextSuggestions, error: null }
}


// "Confirm odometer readings" -- one row per truck whose latest delivered
// trip came after its last odometer update.
function OdometerConfirm({
  suggestions,
  onConfirmed,
}: {
  suggestions: OdometerSuggestion[]
  onConfirmed: (suggestion: OdometerSuggestion, reading: number) => void
}) {
  const [typed, setTyped] = useState<Record<number, string>>({})
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const paged = usePaged(suggestions, '')

  async function confirm(suggestion: OdometerSuggestion) {
    const text = typed[suggestion.itinerary_id]?.trim() ?? ''
    // Empty = take the suggestion; a typed reading must be past the current one.
    const reading = text === '' ? suggestion.suggested_odometer : Number(text)
    if (!Number.isFinite(reading) || reading <= suggestion.current_odometer) {
      setError(
        `${suggestion.plate_number}: the new reading must be higher than the current ${suggestion.current_odometer.toLocaleString()} km.`,
      )
      return
    }
    setSavingId(suggestion.itinerary_id)
    setError(null)
    const { data: updated, error: updateError } = await supabase
      .from('truck_profiles')
      .update({ current_odometer: reading, updated_at: new Date().toISOString() })
      .eq('plate_number', suggestion.plate_number)
      .eq('current_odometer', suggestion.current_odometer)
      .select('plate_number')
      .maybeSingle()

    setSavingId(null)
    if (updateError) {
      setError(`Could not confirm ${suggestion.plate_number}: ${updateError.message}`)
      return
    }
    if (!updated) {
      // The .eq('current_odometer', ...) guard matched 0 rows -- someone
      // else already updated this truck's odometer since the page loaded.
      setError(`${suggestion.plate_number}'s odometer was already updated by someone else. Refresh to see the latest value.`)
      return
    }
    onConfirmed(suggestion, reading)
  }

  return (
    <section aria-labelledby="odo-h" className="card flex flex-col">
      <div className={PANEL_HEAD}>
        <div>
          <h2 id="odo-h" className="text-base font-semibold text-ink">
            Confirm odometer readings
          </h2>
          <p className="text-[13px] text-ink-muted">
            Suggested after each delivered trip: current reading + J.P. Laurel → pickup + trip + back to J.P. Laurel.
          </p>
        </div>
      </div>
      {error && <p className="mx-5 mt-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {suggestions.length === 0 ? (
        <EmptyState message="No odometer readings are waiting for confirmation." className="m-5" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm text-ink-metric">
            <thead>
              <tr>
                <th className={TH}>Truck · Trip</th>
                <th className={`${TH} text-right`}>Current</th>
                <th className={`${TH} text-right`}>Trip Distance</th>
                <th className={`${TH} text-right`}>Suggested</th>
                <th className={TH}>New Reading</th>
                <th className={TH}>
                  <span className="sr-only">Confirm</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((s) => {
                const total = Math.round((s.out_km + s.trip_km + s.return_km) * 100) / 100
                return (
                  <tr key={s.itinerary_id} className="h-[60px] border-b border-slate-200">
                    <td className={TD}>
                      <span className="block font-semibold text-ink">{s.plate_number}</span>
                      <span className="block text-[13px] text-ink-muted">
                        Trip #{s.itinerary_id} · {formatDate(s.trip_date)}
                      </span>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{s.current_odometer.toLocaleString()} km</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {total.toLocaleString()} km
                      <span className="block text-[12px] text-ink-muted">
                        {s.out_km.toLocaleString()} + {s.trip_km.toLocaleString()} + {s.return_km.toLocaleString()}
                      </span>
                      {s.out_is_fallback && <span className="block text-xs text-amber-700">Drive out not routed, not counted</span>}
                      {s.return_is_fallback && <span className="block text-xs text-amber-700">Drive back not routed, same as trip</span>}
                    </td>
                    <td className={`${TD} text-right font-semibold text-ink tabular-nums`}>{s.suggested_odometer.toLocaleString()} km</td>
                    <td className={TD}>
                      <input
                        inputMode="decimal"
                        value={typed[s.itinerary_id] ?? ''}
                        onChange={(e) => setTyped((prev) => ({ ...prev, [s.itinerary_id]: filterAmountInput(e.target.value) }))}
                        placeholder="km"
                        aria-label={`New odometer reading for ${s.plate_number}, trip #${s.itinerary_id}`}
                        className="min-h-11 w-28 rounded-[2px] border border-line-control bg-white px-3 text-sm tabular-nums placeholder:text-ink-muted focus:border-primary"
                      />
                    </td>
                    <td className={TD}>
                      <button
                        type="button"
                        onClick={() => void confirm(s)}
                        disabled={savingId === s.itinerary_id}
                        className="btn-primary px-4 text-sm"
                      >
                        {savingId === s.itinerary_id ? 'Saving...' : 'Confirm'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pager {...paged.pager} />
        </div>
      )}
      <p className="border-t border-line px-5 py-3 text-[13px] text-ink-muted">
        Leave New Reading empty to accept the suggested value. A new reading must be higher than the current one.
      </p>
    </section>
  )
}

function TruckMaintenanceMonitoringSection() {
  const today = toManilaDate(new Date())
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [trailers, setTrailers] = useState<Trailer[]>([])
  const [trips, setTrips] = useState<RecentTrip[]>([])
  const [workOrders, setWorkOrders] = useState<OpenWorkOrder[]>([])
  const [schedules, setSchedules] = useState<PendingMaintenanceSchedule[]>([])
  const [suggestions, setSuggestions] = useState<OdometerSuggestion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createFor, setCreateFor] = useState<PreselectedVehicle | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    // The odometer suggestions can take a while (routing), so they load on
    // their own and the rest of the page doesn't wait for them.
    setSuggestions(null)
    void loadOdometerSuggestions().then((result) => {
      if (result.error) setError(result.error)
      setSuggestions(result.suggestions)
    })
    const [trucksResult, trailersResult, tripsResult, ordersResult, schedulesResult] = await Promise.all([
      supabase
        .from('truck_profiles')
        .select('plate_number, model, current_status, current_odometer, next_service_date')
        .eq('is_active', true)
        .order('plate_number'),
      supabase.from('trailers').select('trailer_id, plate_number, current_status').eq('is_active', true).order('trailer_id'),
      // Newest trips first -- the table shows each truck's last two.
      supabase
        .from('itineraries')
        .select('itinerary_id, plate_number, trip_date_from')
        .not('plate_number', 'is', null)
        .neq('itinerary_status', 'Cancelled')
        .order('trip_date_from', { ascending: false })
        .order('itinerary_id', { ascending: false })
        .limit(300),
      supabase
        .from('work_orders')
        .select('work_order_id, work_order_number, plate_number, trailer_id, maintenance_type, work_order_status, scheduled_start_date')
        .in('work_order_status', OPEN_WORK_ORDER_STATUSES),
      loadPendingMaintenanceSchedules(),
    ])
    const loadError =
      trucksResult.error?.message ??
      trailersResult.error?.message ??
      tripsResult.error?.message ??
      ordersResult.error?.message ??
      schedulesResult.error
    if (loadError) setError(loadError)
    setTrucks(trucksResult.data ?? [])
    setTrailers(trailersResult.data ?? [])
    setTrips((tripsResult.data ?? []) as RecentTrip[])
    setWorkOrders(ordersResult.data ?? [])
    setSchedules(schedulesResult.schedules)
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const down = (status: string | null) => NOT_OPERATIONAL.includes(status ?? '')
  const trucksDown = trucks.filter((t) => down(t.current_status))
  const trailersDown = trailers.filter((t) => down(t.current_status))
  const trailerName = (t: { trailer_id: number; plate_number: string | null }) => t.plate_number ?? `Trailer #${t.trailer_id}`
  const openOrderFor = (match: (o: OpenWorkOrder) => boolean) =>
    workOrders.filter(match).sort((a, b) => b.work_order_id - a.work_order_id)[0]

  // Alerts, worst first.
  const alerts: Alert[] = []
  for (const t of trucksDown) {
    const order = openOrderFor((o) => o.plate_number === t.plate_number)
    alerts.push({
      key: `truck-${t.plate_number}`,
      title: `${t.plate_number} not operational`,
      detail: order ? `${t.current_status} · ${order.work_order_number}, ${order.maintenance_type}` : `${t.current_status} · no open work order`,
      tone: 'bad',
      action: order
        ? { kind: 'link', label: 'Open Work Order', to: `/dashboard/maintenance?wo=${order.work_order_id}` }
        : { kind: 'create', vehicle: { type: 'truck', plateNumber: t.plate_number } },
    })
  }
  for (const t of trailersDown) {
    const order = openOrderFor((o) => o.trailer_id === t.trailer_id)
    alerts.push({
      key: `trailer-${t.trailer_id}`,
      title: `Trailer ${trailerName(t)} not operational`,
      detail: order ? `${t.current_status} · ${order.work_order_number}, ${order.maintenance_type}` : `${t.current_status} · no open work order`,
      tone: 'bad',
      action: order
        ? { kind: 'link', label: 'Open Work Order', to: `/dashboard/maintenance?wo=${order.work_order_id}` }
        : { kind: 'create', vehicle: { type: 'trailer', trailerId: t.trailer_id } },
    })
  }
  for (const o of workOrders) {
    if ((o.work_order_status === 'Created' || o.work_order_status === 'Scheduled') && o.scheduled_start_date && o.scheduled_start_date < today) {
      const vehicle = o.plate_number ?? trailerName(trailers.find((t) => t.trailer_id === o.trailer_id) ?? { trailer_id: o.trailer_id ?? 0, plate_number: null })
      alerts.push({
        key: `wo-${o.work_order_id}`,
        title: `${o.work_order_number} not started`,
        detail: `${vehicle} · ${o.maintenance_type} · scheduled ${formatDate(o.scheduled_start_date)}`,
        tone: 'warn',
        action: { kind: 'link', label: 'Open Work Order', to: `/dashboard/maintenance?wo=${o.work_order_id}` },
      })
    }
  }
  for (const t of trucks) {
    if (!t.next_service_date || down(t.current_status)) continue
    const days = daysUntil(t.next_service_date, today)
    if (days > DUE_SOON_DAYS) continue
    alerts.push({
      key: `service-${t.plate_number}`,
      title: `${t.plate_number} service ${days < 0 ? 'overdue' : 'due soon'}`,
      detail: `Next service date ${formatDate(t.next_service_date)}${days < 0 ? ` (${-days} days ago)` : days === 0 ? ' (today)' : ` (in ${days} days)`}`,
      tone: days < 0 ? 'bad' : 'warn',
      action: { kind: 'create', vehicle: { type: 'truck', plateNumber: t.plate_number } },
    })
  }
  for (const s of schedules) {
    const due = formatScheduleDueDate(s.due_date)
    if (due.tone === 'upcoming') continue
    alerts.push({
      key: `schedule-${s.schedule_id}`,
      title: `${s.vehicle_label.replace(/^(Truck|Trailer): /, '')} · ${s.maintenance_type}`,
      detail: `Maintenance schedule · ${due.label}`,
      tone: due.tone === 'overdue' ? 'bad' : 'warn',
      action: { kind: 'link', label: 'Open Schedules', to: '/dashboard/maintenance?tab=Schedules' },
    })
  }
  alerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1))

  // A truck's next maintenance: its next service date or its earliest
  // pending schedule, whichever comes first.
  function nextMaintenance(t: Truck): { date: string; what: string } | null {
    const options = [
      ...(t.next_service_date ? [{ date: t.next_service_date, what: 'Service' }] : []),
      ...schedules.filter((s) => s.plate_number === t.plate_number).map((s) => ({ date: s.due_date, what: s.maintenance_type })),
    ].sort((a, b) => a.date.localeCompare(b.date))
    return options[0] ?? null
  }

  const pagedTrucks = usePaged(trucks, '')

  return (
    <div>
      <PageHeader
        title="Truck Monitoring"
        subtitle="Which trucks can run, odometer readings to confirm, and maintenance alerts."
        actions={
          <button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary flex items-center gap-2 px-4 text-sm font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
            </svg>
            Refresh
          </button>
        }
      />
      {error && <p className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section aria-label="Fleet status" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Trucks operational', value: trucks.length - trucksDown.length, of: trucks.length },
          { label: 'Trucks not operational', value: trucksDown.length, bad: trucksDown.length > 0 },
          { label: 'Trailers operational', value: trailers.length - trailersDown.length, of: trailers.length },
          { label: 'Odometer readings to confirm', value: suggestions?.length ?? null },
        ].map((tile) => (
          <div key={tile.label} className="card px-[18px] py-3.5">
            <p className="text-sm font-medium text-ink-secondary">{tile.label}</p>
            <p className={`text-[28px] leading-9 font-bold tracking-[-0.01em] tabular-nums ${tile.bad ? 'text-red-700' : 'text-ink'}`}>
              {loading || tile.value === null ? '…' : tile.value}
              {tile.of !== undefined && !loading && <span className="ml-1.5 text-base font-medium text-ink-muted">of {tile.of}</span>}
            </p>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <section aria-labelledby="trucks-h" className="card">
            <div className={PANEL_HEAD}>
              <h2 id="trucks-h" className="text-base font-semibold text-ink">
                Trucks
              </h2>
              <Link to="/dashboard/fleet" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                Open Fleet
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14 M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
            {loading ? (
              <p className="px-5 py-4 text-ink-muted">Loading trucks...</p>
            ) : trucks.length === 0 ? (
              <EmptyState message="No trucks yet." hint="Add one on the Fleet page." className="m-5" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className={TH}>Plate No.</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Odometer</th>
                      <th className={TH}>Last Trips</th>
                      <th className={TH}>Next Maintenance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTrucks.rows.map((t) => {
                      const last = trips.filter((trip) => trip.plate_number === t.plate_number).slice(0, 2)
                      const next = nextMaintenance(t)
                      const overdue = next ? next.date < today : false
                      return (
                        <tr key={t.plate_number} className="h-[60px] border-b border-slate-200">
                          <td className={`${TD} font-semibold ${down(t.current_status) ? 'text-ink-muted' : 'text-ink'}`}>{t.plate_number}</td>
                          <td className={TD}>
                            <StatusBadge status={t.current_status ?? 'Available'} icon />
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>
                            {t.current_odometer != null ? `${Number(t.current_odometer).toLocaleString()} km` : '—'}
                          </td>
                          <td className={`${TD} ${last.length ? '' : 'text-ink-muted'}`}>
                            {last.length === 0
                              ? 'No recent trips'
                              : `${last.length === 1 ? 'Trip' : 'Trips'} ${last.map((trip) => `#${trip.itinerary_id}`).join(', ')} · ${formatDate(last[0].trip_date_from)}`}
                          </td>
                          <td className={`${TD} ${next ? (overdue ? 'font-semibold text-red-700' : '') : 'text-ink-muted'}`}>
                            {next ? (
                              <>
                                {formatDate(next.date)}
                                <span className="block text-[13px] font-normal text-ink-muted">{next.what}</span>
                              </>
                            ) : (
                              'Not set'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <Pager {...pagedTrucks.pager} />
              </div>
            )}
          </section>

          <section aria-labelledby="alerts-h" className="card">
            <div className={PANEL_HEAD}>
              <h2 id="alerts-h" className="text-base font-semibold text-ink">
                Alerts
              </h2>
              <span className="text-[13px] text-ink-muted">Not operational, service due, schedules due, late work orders</span>
            </div>
            {loading ? (
              <p className="px-5 py-4 text-ink-muted">Loading alerts...</p>
            ) : alerts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-muted">No alerts. Every truck and trailer is good to go.</p>
            ) : (
              <ul>
                {alerts.map((alert) => (
                  <li
                    key={alert.key}
                    className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 last:border-0 ${
                      alert.tone === 'bad' ? 'shadow-[inset_4px_0_0_#b91c1c]' : 'shadow-[inset_4px_0_0_#d97706]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 text-sm">
                      <strong className="block font-semibold text-ink">{alert.title}</strong>
                      <span className="text-ink-muted">{alert.detail}</span>
                    </span>
                    {alert.action.kind === 'link' ? (
                      <Link to={alert.action.to} className="btn-secondary inline-flex items-center px-4 text-sm font-medium">
                        {alert.action.label}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setCreateFor((alert.action as { vehicle: PreselectedVehicle }).vehicle)}
                        className="btn-secondary px-4 text-sm font-medium"
                      >
                        Create Work Order
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {suggestions === null ? (
          <section className="card px-5 py-4 text-ink-muted">Working out odometer suggestions...</section>
        ) : (
          <OdometerConfirm
            suggestions={suggestions}
            onConfirmed={(done, reading) => {
              setSuggestions((current) => (current ?? []).filter((s) => s.itinerary_id !== done.itinerary_id))
              setTrucks((current) => current.map((t) => (t.plate_number === done.plate_number ? { ...t, current_odometer: reading } : t)))
            }}
          />
        )}
      </div>

      {createFor && (
        <CreateWorkOrderModal
          vehicle={createFor}
          onClose={() => setCreateFor(null)}
          onCreated={() => {
            setCreateFor(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

export default TruckMaintenanceMonitoringSection
