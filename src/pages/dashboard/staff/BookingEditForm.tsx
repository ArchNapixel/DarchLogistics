// BookingEditForm: Booking Detail -> Edit (Admin + Dispatcher). One form,
// one Save, for everything on the booking except the client: each trip's
// price, the route (pickup, delivery, container return), the distance
// (worked out from the map, can be typed), pickup / deadline / storage
// dates, hours per trip and payment terms. Crew, trucks and trailers stay
// on the Dispatch Board; cargo keeps its own "Edit cargo" under each trip.
//
// Rules: lib/bookingEdit.ts (locks, inputs, the "distance jumped" warning).
// Saved by the database function update_booking_details() in ONE
// transaction -- it also logs who changed what (booking_change_logs), tells
// the client (client_notifications), keeps an already-paid downpayment as it
// was, and queues the driver-pay correction for a delivered trip
// (payroll_adjustments -> Payroll applies it). After saving:
//   - new hours per trip -> waiting trips are re-timed (lib/tripRetime.ts)
//   - new pickup / deadline date -> waiting trips are re-planned
//     (lib/capacityLoad.ts, the "All waiting trips" re-plan)
//   - the client's bell gets prices, places, dates and terms only (not
//     distance / hours per trip); the change history gets everything
//   - payment terms move the due dates of what's still unpaid; parts
//     already paid aren't affected (lib/bookingBalance.ts works due dates
//     out from the terms every time).
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import LocationPicker from '../../../components/LocationPicker'
import { emptyLocationValue, PAYMENT_TERMS_LABELS, tripCargoLabel, type LocationValue, type TripCargo } from '../../../lib/quoteRequest'
import { formatLocationDisplay } from '../../../lib/locationReference'
import { formatDate, formatMoney } from '../../../lib/format'
import { filterAmountInput } from '../../../lib/amountInput'
import { estimateLegKm } from '../../../lib/routeDistance'
import { downpaymentStatus } from '../../../lib/downpayment'
import { sumRates } from '../../../lib/lineRates'
import { retimeTrips } from '../../../lib/tripRetime'
import { loadReplan, saveReplan } from '../../../lib/capacityLoad'
import { clearShortCache } from '../../../lib/shortCache'
import {
  clientMessage,
  datesError,
  distanceError,
  distanceJumped,
  hoursError,
  priceError,
  priceLockReason,
  type EditMoney,
} from '../../../lib/bookingEdit'
import type { Booking } from './BookingsSection'

export type EditTrip = {
  itinerary_id: number
  status: string
  rate: number | null
  cargo: TripCargo
  trip_start_at: string | null
}

type Raw = {
  quote_request_id: number | null
  booking_date: string
  payment_terms: string
  place_of_pickup_id: number
  place_of_delivery_id: number
  place_of_return_id: number | null
  pickup_address_detail: string | null
  delivery_address_detail: string | null
  return_address_detail: string | null
  pickup_landmark: string | null
  delivery_landmark: string | null
  return_landmark: string | null
  pickup_lat: number | null
  pickup_lng: number | null
  delivery_lat: number | null
  delivery_lng: number | null
  return_lat: number | null
  return_lng: number | null
  estimated_distance_km: number | null
  return_distance_km: number | null
  hours_per_trip: number | null
  cost_per_trip: number | null
  storage_deadline: string | null
  downpayment_waived_at: string | null
  downpayment_fixed: number | null
}

// The form's values (also what was loaded, to see what changed).
type Values = {
  pickup: LocationValue
  delivery: LocationValue
  returnPlace: LocationValue | null
  distance: string
  returnDistance: string
  pickupDate: string
  deadline: string
  storageDeadline: string
  hours: string
  terms: string
  rates: Record<number, string>
}

const TERMS = ['Cash', '7Days', '14Days', '30Days'] as const
const termsLabel = (t: string) => PAYMENT_TERMS_LABELS[t as keyof typeof PAYMENT_TERMS_LABELS] ?? t
const placeText = (v: LocationValue) => formatLocationDisplay({ city: v.city, barangay: v.barangay, detail: v.detail || null })
const sameLocation = (a: LocationValue, b: LocationValue) =>
  a.city === b.city && a.barangay === b.barangay && a.detail.trim() === b.detail.trim() &&
  a.landmark.trim() === b.landmark.trim() && a.lat === b.lat && a.lng === b.lng
