// quoteRequest: the one shared definition of a quote's shipment fields
// (route, cargo, schedule, commercial terms) -- their blank state, their
// validation, and how they map onto quote_requests columns. Used by all
// three ways a quote gets in: the public QuoteForm, the client portal's
// NewQuoteModal, and staff's NewQuoteRequestModal. Each channel only
// adds its own client-identity columns on top of buildQuoteRow().
import { useState } from 'react'
import { supabase } from './supabaseClient'

// One end of the route, as picked in components/LocationPicker.tsx.
export type LocationValue = {
  city: string
  barangay: string
  detail: string
  // Exact map pin, if one was dropped. Null when picked from the
  // dropdowns/quick-pick only.
  lat: number | null
  lng: number | null
}

export const emptyLocationValue: LocationValue = {
  city: '',
  barangay: '',
  detail: '',
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

// "2026-10-05" -> "Oct 5, 2026". Parsed as a local date on purpose:
// new Date("2026-10-05") would be UTC midnight and can show the day before.
export function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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

// Contact checks shared by the public form and staff's phone-in modal.
// Return an error message, or null when fine.
// Phone: PH mobile (09xx / +639xx) or landline with area code.
export function phoneError(phone: string): string | null {
  const digits = phone.replace(/[\s()-]/g, '')
  if (!digits) return 'Enter a phone number.'
  if (!/^(?:\+?63|0)(?:9\d{9}|[2-8]\d{7,9})$/.test(digits)) {
    return 'Invalid PH number.'
  }
  return null
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
  }

  if (!form.preferredPickupDate) {
    errors.preferredPickupDate = 'Select a date.'
  } else if (form.preferredPickupDate < todayDateString()) {
    errors.preferredPickupDate = 'Date is in the past.'
  }
  if (form.isLastDayOfPortStorage === 'No') {
    if (!form.preferredDeliveryDate) {
      errors.preferredDeliveryDate = 'Select a date.'
    } else if (
      form.preferredPickupDate &&
      form.preferredDeliveryDate < form.preferredPickupDate
    ) {
      errors.preferredDeliveryDate = 'Before pickup date.'
    }
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
// here rather than read back from the insert, because the public form
// (anon) isn't allowed to read quote_requests. No 0/O/1/I, so it reads
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
      pickup_city: pickup.city,
      pickup_barangay: pickup.barangay,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      delivery_location_text: delivery.detail.trim(),
      delivery_city: delivery.city,
      delivery_barangay: delivery.barangay,
      delivery_lat: delivery.lat,
      delivery_lng: delivery.lng,
      cargo_type: form.cargoType,
      cargo_description: form.cargoDescription.trim(),
      weight: Number(form.weight),
      container_type: form.containerType,
      preferred_pickup_date: form.preferredPickupDate,
      payment_terms: form.paymentTerms,
      proposed_rate: Number(form.proposedRate),
      is_last_day_of_port_storage: form.isLastDayOfPortStorage === 'Yes',
      preferred_delivery_date:
        form.isLastDayOfPortStorage === 'Yes' ? null : form.preferredDeliveryDate,
      delivery_order_count: Number(form.deliveryOrderCount),
      request_status: 'Pending',
    },
  }
}

// Form state + per-field errors, shared by all three quote channels.
// Editing a field clears that field's error straight away, so a fixed
// mistake doesn't keep showing red until the next submit.
export function useShipmentForm() {
  const [form, setForm] = useState<ShipmentForm>(emptyShipment)
  const [errors, setErrors] = useState<FieldErrors>({})

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
      'booking_id, place_of_pickup_id, place_of_delivery_id, pickup_address_detail, delivery_address_detail, pickup_lat, pickup_lng, delivery_lat, delivery_lng',
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
      [b.place_of_pickup_id, b.pickup_address_detail, b.pickup_lat, b.pickup_lng],
      [b.place_of_delivery_id, b.delivery_address_detail, b.delivery_lat, b.delivery_lng],
    ] as const
    for (const [placeId, detail, lat, lng] of ends) {
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
        lat: lat ?? null,
        lng: lng ?? null,
        label: detail?.trim() || `Brgy. ${place.barangay}`,
      })
    }
  }

  return recent.slice(0, 6)
}
