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
  'border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

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

function InfoRow({
  label,
  value,
  pin,
}: {
  label: string
  value: string
  pin?: string | null
}) {
  return (
    <div>
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

    const hoursValue = Number(hoursPerTrip)
    if (!hoursPerTrip || !(hoursValue > 0) || hoursValue > MAX_HOURS_PER_TRIP) {
      setError(`Enter the hours per trip (more than 0, up to ${MAX_HOURS_PER_TRIP}) before approving.`)
      return
    }

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

  const showProfitabilityPanel = approvedBookingId === null && distanceForCalc > 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center sm:py-8">
      <div className="flex w-full max-w-4xl flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-center">
      <div className="max-h-[90vh] w-full overflow-y-auto bg-white p-6 shadow-lg lg:max-w-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Quote #{quote.quote_request_id}
            {quote.reference_code && (
              <span className="ml-2 font-mono text-sm font-medium text-slate-500">
                {quote.reference_code}
              </span>
            )}
          </h3>
          <button
            onClick={close}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {approvedBookingId !== null ? (
          <>
            <p className="mt-4 bg-green-50 px-4 py-3 text-sm text-green-800">
              Quote approved. Booking #{approvedBookingId} was created with{' '}
              {itinerariesCreated}{' '}
              {itinerariesCreated === 1 ? 'itinerary' : 'itineraries'}{' '}
              (status "Awaiting"). Assign a truck, trailer, and driver to
              each from the Dispatch Board.
            </p>
            <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
              <button
                onClick={() => onResolved(quote.quote_request_id)}
                className="btn-primary px-4 py-2 text-sm font-medium"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {quote.resubmit_count > 0 && (
              <div className="mt-4 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">
                  Resubmitted by the client
                  {quote.resubmit_count > 1 ? ` (${quote.resubmit_count} times)` : ''}
                </p>
                {quote.previous_rejection_reason && (
                  <p className="mt-1">Previously rejected: {quote.previous_rejection_reason}</p>
                )}
              </div>
            )}
            {urgent && (
              <div className="mt-4 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Urgent · last free storage day</p>
                <p className="mt-1">
                  Every trip must be picked up from the port by 11:59 PM on{' '}
                  {tripDateFrom ? formatDate(tripDateFrom) : '—'}. Approving starts all trips at the same time.
                  {tripDateFrom && tripDateFrom < toManilaDate(new Date()) && (
                    <span className="block font-semibold text-red-700">That day has already passed.</span>
                  )}
                </p>
              </div>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <InfoRow label="Client name" value={quote.client_name} />
              <InfoRow
                label="Contact"
                value={
                  [quote.contact_number, quote.contact_email]
                    .filter(Boolean)
                    .join(' / ') || '—'
                }
              />
              <InfoRow
                label="Pickup"
                value={formatLocationDisplay({
                  city: quote.pickup_city,
                  barangay: quote.pickup_barangay,
                  detail: quote.pickup_location_text,
                })}
                pin={pinLink(quote.pickup_lat, quote.pickup_lng)}
              />
              <InfoRow
                label="Delivery"
                value={formatLocationDisplay({
                  city: quote.delivery_city,
                  barangay: quote.delivery_barangay,
                  detail: quote.delivery_location_text,
                })}
                pin={pinLink(quote.delivery_lat, quote.delivery_lng)}
              />
              <InfoRow label="Cargo type" value={quote.cargo_type} />
              <InfoRow label="Trailer size" value={quote.container_type} />
              <InfoRow label="Trailer type" value={quote.trailer_type ?? '—'} />
              <InfoRow label="Weight (tons)" value={String(quote.weight)} />
              <InfoRow
                label="Number of deliveries"
                value={String(quote.delivery_order_count ?? 1)}
              />
              <InfoRow
                label={urgent ? 'Last free storage day (pick up by)' : 'Preferred pickup date'}
                value={quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}
              />
              <InfoRow
                label="Deadline date"
                value={quote.preferred_delivery_date ? formatDate(quote.preferred_delivery_date) : 'Not given'}
              />
              <InfoRow
                label="Cargo description"
                value={quote.cargo_description}
              />
            </div>

            <div className="mt-6 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
              <InfoRow
                label="Proposed rate"
                value={quote.proposed_rate !== null ? `${formatMoney(quote.proposed_rate)} per trip` : '—'}
              />

              <InfoRow
                label="Payment terms"
                value={PAYMENT_TERMS_LABELS[paymentTerms as keyof typeof PAYMENT_TERMS_LABELS] ?? paymentTerms}
              />

              <label className={labelClasses}>
                Estimated distance (km)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedDistanceKm}
                  onChange={(e) => {
                    distanceTypedRef.current = true
                    setEstimatedDistanceKm(e.target.value)
                    setDistanceIsCached(false)
                    setDistanceIsAutoEstimated(false)
                    setDistanceIsFromPins(false)
                  }}
                  className={fieldClasses}
                />
                {autoEstimatingDistance && (
                  <span className="text-xs font-normal text-slate-500">
                    Estimating distance…
                  </span>
                )}
                {distanceIsCached && (
                  <span className="text-xs font-normal text-slate-500">
                    From a previous trip between these barangays. Edit it if
                    this route differs.
                  </span>
                )}
                {distanceIsFromPins && (
                  <span className="text-xs font-normal text-slate-500">
                    Driving distance between the two pinned spots. Check it
                    before approving.
                  </span>
                )}
                {distanceIsAutoEstimated && (
                  <span className="text-xs font-normal text-slate-500">
                    Rough estimate between the two barangay centres (no exact
                    pins). Check it before approving.
                  </span>
                )}
              </label>

              <label className={labelClasses}>
                Hours per trip
                <input
                  type="number"
                  min="0.5"
                  max={MAX_HOURS_PER_TRIP}
                  step="0.5"
                  value={hoursPerTrip}
                  onChange={(e) => setHoursPerTrip(e.target.value)}
                  placeholder="e.g. 6"
                  className={fieldClasses}
                />
                <span className="text-xs font-normal text-slate-500">
                  {Number(hoursPerTrip) > 0 && tripDateFrom
                    ? `${(quote.delivery_order_count ?? 1) > 1 ? 'Trip 1' : 'Each trip'}: ${formatSlot(
                        manilaTimestamp(tripDateFrom, defaultStartMinutes),
                        new Date(
                          new Date(manilaTimestamp(tripDateFrom, defaultStartMinutes)).getTime() +
                            Number(hoursPerTrip) * 3_600_000,
                        ),
                      )}${(quote.delivery_order_count ?? 1) > 1 ? (urgent ? ', all trips at the same time' : ', the rest follow back to back') : ''} (dispatch can move them)`
                    : 'How long one trip takes. Sets each driver\'s time slot.'}
                </span>
              </label>

              <InfoRow
                label="Trip start date"
                value={tripDateFrom ? formatDate(tripDateFrom) : '—'}
              />
            </div>

            {showRejectForm ? (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <p className="text-sm font-medium text-slate-700">Why is it rejected?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Object.keys(REJECTION_TAGS) as RejectionTag[]).map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => pickRejectTag(tag)}
                      aria-pressed={rejectTag === tag}
                      className={`border px-3 py-1.5 text-sm font-medium ${
                        rejectTag === tag
                          ? 'border-red-600 bg-red-600 text-white'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {REJECTION_TAGS[tag].label}
                    </button>
                  ))}
                </div>
                <label className={`${labelClasses} mt-4`}>
                  {rejectTag === 'Other' ? 'Reason for rejection' : 'Message to the client'}
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    className={fieldClasses}
                  />
                </label>
                <div className="mt-4 flex justify-end gap-3">
                  <button
                    onClick={() => setShowRejectForm(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  {/* A preset must be picked first (handleReject checks too). */}
                  <button
                    onClick={handleReject}
                    disabled={submitting || !rejectTag}
                    title={rejectTag ? undefined : 'Pick a reason above first'}
                    className="bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                  >
                    {submitting ? 'Rejecting...' : 'Confirm Reject'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  onClick={() => setShowRejectForm(true)}
                  disabled={submitting}
                  className="border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="btn-primary px-4 py-2 text-sm font-medium"
                >
                  {submitting ? 'Approving...' : 'Approve'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showProfitabilityPanel && (
        <div className="w-full overflow-y-auto bg-white p-6 shadow-lg lg:max-w-xs">
          <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Profitability Estimate
          </h3>

          {!settingsLoaded && (
            <p className="mt-3 text-sm text-slate-500">
              Set diesel price and driver commission rate under Settings to
              see this estimate.
            </p>
          )}

          {settingsLoaded && rateForCalc <= 0 && (
            <p className="mt-3 text-sm text-slate-500">
              Enter a proposed rate to calculate.
            </p>
          )}

          {canCalculateProfitability && (
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">
                  Contract value ({deliveryCount}{' '}
                  {deliveryCount === 1 ? 'trip' : 'trips'} ×{' '}
                  {formatMoney(rateForCalc)})
                </span>
                <span className="font-medium text-slate-900">
                  {formatMoney(totalContractValue)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Diesel cost</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(dieselCost)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Driver commission</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(driverCommissionCost)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Driver per-trip fee</span>
                <span className="font-medium text-slate-900">
                  {formatMoney(perTripFeeCost)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-slate-500">Total cost</span>
                <span className="font-bold text-slate-900">
                  {formatMoney(totalCost)}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Cost vs. rate</span>
                  <span
                    className={`font-bold ${
                      isLowMargin
                        ? 'text-red-600'
                        : costRatio >= 0.4
                          ? 'text-amber-600'
                          : 'text-green-700'
                    }`}
                  >
                    {(costRatio * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="relative h-3 w-full overflow-hidden bg-slate-100">
                  <div
                    className={`h-full transition-all duration-500 ease-out ${
                      isLowMargin
                        ? 'bg-red-500'
                        : costRatio >= 0.4
                          ? 'bg-amber-400'
                          : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(costRatio * 100, 100)}%` }}
                  />
                  {/* Marker at the 50% rejection-review threshold. */}
                  <div className="absolute inset-y-0 left-1/2 w-px bg-slate-400/70" />
                </div>
              </div>

              {downpayment !== null && (
                <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                  <span className="text-slate-500">
                    Client downpayment
                    <span className="block text-xs">cost + 25% of the rest · before any trip starts</span>
                  </span>
                  <span className="font-bold text-slate-900">{formatMoney(downpayment)}</span>
                </div>
              )}

              {isLowMargin && (
                <p className="bg-red-50 px-3 py-2 text-xs text-red-700">
                  Costs are at or above 50% of the rate, so this trip may not
                  be worth approving as priced. This is informational only;
                  Approve/Reject is still your call.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}

export default QuoteReviewModal
