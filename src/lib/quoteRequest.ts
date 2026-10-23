// quoteRequest: the one shared definition of a quote's shipment fields
// (route, cargo, schedule, commercial terms) -- their blank state, their
// validation, and how they map onto quote_requests columns. Used by both
// ways a quote gets in: a logged-in client (ClientQuoteForm, on the
// /quote-request page and in the portal) and staff's NewQuoteRequestModal.
// Each channel only adds its own client-identity columns on top of
// buildQuoteRow().
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

// One end of the route, as picked in components/LocationPicker.tsx.
export type LocationValue = {
  city: string
  barangay: string
  // "Address" on screen: street/building. Saved as *_location_text.
  detail: string
  // Optional landmark to help the driver find the spot ("beside Shell,
  // blue gate"). Display only -- never used for distance, places or cost.
  landmark: string
  // Exact map pin, if one was dropped. Null when picked from the
  // dropdowns/quick-pick only.
  lat: number | null
  lng: number | null
}

export const emptyLocationValue: LocationValue = {
  city: '',
  barangay: '',
  detail: '',
  landmark: '',
  lat: null,
  lng: null,
}

export type ShipmentForm = {
  pickup: LocationValue
  delivery: LocationValue
  cargoType: 'Container' | 'Loose'
  cargoDescription: string
  weight: string
  containerType: '20ft' | '40ft'
  // Flatbed or Skeletal -- '' until the customer picks one (required).
  trailerType: '' | 'Flatbed' | 'Skeletal'
  preferredPickupDate: string
  paymentTerms: 'Cash' | '7Days' | '14Days' | '30Days'
  proposedRate: string
  isLastDayOfPortStorage: 'No' | 'Yes'
  preferredDeliveryDate: string
  deliveryOrderCount: string
}

export type ShipmentField = keyof ShipmentForm

// One message per field that has a problem, shown right under that field.
export type FieldErrors = Partial<Record<ShipmentField, string>>

export const emptyShipment: ShipmentForm = {
  pickup: emptyLocationValue,
  delivery: emptyLocationValue,
  cargoType: 'Container',
  cargoDescription: '',
  weight: '',
  containerType: '20ft',
  trailerType: '',
  preferredPickupDate: '',
  paymentTerms: 'Cash',
  proposedRate: '',
  isLastDayOfPortStorage: 'No',
  preferredDeliveryDate: '',
  deliveryOrderCount: '',
}

export const PAYMENT_TERMS_LABELS: Record<ShipmentForm['paymentTerms'], string> = {
  Cash: 'Cash',
  '7Days': '7 days',
  '14Days': '14 days',
  '30Days': '30 days',
}

// Today as YYYY-MM-DD in the user's own timezone -- same format
// <input type="date"> uses, so plain string comparison works.
export function todayDateString(): string {
  return new Date().toLocaleDateString('en-CA')
}

function sameSpot(a: LocationValue, b: LocationValue): boolean {
  const norm = (s: string) => s.trim().toLowerCase()
  if (norm(a.city) !== norm(b.city) || norm(a.barangay) !== norm(b.barangay)) {
    return false
  }
  // Two pins in the same barangay are different spots if they're
  // more than ~100 m apart (0.001 degrees).
  if (a.lat !== null && a.lng !== null && b.lat !== null && b.lng !== null) {
    return Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lng - b.lng) < 0.001
  }
  // No pins to tell them apart: only a different landmark does.
  return norm(a.detail) === norm(b.detail)
}

// Contact checks used by sign-up, profiles and staff's phone-in modal.
// Return an error message, or null when fine.
// Phone: digits only, exactly 11, starting with 09 (e.g. 09171234567).
// The input shows spaces (0966 047 5467); they're ignored here and removed on save.
export function phoneError(phone: string): string | null {
  const digits = phoneDigits(phone)
  if (!digits) return 'Enter a phone number.'
  if (!/^09\d{9}$/.test(digits)) return 'Phone number must be 11 digits and start with 09.'
  return null
}

// Phone without spaces, for validating and saving.
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '')
}

// Use in the phone input's onChange: keeps digits only, caps at 11, and
// adds spaces as you type: 0966 047 5467.
export function phoneInput(value: string): string {
  const d = phoneDigits(value).slice(0, 11)
  return [d.slice(0, 4), d.slice(4, 7), d.slice(7)].filter(Boolean).join(' ')
}

