// damageCharges: damage the client has to pay for. A delivery_damage_records
// row counts once staff approved it with charge_to 'Client' on the Damage
// Charges page. It's added ON TOP of the booking's delivery amount
// (amount_to_pay override, or rate x delivered trips) everywhere a
// balance is shown -- Bookings, Financial Records, Payments Due, the
// client portal. amount_to_pay itself never includes it, so an override
// can't swallow or double-count a damage charge.
import { supabase } from './supabaseClient'

// booking_id -> total approved Client damage (bookings with none are absent).
export async function loadClientDamageChargesByBooking(bookingIds: number[]): Promise<{
  byBooking: Map<number, number>
  error: string | null
}> {
  const byBooking = new Map<number, number>()
  if (bookingIds.length === 0) return { byBooking, error: null }

  const { data: trips, error: tripsError } = await supabase
    .from('itineraries')
    .select('itinerary_id, booking_id')
    .in('booking_id', bookingIds)
  if (tripsError) return { byBooking, error: tripsError.message }
  if (trips.length === 0) return { byBooking, error: null }

  const { data: damageRows, error: damageError } = await supabase
    .from('delivery_damage_records')
    .select('itinerary_id, estimated_damage_cost')
    .in('itinerary_id', trips.map((t) => t.itinerary_id))
    .eq('damage_status', 'Approved')
    .eq('charge_to', 'Client')
  if (damageError) return { byBooking, error: damageError.message }

  const bookingByTrip = new Map(trips.map((t) => [t.itinerary_id, t.booking_id]))
  for (const row of damageRows) {
    const bookingId = bookingByTrip.get(row.itinerary_id)
    if (bookingId === undefined) continue
    byBooking.set(bookingId, (byBooking.get(bookingId) ?? 0) + Number(row.estimated_damage_cost ?? 0))
  }
  return { byBooking, error: null }
}

// ---- Reporting damage (MarkDeliveredModal on the Dispatch Board, and
// ReportDamageModal on the Damage Charges page) ----

export type DamageCondition = 'Good' | 'Damaged' | 'Partial' | 'Missing'

export type DamageInput = {
  condition: DamageCondition
  description: string
  cost: string // form value; converted on save
  chargeTo: 'Client' | 'Company'
}

export const EMPTY_DAMAGE: DamageInput = {
  condition: 'Good',
  description: '',
  cost: '',
  chargeTo: 'Client',
}

// Form check -- null when OK. 'Good' means nothing to report.
export function damageInputError(input: DamageInput): string | null {
  if (input.condition === 'Good') return null
  if (!input.description.trim() || !input.cost) {
    return 'Describe the problem and enter an estimated cost.'
  }
  if (Number(input.cost) < 0) return "Estimated cost can't be negative."
  return null
}

// Saves one delivery_damage_records row (status defaults to 'Reported'
// until staff pick Client/Company on Damage Charges). Returns an error
// message or null.
export async function insertDamageRecord(itineraryId: number, input: DamageInput) {
  const { error } = await supabase.from('delivery_damage_records').insert({
    itinerary_id: itineraryId,
    damage_description: `${input.condition}: ${input.description.trim()}`,
    estimated_damage_cost: Number(input.cost),
    charge_to: input.chargeTo,
  })
  return error?.message ?? null
}
