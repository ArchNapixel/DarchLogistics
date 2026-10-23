// QuoteReviewModal: full detail view for one quote request, with an
// editable estimated trip distance (bookings.estimated_distance_km is
// required), plus Approve/Reject actions. The proposed rate, payment
// terms and trip start date (= preferred pickup date) are the client's
// and read-only -- to change them, Reject with a preset reason.
// Staff also enter the booking's hours per trip (bookings.hours_per_trip).
// The trips run one after another: trip 1 starts on the pickup date at
// Settings' default trip start time (default_trip_start_time, 6 AM if
// unset), trip 2 starts when trip 1 ends, and so on (chainSlots).
// Approve also saves the estimated cost per trip (bookings.cost_per_trip,
// the profitability panel's diesel + commission + per-trip fee at today's
// Settings) -- the client's downpayment is worked out from it
// (lib/downpayment.ts), and no trip can start until it's paid.
//
// Distance, most precise source first (the field stays editable either
// way):
//   1. Both ends have an exact map pin (quote_requests.*_lat/*_lng, set
//      by LocationPicker) -> OSRM driving distance between the two pins.
//   2. `route_cache` has a distance for this barangay pair (one row per
//      unique place pair, place_id_a always the lower id, so direction
//      doesn't matter) from a previous approval.
//   3. Best-effort estimate between the two barangays' centres
//      (Nominatim geocode of the city/barangay text + OSRM).
// Approve saves whatever value is showing to route_cache so a later
// quote on that same barangay pair *without* pins reuses it.
//
// Profitability estimate: a side panel that appears once a distance is
// entered, using `app_settings` (diesel_price_per_liter,
// driver_commission_rate, driver_per_trip_fee) to estimate diesel cost
// (price/liter * km), driver commission cost (commission% * proposed
// rate), and a flat driver per-trip fee. If the three combined reach
// 50% of the rate, a warning is shown -- this never blocks or
// auto-rejects anything, it's just information for staff to weigh
// before clicking Approve.
//
// Approve first CLAIMS the quote (Pending -> Approved, only if still
// Pending, checked with .select().maybeSingle()) so two admins can never
// both approve it; if a step fails before the booking exists, the claim
// is released back to Pending. Reject has the same "still Pending" guard.
// Then it does 5 steps in order: resolve the client -- the `client_id`
// staff already linked on the request if there is one, else an existing
// `clients` row matching by email (clients.email is unique), else a new
// one created from the quote's free-text client info -- reuse existing `places` rows by
// city+barangay (trimmed, case-insensitive -- barangay is the routing/
// cache unit, same idea as the client email check) or create them if
// this is a new barangay, update the quote_request, create the
// `bookings` row using those IDs (also copying the quote's free-text
// landmark detail onto pickup/delivery_address_detail, since bookings
// only ever had place_id before), then create ONE `itinerary` per
// delivery order (quote.delivery_order_count) linked to that booking --
// a booking can cover multiple deliverables (e.g. several containers),
// each needing its own truck+trailer+driver, so each one gets its own
// itinerary row (status 'Awaiting', no truck/trailer/driver assigned
// yet -- that happens later on the Dispatch Board). If a later step
// fails, earlier ones have already been saved (no rollback) -- fine for
// now, but worth moving into a single database function later for
// atomicity. The booking->itinerary step is the one most likely to
// leave things half-done (quote Approved + booking created, but zero or
// partial itineraries), so that failure is surfaced with an explicit
// "needs manual review" message instead of a generic one.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import { estimateTripCosts } from '../../../lib/tripCost'
import { formatLocationDisplay } from '../../../lib/locationReference'
import { fetchDrivingDistanceKm, geocodePlace } from '../../../lib/geocoding'
import type { QuoteRequest } from './QuoteRequestsSection'
import { formatMoney, formatDate, formatSlot, manilaTimestamp } from '../../../lib/format'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { toManilaDate } from '../../../lib/payslip'
import {
  MAX_DELIVERY_ORDERS,
  PAYMENT_TERMS_LABELS,
  REJECTION_TAGS,
  type RejectionTag,
} from '../../../lib/quoteRequest'
import { chainSlots } from '../../../lib/tripSchedule'
import { downpaymentFor } from '../../../lib/downpayment'

// Used when Settings has no default_trip_start_time row: 6 AM.
const DEFAULT_TRIP_START_MINUTES = 360
// Same cap as the bookings.hours_per_trip CHECK constraint.
const MAX_HOURS_PER_TRIP = 72

const fieldClasses =
  'w-full border-2 border-slate-300 bg-white px-3 py-2.5 text-[15px] text-slate-900 focus:border-primary focus:outline-none'

// Looks up an existing place by city+barangay (trimmed, case-insensitive)
// before creating a new one -- barangay is the routing/cache unit (see
// route_cache below), not the free-text landmark, so two quotes into the
// same barangay always resolve to the same place_id no matter how
// differently their landmark text reads. A database-level unique index
// on (lower(trim(city)), lower(trim(barangay))) backs this up in case
// some other code path ever skips this check.
async function findOrCreatePlace(
  city: string | null,
  barangay: string | null,
): Promise<{ placeId: number } | { error: string }> {
  if (!city || !barangay) {
    return { error: 'This quote is missing a city/barangay for one of its locations.' }
  }

  const trimmedCity = city.trim()
  const trimmedBarangay = barangay.trim()

  const { data: existingPlace, error: existingPlaceError } = await supabase
    .from('places')
    .select('place_id')
    .ilike('city', trimmedCity)
    .ilike('barangay', trimmedBarangay)
    .maybeSingle()

  if (existingPlaceError) {
    return { error: existingPlaceError.message }
  }

  if (existingPlace) {
    return { placeId: existingPlace.place_id }
  }

  const { data: newPlace, error: insertError } = await supabase
    .from('places')
    .insert({
      place_name: `Brgy. ${trimmedBarangay}, ${trimmedCity}`,
      city: trimmedCity,
      barangay: trimmedBarangay,
    })
    .select('place_id')
    .single()

  if (insertError || !newPlace) {
    return { error: insertError?.message ?? 'Could not create location.' }
  }

  return { placeId: newPlace.place_id }
}