// Email is optional: blank is fine.
export function emailError(email: string): string | null {
  const value = email.trim()
  if (value && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) {
    return 'Invalid email.'
  }
  return null
}

// Heaviest load one trailer can carry.
export const MAX_WEIGHT_TONS = 45
// Most trips one quote can ask for -- Approve creates one itinerary per
// delivery, so an unbounded number would flood the Dispatch Board.
export const MAX_DELIVERY_ORDERS = 50

// Checks every shipment field and returns a message for each one with
// a problem (empty object = all good). Number(...) on an empty/invalid
// string gives NaN, which would otherwise be sent to Supabase and
// silently saved as null -- caught here instead.
export function validateShipment(form: ShipmentForm): FieldErrors {
  const errors: FieldErrors = {}
  const { pickup, delivery } = form

  if (!pickup.city || !pickup.barangay) {
    errors.pickup = 'Select city and barangay.'
  }
  if (!delivery.city || !delivery.barangay) {
    errors.delivery = 'Select city and barangay.'
  } else if (!errors.pickup && sameSpot(pickup, delivery)) {
    errors.delivery =
      'Same as pickup. Add a landmark or pin.'
  }

  if (!form.trailerType) {
    errors.trailerType = 'Select a trailer type.'
  } else if (form.cargoType === 'Loose' && form.trailerType !== 'Flatbed') {
    // The form sets Flatbed for loose cargo; this catches an old quote
    // being edited/resubmitted with Loose + Skeletal.
    errors.trailerType = 'Loose cargo goes on a flatbed.'
  }
  if (!form.cargoDescription.trim()) {
    errors.cargoDescription = 'Required.'
  }
  const weight = Number(form.weight)
  if (!form.weight || Number.isNaN(weight) || weight <= 0) {
    errors.weight = 'Enter a weight.'
  } else if (weight > MAX_WEIGHT_TONS) {
    errors.weight = `Max ${MAX_WEIGHT_TONS} tons.`
  } else if (!/^\d+(\.\d{1,2})?$/.test(form.weight)) {
    errors.weight = 'Max 2 decimals.'
  }
  const deliveryOrderCount = Number(form.deliveryOrderCount)
  if (!Number.isInteger(deliveryOrderCount) || deliveryOrderCount <= 0) {
    errors.deliveryOrderCount = 'Enter 1 or more.'
  } else if (deliveryOrderCount > MAX_DELIVERY_ORDERS) {
    errors.deliveryOrderCount = `Max ${MAX_DELIVERY_ORDERS} per quote.`
  }

  if (!form.preferredPickupDate) {
    errors.preferredPickupDate = 'Select a date.'
  } else if (form.preferredPickupDate < todayDateString()) {
    errors.preferredPickupDate = 'Date is in the past.'
  }
  // "Deadline date" on screen (column: preferred_delivery_date) -- the
  // latest day the client needs the cargo. Required for every quote, also
  // a last-free-storage-day one: that only adds a pickup deadline (picked
  // up by 11:59 PM on the pickup date), the cargo can arrive later.
  if (!form.preferredDeliveryDate) {
    errors.preferredDeliveryDate = 'Select a date.'
  } else if (
    form.preferredPickupDate &&
    form.preferredDeliveryDate < form.preferredPickupDate
  ) {
    errors.preferredDeliveryDate = 'Before pickup date.'
  }

  const proposedRate = Number(form.proposedRate)
  if (!form.proposedRate || Number.isNaN(proposedRate) || proposedRate <= 0) {
    errors.proposedRate = 'Enter a rate.'
  } else if (!/^\d+(\.\d{1,2})?$/.test(form.proposedRate)) {
    errors.proposedRate = 'Max 2 decimals.'
  }

  return errors
}

// Short code the customer can quote back to us ("Q-7F3K9A") -- generated
// here rather than read back from the insert (a plain insert, no
// .select(), so no extra SELECT policy is involved). No 0/O/1/I, so it reads
// cleanly over the phone. quote_requests.reference_code is UNIQUE, so a
// (roughly 1-in-a-billion) repeat just fails the insert instead of
// creating a duplicate.
function generateReferenceCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `Q-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`
}

