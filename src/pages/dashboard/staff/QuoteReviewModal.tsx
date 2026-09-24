// QuoteReviewModal: full detail view for one quote request, with an
// editable proposed rate, payment terms, estimated trip distance
// (bookings.estimated_distance_km is required), and trip start date,
// plus Approve/Reject actions.
//
// Distance reuse: `route_cache` stores one distance per unique place
// pair (place_id_a always the lower id, so direction doesn't matter).
// On open, if both the pickup and delivery text already match known
// places AND that pair has a cached distance, the field is pre-filled
// automatically. Otherwise, a best-effort auto-estimate runs instead
// (geocodeToLatLng + fetchDrivingDistanceKm below -- free OSM stack,
// same one LocationPicker's map picker already uses: Nominatim to
// geocode the city/barangay text, OSRM's public server for real
// driving distance). Either way the field stays editable, and Approve
// saves whatever value is showing to route_cache so the next quote on
// that same route reuses the exact (possibly staff-corrected) number
// instead of re-estimating.
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
// Approve does 5 steps in order: reuse an existing `clients` row by
// email if one matches (clients.email is unique) or create one from the
// quote's free-text client info, reuse existing `places` rows by
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
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { formatLocationDisplay } from '../../../lib/locationReference'
import type { QuoteRequest } from './QuoteRequestsSection'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
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
  const query = `Barangay ${barangay}, ${city}, Philippines`
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
  )
  const data = await response.json()
  const first = data[0]
  if (!first) return null
  return { lat: Number(first.lat), lon: Number(first.lon) }
}

