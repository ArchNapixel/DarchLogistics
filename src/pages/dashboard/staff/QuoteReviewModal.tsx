// QuoteReviewModal: staff side of a quote's price negotiation.
//
// Clients don't enter a rate any more. Staff price the quote here and SEND
// AN OFFER; the client accepts it, counters (their own rate and/or dates),
// or declines with a reason -- see lib/quoteOffers.ts and the database
// functions send_quote_offer / respond_to_quote_offer / accept_quote_counter
// (SQL given in chat 2026-10-23). By request_status:
//   Pending   -> staff enter rate per trip, distance, hours per trip and
//                the dates, check the profitability panel, then Send offer
//                (or Reject, as before -- the client may edit & resubmit).
//   Countered -> the client's rate/dates are shown next to our last offer;
//                staff Accept the client's rate (booking created), send a
//                new offer, or Reject.
//   Offered   -> waiting on the client: staff can Withdraw the offer (back
//                to Pending), or record a phone / walk-in client's reply
//                for them (accept / counter / decline).
// No expiry and no limit on rounds; every offer/counter/answer is kept in
// quote_rate_offers.
//
// The booking is created INSIDE the database when the offer is accepted
// (create_booking_from_quote: client, places, route_cache, booking, one
// itinerary per cargo with chained time slots), all in one transaction --
// the old step-by-step JS Approve with "needs manual review" is gone.
//
// Distance, most precise source first (the field stays editable either
// way):
//   1. Both ends have an exact map pin -> OSRM driving distance.
//   2. `route_cache` has a distance for this barangay pair.
//   3. Best-effort estimate between the two barangays' centres.
// A distance/hours saved with an earlier offer is used as-is.
//
// Profitability panel: diesel (price/liter x km), driver commission
// (commission% x rate) and the per-trip fee, against rate x trips, with a
// warning at 50% (lib/tripCost.ts). Plus a pricing guide: the break-even
// rate and the rate at the 50% line (lib/quotePricing.ts), and on a
// counter-offer, our last offer vs the client's rate side by side. The
// cost per trip saved with an offer is what the downpayment uses.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { showToast } from '../../../components/Toast'
import { estimateTripCosts } from '../../../lib/tripCost'
import { formatLocationDisplay } from '../../../lib/locationReference'
import { fetchDrivingDistanceKm, geocodePlace } from '../../../lib/geocoding'
import type { QuoteRequest } from './QuoteRequestsSection'
import { formatMoney, formatDate } from '../../../lib/format'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { toManilaDate } from '../../../lib/payslip'
import {
  MAX_DELIVERY_ORDERS,
  PAYMENT_TERMS_LABELS,
  REJECTION_TAGS,
  expandCargoLines,
  parseCargoLines,
  tripCargoLabel,
  type RejectionTag,
} from '../../../lib/quoteRequest'
import { downpaymentFor } from '../../../lib/downpayment'
import { rateForCostShare } from '../../../lib/quotePricing'
import {
  QUOTE_STATUS_LABELS,
  isProposal,
  loadQuoteOffers,
  offerActionLabel,
  offerChanges,
  previousProposal,
  type QuoteOfferRow,
} from '../../../lib/quoteOffers'
import OfferComparison from '../../../components/OfferComparison'
import { promptDialog } from '../../../components/ConfirmDialog'
import CapacityCard from './CapacityCard'
import QuoteWarnings from './QuoteWarnings'
import type { CapacityResult } from '../../../lib/capacity'

// Same cap as the bookings.hours_per_trip CHECK constraint.
const MAX_HOURS_PER_TRIP = 72

const fieldClasses =
  'w-full border-2 border-line-control bg-white px-3 py-2.5 text-[15px] text-slate-900 focus:border-primary min-h-11'

// Looks up a place by city+barangay (trimmed, case-insensitive) -- only to
// preview whether a cached distance exists. Never creates a place; the
// database does that when the booking is created.
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
      <dt className="text-[13px] font-medium text-ink-muted">{label}</dt>
      <dd className="text-[15px] font-medium text-ink">{children}</dd>
    </div>
  )
}