// Validates, then maps the shipment fields onto quote_requests columns.
export function buildQuoteRow(form: ShipmentForm) {
  const errors = validateShipment(form)
  if (Object.keys(errors).length > 0) {
    return { errors }
  }

  const { pickup, delivery } = form
  return {
    row: {
      reference_code: generateReferenceCode(),
      pickup_location_text: pickup.detail.trim(),
      pickup_landmark: pickup.landmark.trim() || null,
      pickup_city: pickup.city,
      pickup_barangay: pickup.barangay,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      delivery_location_text: delivery.detail.trim(),
      delivery_landmark: delivery.landmark.trim() || null,
      delivery_city: delivery.city,
      delivery_barangay: delivery.barangay,
      delivery_lat: delivery.lat,
      delivery_lng: delivery.lng,
      cargo_type: form.cargoType,
      cargo_description: form.cargoDescription.trim(),
      weight: Number(form.weight),
      container_type: form.containerType,
      trailer_type: form.trailerType,
      preferred_pickup_date: form.preferredPickupDate,
      payment_terms: form.paymentTerms,
      proposed_rate: Number(form.proposedRate),
      is_last_day_of_port_storage: form.isLastDayOfPortStorage === 'Yes',
      // Shown as "Deadline date".
      preferred_delivery_date: form.preferredDeliveryDate,
      delivery_order_count: Number(form.deliveryOrderCount),
      request_status: 'Pending',
    },
  }
}

// The quote_requests columns buildQuoteRow writes -- what quoteToForm
// needs to read a saved quote back into the form.
export const SHIPMENT_COLUMNS =
  'pickup_location_text, pickup_landmark, pickup_city, pickup_barangay, pickup_lat, pickup_lng, delivery_location_text, delivery_landmark, delivery_city, delivery_barangay, delivery_lat, delivery_lng, cargo_type, cargo_description, weight, container_type, trailer_type, preferred_pickup_date, payment_terms, proposed_rate, is_last_day_of_port_storage, preferred_delivery_date, delivery_order_count'

// The reverse of buildQuoteRow: a saved quote (SHIPMENT_COLUMNS) back
// into form state, so a rejected quote can be edited and resubmitted.
// Unknown/old values fall back to the blank form's defaults.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function quoteToForm(q: Record<string, any>): ShipmentForm {
  const text = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  return {
    pickup: {
      city: text(q.pickup_city),
      barangay: text(q.pickup_barangay),
      detail: text(q.pickup_location_text),
      landmark: text(q.pickup_landmark),
      lat: q.pickup_lat ?? null,
      lng: q.pickup_lng ?? null,
    },
    delivery: {
      city: text(q.delivery_city),
      barangay: text(q.delivery_barangay),
      detail: text(q.delivery_location_text),
      landmark: text(q.delivery_landmark),
      lat: q.delivery_lat ?? null,
      lng: q.delivery_lng ?? null,
    },
    cargoType: q.cargo_type === 'Loose' ? 'Loose' : 'Container',
    cargoDescription: text(q.cargo_description),
    weight: text(q.weight),
    containerType: q.container_type === '40ft' ? '40ft' : '20ft',
    trailerType: q.trailer_type === 'Flatbed' || q.trailer_type === 'Skeletal' ? q.trailer_type : '',
    preferredPickupDate: text(q.preferred_pickup_date),
    paymentTerms: q.payment_terms in PAYMENT_TERMS_LABELS ? q.payment_terms : 'Cash',
    proposedRate: text(q.proposed_rate),
    isLastDayOfPortStorage: q.is_last_day_of_port_storage ? 'Yes' : 'No',
    preferredDeliveryDate: text(q.preferred_delivery_date),
    deliveryOrderCount: text(q.delivery_order_count),
  }
}

// Form state + per-field errors, shared by all three quote channels.
// Editing a field clears that field's error straight away, so a fixed
// mistake doesn't keep showing red until the next submit.
// Preset reasons staff pick when rejecting a quote, saved in
// quote_requests.rejection_tag (keep in sync with its CHECK list).
// `fields` are the ones the client is sent back to fix on resubmit:
// they open highlighted in red, on the step that holds them.
export const REJECTION_TAGS = {
  Rate: { label: 'Trip rate too low', fields: ['proposedRate'] },
  Weight: { label: 'Too heavy', fields: ['weight'] },
  Schedule: { label: 'Schedule unavailable', fields: ['preferredPickupDate', 'preferredDeliveryDate'] },
  Terms: { label: 'Payment terms not accepted', fields: ['paymentTerms'] },
  Other: { label: 'Other', fields: [] },
} as const satisfies Record<string, { label: string; fields: readonly ShipmentField[] }>

export type RejectionTag = keyof typeof REJECTION_TAGS