async function fetchDrivingDistanceKm(
  pickup: { lat: number; lon: number },
  delivery: { lat: number; lon: number },
): Promise<number | null> {
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${pickup.lon},${pickup.lat};${delivery.lon},${delivery.lat}?overview=false`,
  )
  const data = await response.json()
  const meters = data?.routes?.[0]?.distance
  return typeof meters === 'number' ? meters / 1000 : null
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-slate-900">{value}</p>
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
  const [proposedRate, setProposedRate] = useState(
    quote.proposed_rate?.toString() ?? '',
  )
  const [paymentTerms, setPaymentTerms] = useState(quote.payment_terms)
  const [estimatedDistanceKm, setEstimatedDistanceKm] = useState('')
  const [distanceIsCached, setDistanceIsCached] = useState(false)
  const [distanceIsAutoEstimated, setDistanceIsAutoEstimated] = useState(false)
  const [autoEstimatingDistance, setAutoEstimatingDistance] = useState(false)
  const [tripDateFrom, setTripDateFrom] = useState(
    quote.preferred_pickup_date ?? '',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
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

  // Load the settings the profitability panel needs. If any aren't
  // configured yet, that value stays null and the panel shows a note
  // instead of numbers.
  useEffect(() => {
    async function loadSettings() {
      const { data } = await supabase
        .from('app_settings')
        .select('setting_key, setting_value')
        .in('setting_key', [
          'diesel_price_per_liter',
          'driver_commission_rate',
          'driver_per_trip_fee',
        ])

      if (!data) {
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
      const pickupId = await findPlaceIdByCityBarangay(quote.pickup_city, quote.pickup_barangay)
      const deliveryId = await findPlaceIdByCityBarangay(
        quote.delivery_city,
        quote.delivery_barangay,
      )

      if (pickupId !== null && deliveryId !== null) {
        const cachedKm = await findCachedDistance(pickupId, deliveryId)
        if (cachedKm !== null) {
          setEstimatedDistanceKm(String(cachedKm))
          setDistanceIsCached(true)
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
          setEstimatedDistanceKm(km.toFixed(2))
          setDistanceIsAutoEstimated(true)
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
  ])

  async function handleApprove() {
    const rateValue = Number(proposedRate)
    if (!proposedRate || rateValue <= 0) {
      setError('Enter a proposed rate before approving.')
      return
    }

    const distanceValue = Number(estimatedDistanceKm)
    if (!estimatedDistanceKm || distanceValue <= 0) {
      setError('Enter the estimated trip distance before approving.')
      return
    }

    if (!tripDateFrom) {
      setError('Enter a trip start date before approving.')
      return
    }

    setSubmitting(true)
    setError(null)

    // 1. Reuse an existing client if this email already has one (clients.email
    // is unique -- inserting a duplicate would fail), otherwise create one
    // from the quote's free-text client info.
    let clientId: number

    if (quote.contact_email) {
      const { data: existingClient, error: existingClientError } =
        await supabase
          .from('clients')
          .select('client_id')
          .eq('email', quote.contact_email)
          .maybeSingle()

      if (existingClientError) {
        setError(existingClientError.message)
        setSubmitting(false)
        return
      }

      if (existingClient) {
        clientId = existingClient.client_id
      } else {
        const { data: newClient, error: clientError } = await supabase
          .from('clients')
          .insert({
            client_name: quote.client_name,
            email: quote.contact_email,
            phone_number: quote.contact_number,
          })
          .select('client_id')
          .single()

        if (clientError || !newClient) {
          setError(clientError?.message ?? 'Could not create client record.')
          setSubmitting(false)
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
        setError(clientError?.message ?? 'Could not create client record.')
        setSubmitting(false)
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
      setError(pickupResult.error)
      setSubmitting(false)
      return
    }
    const pickupPlace = { place_id: pickupResult.placeId }

    const deliveryResult = await findOrCreatePlace(quote.delivery_city, quote.delivery_barangay)
    if ('error' in deliveryResult) {
      setError(deliveryResult.error)
      setSubmitting(false)
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

    // 3. Update the quote request: approved, with the final rate/terms
    // and links to the client/place records just created.
    const { error: updateError } = await supabase
      .from('quote_requests')
      .update({
        request_status: 'Approved',
        proposed_rate: rateValue,
        payment_terms: paymentTerms,
        client_id: clientId,
        place_of_pickup_id: pickupPlace.place_id,
        place_of_delivery_id: deliveryPlace.place_id,
      })
      .eq('quote_request_id', quote.quote_request_id)

    if (updateError) {
      setError(updateError.message)
      setSubmitting(false)
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
        cargo_type: quote.cargo_type,
        cargo_description: quote.cargo_description,
        weight: quote.weight,
        container_type: quote.container_type,
        payment_terms: paymentTerms,
        booking_status: 'Draft',
        booking_date: quote.preferred_pickup_date,
        estimated_distance_km: distanceValue,
        rate_of_delivery_service: rateValue,
      })
      .select('booking_id')
      .single()

    if (bookingError || !newBooking) {
      setSubmitting(false)
      setError(bookingError?.message ?? 'Could not create booking.')
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
    const itineraryRows = Array.from({ length: deliveryCount }, () => ({
      booking_id: newBooking.booking_id,
      place_of_pickup_id: pickupPlace.place_id,
      place_of_delivery_id: deliveryPlace.place_id,
      trip_date_from: tripDateFrom,
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
          `Approved and the booking already exists -- this needs manual ` +
          `review. Don't click Approve again, it would create a ` +
          `duplicate booking.`,
      )
      return
    }

    setItinerariesCreated(deliveryCount)

    setApprovedBookingId(newBooking.booking_id)
  }

  async function handleReject() {
    if (!rejectReason.trim()) {
      setError('Enter a reason for rejecting this quote.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: rejectError } = await supabase
      .from('quote_requests')
      .update({
        request_status: 'Rejected',
        rejection_reason: rejectReason,
      })
      .eq('quote_request_id', quote.quote_request_id)

    setSubmitting(false)

    if (rejectError) {
      setError(rejectError.message)
      return
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
  const dieselCost = canCalculateProfitability
    ? dieselPricePerLiter! * distanceForCalc * deliveryCount
    : 0
  const driverCommissionCost = canCalculateProfitability
    ? (driverCommissionRate! / 100) * rateForCalc * deliveryCount
    : 0
  const perTripFeeCost = canCalculateProfitability
    ? driverPerTripFee! * deliveryCount
    : 0
  const totalCost = dieselCost + driverCommissionCost + perTripFeeCost
  const costRatio = canCalculateProfitability
    ? totalCost / totalContractValue
    : 0
  const isLowMargin = canCalculateProfitability && costRatio >= 0.5

  const showProfitabilityPanel = approvedBookingId === null && distanceForCalc > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 px-4 py-8">
      <div className="flex w-full max-w-4xl flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-center">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white p-6 shadow-lg lg:max-w-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Quote #{quote.quote_request_id}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {approvedBookingId !== null ? (
          <>
            <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
              Quote approved. Booking #{approvedBookingId} was created with{' '}
              {itinerariesCreated}{' '}
              {itinerariesCreated === 1 ? 'itinerary' : 'itineraries'}{' '}
              (status "Awaiting") -- assign a truck, trailer, and driver to
              each from the Dispatch Board.
            </p>
            <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
              <button
                onClick={() => onResolved(quote.quote_request_id)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
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
                label="Origin"
                value={formatLocationDisplay({
                  city: quote.pickup_city,
                  barangay: quote.pickup_barangay,
                  detail: quote.pickup_location_text,
                })}
              />
              <InfoRow
                label="Destination"
                value={formatLocationDisplay({
                  city: quote.delivery_city,
                  barangay: quote.delivery_barangay,
                  detail: quote.delivery_location_text,
                })}
              />
              <InfoRow label="Cargo type" value={quote.cargo_type} />
              <InfoRow label="Trailer type" value={quote.container_type} />
              <InfoRow label="Weight (tons)" value={String(quote.weight)} />
              <InfoRow
                label="Number of deliveries"
                value={String(quote.delivery_order_count ?? 1)}
              />
              <InfoRow
                label="Preferred pickup date"
                value={quote.preferred_pickup_date ?? '—'}
              />
              <InfoRow
                label="Cargo description"
                value={quote.cargo_description}
              />
            </div>

            <div className="mt-6 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
              <label className={labelClasses}>
                Proposed rate
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={proposedRate}
                  onChange={(e) => setProposedRate(e.target.value)}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Payment terms
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className={fieldClasses}
                >
                  <option value="Cash">Cash</option>
                  <option value="7Days">7 days</option>
                  <option value="14Days">14 days</option>
                  <option value="30Days">30 days</option>
                </select>
              </label>

              <label className={labelClasses}>
                Estimated distance (km)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedDistanceKm}
                  onChange={(e) => {
                    setEstimatedDistanceKm(e.target.value)
                    setDistanceIsCached(false)
                    setDistanceIsAutoEstimated(false)
                  }}
                  className={fieldClasses}
                />
                {autoEstimatingDistance && (
                  <span className="text-xs font-normal text-slate-500">
                    Estimating distance...
                  </span>
                )}
                {distanceIsCached && (
                  <span className="text-xs font-normal text-slate-500">
                    Pulled from a previous trip on this route -- edit if
                    it's changed.
                  </span>
                )}
                {distanceIsAutoEstimated && (
                  <span className="text-xs font-normal text-slate-500">
                    Auto-estimated driving distance -- double check before
                    approving.
                  </span>
                )}
              </label>

              <label className={labelClasses}>
                Trip start date
                <input
                  type="date"
                  value={tripDateFrom}
                  onChange={(e) => setTripDateFrom(e.target.value)}
                  className={fieldClasses}
                />
              </label>
            </div>

            {showRejectForm ? (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <label className={labelClasses}>
                  Reason for rejection
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
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={submitting}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
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
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {submitting ? 'Approving...' : 'Approve'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showProfitabilityPanel && (
        <div className="w-full overflow-y-auto rounded-xl bg-white p-6 shadow-lg lg:max-w-xs">
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
                  {deliveryCount === 1 ? 'trip' : 'trips'} × ₱
                  {rateForCalc.toLocaleString()})
                </span>
                <span className="font-medium text-slate-900">
                  ₱{totalContractValue.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Diesel cost</span>
                <span className="font-medium text-slate-900">
                  ₱{dieselCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Driver commission</span>
                <span className="font-medium text-slate-900">
                  ₱
                  {driverCommissionCost.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Driver per-trip fee</span>
                <span className="font-medium text-slate-900">
                  ₱
                  {perTripFeeCost.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-slate-500">Total cost</span>
                <span className="font-bold text-slate-900">
                  ₱{totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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

              {isLowMargin && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  Costs are at or above 50% of the rate -- this trip may not
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