// Read-only version of the lookup above -- used just to preview whether
// a cached distance exists before Approve is clicked. Never creates a
// place, since the quote might still get Rejected.
async function findPlaceIdByCityBarangay(
  city: string | null,
  barangay: string | null,
): Promise<number | null> {
  if (!city || !barangay) {
    return null
  }

  const { data } = await supabase
    .from('places')
    .select('place_id')
    .ilike('city', city.trim())
    .ilike('barangay', barangay.trim())
    .maybeSingle()

  return data?.place_id ?? null
}

// route_cache stores each pair with the lower place_id first, so a
// route reads the same regardless of pickup/delivery direction.
function orderPlacePair(placeIdA: number, placeIdB: number): [number, number] {
  return placeIdA < placeIdB ? [placeIdA, placeIdB] : [placeIdB, placeIdA]
}

async function findCachedDistance(
  placeIdA: number,
  placeIdB: number,
): Promise<number | null> {
  const [lowId, highId] = orderPlacePair(placeIdA, placeIdB)

  const { data } = await supabase
    .from('route_cache')
    .select('distance_km')
    .eq('place_id_a', lowId)
    .eq('place_id_b', highId)
    .maybeSingle()

  return data?.distance_km ?? null
}

// Best-effort auto-distance for a route with no route_cache hit yet --
// same free OSM stack LocationPicker already uses for its map picker
// (Nominatim), plus OSRM's public routing server for real driving
// distance. Never trusted blindly (same spirit as the map picker's
// reverse-geocode): a bad/no match just returns null and the caller
// leaves the field blank for manual entry, exactly like before this
// feature existed.
async function geocodeToLatLng(
  city: string,
  barangay: string,
): Promise<{ lat: number; lon: number } | null> {
  return geocodePlace(`Barangay ${barangay}, ${city}, Philippines`)
}

// Link to the exact pinned spot on OpenStreetMap, so staff can check
// where the customer actually meant before approving. Null when the
// quote has no pin for that end.
function pinLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
}

// One read-only label/value pair (inside a <dl>).
function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[13px] text-slate-500">{label}</dt>
      <dd className="text-[15px] text-slate-900">{children}</dd>
    </div>
  )
}

// Small heading over each group in the left column, with a rule under it.
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 border-b border-slate-200 pb-2 text-[15px] font-semibold text-slate-900">{children}</h3>
  )
}

// One row of the profitability panel: label (+ optional hint) and amount.
function CostRow({ label, hint, value, strong = false }: { label: string; hint?: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className={strong ? 'font-semibold text-slate-900' : 'text-slate-700'}>
        {label}
        {hint && <span className="block text-[13px] font-normal text-slate-500">{hint}</span>}
      </span>
      <span className={`tabular-nums ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-900'}`}>{value}</span>
    </div>
  )
}

// Outline icons (24x24 SVG paths, same style as the sidebar's).
const ICONS = {
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
}

function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block shrink-0"
      aria-hidden="true"
    >
      <path d={ICONS[name]} />
    </svg>
  )
}

// Hours-per-trip rule, used on blur and again on Approve.
function hoursProblem(value: string): string | null {
  const hours = Number(value)
  if (!value.trim()) return 'Enter how many hours one trip takes.'
  if (!(hours > 0)) return 'Enter a number of hours greater than 0.'
  if (hours > MAX_HOURS_PER_TRIP) return `One trip can be at most ${MAX_HOURS_PER_TRIP} hours.`
  return null
}