// The red highlights for a resubmit: each tagged field shows staff's
// reason as its error message. Untagged/Other quotes highlight nothing.
export function rejectionErrors(tag: string | null, reason: string | null): FieldErrors {
  const preset = tag && tag in REJECTION_TAGS ? REJECTION_TAGS[tag as RejectionTag] : null
  const message = reason?.trim() || preset?.label || ''
  return Object.fromEntries((preset?.fields ?? []).map((f) => [f, message]))
}

// `initial` pre-fills the form (editing a rejected quote, see quoteToForm);
// `initialErrors` opens it with those fields already marked red.
export function useShipmentForm(initial: ShipmentForm = emptyShipment, initialErrors: FieldErrors = {}) {
  const [form, setForm] = useState<ShipmentForm>(initial)
  const [errors, setErrors] = useState<FieldErrors>(initialErrors)

  function setField<K extends ShipmentField>(name: K, value: ShipmentForm[K]) {
    setForm((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }

  function reset() {
    setForm(emptyShipment)
    setErrors({})
  }

  return { form, setField, errors, setErrors, reset }
}

// When to slide the QuoteSummaryDrawer in (staff's NewQuoteRequestModal): once every shipment field is
// valid, held for a second so it doesn't pop up mid-typing (e.g. after
// the first digit of the rate). Closing keeps it closed until the form
// goes incomplete again.
export function useSummaryDrawer(form: ShipmentForm) {
  const [filledIn, setFilledIn] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const complete = Object.keys(validateShipment(form)).length === 0
  const [wasComplete, setWasComplete] = useState(complete)
  if (wasComplete !== complete) {
    setWasComplete(complete)
    if (!complete) {
      setFilledIn(false)
      setDismissed(false)
    }
  }
  useEffect(() => {
    if (!complete) return
    const timer = setTimeout(() => setFilledIn(true), 1000)
    return () => clearTimeout(timer)
  }, [complete])

  return { open: filledIn && !dismissed, dismiss: () => setDismissed(true) }
}

// A location from one of the client's own past bookings, offered as a
// one-click pick in the client portal.
export type RecentLocation = LocationValue & { label: string }

// Pickup and delivery spots from the client's latest bookings, newest
// first, one entry per distinct city + barangay + landmark. Reads only
// the client's own bookings (same query shape as MyBookingsSection)
// plus `places` for the city/barangay. Failures just mean no recent
// picks -- they never block the form.
export async function loadRecentLocations(clientId: number): Promise<RecentLocation[]> {
  const { data: bookings } = await supabase
    .from('bookings')
    .select(
      'booking_id, place_of_pickup_id, place_of_delivery_id, pickup_address_detail, delivery_address_detail, pickup_landmark, delivery_landmark, pickup_lat, pickup_lng, delivery_lat, delivery_lng',
    )
    .eq('client_id', clientId)
    .order('booking_id', { ascending: false })
    .limit(20)

  if (!bookings || bookings.length === 0) return []

  const placeIds = Array.from(
    new Set(bookings.flatMap((b) => [b.place_of_pickup_id, b.place_of_delivery_id])),
  ).filter((id): id is number => typeof id === 'number')

  const { data: places } = await supabase
    .from('places')
    .select('place_id, city, barangay')
    .in('place_id', placeIds)

  const placeById = new Map((places ?? []).map((p) => [p.place_id, p]))
  const seen = new Set<string>()
  const recent: RecentLocation[] = []

  for (const b of bookings) {
    const ends = [
      [b.place_of_pickup_id, b.pickup_address_detail, b.pickup_landmark, b.pickup_lat, b.pickup_lng],
      [b.place_of_delivery_id, b.delivery_address_detail, b.delivery_landmark, b.delivery_lat, b.delivery_lng],
    ] as const
    for (const [placeId, detail, landmark, lat, lng] of ends) {
      const place = placeById.get(placeId)
      // Older places rows from before city/barangay existed can't be
      // turned back into a pick -- skip them.
      if (!place?.city || !place?.barangay) continue

      const key = `${place.city}|${place.barangay}|${(detail ?? '').trim().toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      recent.push({
        city: place.city,
        barangay: place.barangay,
        detail: detail ?? '',
        landmark: landmark ?? '',
        lat: lat ?? null,
        lng: lng ?? null,
        label: detail?.trim() || `Brgy. ${place.barangay}`,
      })
    }
  }

  return recent.slice(0, 6)
}