const sameRoute = (a: LocationValue, b: LocationValue) => a.city === b.city && a.barangay === b.barangay && a.lat === b.lat && a.lng === b.lng
const peso = (n: number) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`
const km = (text: string) => `${Number(text).toLocaleString('en-PH', { maximumFractionDigits: 2 })} km`
const locationJson = (v: LocationValue) => ({
  city: v.city,
  barangay: v.barangay,
  detail: v.detail,
  landmark: v.landmark,
  lat: v.lat,
  lng: v.lng,
})

async function loadEditData(bookingId: number) {
  const { data: b, error } = await supabase
    .from('bookings')
    .select(
      'quote_request_id, booking_date, payment_terms, place_of_pickup_id, place_of_delivery_id, place_of_return_id, pickup_address_detail, delivery_address_detail, return_address_detail, pickup_landmark, delivery_landmark, return_landmark, pickup_lat, pickup_lng, delivery_lat, delivery_lng, return_lat, return_lng, estimated_distance_km, return_distance_km, hours_per_trip, cost_per_trip, storage_deadline, downpayment_waived_at, downpayment_fixed',
    )
    .eq('booking_id', bookingId)
    .single()
  if (error || !b) return { error: error?.message ?? 'Booking not found.' }
  const raw = b as Raw
  const placeIds = [raw.place_of_pickup_id, raw.place_of_delivery_id, ...(raw.place_of_return_id === null ? [] : [raw.place_of_return_id])]
  const [places, quote] = await Promise.all([
    supabase.from('places').select('place_id, city, barangay').in('place_id', placeIds),
    raw.quote_request_id !== null
      ? supabase
          .from('quote_requests')
          .select('preferred_pickup_date, preferred_delivery_date')
          .eq('quote_request_id', raw.quote_request_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (places.error) return { error: places.error.message }
  if (quote.error) return { error: quote.error.message }
  const placeById = new Map((places.data ?? []).map((p) => [p.place_id, p]))
  const location = (placeId: number, detail: string | null, landmark: string | null, lat: number | null, lng: number | null): LocationValue => ({
    ...emptyLocationValue,
    city: placeById.get(placeId)?.city ?? '',
    barangay: placeById.get(placeId)?.barangay ?? '',
    detail: detail ?? '',
    landmark: landmark ?? '',
    lat,
    lng,
  })
  return {
    raw,
    values: {
      pickup: location(raw.place_of_pickup_id, raw.pickup_address_detail, raw.pickup_landmark, raw.pickup_lat, raw.pickup_lng),
      delivery: location(raw.place_of_delivery_id, raw.delivery_address_detail, raw.delivery_landmark, raw.delivery_lat, raw.delivery_lng),
      returnPlace:
        raw.place_of_return_id === null
          ? null
          : location(raw.place_of_return_id, raw.return_address_detail, raw.return_landmark, raw.return_lat, raw.return_lng),
      distance: raw.estimated_distance_km === null ? '' : String(raw.estimated_distance_km),
      returnDistance: raw.return_distance_km === null ? '' : String(raw.return_distance_km),
      pickupDate: quote.data?.preferred_pickup_date ?? raw.booking_date,
      deadline: quote.data?.preferred_delivery_date ?? '',
      storageDeadline: raw.storage_deadline ?? '',
      hours: raw.hours_per_trip === null ? '' : String(raw.hours_per_trip),
      terms: raw.payment_terms,
      rates: {},
    } satisfies Values,
  }
}

function BookingEditForm({
  booking,
  trips,
  onCancel,
  onSaved,
}: {
  booking: Booking
  trips: EditTrip[]
  onCancel: () => void
  onSaved: () => void
}) {
  const [loaded, setLoaded] = useState<{ raw: Raw; values: Values } | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Distance lookups: "working", or what went wrong.
  const [routeNote, setRouteNote] = useState<string | null>(null)
  // Bumped on every route change, so a slow lookup for an older route can't land.
  const lookupRef = useRef(0)

  const liveTrips = trips.filter((t) => t.status !== 'Cancelled')
  const money: EditMoney = {
    contract: booking.total_contract_value,
    delivered: booking.computed_billable_amount,
    extras: booking.damage_charges,
    paid: booking.amount_paid,
  }

  useEffect(() => {
    let cancelled = false
    loadEditData(booking.booking_id).then((result) => {
      if (cancelled) return
      if ('error' in result && result.error) return setLoadError(result.error)
      if (!('values' in result) || !result.values || !result.raw) return
      const rates = Object.fromEntries(
        trips.map((t) => [t.itinerary_id, t.rate === null ? String(booking.rate ?? '') : String(t.rate)]),
      )
      const start = { ...result.values, rates }
      setLoaded({ raw: result.raw, values: start })
      setValues(start)
    })
    return () => {
      cancelled = true
    }
    // Loaded once when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.booking_id])

  // Works the distance out again from the map (pickup -> delivery, and
  // delivery -> return place). Fills the boxes; staff can still type over them.
  async function recalculate(next: Values) {
    const token = ++lookupRef.current
    setRouteNote('Working out the distance from the map…')
    const stop = (v: LocationValue) => ({ city: v.city || null, barangay: v.barangay || null, lat: v.lat, lng: v.lng })
    const [main, back] = await Promise.all([
      estimateLegKm(stop(next.pickup), stop(next.delivery)),
      next.returnPlace ? estimateLegKm(stop(next.delivery), stop(next.returnPlace)) : Promise.resolve(null),
    ])
    if (token !== lookupRef.current) return
    setValues((v) =>
      v && {
        ...v,
        distance: main === null ? v.distance : String(main),
        returnDistance: next.returnPlace && back !== null ? String(back) : v.returnDistance,
      },
    )
    setRouteNote(main === null ? "Couldn't work the distance out from the map -- type it." : null)
  }

  // A new place / pin works the distance out again by itself.
  function setStop(key: 'pickup' | 'delivery' | 'returnPlace', next: LocationValue) {
    if (!values) return
    const before = values[key]
    const updated = { ...values, [key]: next }
    setValues(updated)
    if (before && !sameRoute(before, next) && next.city && next.barangay) void recalculate(updated)
  }

  if (loadError) return <p className="bg-red-50 px-4 py-3 text-sm text-red-700">Couldn&apos;t open the editor ({loadError}).</p>
  if (!loaded || !values) return <p className="px-1 py-3 text-sm text-slate-500">Loading the booking…</p>

  const start = loaded.values
  const raw = loaded.raw
  const set = (patch: Partial<Values>) => setValues({ ...values, ...patch })

  // ---- What changed ----
  const rateChanges = liveTrips.flatMap((t) => {
    const before = start.rates[t.itinerary_id] ?? ''
    const after = (values.rates[t.itinerary_id] ?? '').trim()
    return before !== after && Number(before) !== Number(after) ? [{ trip: t, before: Number(before), after }] : []
  })
  const changed = {
    pickup: !sameLocation(start.pickup, values.pickup),
    delivery: !sameLocation(start.delivery, values.delivery),
    returnPlace: !!values.returnPlace && !!start.returnPlace && !sameLocation(start.returnPlace, values.returnPlace),
    distance: Number(start.distance) !== Number(values.distance),
    returnDistance: !!values.returnPlace && Number(start.returnDistance) !== Number(values.returnDistance),
    pickupDate: start.pickupDate !== values.pickupDate,
    deadline: start.deadline !== values.deadline,
    storageDeadline: start.storageDeadline !== values.storageDeadline,
    hours: Number(start.hours) !== Number(values.hours),
    terms: start.terms !== values.terms,
  }
  const anyChange = rateChanges.length > 0 || Object.values(changed).some(Boolean)

  // ---- Problems ----
  const rateProblems = new Map(
    rateChanges.flatMap((c) => {
      const problem = priceError(c.after)
      return problem ? [[c.trip.itinerary_id, problem] as const] : []
    }),
  )
  const problem =
    (rateProblems.size > 0 ? 'Fix the trip prices marked in red.' : null) ??
    (!values.pickup.city || !values.pickup.barangay ? 'Pick the pickup city and barangay.' : null) ??
    (!values.delivery.city || !values.delivery.barangay ? 'Pick the delivery city and barangay.' : null) ??
    (values.returnPlace && (!values.returnPlace.city || !values.returnPlace.barangay)
      ? 'Pick the container return city and barangay.'
      : null) ??
    (changed.distance ? distanceError(values.distance) : null) ??
    (changed.returnDistance ? distanceError(values.returnDistance, 'Return distance') : null) ??
    (changed.pickupDate || changed.deadline ? datesError(values.pickupDate, values.deadline) : null) ??
    (changed.hours ? hoursError(values.hours) : null)

  // ---- Cost per trip / downpayment (they don't change by themselves) ----
  const jumped =
    distanceJumped(Number(start.distance) || null, Number(values.distance) || null) ||
    (!!values.returnPlace && distanceJumped(Number(start.returnDistance) || null, Number(values.returnDistance) || null))
  const newContract = sumRates(
    liveTrips.map((t) => {
      const typed = Number(values.rates[t.itinerary_id])
      return typed > 0 ? typed : (t.rate ?? booking.rate ?? 0)
    }),
  )
  const downpayment = downpaymentStatus({
    contract: newContract,
    costPerTrip: raw.cost_per_trip,
    trips: liveTrips.length,
    amountPaid: booking.amount_paid,
    waivedAt: raw.downpayment_waived_at,
    fixed: raw.downpayment_fixed,
  })
  // Paid already (and repriced): the database keeps it as it was.
  const downpaymentNow = downpaymentStatus({
    contract: booking.total_contract_value,
    costPerTrip: raw.cost_per_trip,
    trips: liveTrips.length,
    amountPaid: booking.amount_paid,
    waivedAt: raw.downpayment_waived_at,
    fixed: raw.downpayment_fixed,
  })
  const downpaymentShown = downpaymentNow?.met ? downpaymentNow : downpayment

  async function save() {
    if (!values || problem || !anyChange) return
    setSaving(true)
    setError(null)

    const changes: Record<string, unknown> = {}
    // Every change goes in the staff log; the client is only told about the
    // ones that are theirs (prices, places, dates, terms) -- distance and
    // hours per trip are internal planning numbers.
    const lines: string[] = []
    const internal = new Set<string>()
    if (rateChanges.length > 0) {
      changes.trip_rates = rateChanges.map((c) => ({ itinerary_id: c.trip.itinerary_id, rate: Number(c.after) }))
      rateChanges.forEach((c) => lines.push(`Trip #${c.trip.itinerary_id} price ${peso(c.before)} → ${peso(Number(c.after))}`))
    }
    if (changed.pickup) {
      changes.pickup = locationJson(values.pickup)
      lines.push(`Pickup ${placeText(start.pickup)} → ${placeText(values.pickup)}`)
    }
    if (changed.delivery) {
      changes.delivery = locationJson(values.delivery)
      lines.push(`Delivery ${placeText(start.delivery)} → ${placeText(values.delivery)}`)
    }
    if (changed.returnPlace && values.returnPlace && start.returnPlace) {
      changes.return_place = locationJson(values.returnPlace)
      lines.push(`Container return ${placeText(start.returnPlace)} → ${placeText(values.returnPlace)}`)
    }
    if (changed.distance) {
      changes.estimated_distance_km = Number(values.distance)
      const line = `Distance ${start.distance ? km(start.distance) : '—'} → ${km(values.distance)}`
      lines.push(line)
      internal.add(line)
    }
    if (changed.returnDistance) {
      changes.return_distance_km = Number(values.returnDistance)
      const line = `Return distance ${start.returnDistance ? km(start.returnDistance) : '—'} → ${km(values.returnDistance)}`
      lines.push(line)
      internal.add(line)
    }
    if (changed.pickupDate) {
      changes.pickup_date = values.pickupDate
      lines.push(`Pickup date ${formatDate(start.pickupDate)} → ${formatDate(values.pickupDate)}`)
    }
    if (changed.deadline) {
      changes.deadline_date = values.deadline || null
      lines.push(`Deadline ${start.deadline ? formatDate(start.deadline) : 'none'} → ${values.deadline ? formatDate(values.deadline) : 'none'}`)
    }
    if (changed.storageDeadline) {
      changes.storage_deadline = values.storageDeadline || null
      lines.push(
        `Last free storage day ${start.storageDeadline ? formatDate(start.storageDeadline) : 'none'} → ${values.storageDeadline ? formatDate(values.storageDeadline) : 'none'}`,
      )
    }
    if (changed.hours) {
      changes.hours_per_trip = Number(values.hours)
      const line = `Hours per trip ${start.hours || '—'} → ${values.hours}`
      lines.push(line)
      internal.add(line)
    }
    if (changed.terms) {
      changes.payment_terms = values.terms
      lines.push(`Payment terms ${termsLabel(start.terms)} → ${termsLabel(values.terms)}`)
    }

    const { error: saveError } = await supabase.rpc('update_booking_details', {
      p_booking_id: booking.booking_id,
      p_changes: changes,
      p_summary: lines,
      // Empty when only internal numbers changed = no notification.
      p_client_message: clientMessage(booking.booking_id, lines.filter((l) => !internal.has(l))),
    })
    if (saveError) {
      setSaving(false)
      setError(
        saveError.message.includes('update_booking_details')
          ? 'Editing needs the 2026-11-18 database update (migration 20261118000000) -- run it in the SQL Editor first.'
          : saveError.message,
      )
      return
    }
    clearShortCache()

    // Follow-ups: re-time / re-plan the trips that haven't left.
    const followUp: string[] = []
    const waiting = trips.filter((t) => t.status === 'Awaiting' && t.trip_start_at !== null)
    if (changed.hours && waiting.length > 0) {
      const hours = Number(values.hours)
      const result = await retimeTrips(
        { lengths: new Map(waiting.map((t) => [t.itinerary_id, hours * 3_600_000])) },
        Math.min(...waiting.map((t) => new Date(t.trip_start_at!).getTime())),
      )
      if (result.warning) followUp.push(`Not every trip was re-timed: ${result.warning}`)
      for (const message of result.late) showToast(message, 'error')
    }
    if ((changed.pickupDate || changed.deadline) && waiting.length > 0) {
      const plan = await loadReplan(booking.booking_id)
      if (plan.error || !plan.data) {
        followUp.push(`The waiting trips couldn't be re-planned (${plan.error ?? 'no data'}) -- use "Re-plan waiting trips".`)
      } else if (plan.data.replans.all.moves.length > 0) {
        const replanError = await saveReplan(booking.booking_id, plan.data.replans.all.moves)
        if (replanError) followUp.push(`The waiting trips couldn't be re-planned (${replanError}) -- use "Re-plan waiting trips".`)
      }
      if (plan.data && plan.data.replans.all.stuck.length > 0) {
        followUp.push(`${plan.data.replans.all.stuck.length} waiting trip(s) couldn't be placed and kept their old time.`)
      }
    }
    setSaving(false)

    const deliveredRepriced = rateChanges.some((c) => c.trip.status !== 'Awaiting')
    const clientTold = lines.some((l) => !internal.has(l))
    showToast(
      `Booking #${booking.booking_id} saved.` +
        (deliveredRepriced ? " The driver's pay is corrected the next time Payroll is opened." : '') +
        (clientTold ? ' The client sees the change in their portal.' : ''),
    )
    for (const message of followUp) showToast(message, 'error')
    onSaved()
  }

  const field =
    'w-full min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm text-ink-metric focus:border-primary'
  const label = 'flex flex-col gap-1.5 text-sm font-medium text-ink-secondary'
  const warnBox = jumped ? 'border-2 border-red-600' : 'border border-line'

  return (
    <section aria-label="Edit booking" className="border-2 border-primary bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <h4 className="text-base font-semibold text-slate-900">Edit booking #{booking.booking_id}</h4>
          <p className="text-[13px] text-ink-muted">
            Client: {booking.client_name} (can&apos;t be changed). Crew, trucks and trailers are set on the Dispatch Board.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-5 py-4">
        {/* Prices */}
        <div>
          <h5 className="text-sm font-semibold text-slate-900">Price per trip</h5>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="px-2 py-2">Trip</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Cargo</th>
                  <th className="px-2 py-2">Price (₱)</th>
                </tr>
              </thead>
              <tbody>
                {liveTrips.map((t) => {
                  const lock = priceLockReason(t.status, money)
                  const problemText = rateProblems.get(t.itinerary_id)
                  return (
                    <tr key={t.itinerary_id} className="border-t border-slate-200">
                      <td className="px-2 py-2 font-semibold">#{t.itinerary_id}</td>
                      <td className="px-2 py-2">{t.status}</td>
                      <td className="px-2 py-2">{tripCargoLabel(t.cargo)}</td>
                      <td className="px-2 py-2">
                        <input
                          inputMode="decimal"
                          aria-label={`Trip #${t.itinerary_id} price`}
                          value={values.rates[t.itinerary_id] ?? ''}
                          disabled={!!lock || saving}
                          onChange={(e) => set({ rates: { ...values.rates, [t.itinerary_id]: filterAmountInput(e.target.value) } })}
                          className={`${field} w-40 tabular-nums disabled:bg-slate-100 ${problemText ? 'border-red-600' : ''}`}
                        />
                        {lock && <span className="mt-1 block text-xs text-ink-muted">Locked: {lock.toLowerCase()}</span>}
                        {problemText && <span className="mt-1 block text-xs text-red-700">{problemText}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[13px] text-ink-muted">
            New contract {formatMoney(newContract)} (was {formatMoney(booking.total_contract_value)}). The difference moves the balance;
            a downpayment already paid stays the same.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={`px-4 py-3 ${warnBox}`}>
              <p className="text-xs text-slate-500">Cost per trip (saved)</p>
              <p className="text-lg font-bold tabular-nums">{formatMoney(raw.cost_per_trip)}</p>
              {jumped && <p className="text-xs font-medium text-red-700">Distance went up a lot -- may need updating.</p>}
            </div>
            <div className={`px-4 py-3 ${warnBox}`}>
              <p className="text-xs text-slate-500">Downpayment</p>
              <p className="text-lg font-bold tabular-nums">
                {downpaymentShown ? formatMoney(downpaymentShown.required) : 'None required'}
              </p>
              {downpaymentNow?.met && <p className="text-xs text-green-800">Paid -- stays as it is.</p>}
              {jumped && <p className="text-xs font-medium text-red-700">Distance went up a lot -- may need updating.</p>}
            </div>
          </div>
        </div>

        {/* Route */}
        <div className="flex flex-col gap-4">
          <h5 className="text-sm font-semibold text-slate-900">Route</h5>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-secondary">Pickup</p>
              <LocationPicker stop="pickup" value={values.pickup} onChange={(v) => setStop('pickup', v)} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-secondary">Delivery</p>
              <LocationPicker stop="delivery" value={values.delivery} onChange={(v) => setStop('delivery', v)} />
            </div>
            {values.returnPlace && (
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink-secondary">Return the empty container to</p>
                <LocationPicker stop="return" value={values.returnPlace} onChange={(v) => setStop('returnPlace', v)} />
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className={label}>
              Distance per trip (km)
              <input
                inputMode="decimal"
                value={values.distance}
                onChange={(e) => {
                  lookupRef.current += 1 // typed: a lookup still running mustn't overwrite it
                  setRouteNote(null)
                  set({ distance: filterAmountInput(e.target.value) })
                }}
                className={`${field} w-40 tabular-nums`}
              />
            </label>
            {values.returnPlace && (
              <label className={label}>
                Return distance (km)
                <input
                  inputMode="decimal"
                  value={values.returnDistance}
                  onChange={(e) => {
                    lookupRef.current += 1
                    setRouteNote(null)
                    set({ returnDistance: filterAmountInput(e.target.value) })
                  }}
                  className={`${field} w-40 tabular-nums`}
                />
              </label>
            )}
            <button type="button" onClick={() => void recalculate(values)} className="btn-secondary px-4 text-sm font-medium">
              Recalculate from map
            </button>
          </div>
          {routeNote && <p className="text-[13px] text-ink-muted">{routeNote}</p>}
        </div>

        {/* Schedule & terms */}
        <div>
          <h5 className="text-sm font-semibold text-slate-900">Schedule &amp; terms</h5>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className={label}>
              Pickup date
              <input type="date" value={values.pickupDate} onChange={(e) => set({ pickupDate: e.target.value })} className={field} />
            </label>
            <label className={label}>
              Deadline date
              <input type="date" value={values.deadline} onChange={(e) => set({ deadline: e.target.value })} className={field} />
            </label>
            <label className={label}>
              Last free storage day (optional)
              <input
                type="date"
                value={values.storageDeadline}
                onChange={(e) => set({ storageDeadline: e.target.value })}
                className={field}
              />
            </label>
            <label className={label}>
              Hours per trip
              <input
                inputMode="decimal"
                value={values.hours}
                onChange={(e) => set({ hours: filterAmountInput(e.target.value) })}
                className={`${field} tabular-nums`}
              />
            </label>
            <label className={label}>
              Payment terms
              <select value={values.terms} onChange={(e) => set({ terms: e.target.value })} className={field}>
                {TERMS.map((t) => (
                  <option key={t} value={t}>
                    {termsLabel(t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-2 text-[13px] text-ink-muted">
            A new pickup or deadline date re-plans the waiting trips. New payment terms move the due dates of what&apos;s still
            unpaid.
          </p>
        </div>

        {(error || (anyChange && problem)) && (
          <p className="bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error ?? problem}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onCancel} disabled={saving} className="btn-secondary px-4 text-sm font-medium">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !anyChange || !!problem}
            className="btn-primary px-4 text-sm font-medium"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </section>
  )
}

export default BookingEditForm