function QuoteReviewModal({
  quote,
  onClose,
  onResolved,
}: {
  quote: QuoteRequest
  onClose: () => void
  onResolved: (quoteRequestId: number) => void
}) {
  // Rate, payment terms and trip start date are the client's own -- staff
  // can't change them here. If one is wrong, Reject with the matching
  // preset (Trip rate too low / Payment terms / Schedule) and the client
  // fixes it and resubmits. Trip start = the client's preferred pickup date.
  const proposedRate = quote.proposed_rate?.toString() ?? ''
  const paymentTerms = quote.payment_terms
  const tripDateFrom = quote.preferred_pickup_date ?? ''
  // Last free storage day: every trip must be Picked Up by 11:59 PM on the
  // pickup date, so the trips all start together (one truck each) instead
  // of back to back. Saved as bookings.storage_deadline on Approve.
  const urgent = quote.is_last_day_of_port_storage === true
  const [estimatedDistanceKm, setEstimatedDistanceKm] = useState('')
  // Length of each trip's time slot (bookings.hours_per_trip).
  const [hoursPerTrip, setHoursPerTrip] = useState('')
  // Inline error under the hours box (checked on blur and on Approve).
  const [hoursError, setHoursError] = useState<string | null>(null)
  const hoursInputRef = useRef<HTMLInputElement>(null)
  // Settings' default trip start time, minutes after midnight.
  const [defaultStartMinutes, setDefaultStartMinutes] = useState(DEFAULT_TRIP_START_MINUTES)
  const [distanceIsCached, setDistanceIsCached] = useState(false)
  const [distanceIsAutoEstimated, setDistanceIsAutoEstimated] = useState(false)
  const [distanceIsFromPins, setDistanceIsFromPins] = useState(false)
  const [autoEstimatingDistance, setAutoEstimatingDistance] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  // Preset picked in the Reject form -- tells the client which field to
  // fix on resubmit (REJECTION_TAGS in lib/quoteRequest.ts).
  const [rejectTag, setRejectTag] = useState<RejectionTag | null>(null)
  const [approvedBookingId, setApprovedBookingId] = useState<number | null>(
    null,
  )
  const [itinerariesCreated, setItinerariesCreated] = useState(0)
  const [dieselPricePerLiter, setDieselPricePerLiter] = useState<number | null>(
    null,
  )
  const [driverCommissionRate, setDriverCommissionRate] = useState<
    number | null
  >(null)
  const [driverPerTripFee, setDriverPerTripFee] = useState<number | null>(
    null,
  )
  // True once staff typed in the distance box -- the background estimate
  // below must never overwrite their number.
  const distanceTypedRef = useRef(false)
  // True once this quote is no longer Pending (our own Approve claimed
  // it), so closing the modal must also drop it from the Pending list.
  const [claimed, setClaimed] = useState(false)

  // Close: if the quote already left Pending, tell the list to drop it
  // (✕ after an approval used to leave it there, ready to approve twice).
  function close() {
    if (claimed) onResolved(quote.quote_request_id)
    else onClose()
  }

  // Load the settings the profitability panel needs. If any aren't
  // configured yet, that value stays null and the panel shows a note
  // instead of numbers.
  useEffect(() => {
    async function loadSettings() {
      const { data, error: settingsError } = await supabase
        .from('app_settings')
        .select('setting_key, setting_value')
        .in('setting_key', [
          'diesel_price_per_liter',
          'driver_commission_rate',
          'driver_per_trip_fee',
          'default_trip_start_time',
        ])

      if (settingsError || !data) {
        // Say what actually failed, instead of Approve later claiming the
        // Settings rows are missing.
        setError(`Couldn't load Settings (${settingsError?.message ?? 'no data'}). Close and reopen this quote.`)
        return
      }

      const dieselSetting = data.find(
        (setting) => setting.setting_key === 'diesel_price_per_liter',
      )
      const commissionSetting = data.find(
        (setting) => setting.setting_key === 'driver_commission_rate',
      )
      const perTripFeeSetting = data.find(
        (setting) => setting.setting_key === 'driver_per_trip_fee',
      )

      if (dieselSetting) {
        setDieselPricePerLiter(dieselSetting.setting_value)
      }
      if (commissionSetting) {
        setDriverCommissionRate(commissionSetting.setting_value)
      }
      if (perTripFeeSetting) {
        setDriverPerTripFee(perTripFeeSetting.setting_value)
      }
      const startSetting = data.find(
        (setting) => setting.setting_key === 'default_trip_start_time',
      )
      if (startSetting) {
        setDefaultStartMinutes(Number(startSetting.setting_value))
      }
    }

    loadSettings()
  }, [])

  // If both pickup and delivery text already match known places with a
  // cached distance from a previous approval, use that (it's exact --
  // possibly staff-corrected). Otherwise fall back to a best-effort
  // auto-estimate via geocoding + routing (see geocodeToLatLng/
  // fetchDrivingDistanceKm above). Either way the field stays editable.
  useEffect(() => {
    async function loadDistance() {
      // Fills the box only if staff haven't typed in it yet -- the lookups
      // below can take a few seconds (geocoding is throttled to 1/sec).
      function applyEstimate(km: string, source: 'pins' | 'cache' | 'auto') {
        if (distanceTypedRef.current) return
        setEstimatedDistanceKm(km)
        setDistanceIsFromPins(source === 'pins')
        setDistanceIsCached(source === 'cache')
        setDistanceIsAutoEstimated(source === 'auto')
      }

      if (
        typeof quote.pickup_lat === 'number' &&
        typeof quote.pickup_lng === 'number' &&
        typeof quote.delivery_lat === 'number' &&
        typeof quote.delivery_lng === 'number'
      ) {
        setAutoEstimatingDistance(true)
        try {
          const km = await fetchDrivingDistanceKm(
            { lat: quote.pickup_lat, lon: quote.pickup_lng },
            { lat: quote.delivery_lat, lon: quote.delivery_lng },
          )
          if (km !== null) {
            applyEstimate(km.toFixed(2), 'pins')
            return
          }
        } catch {
          // Routing failed -- fall through to the cache/barangay estimate.
        } finally {
          setAutoEstimatingDistance(false)
        }
      }

      const pickupId = await findPlaceIdByCityBarangay(quote.pickup_city, quote.pickup_barangay)
      const deliveryId = await findPlaceIdByCityBarangay(
        quote.delivery_city,
        quote.delivery_barangay,
      )

      if (pickupId !== null && deliveryId !== null) {
        const cachedKm = await findCachedDistance(pickupId, deliveryId)
        if (cachedKm !== null) {
          applyEstimate(String(cachedKm), 'cache')
          return
        }
      }

      if (
        !quote.pickup_city ||
        !quote.pickup_barangay ||
        !quote.delivery_city ||
        !quote.delivery_barangay
      ) {
        return
      }

      setAutoEstimatingDistance(true)
      try {
        const [pickupPoint, deliveryPoint] = await Promise.all([
          geocodeToLatLng(quote.pickup_city, quote.pickup_barangay),
          geocodeToLatLng(quote.delivery_city, quote.delivery_barangay),
        ])

        if (!pickupPoint || !deliveryPoint) return

        const km = await fetchDrivingDistanceKm(pickupPoint, deliveryPoint)
        if (km !== null) {
          applyEstimate(km.toFixed(2), 'auto')
        }
      } catch {
        // Geocoding/routing failed (network, rate limit, no match) --
        // leave the field blank for manual entry, same as before this
        // feature existed.
      } finally {
        setAutoEstimatingDistance(false)
      }
    }

    loadDistance()
  }, [
    quote.pickup_city,
    quote.pickup_barangay,
    quote.delivery_city,
    quote.delivery_barangay,
    quote.pickup_lat,
    quote.pickup_lng,
    quote.delivery_lat,
    quote.delivery_lng,
  ])

  async function handleApprove() {
    const rateValue = Number(proposedRate)
    if (!proposedRate || rateValue <= 0) {
      setError('This quote has no proposed rate. Reject it ("Trip rate too low") so the client can add one.')
      return
    }

    const distanceValue = Number(estimatedDistanceKm)
    if (!estimatedDistanceKm || distanceValue <= 0) {
      setError('Enter the estimated trip distance before approving.')
      return
    }

    // Checked before the storage-day confirm below, so a missing hours
    // value is fixed first. Shown under the box, not as a top error.
    const hoursMessage = hoursProblem(hoursPerTrip)
    if (hoursMessage) {
      setHoursError(hoursMessage)
      hoursInputRef.current?.focus()
      return
    }

    if (!tripDateFrom) {
      setError('This quote has no pickup date. Reject it ("Schedule unavailable") so the client can add one.')
      return
    }

    // The storage day already passed: the free storage is gone, so ask first.
    if (
      urgent &&
      tripDateFrom < toManilaDate(new Date()) &&
      !(await confirmDialog({
        title: 'Storage day already passed',
        message: `The last free storage day (${formatDate(tripDateFrom)}) is already over. Approve anyway?`,
        confirmLabel: 'Approve anyway',
        danger: true,
      }))
    ) {
      return
    }

    // The downpayment is worked out from the trip cost, so the cost must be known.
    if (!canCalculateProfitability) {
      setError(
        'The trip cost (and so the client\'s downpayment) can\'t be worked out -- check that Settings has the diesel price, driver commission rate and per-trip fee.',
      )
      return
    }

    const hoursValue = Number(hoursPerTrip) // validated above (hoursProblem)

    // Older quotes can predate the delivery cap in lib/quoteRequest.ts.
    const requestedTrips = quote.delivery_order_count ?? 1
    if (requestedTrips > MAX_DELIVERY_ORDERS) {
      setError(
        `This quote asks for ${requestedTrips} trips (max ${MAX_DELIVERY_ORDERS}). Reject it ("Other") so the client splits it into smaller quotes.`,
      )
      return
    }

    setSubmitting(true)
    setError(null)

    // 0. Claim the quote FIRST: mark it Approved only if it's still
    // Pending, and check a row really changed (.select().maybeSingle() --
    // a blocked or already-handled update reports no error but changes
    // nothing). Nothing else is written until this succeeds, so two
    // admins / two tabs can never both create a booking for one quote.
    const { data: claimedRow, error: claimError } = await supabase
      .from('quote_requests')
      .update({ request_status: 'Approved' })
      .eq('quote_request_id', quote.quote_request_id)
      .eq('request_status', 'Pending')
      .select('quote_request_id')
      .maybeSingle()

    if (claimError) {
      setError(claimError.message)
      setSubmitting(false)
      return
    }
    if (!claimedRow) {
      setSubmitting(false)
      showToast('Another admin already handled this quote -- it is no longer pending.', 'error')
      onResolved(quote.quote_request_id)
      return
    }
    setClaimed(true)

    // A step before the booking failed: put the quote back to Pending so
    // it can simply be approved again (no booking exists yet). Guarded on
    // 'Approved' so it never undoes anything else.
    async function releaseClaim(message: string) {
      const { data: released } = await supabase
        .from('quote_requests')
        .update({ request_status: 'Pending' })
        .eq('quote_request_id', quote.quote_request_id)
        .eq('request_status', 'Approved')
        .select('quote_request_id')
        .maybeSingle()
      if (released) setClaimed(false)
      setError(
        released
          ? `${message} Nothing was created; the quote is back to Pending.`
          : `${message} The quote could not be set back to Pending -- check the Approved tab (it will show "No booking found").`,
      )
      setSubmitting(false)
    }

    // 1. Resolve the client, in order of how certain we are: a client
    // staff already linked on the request itself, else an existing one
    // matching this email (clients.email is unique -- inserting a
    // duplicate would fail), else a new one from the quote's free-text
    // client info.
    let clientId: number

    if (quote.client_id) {
      // Staff already picked a real client when logging this request
      // (NewQuoteRequestModal's "Existing client" tab), so there's
      // nothing to match or create -- and matching by email instead
      // would duplicate the client whenever they have no email on file.
      clientId = quote.client_id
    } else if (quote.contact_email) {
      // Case-insensitive (Juan@x.com = juan@x.com). ilike treats % and _ as
      // wildcards, so they're escaped to match literally.
      const email = quote.contact_email.trim().toLowerCase()
      const { data: existingClients, error: existingClientError } =
        await supabase
          .from('clients')
          .select('client_id')
          .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
          .order('client_id')
          .limit(1)

      if (existingClientError) {
        await releaseClaim(existingClientError.message)
        return
      }

      if (existingClients.length > 0) {
        clientId = existingClients[0].client_id
      } else {
        const { data: newClient, error: clientError } = await supabase
          .from('clients')
          .insert({
            client_name: quote.client_name,
            email,
            phone_number: quote.contact_number,
          })
          .select('client_id')
          .single()

        if (clientError || !newClient) {
          await releaseClaim(clientError?.message ?? 'Could not create client record.')
          return
        }

        clientId = newClient.client_id
      }
    } else {
      // No email on this quote -- can't match an existing client, so
      // always create a new one.
      const { data: newClient, error: clientError } = await supabase
        .from('clients')
        .insert({
          client_name: quote.client_name,
          phone_number: quote.contact_number,
        })
        .select('client_id')
        .single()

      if (clientError || !newClient) {
        await releaseClaim(clientError?.message ?? 'Could not create client record.')
        return
      }

      clientId = newClient.client_id
    }

    // 2. Reuse an existing place by city+barangay if one matches
    // (trimmed, case-insensitive), otherwise create it. Barangay is the
    // routing/cache unit, not the landmark text, so two quotes into the
    // same barangay always resolve to the same place_id even if their
    // free-text landmark reads completely differently.
    const pickupResult = await findOrCreatePlace(quote.pickup_city, quote.pickup_barangay)
    if ('error' in pickupResult) {
      await releaseClaim(pickupResult.error)
      return
    }
    const pickupPlace = { place_id: pickupResult.placeId }

    const deliveryResult = await findOrCreatePlace(quote.delivery_city, quote.delivery_barangay)
    if ('error' in deliveryResult) {
      await releaseClaim(deliveryResult.error)
      return
    }
    const deliveryPlace = { place_id: deliveryResult.placeId }

    // 2.5. Save this route's distance for reuse next time (upsert so it
    // also corrects a previously cached value if staff edited it). Best
    // effort -- the cache is a convenience, not core data, so a failure
    // here shouldn't block the approval itself.
    const [lowPlaceId, highPlaceId] = orderPlacePair(
      pickupPlace.place_id,
      deliveryPlace.place_id,
    )
    await supabase
      .from('route_cache')
      .upsert(
        { place_id_a: lowPlaceId, place_id_b: highPlaceId, distance_km: distanceValue },
        { onConflict: 'place_id_a,place_id_b' },
      )

    // 3. Link the (already Approved, step 0) quote to the client/place
    // records just resolved, with the final rate/terms.
    const { data: linkedRow, error: updateError } = await supabase
      .from('quote_requests')
      .update({
        proposed_rate: rateValue,
        payment_terms: paymentTerms,
        client_id: clientId,
        place_of_pickup_id: pickupPlace.place_id,
        place_of_delivery_id: deliveryPlace.place_id,
      })
      .eq('quote_request_id', quote.quote_request_id)
      .select('quote_request_id')
      .maybeSingle()

    if (updateError || !linkedRow) {
      await releaseClaim(updateError?.message ?? 'Could not update the quote.')
      return
    }

    // 4. Create the booking itself. .select().single() so we get the new
    // booking_id back -- the itinerary in step 5 needs it.
    const { data: newBooking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        quote_request_id: quote.quote_request_id,
        client_id: clientId,
        place_of_pickup_id: pickupPlace.place_id,
        place_of_delivery_id: deliveryPlace.place_id,
        pickup_address_detail: quote.pickup_location_text || null,
        delivery_address_detail: quote.delivery_location_text || null,
        // Exact spots, so dispatch/drivers aren't left with only a
        // barangay (places rows are one per barangay, not per address).
        pickup_lat: quote.pickup_lat,
        pickup_lng: quote.pickup_lng,
        delivery_lat: quote.delivery_lat,
        delivery_lng: quote.delivery_lng,
        cargo_type: quote.cargo_type,
        cargo_description: quote.cargo_description,
        weight: quote.weight,
        container_type: quote.container_type,
        trailer_type: quote.trailer_type,
        payment_terms: paymentTerms,
        // Approving IS the confirmation. From here the booking's status
        // follows its itineraries automatically (sync_booking_status
        // trigger): InProgress once a trip moves, Delivered once all are.
        booking_status: 'Confirmed',
        booking_date: quote.preferred_pickup_date,
        estimated_distance_km: distanceValue,
        rate_of_delivery_service: rateValue,
        hours_per_trip: hoursValue,
        cost_per_trip: costPerTrip,
        storage_deadline: urgent ? tripDateFrom : null,
      })
      .select('booking_id')
      .single()

    if (bookingError || !newBooking) {
      // No booking exists yet, so the quote can safely go back to Pending.
      await releaseClaim(bookingError?.message ?? 'Could not create booking.')
      return
    }

    // 5. Create one itinerary per delivery order (a booking can cover
    // multiple deliverables -- e.g. several containers -- each needing
    // its own truck+trailer+driver later). By this point the quote is
    // already Approved and the booking already exists -- if this insert
    // fails, don't fail silently. The error message below says exactly
    // that, so staff know there's a booking with no itineraries that
    // needs manual follow-up instead of just retrying "Approve" (which
    // would create a duplicate booking).
    const deliveryCount = quote.delivery_order_count ?? 1
    // Back-to-back slots: trip 1 at the default start on the pickup date,
    // each next trip when the one before ends. Dispatch can move them.
    // Urgent (last free storage day): every trip starts at the default time
    // together, so all can be picked up that day.
    const firstStart = new Date(manilaTimestamp(tripDateFrom, defaultStartMinutes)).getTime()
    const slots = urgent
      ? Array.from({ length: deliveryCount }, () => ({ start: firstStart, end: firstStart + hoursValue * 3_600_000 }))
      : chainSlots(
          firstStart,
          Array.from({ length: deliveryCount }, () => hoursValue * 3_600_000),
        )
    const itineraryRows = slots.map((slot) => ({
      booking_id: newBooking.booking_id,
      place_of_pickup_id: pickupPlace.place_id,
      place_of_delivery_id: deliveryPlace.place_id,
      trip_date_from: tripDateFrom,
      trip_start_at: new Date(slot.start).toISOString(),
      trip_end_at: new Date(slot.end).toISOString(),
      itinerary_status: 'Awaiting',
    }))

    const { error: itineraryError } = await supabase
      .from('itineraries')
      .insert(itineraryRows)

    setSubmitting(false)

    if (itineraryError) {
      setError(
        `Booking #${newBooking.booking_id} was created, but its ` +
          `${deliveryCount} itinerary row(s) could not be created ` +
          `(${itineraryError.message}). The quote is already marked ` +
          `Approved and the booking already exists, so this needs manual ` +
          `review. Don't click Approve again: it would create a ` +
          `duplicate booking.`,
      )
      return
    }

    setItinerariesCreated(deliveryCount)

    setApprovedBookingId(newBooking.booking_id)
  }

  // Picking a preset fills the reason with its label (staff can add
  // details); a reason staff typed themselves is kept.
  function pickRejectTag(tag: RejectionTag) {
    const presetLabels: string[] = Object.values(REJECTION_TAGS).map((t) => t.label)
    if (!rejectReason.trim() || presetLabels.includes(rejectReason.trim())) {
      setRejectReason(tag === 'Other' ? '' : REJECTION_TAGS[tag].label)
    }
    setRejectTag(tag)
    setError(null)
  }

  async function handleReject() {
    if (!rejectTag) {
      setError('Pick why this quote is being rejected.')
      return
    }
    if (!rejectReason.trim()) {
      setError('Enter a reason for rejecting this quote.')
      return
    }

    setSubmitting(true)
    setError(null)

    // Only while still Pending -- never overwrite a quote another admin
    // already approved (its booking would stay, labelled Rejected).
    const { data: rejectedRow, error: rejectError } = await supabase
      .from('quote_requests')
      .update({
        request_status: 'Rejected',
        rejection_reason: rejectReason.trim(),
        rejection_tag: rejectTag,
      })
      .eq('quote_request_id', quote.quote_request_id)
      .eq('request_status', 'Pending')
      .select('quote_request_id')
      .maybeSingle()

    setSubmitting(false)

    if (rejectError) {
      setError(rejectError.message)
      return
    }
    if (!rejectedRow) {
      showToast('Another admin already handled this quote -- it is no longer pending.', 'error')
    }

    onResolved(quote.quote_request_id)
  }

  // proposedRate/estimatedDistanceKm are PER TRIP -- a booking with
  // delivery_order_count deliveries runs that many separate truck trips,
  // each with its own diesel burn, driver commission, and per-trip fee.
  // The estimate below is for the whole contract (all deliveries), not
  // just one, so every cost is multiplied by deliveryCount alongside the
  // revenue side (rateForCalc x deliveryCount) -- otherwise the % of
  // rate would compare a full-contract revenue against only one trip's
  // costs and look far more profitable than it really is.
  const deliveryCount = quote.delivery_order_count ?? 1
  const rateForCalc = Number(proposedRate)
  const distanceForCalc = Number(estimatedDistanceKm)
  const settingsLoaded =
    dieselPricePerLiter !== null &&
    driverCommissionRate !== null &&
    driverPerTripFee !== null
  const canCalculateProfitability =
    settingsLoaded && rateForCalc > 0 && distanceForCalc > 0

  const totalContractValue = rateForCalc * deliveryCount
  // Formula lives in lib/tripCost.ts (shared with the Admin dashboard).
  const estimated = canCalculateProfitability
    ? estimateTripCosts(
        {
          dieselPricePerLiter: dieselPricePerLiter!,
          driverCommissionRate: driverCommissionRate!,
          driverPerTripFee: driverPerTripFee!,
        },
        rateForCalc,
        distanceForCalc,
        deliveryCount,
      )
    : { diesel: 0, commission: 0, perTripFee: 0, total: 0 }
  const dieselCost = estimated.diesel
  const driverCommissionCost = estimated.commission
  const perTripFeeCost = estimated.perTripFee
  const totalCost = estimated.total
  const costRatio = canCalculateProfitability
    ? totalCost / totalContractValue
    : 0
  const isLowMargin = canCalculateProfitability && costRatio >= 0.5
  // Saved on the booking at Approve; the downpayment comes from it.
  const costPerTrip = Math.round((totalCost / deliveryCount) * 100) / 100
  const downpayment = canCalculateProfitability ? downpaymentFor(rateForCalc, costPerTrip, deliveryCount) : null

  const estimatedProfit = totalContractValue - totalCost
  const pickupToday = tripDateFrom !== '' && tripDateFrom === toManilaDate(new Date())
  const quoteLabel = quote.reference_code ?? `#${quote.quote_request_id}`
  const pickupPin = pinLink(quote.pickup_lat, quote.pickup_lng)
  const deliveryPin = pinLink(quote.delivery_lat, quote.delivery_lng)

  // Dialog behaviour: Esc closes, Tab stays inside the panel, and focus
  // goes back to whatever opened it (the row's Review button) on close.
  const panelRef = useRef<HTMLDivElement>(null)
  // Latest close() for the Esc handler below (it's set up once).
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Leave Esc to a confirm dialog opened on top of this panel.
        if (panelRef.current?.contains(document.activeElement) || document.activeElement === document.body) {
          e.preventDefault()
          closeRef.current()
        }
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      // The opener may be gone (the quote left the Pending list).
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  const footerButton = 'flex h-11 items-center gap-2 px-5 text-sm font-semibold disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-50">
      {/* Dim backdrop over the Pending list; clicking it closes the panel. */}
      <div className="absolute inset-0 bg-slate-900/50" onClick={close} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-quote-title"
        className="absolute inset-y-0 right-0 flex w-full max-w-[1100px] flex-col border-l-2 border-slate-300 bg-white transition-transform duration-200 ease-out starting:translate-x-full motion-reduce:transition-none"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-slate-200 px-7 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="review-quote-title" className="text-xl font-bold text-slate-900">
              Review Quote #{quote.quote_request_id}
            </h2>
            {quote.reference_code && (
              <span className="font-mono text-xs font-semibold text-slate-600">{quote.reference_code}</span>
            )}
            <span className="bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {approvedBookingId !== null ? 'Approved' : 'Pending'}
            </span>
            {pickupToday && (
              <span className="flex items-center gap-1 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                <Icon name="clock" size={12} />
                Pickup Today
              </span>
            )}
          </div>
          <button
            onClick={close}
            aria-label="Close review"
            data-autofocus
            className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-slate-300 text-slate-700 hover:border-slate-500 hover:text-slate-900"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Body: fits a 1080p screen; scrolls only on smaller windows. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {approvedBookingId !== null ? (
            <div className="px-7 py-6">
              <p className="border-2 border-green-200 bg-green-50 px-4 py-3 text-[15px] text-green-900">
                Quote approved. Booking #{approvedBookingId} was created with {itinerariesCreated}{' '}
                {itinerariesCreated === 1 ? 'itinerary' : 'itineraries'} (status "Awaiting"). Assign a truck,
                trailer, and driver to each from the Dispatch Board.
              </p>
            </div>
          ) : (
            <div className="grid gap-8 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_436px]">
              {/* LEFT: the request, read-only */}
              <div className="flex flex-col gap-6">
                {quote.resubmit_count > 0 && (
                  <div className="border-2 border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                    <p className="font-semibold">
                      Resubmitted by the client
                      {quote.resubmit_count > 1 ? ` (${quote.resubmit_count} times)` : ''}
                    </p>
                    {quote.previous_rejection_reason && (
                      <p className="mt-0.5">Previously rejected: {quote.previous_rejection_reason}</p>
                    )}
                  </div>
                )}
                {urgent && (
                  <div className="border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                    <p className="font-semibold">Urgent · last free storage day</p>
                    <p className="mt-0.5">
                      Every trip must be picked up from the port by 11:59 PM on{' '}
                      {tripDateFrom ? formatDate(tripDateFrom) : '—'}. Approving starts all trips at the same time.
                      {tripDateFrom && tripDateFrom < toManilaDate(new Date()) && (
                        <span className="block font-semibold text-red-700">That day has already passed.</span>
                      )}
                    </p>
                  </div>
                )}

                <section>
                  <GroupHeading>Client</GroupHeading>
                  <dl className="grid grid-cols-2 gap-4">
                    <Field label="Client name">
                      <span className="text-lg font-semibold">{quote.client_name}</span>
                    </Field>
                    <Field label="Contact">
                      {[quote.contact_number, quote.contact_email].filter(Boolean).join(' / ') || '—'}
                    </Field>
                  </dl>
                </section>

                <section>
                  <GroupHeading>Route</GroupHeading>
                  {/* Two stops joined by a line: hollow circle = pickup, filled square = delivery */}
                  <dl className="relative flex flex-col gap-4 pl-7">
                    <span className="absolute top-2 bottom-8 left-[5px] w-0.5 bg-slate-300" aria-hidden="true" />
                    <div className="relative">
                      <span
                        className="absolute top-1 -left-7 h-3 w-3 rounded-full border-2 border-primary bg-white"
                        aria-hidden="true"
                      />
                      <dt className="text-[13px] text-slate-500">Pickup</dt>
                      <dd className="text-[15px] text-slate-900">
                        {formatLocationDisplay({
                          city: quote.pickup_city,
                          barangay: quote.pickup_barangay,
                          detail: quote.pickup_location_text,
                        })}
                        {pickupPin && (
                          <a href={pickupPin} target="_blank" rel="noreferrer" className="ml-3 text-[13px] text-primary underline">
                            View pinned spot on map
                          </a>
                        )}
                      </dd>
                    </div>
                    <div className="relative">
                      <span className="absolute top-1 -left-7 h-3 w-3 bg-primary" aria-hidden="true" />
                      <dt className="text-[13px] text-slate-500">Delivery</dt>
                      <dd className="text-[15px] text-slate-900">
                        {formatLocationDisplay({
                          city: quote.delivery_city,
                          barangay: quote.delivery_barangay,
                          detail: quote.delivery_location_text,
                        })}
                        {deliveryPin && (
                          <a href={deliveryPin} target="_blank" rel="noreferrer" className="ml-3 text-[13px] text-primary underline">
                            View pinned spot on map
                          </a>
                        )}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section>
                  <GroupHeading>Cargo</GroupHeading>
                  <dl className="grid grid-cols-4 gap-4">
                    <Field label="Cargo type">{quote.cargo_type}</Field>
                    <Field label="Trailer size">{quote.container_type}</Field>
                    <Field label="Trailer type">{quote.trailer_type ?? '—'}</Field>
                    <Field label="Weight (tons)">{String(quote.weight)}</Field>
                    <Field label="Cargo description" className="col-span-4">
                      {quote.cargo_description || '—'}
                    </Field>
                  </dl>
                </section>

                <section>
                  <GroupHeading>Schedule</GroupHeading>
                  <dl className="grid grid-cols-4 gap-4">
                    <Field label="Number of deliveries">{String(deliveryCount)}</Field>
                    <Field label={urgent ? 'Last free storage day (pick up by)' : 'Preferred pickup date'}>
                      {quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}
                    </Field>
                    <Field label="Deadline date">
                      {quote.preferred_delivery_date ? formatDate(quote.preferred_delivery_date) : 'Not given'}
                    </Field>
                    <Field label="Trip start date">{tripDateFrom ? formatDate(tripDateFrom) : '—'}</Field>
                  </dl>
                </section>

                <section>
                  <GroupHeading>Terms</GroupHeading>
                  <dl className="grid grid-cols-2 gap-4">
                    <Field label="Proposed rate">
                      {quote.proposed_rate !== null ? (
                        <>
                          <span className="text-2xl font-bold tabular-nums">{formatMoney(quote.proposed_rate)}</span>{' '}
                          <span className="text-[13px] text-slate-500">per trip</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </Field>
                    <Field label="Payment terms">
                      {PAYMENT_TERMS_LABELS[paymentTerms as keyof typeof PAYMENT_TERMS_LABELS] ?? paymentTerms}
                    </Field>
                  </dl>
                </section>
              </div>

              {/* RIGHT: what the admin decides, then the result */}
              {showRejectForm ? (
                <section className="self-start border-2 border-red-300 px-5 py-5">
                  <h3 className="text-[17px] font-semibold text-slate-900">Reject this quote</h3>
                  <p className="mt-1 text-[13px] text-slate-500">
                    The client sees the reason and can fix the quote and resubmit it.
                  </p>
                  <fieldset className="mt-4">
                    <legend className="text-sm font-semibold text-slate-900">Why is it rejected?</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(Object.keys(REJECTION_TAGS) as RejectionTag[]).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => pickRejectTag(tag)}
                          aria-pressed={rejectTag === tag}
                          className={`flex items-center gap-1.5 border-2 px-3 py-1.5 text-sm font-medium ${
                            rejectTag === tag
                              ? 'border-red-700 bg-red-700 text-white'
                              : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {rejectTag === tag && <Icon name="check" size={14} />}
                          {REJECTION_TAGS[tag].label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <label htmlFor="reject-reason" className="mt-4 block text-sm font-semibold text-slate-900">
                    {rejectTag === 'Other' ? 'Reason for rejection' : 'Message to the client'}
                  </label>
                  <textarea
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={4}
                    className={`${fieldClasses} mt-1.5`}
                  />
                </section>
              ) : (
                <div className="flex flex-col gap-4 self-start">
                  <section className="border-2 border-slate-300 px-5 py-5">
                    <h3 className="text-[17px] font-semibold text-slate-900">Confirm Trip Details</h3>
                    <div className="mt-4 grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="review-distance" className="block text-sm font-semibold text-slate-900">
                          Estimated distance (km)
                        </label>
                        <input
                          id="review-distance"
                          type="number"
                          min="0"
                          step="0.01"
                          value={estimatedDistanceKm}
                          aria-describedby="review-distance-hint"
                          onChange={(e) => {
                            distanceTypedRef.current = true
                            setEstimatedDistanceKm(e.target.value)
                            setDistanceIsCached(false)
                            setDistanceIsAutoEstimated(false)
                            setDistanceIsFromPins(false)
                          }}
                          className={`${fieldClasses} mt-1.5 tabular-nums`}
                        />
                        <p id="review-distance-hint" className="mt-1.5 text-[13px] text-slate-500">
                          {autoEstimatingDistance
                            ? 'Estimating distance…'
                            : distanceIsCached
                              ? 'From a previous trip between these barangays. Edit it if this route differs.'
                              : distanceIsFromPins
                                ? 'Driving distance between the two pinned spots. Check it before approving.'
                                : distanceIsAutoEstimated
                                  ? 'Rough estimate between the two barangay centres (no exact pins). Check it before approving.'
                                  : 'One way, pickup to delivery.'}
                        </p>
                      </div>
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <label htmlFor="review-hours" className="block text-sm font-semibold text-slate-900">
                            Hours per trip
                          </label>
                          <span className="text-[13px] font-medium text-amber-800">Required</span>
                        </div>
                        <input
                          id="review-hours"
                          ref={hoursInputRef}
                          type="number"
                          min="0.5"
                          max={MAX_HOURS_PER_TRIP}
                          step="0.5"
                          required
                          value={hoursPerTrip}
                          placeholder="e.g. 6"
                          aria-invalid={hoursError !== null}
                          aria-describedby="review-hours-hint"
                          onChange={(e) => {
                            setHoursPerTrip(e.target.value)
                            // Clear the error as soon as the value is fixed.
                            if (hoursError && !hoursProblem(e.target.value)) setHoursError(null)
                          }}
                          onBlur={() => setHoursError(hoursProblem(hoursPerTrip))}
                          className={`${fieldClasses} mt-1.5 tabular-nums ${hoursError ? 'border-red-700' : ''}`}
                        />
                        <p
                          id="review-hours-hint"
                          className={`mt-1.5 text-[13px] ${hoursError ? 'font-medium text-red-700' : 'text-slate-500'}`}
                        >
                          {hoursError ??
                            (Number(hoursPerTrip) > 0 && tripDateFrom
                              ? `${deliveryCount > 1 ? 'Trip 1' : 'Each trip'}: ${formatSlot(
                                  manilaTimestamp(tripDateFrom, defaultStartMinutes),
                                  new Date(
                                    new Date(manilaTimestamp(tripDateFrom, defaultStartMinutes)).getTime() +
                                      Number(hoursPerTrip) * 3_600_000,
                                  ),
                                )}${deliveryCount > 1 ? (urgent ? ', all trips at the same time' : ', the rest follow back to back') : ''} (dispatch can move them)`
                              : "How long one trip takes. Sets each driver's time slot.")}
                        </p>
                      </div>
                    </div>
                  </section>

                  <section className="border-2 border-slate-300 px-5 py-5" aria-live="polite">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-[17px] font-semibold text-slate-900">Profitability Estimate</h3>
                      <span className="text-[13px] text-slate-500">Updates with distance</span>
                    </div>

                    {!settingsLoaded ? (
                      <p className="mt-3 text-sm text-slate-600">
                        Set diesel price and driver commission rate under Settings to see this estimate.
                      </p>
                    ) : rateForCalc <= 0 ? (
                      <p className="mt-3 text-sm text-slate-600">This quote has no proposed rate to calculate with.</p>
                    ) : distanceForCalc <= 0 ? (
                      <p className="mt-3 text-sm text-slate-600">Enter the estimated distance to see the costs.</p>
                    ) : (
                      <div className="mt-2 text-[15px]">
                        <CostRow
                          label="Contract value"
                          hint={`${deliveryCount} ${deliveryCount === 1 ? 'trip' : 'trips'} × ${formatMoney(rateForCalc)}`}
                          value={formatMoney(totalContractValue)}
                          strong
                        />
                        <div className="border-t border-slate-200 pt-1">
                          <CostRow label="Diesel cost" value={formatMoney(dieselCost)} />
                          <CostRow label="Driver commission" value={formatMoney(driverCommissionCost)} />
                          <CostRow label="Driver per-trip fee" value={formatMoney(perTripFeeCost)} />
                        </div>
                        <div className="border-t border-slate-200 pt-1">
                          <CostRow label="Total cost" value={formatMoney(totalCost)} strong />
                          <div className="flex items-baseline justify-between gap-3 pt-1">
                            <span className="text-slate-700">Cost vs. rate</span>
                            <span className="font-semibold tabular-nums text-slate-900">
                              {(costRatio * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div
                            className="mt-2 h-2.5 bg-slate-200"
                            role="img"
                            aria-label={`Costs are ${(costRatio * 100).toFixed(1)}% of the contract value`}
                          >
                            <div
                              className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                              style={{ width: `${Math.min(costRatio * 100, 100)}%` }}
                            />
                          </div>
                          {isLowMargin && (
                            <p className="mt-2 text-[13px] font-medium text-red-700">
                              Costs are at or above 50% of the rate. Informational only; Approve is still your call.
                            </p>
                          )}
                        </div>
                        <div className="mt-3 border-t border-slate-200 pt-1">
                          <div className="flex items-baseline justify-between gap-3 py-2">
                            <span className="font-semibold text-slate-900">
                              Estimated profit
                              <span className="block text-[13px] font-normal text-slate-500">
                                Contract value − total cost
                              </span>
                            </span>
                            <span
                              className={`text-xl font-bold tabular-nums ${estimatedProfit < 0 ? 'text-red-700' : 'text-slate-900'}`}
                            >
                              {estimatedProfit < 0 ? '−' : ''}
                              {formatMoney(Math.abs(estimatedProfit))}
                            </span>
                          </div>
                        </div>
                        {downpayment !== null && (
                          <div className="mt-2 flex items-center justify-between gap-4 border-2 border-accent-300 bg-accent-100 px-4 py-3">
                            <span className="font-semibold text-slate-900">
                              Client downpayment
                              <span className="block text-[13px] font-normal text-slate-600">
                                Total cost + 25% of the rest, due before any trip starts.
                              </span>
                            </span>
                            <span className="text-2xl font-bold tabular-nums text-primary">
                              {formatMoney(downpayment)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer: Reject far left, Approve far right */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-t-2 border-slate-200 px-7 py-4">
          {approvedBookingId !== null ? (
            <>
              <span />
              <button onClick={() => onResolved(quote.quote_request_id)} className={`btn-primary ${footerButton}`}>
                <Icon name="check" />
                Done
              </button>
            </>
          ) : showRejectForm ? (
            <>
              <button
                onClick={() => {
                  setShowRejectForm(false)
                  setError(null)
                }}
                disabled={submitting}
                className={`border-2 border-slate-300 text-slate-700 hover:bg-slate-50 ${footerButton}`}
              >
                Back to review
              </button>
              <p role="alert" className="min-w-0 flex-1 text-center text-sm text-red-700">
                {error}
              </p>
              {/* A preset must be picked first (handleReject checks too). */}
              <button
                onClick={handleReject}
                disabled={submitting || !rejectTag}
                title={rejectTag ? undefined : 'Pick a reason first'}
                className={`bg-red-700 text-white hover:bg-red-800 ${footerButton}`}
              >
                <Icon name="close" />
                {submitting ? 'Rejecting...' : `Reject quote ${quoteLabel}`}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setShowRejectForm(true)
                  setError(null)
                }}
                disabled={submitting}
                className={`border-2 border-red-700 text-red-700 hover:bg-red-50 ${footerButton}`}
              >
                <Icon name="close" />
                Reject Quote...
              </button>
              <p role="alert" className="min-w-0 flex-1 text-center text-sm text-red-700">
                {error}
              </p>
              <button onClick={handleApprove} disabled={submitting} className={`btn-primary ${footerButton}`}>
                <Icon name="check" />
                {submitting ? 'Approving...' : 'Approve Quote'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default QuoteReviewModal