// Small heading over each group in the left column, with a rule under it.
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold text-ink">{children}</h3>
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
  // Payment terms stay the client's; a wrong one is still a Reject preset.
  const paymentTerms = quote.payment_terms
  // Where the negotiation is (header comment): Pending / Countered = staff's
  // turn to price it, Offered = waiting on the client.
  const status = quote.request_status
  const waitingOnClient = status === 'Offered'
  const countered = status === 'Countered'
  // What staff offer: rate per trip + dates, prefilled with what's on the
  // quote now (the client's counter, or an old quote's own rate).
  const [rateInput, setRateInput] = useState(quote.proposed_rate != null ? String(quote.proposed_rate) : '')
  const [offerPickupDate, setOfferPickupDate] = useState(quote.preferred_pickup_date ?? '')
  const [offerDeadline, setOfferDeadline] = useState(quote.preferred_delivery_date ?? '')
  const [offerNote, setOfferNote] = useState('')
  // Trip 1 starts on the pickup date being offered.
  const tripDateFrom = offerPickupDate
  // Every offer / counter / answer so far (quote_rate_offers), oldest first.
  const [history, setHistory] = useState<QuoteOfferRow[]>([])
  const lastOurOffer = [...history].reverse().find((h) => h.party === 'Business' && h.action === 'Offer')
  const lastClientMove = [...history].reverse().find((h) => h.party === 'Client')
  // Last free storage day: every trip must be Picked Up by 11:59 PM on the
  // pickup date, so the trips all start together (one truck each) instead
  // of back to back. Saved as bookings.storage_deadline on Approve.
  const urgent = quote.is_last_day_of_port_storage === true
  // The client's cargo lines, and the cargo of each trip they turn into
  // (trip 1 = line 1's first trip...). Approve creates one itinerary each.
  const cargoLines = parseCargoLines(quote.cargo_lines)
  const tripCargo = expandCargoLines(cargoLines)
  // A distance / hours saved with an earlier offer are reused as-is.
  const [estimatedDistanceKm, setEstimatedDistanceKm] = useState(
    quote.estimated_distance_km != null ? String(quote.estimated_distance_km) : '',
  )
  // Length of each trip's time slot (bookings.hours_per_trip).
  const [hoursPerTrip, setHoursPerTrip] = useState(quote.hours_per_trip != null ? String(quote.hours_per_trip) : '')
  // Inline error under the hours box (checked on blur and on Approve).
  const [hoursError, setHoursError] = useState<string | null>(null)
  const hoursInputRef = useRef<HTMLInputElement>(null)
  const [distanceIsCached, setDistanceIsCached] = useState(false)
  const [distanceIsAutoEstimated, setDistanceIsAutoEstimated] = useState(false)
  const [distanceIsFromPins, setDistanceIsFromPins] = useState(false)
  const [autoEstimatingDistance, setAutoEstimatingDistance] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  // Capacity Check result for the dates / hours being offered (CapacityCard).
  const [capacity, setCapacity] = useState<CapacityResult | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  // Preset picked in the Reject form -- tells the client which field to
  // fix on resubmit (REJECTION_TAGS in lib/quoteRequest.ts).
  const [rejectTag, setRejectTag] = useState<RejectionTag | null>(null)
  // Set after an action (offer sent, booking created...): the message shown
  // instead of the form. The quote has left its tab, so closing drops it.
  const [doneMessage, setDoneMessage] = useState<string | null>(null)
  const [dieselPricePerLiter, setDieselPricePerLiter] = useState<number | null>(
    null,
  )
  const [driverCommissionRate, setDriverCommissionRate] = useState<
    number | null
  >(null)
  const [driverPerTripFee, setDriverPerTripFee] = useState<number | null>(
    null,
  )
  // True once staff typed in the distance box (or it came saved with an
  // earlier offer) -- the background estimate must never overwrite it.
  const distanceTypedRef = useRef(quote.estimated_distance_km != null)

  // Close: if the quote already left its tab, tell the list to drop it.
  function close() {
    if (doneMessage) onResolved(quote.quote_request_id)
    else onClose()
  }

  // The negotiation history, for the left column and the counter compare.
  useEffect(() => {
    loadQuoteOffers(quote.quote_request_id).then(({ rows, error: historyError }) => {
      if (historyError) setError(`Couldn't load the offer history (${historyError}).`)
      else setHistory(rows)
    })
  }, [quote.quote_request_id])

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

  // Checks staff's price before it goes out. Returns the numbers, or null
  // (the problem is already shown).
  async function checkOffer(): Promise<{ rate: number; distance: number; hours: number } | null> {
    const rate = Number(rateInput)
    if (!rateInput || !(rate > 0)) {
      setError('Enter the rate per trip to offer.')
      return null
    }
    if (!/^\d+(\.\d{1,2})?$/.test(rateInput)) {
      setError('Rate per trip: max 2 decimals.')
      return null
    }
    const distance = Number(estimatedDistanceKm)
    if (!estimatedDistanceKm || !(distance > 0)) {
      setError('Enter the estimated trip distance.')
      return null
    }
    // Shown under the box, not as a top error.
    const hoursMessage = hoursProblem(hoursPerTrip)
    if (hoursMessage) {
      setHoursError(hoursMessage)
      hoursInputRef.current?.focus()
      return null
    }
    if (!offerPickupDate) {
      setError('Enter the pickup date.')
      return null
    }
    if (offerDeadline && offerDeadline < offerPickupDate) {
      setError('The deadline is before the pickup date.')
      return null
    }
    // The downpayment is worked out from the trip cost, so it must be known.
    if (!canCalculateProfitability) {
      setError(
        "The trip cost (and so the client's downpayment) can't be worked out -- check that Settings has the diesel price, driver commission rate and per-trip fee.",
      )
      return null
    }
    if (tripCargo.length === 0) {
      setError('This quote has no cargo lines. Reject it ("Other") so the client adds the cargo.')
      return null
    }
    if (tripCargo.length > MAX_DELIVERY_ORDERS) {
      setError(
        `This quote asks for ${tripCargo.length} trips (max ${MAX_DELIVERY_ORDERS}). Reject it ("Other") so the client splits it into smaller quotes.`,
      )
      return null
    }
    // The storage day already passed: the free storage is gone, so ask first.
    if (
      urgent &&
      offerPickupDate < toManilaDate(new Date()) &&
      !(await confirmDialog({
        title: 'Storage day already passed',
        message: `The last free storage day (${formatDate(offerPickupDate)}) is already over. Continue anyway?`,
        confirmLabel: 'Continue anyway',
        danger: true,
      }))
    ) {
      return null
    }
    return { rate, distance, hours: Number(hoursPerTrip) }
  }

  // Pending / Countered -> Offered. The client then answers it.
  async function handleSendOffer() {
    const offer = await checkOffer()
    if (!offer) return
    // Capacity Check is advisory: ask before sending an offer we can't run as asked.
    if (
      capacity &&
      capacity.status !== 'fits' &&
      !(await confirmDialog({
        title: "We can't run this as offered",
        message:
          capacity.status === 'none'
            ? `No driver, truck and trailer are free for these trips on ${formatDate(offerPickupDate)}, or in the next 2 weeks after the deadline. Send the offer anyway?`
            : `Not everything is free on ${formatDate(offerPickupDate)}. The earliest that works is ${formatDate(toManilaDate(new Date(capacity.start)))}. Send the offer anyway?`,
        confirmLabel: 'Send anyway',
        danger: true,
      }))
    ) {
      return
    }
    setSubmitting(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('send_quote_offer', {
      p_quote_id: quote.quote_request_id,
      p_rate: offer.rate,
      p_pickup_date: offerPickupDate,
      p_deadline_date: offerDeadline || null,
      p_distance_km: offer.distance,
      p_hours_per_trip: offer.hours,
      p_cost_per_trip: costPerTrip,
      p_note: offerNote,
    })
    setSubmitting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setDoneMessage(
      `Offer sent: ${formatMoney(offer.rate)} per trip × ${deliveryCount} = ${formatMoney(offer.rate * deliveryCount)}. ` +
        'The client can accept it, counter it or decline it from their portal. It is now under "Waiting on client".',
    )
  }

  // Countered: take the client's rate and dates -> the booking is created.
  async function handleAcceptCounter() {
    const counterRate = quote.proposed_rate ?? 0
    const distance = Number(estimatedDistanceKm)
    const hoursMessage = hoursProblem(hoursPerTrip)
    if (!(distance > 0)) {
      setError('Enter the estimated trip distance.')
      return
    }
    if (hoursMessage) {
      setHoursError(hoursMessage)
      hoursInputRef.current?.focus()
      return
    }
    if (counterAt === null) {
      setError("The trip cost can't be worked out -- check the Settings (diesel price, commission, per-trip fee).")
      return
    }
    const ok = await confirmDialog({
      title: `Accept ${formatMoney(counterRate)} per trip?`,
      message: `This creates the booking now: ${deliveryCount} trips, contract ${formatMoney(counterRate * deliveryCount)}, pickup ${
        quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'
      }.`,
      confirmLabel: 'Accept and create booking',
    })
    if (!ok) return
    setSubmitting(true)
    setError(null)
    const { data: bookingId, error: rpcError } = await supabase.rpc('accept_quote_counter', {
      p_quote_id: quote.quote_request_id,
      p_distance_km: distance,
      p_hours_per_trip: Number(hoursPerTrip),
      p_cost_per_trip: counterAt.costPerTrip,
    })
    setSubmitting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setDoneMessage(
      `Client's rate accepted. Booking #${bookingId} was created with ${deliveryCount} ${deliveryCount === 1 ? 'trip' : 'trips'} ` +
        '(status "Awaiting"). Assign a truck, trailer and driver to each from the Dispatch Board.',
    )
  }

  // Offered -> back to Pending (e.g. a wrong rate went out).
  async function handleWithdraw() {
    const ok = await confirmDialog({
      title: 'Withdraw this offer?',
      message: 'The client can no longer accept it. The quote goes back to "Needs pricing" so you can send a new one.',
      confirmLabel: 'Withdraw offer',
      danger: true,
    })
    if (!ok) return
    setSubmitting(true)
    setError(null)
    const { data: withdrawn, error: withdrawError } = await supabase
      .from('quote_requests')
      .update({ request_status: 'Pending' })
      .eq('quote_request_id', quote.quote_request_id)
      .eq('request_status', 'Offered')
      .select('quote_request_id')
      .maybeSingle()
    setSubmitting(false)
    if (withdrawError) {
      setError(withdrawError.message)
      return
    }
    if (!withdrawn) {
      setError('The client already answered this offer. Close and refresh to see their reply.')
      return
    }
    setDoneMessage('Offer withdrawn. The quote is back under "Needs pricing".')
  }

  // Offered: a phone / walk-in client answered -- staff enter it for them
  // (same database function the client portal uses; logged as by staff).
  async function handleRecordReply(action: 'accept' | 'counter' | 'decline') {
    let rate: number | null = null
    let note: string | null = null
    if (action === 'counter') {
      const typed = await promptDialog({
        title: "Client's rate per trip",
        message: 'What rate per trip did the client ask for? (Dates: change them below the offer if they asked for other dates.)',
        confirmLabel: 'Record counter-offer',
      })
      if (typed === null) return
      rate = Number(typed.replace(/[^\d.]/g, ''))
      if (!(rate > 0)) {
        setError('Enter the rate the client asked for.')
        return
      }
    } else if (action === 'decline') {
      note = await promptDialog({
        title: 'Client declined',
        message: 'Why did the client decline?',
        confirmLabel: 'Record decline',
        danger: true,
      })
      if (note === null) return
      if (!note.trim()) {
        setError('A reason is required.')
        return
      }
    } else if (
      !(await confirmDialog({
        title: 'Client accepted?',
        message: `Record that the client accepted ${formatMoney(quote.proposed_rate ?? 0)} per trip. This creates the booking now.`,
        confirmLabel: 'Client accepted -- create booking',
      }))
    ) {
      return
    }

    setSubmitting(true)
    setError(null)
    const { data: bookingId, error: rpcError } = await supabase.rpc('respond_to_quote_offer', {
      p_quote_id: quote.quote_request_id,
      p_action: action,
      p_rate: rate,
      // A counter can also move the dates (the date boxes below the offer).
      p_pickup_date: action === 'counter' ? offerPickupDate || null : null,
      p_deadline_date: action === 'counter' ? offerDeadline || null : null,
      p_note: note,
    })
    setSubmitting(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setDoneMessage(
      action === 'accept'
        ? `Recorded. Booking #${bookingId} was created with ${deliveryCount} ${deliveryCount === 1 ? 'trip' : 'trips'} (status "Awaiting").`
        : action === 'counter'
          ? `Counter-offer recorded (${formatMoney(rate ?? 0)} per trip). It is back under "Needs pricing".`
          : 'Decline recorded. The quote is closed.',
    )
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

    // Only while it's staff's turn (Pending / Countered) -- never overwrite
    // an offer the client may be accepting, or a quote already booked.
    const { data: rejectedRow, error: rejectError } = await supabase
      .from('quote_requests')
      .update({
        request_status: 'Rejected',
        rejection_reason: rejectReason.trim(),
        rejection_tag: rejectTag,
      })
      .eq('quote_request_id', quote.quote_request_id)
      .in('request_status', ['Pending', 'Countered'])
      .select('quote_request_id')
      .maybeSingle()

    setSubmitting(false)

    if (rejectError) {
      setError(rejectError.message)
      return
    }
    if (!rejectedRow) {
      showToast('Another admin already handled this quote -- it is no longer waiting on us.', 'error')
    }

    onResolved(quote.quote_request_id)
  }

  // rateInput/estimatedDistanceKm are PER TRIP -- a booking with
  // delivery_order_count deliveries runs that many separate truck trips,
  // each with its own diesel burn, driver commission, and per-trip fee.
  // The estimate below is for the whole contract (all deliveries), not
  // just one, so every cost is multiplied by deliveryCount alongside the
  // revenue side (rateForCalc x deliveryCount) -- otherwise the % of
  // rate would compare a full-contract revenue against only one trip's
  // costs and look far more profitable than it really is.
  const deliveryCount = tripCargo.length > 0 ? tripCargo.length : (quote.delivery_order_count ?? 1)
  const rateForCalc = Number(rateInput)
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
  // Sent with the offer (quote_requests.cost_per_trip) and copied to the
  // booking; the client's downpayment comes from it.
  const costPerTrip = Math.round((totalCost / deliveryCount) * 100) / 100
  const downpayment = canCalculateProfitability ? downpaymentFor(rateForCalc, costPerTrip, deliveryCount) : null

  // Pricing guide (lib/quotePricing.ts) and "what if" at any rate -- same
  // cost formula as the panel. Null until Settings + distance are known.
  const costSettings = settingsLoaded
    ? {
        dieselPricePerLiter: dieselPricePerLiter!,
        driverCommissionRate: driverCommissionRate!,
        driverPerTripFee: driverPerTripFee!,
      }
    : null
  const breakEvenRate = costSettings && distanceForCalc > 0 ? rateForCostShare(costSettings, distanceForCalc, 1) : null
  const fiftyLineRate = costSettings && distanceForCalc > 0 ? rateForCostShare(costSettings, distanceForCalc, 0.5) : null
  function profitAt(rate: number) {
    if (!costSettings || !(distanceForCalc > 0) || !(rate > 0)) return null
    const costs = estimateTripCosts(costSettings, rate, distanceForCalc, deliveryCount)
    const contract = rate * deliveryCount
    return {
      contract,
      total: costs.total,
      profit: contract - costs.total,
      ratio: costs.total / contract,
      costPerTrip: Math.round((costs.total / deliveryCount) * 100) / 100,
    }
  }
  // On a counter: our last offer vs the client's rate (quote.proposed_rate).
  const ourOfferAt = countered && lastOurOffer?.rate ? profitAt(lastOurOffer.rate) : null
  const counterAt = countered ? profitAt(quote.proposed_rate ?? 0) : null
  // The offer the client is looking at (Offered): its downpayment.
  const offeredDownpayment =
    waitingOnClient && quote.cost_per_trip != null
      ? downpaymentFor(quote.proposed_rate, quote.cost_per_trip, deliveryCount)
      : null

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
        className="absolute inset-y-0 right-0 flex w-full max-w-[1100px] flex-col border-l-2 border-line-card bg-white transition-transform duration-200 ease-out starting:translate-x-full motion-reduce:transition-none"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-7 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id="review-quote-title" className="text-xl font-bold text-slate-900">
              Review Quote #{quote.quote_request_id}
            </h2>
            {quote.reference_code && (
              <span className="font-mono text-[13px] font-semibold tracking-[0.02em] text-ink-secondary">{quote.reference_code}</span>
            )}
            <span className="bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 rounded-[2px]">
              {QUOTE_STATUS_LABELS[status] ?? status}
            </span>
            {pickupToday && (
              <span className="flex items-center gap-1 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 rounded-[2px]">
                <Icon name="clock" size={12} />
                Pickup Today
              </span>
            )}
          </div>
          <button
            onClick={close}
            aria-label="Close review"
            data-autofocus
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control text-ink-secondary hover:bg-slate-50"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Body: fits a 1080p screen; scrolls only on smaller windows. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {doneMessage !== null ? (
            <div className="px-7 py-6">
              <p className="border-2 border-green-200 bg-green-50 px-4 py-3 text-[15px] text-green-900">
                {doneMessage}
              </p>
            </div>
          ) : (
            <div className="grid gap-8 px-7 py-6 lg:grid-cols-[minmax(0,1fr)_436px]">
              {/* LEFT: the request, read-only */}
              <div className="flex flex-col gap-6">
                <QuoteWarnings
                  quoteId={quote.quote_request_id}
                  clientId={quote.client_id}
                  clientName={quote.client_name}
                  pickupBarangay={quote.pickup_barangay}
                  deliveryBarangay={quote.delivery_barangay}
                  pickupDate={quote.preferred_pickup_date}
                />
                {countered && (
                  <div className="border-2 border-sky-300 bg-sky-50 px-4 py-2.5 text-sm text-sky-900">
                    <p className="font-semibold">
                      Client countered: {formatMoney(quote.proposed_rate ?? 0)} per trip
                    </p>
                    {/* What they changed from our last offer, highlighted. */}
                    {lastOurOffer && lastClientMove ? (
                      <div className="mt-2 bg-white px-3 py-2">
                        <OfferComparison
                          before={lastOurOffer}
                          now={lastClientMove}
                          beforeLabel="Our last offer"
                          nowLabel="Client's counter"
                        />
                      </div>
                    ) : (
                      lastClientMove && (
                        <p className="mt-0.5">
                          Pickup {lastClientMove.pickup_date ? formatDate(lastClientMove.pickup_date) : '—'} · Deadline{' '}
                          {lastClientMove.deadline_date ? formatDate(lastClientMove.deadline_date) : '—'}
                        </p>
                      )
                    )}
                    {lastClientMove?.note && <p className="mt-1">"{lastClientMove.note}"</p>}
                  </div>
                )}
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
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
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
                        {quote.pickup_landmark && (
                          <span className="block text-[13px] text-slate-500">Landmark: {quote.pickup_landmark}</span>
                        )}
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
                        {quote.delivery_landmark && (
                          <span className="block text-[13px] text-slate-500">Landmark: {quote.delivery_landmark}</span>
                        )}
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
                  {cargoLines.length === 0 ? (
                    <p className="text-[15px] text-slate-500">No cargo lines on this quote.</p>
                  ) : (
                    <ol className="flex flex-col gap-3">
                      {cargoLines.map((line, index) => (
                        <li key={index} className="border border-slate-200 px-4 py-3">
                          <p className="text-base font-semibold text-ink">
                            {line.quantity} × {tripCargoLabel(line)}
                          </p>
                          <ol className="mt-1 list-inside list-decimal text-[14px] text-slate-700">
                            {line.cargo_descriptions.map((d, i) => (
                              <li key={i}>{d || '—'}</li>
                            ))}
                          </ol>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section>
                  <GroupHeading>Schedule</GroupHeading>
                  <dl className="grid grid-cols-4 gap-x-6 gap-y-3">
                    <Field label="Number of deliveries">{String(deliveryCount)}</Field>
                    <Field label={urgent ? 'Last free storage day (pick up by)' : 'Preferred pickup date'}>
                      {quote.preferred_pickup_date ? formatDate(quote.preferred_pickup_date) : '—'}
                    </Field>
                    <Field label="Deadline date">
                      {quote.preferred_delivery_date ? formatDate(quote.preferred_delivery_date) : 'Not given'}
                    </Field>
                  </dl>
                </section>

                <section>
                  <GroupHeading>Terms</GroupHeading>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <Field label={countered ? "Client's counter-offer" : waitingOnClient ? 'Our offer' : 'Rate'}>
                      {quote.proposed_rate !== null && status !== 'Pending' ? (
                        <>
                          <span className="text-2xl font-bold tabular-nums">{formatMoney(quote.proposed_rate)}</span>{' '}
                          <span className="text-[13px] text-slate-500">per trip</span>
                        </>
                      ) : (
                        'Not priced yet'
                      )}
                    </Field>
                    <Field label="Payment terms">
                      {PAYMENT_TERMS_LABELS[paymentTerms as keyof typeof PAYMENT_TERMS_LABELS] ?? paymentTerms}
                    </Field>
                  </dl>
                </section>

                {history.length > 0 && (
                  <section>
                    <GroupHeading>Offers so far</GroupHeading>
                    <ol className="flex flex-col gap-2 text-[14px]">
                      {history.map((h, index) => {
                        // Highlight what this offer/counter changed from the one before it.
                        const changed = isProposal(h) ? offerChanges(previousProposal(history, index), h) : null
                        const mark = (isChanged: boolean | undefined) =>
                          isChanged ? 'bg-amber-200 px-1 font-semibold' : ''
                        return (
                          <li key={h.offer_id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-slate-200 pb-2">
                            <span className="text-slate-900">
                              <span className="font-semibold">{offerActionLabel(h)}</span>
                              {h.rate != null && (
                                <>
                                  {' · '}
                                  <span className={mark(changed?.rate)}>{formatMoney(h.rate)}</span> per trip
                                </>
                              )}
                              {h.pickup_date && (
                                <>
                                  {' · pickup '}
                                  <span className={mark(changed?.pickup)}>{formatDate(h.pickup_date)}</span>
                                </>
                              )}
                              {h.deadline_date && (
                                <>
                                  {' · deadline '}
                                  <span className={mark(changed?.deadline)}>{formatDate(h.deadline_date)}</span>
                                </>
                              )}
                              {h.note && <span className="block text-slate-600">"{h.note}"</span>}
                            </span>
                            <span className="text-[13px] text-slate-500">{formatDate(h.created_at)}</span>
                          </li>
                        )
                      })}
                    </ol>
                  </section>
                )}
              </div>

              {/* RIGHT: what the admin decides, then the result */}
              {showRejectForm ? (
                <section className="self-start border-2 border-red-300 px-5 py-5">
                  <h3 className="text-base font-semibold text-ink">Reject this quote</h3>
                  <p className="mt-1 text-[13px] text-slate-500">
                    The client sees the reason and can fix the quote and resubmit it.
                  </p>
                  <fieldset className="mt-4">
                    <legend className="text-sm font-semibold text-slate-900">Why is it rejected?</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(Object.keys(REJECTION_TAGS) as RejectionTag[]).filter((tag) => tag !== 'Rate').map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => pickRejectTag(tag)}
                          aria-pressed={rejectTag === tag}
                          className={`flex items-center gap-1.5 border-2 px-3 py-1.5 text-sm font-medium ${
                            rejectTag === tag
                              ? 'border-red-700 bg-red-700 text-white'
                              : 'border-line-control text-ink-metric hover:bg-slate-50'
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
              ) : waitingOnClient ? (
                <div className="flex flex-col gap-4 self-start">
                  <section className="border-2 border-line-card px-5 py-5">
                    <h3 className="text-base font-semibold text-ink">Waiting on the client</h3>
                    <p className="mt-1 text-[13px] text-slate-500">
                      They can accept, counter (rate or dates) or decline from their portal.
                    </p>
                    <div className="mt-3 text-[15px]">
                      <CostRow
                        label="Our offer"
                        hint={`${deliveryCount} ${deliveryCount === 1 ? 'trip' : 'trips'} × ${formatMoney(quote.proposed_rate ?? 0)}`}
                        value={formatMoney((quote.proposed_rate ?? 0) * deliveryCount)}
                        strong
                      />
                      {offeredDownpayment !== null && (
                        <CostRow label="Client downpayment" value={formatMoney(offeredDownpayment)} />
                      )}
                      {lastOurOffer?.note && <p className="mt-1 text-[13px] text-slate-600">Note sent: "{lastOurOffer.note}"</p>}
                    </div>
                  </section>
                  <section className="border-2 border-line-card px-5 py-5">
                    <h3 className="text-base font-semibold text-ink">Client answered by phone or in person?</h3>
                    <p className="mt-1 text-[13px] text-slate-500">
                      For clients without a portal login. Recorded as entered by staff.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => handleRecordReply('accept')} disabled={submitting} className="btn-primary px-3 py-2 text-sm font-semibold">
                        Client accepted
                      </button>
                      <button type="button" onClick={() => handleRecordReply('counter')} disabled={submitting} className="border-2 border-line-control px-3 py-2 text-sm font-semibold text-ink-metric hover:bg-slate-50">
                        Client countered…
                      </button>
                      <button type="button" onClick={() => handleRecordReply('decline')} disabled={submitting} className="border-2 border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
                        Client declined…
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1 text-[13px] font-medium text-slate-600">
                        Counter: pickup date
                        <input type="date" value={offerPickupDate} onChange={(e) => setOfferPickupDate(e.target.value)} className={fieldClasses} />
                      </label>
                      <label className="flex flex-col gap-1 text-[13px] font-medium text-slate-600">
                        Counter: deadline
                        <input type="date" value={offerDeadline} min={offerPickupDate || undefined} onChange={(e) => setOfferDeadline(e.target.value)} className={fieldClasses} />
                      </label>
                    </div>
                  </section>
                </div>
              ) : (
                <div className="flex flex-col gap-4 self-start">
                  <section className="border-2 border-line-card px-5 py-5">
                    <h3 className="text-base font-semibold text-ink">Price this quote</h3>
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
                        {/* Only notes that need a look: loading, or a figure to check. */}
                        {(autoEstimatingDistance || (!distanceIsCached && (distanceIsFromPins || distanceIsAutoEstimated))) && (
                          <p id="review-distance-hint" className="mt-1.5 text-[13px] text-slate-500">
                            {autoEstimatingDistance
                              ? 'Estimating distance…'
                              : distanceIsFromPins
                                ? 'Driving distance between the two pinned spots. Check it before approving.'
                                : 'Rough estimate between the two barangay centres (no exact pins). Check it before approving.'}
                          </p>
                        )}
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
                        {hoursError && (
                          <p id="review-hours-hint" className="mt-1.5 text-[13px] font-medium text-red-700">
                            {hoursError}
                          </p>
                        )}
                      </div>
                      <div className="col-span-2">
                        <label htmlFor="offer-rate" className="block text-sm font-semibold text-slate-900">
                          Rate per trip to offer (PHP)
                        </label>
                        <input
                          id="offer-rate"
                          type="text"
                          inputMode="decimal"
                          value={rateInput}
                          onChange={(e) => setRateInput(e.target.value.replace(/[^\d.]/g, ''))}
                          placeholder={fiftyLineRate ? `e.g. ${fiftyLineRate}` : 'e.g. 15000'}
                          className={`${fieldClasses} mt-1.5 tabular-nums`}
                        />
                      </div>
                      <div>
                        <label htmlFor="offer-pickup" className="block text-sm font-semibold text-slate-900">
                          {urgent ? 'Last free storage day' : 'Pickup date'}
                        </label>
                        <input
                          id="offer-pickup"
                          type="date"
                          value={offerPickupDate}
                          onChange={(e) => setOfferPickupDate(e.target.value)}
                          className={`${fieldClasses} mt-1.5`}
                        />
                      </div>
                      <div>
                        <label htmlFor="offer-deadline" className="block text-sm font-semibold text-slate-900">
                          Deadline date
                        </label>
                        <input
                          id="offer-deadline"
                          type="date"
                          value={offerDeadline}
                          min={offerPickupDate || undefined}
                          onChange={(e) => setOfferDeadline(e.target.value)}
                          className={`${fieldClasses} mt-1.5`}
                        />
                      </div>
                      <div className="col-span-2">
                        <label htmlFor="offer-note" className="block text-sm font-semibold text-slate-900">
                          Note to the client <span className="font-normal text-slate-500">(optional)</span>
                        </label>
                        <input
                          id="offer-note"
                          type="text"
                          value={offerNote}
                          maxLength={300}
                          onChange={(e) => setOfferNote(e.target.value)}
                          placeholder="e.g. Includes the return trip of the empty container"
                          className={`${fieldClasses} mt-1.5`}
                        />
                      </div>
                    </div>
                  </section>

                  <CapacityCard
                    quoteId={quote.quote_request_id}
                    cargoLines={quote.cargo_lines}
                    hoursPerTrip={hoursPerTrip}
                    pickupDate={offerPickupDate}
                    deadlineDate={offerDeadline}
                    storage={urgent}
                    onResult={setCapacity}
                    onUseStart={(pickup, lastTripEnd) => {
                      setOfferPickupDate(pickup)
                      // Don't leave a deadline before the new trips end.
                      if (offerDeadline && offerDeadline < lastTripEnd) setOfferDeadline(lastTripEnd)
                    }}
                    onReject={() => {
                      pickRejectTag('Schedule')
                      setShowRejectForm(true)
                    }}
                  />

                  {(breakEvenRate !== null || fiftyLineRate !== null) && (
                    <section className="border-2 border-line-card px-5 py-5">
                      <h3 className="text-base font-semibold text-ink">Pricing guide</h3>
                      <div className="mt-2 text-[15px]">
                        <CostRow
                          label="Break-even rate"
                          value={breakEvenRate !== null ? formatMoney(breakEvenRate) : '—'}
                        />
                        <CostRow
                          label="Rate at the 50% line"
                          value={fiftyLineRate !== null ? formatMoney(fiftyLineRate) : '—'}
                        />
                        {fiftyLineRate !== null && (
                          <button
                            type="button"
                            onClick={() => setRateInput(String(fiftyLineRate))}
                            className="mt-1 text-sm font-medium text-primary underline"
                          >
                            Use {formatMoney(fiftyLineRate)} as the rate
                          </button>
                        )}
                      </div>
                      {ourOfferAt && counterAt && (
                        <table className="mt-4 w-full text-[14px] tabular-nums">
                          <thead className="text-left text-[13px] text-slate-500">
                            <tr>
                              <th className="py-1 font-medium" />
                              <th className="py-1 text-right font-medium">Our offer {formatMoney(lastOurOffer!.rate!)}</th>
                              <th className="py-1 text-right font-medium">Client's {formatMoney(quote.proposed_rate ?? 0)}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {([
                              ['Contract value', (x: NonNullable<typeof counterAt>) => formatMoney(x.contract)],
                              ['Total cost', (x: NonNullable<typeof counterAt>) => formatMoney(x.total)],
                              ['Est. profit', (x: NonNullable<typeof counterAt>) => formatMoney(x.profit)],
                              ['Cost vs. rate', (x: NonNullable<typeof counterAt>) => `${(x.ratio * 100).toFixed(1)}%${x.ratio >= 0.5 ? ' ⚠' : ''}`],
                            ] as const).map(([label, show]) => (
                              <tr key={label} className="border-t border-slate-100">
                                <td className="py-1 text-slate-700">{label}</td>
                                <td className="py-1 text-right text-slate-900">{show(ourOfferAt)}</td>
                                <td className="py-1 text-right font-semibold text-slate-900">{show(counterAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </section>
                  )}

                  <section className="border-2 border-line-card px-5 py-5" aria-live="polite">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-base font-semibold text-ink">Profitability Estimate</h3>
                      <span className="text-[13px] text-slate-500">Updates as you type</span>
                    </div>

                    {!settingsLoaded ? (
                      <p className="mt-3 text-sm text-slate-600">
                        Set diesel price and driver commission rate under Settings to see this estimate.
                      </p>
                    ) : rateForCalc <= 0 ? (
                      <p className="mt-3 text-sm text-slate-600">Enter a rate per trip to see the profit.</p>
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
                              Costs are at or above 50% of the rate. Informational only; the offer is still your call.
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

        {/* Footer: Reject / Withdraw far left, Send offer / Accept far right */}
        <div className="flex shrink-0 items-center justify-between gap-4 min-h-[84px] border-t border-line px-7 py-4">
          {doneMessage !== null ? (
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
                className={`border-2 border-line-card text-slate-700 hover:bg-slate-50 ${footerButton}`}
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
          ) : waitingOnClient ? (
            <>
              <button
                onClick={handleWithdraw}
                disabled={submitting}
                className={`border-2 border-red-700 text-red-700 hover:bg-red-50 ${footerButton}`}
              >
                Withdraw offer
              </button>
              <p role="alert" className="min-w-0 flex-1 text-center text-sm text-red-700">
                {error}
              </p>
              <button onClick={close} className={`border-2 border-line-card text-slate-700 hover:bg-slate-50 ${footerButton}`}>
                Close
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
              {countered && (
                <button
                  onClick={handleAcceptCounter}
                  disabled={submitting}
                  className={`border-2 border-primary text-primary hover:bg-slate-50 ${footerButton}`}
                >
                  <Icon name="check" />
                  Accept client's {formatMoney(quote.proposed_rate ?? 0)}
                </button>
              )}
              <button onClick={handleSendOffer} disabled={submitting} className={`btn-primary ${footerButton}`}>
                <Icon name="check" />
                {submitting ? 'Sending...' : countered ? 'Send new offer' : 'Send offer to client'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default QuoteReviewModal
