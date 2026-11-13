// bookingCharges: extra charges added to a booking's bill by hand ("Add
// Charge" on the Billing page) -- e.g. waiting time, an extra drop, a
// re-delivery. One row each in `booking_charges` (SQL given in chat
// 2026-10-25): booking_id, description, amount, created_by, created_at, and
// voided_at / voided_by / void_reason (a wrong charge is VOIDED, not
// deleted, so the bill's history stays readable).
//
// A booking's "extra charges" = approved Client damage (decided on Damage
// Charges) + its non-voided added charges. Everything that shows a balance
// adds that ON TOP of the trips' amount, through loadExtraChargesByBooking()
// below (the `damage_charges` field on Booking / PaymentDueRow holds the
// total). It also returns each charge as its own line (`items`), so Billing,
// Statements and the client portal can name them instead of one lump.
import { supabase } from './supabaseClient'
import { fetchIn } from './dashboardExpenses'
import { splitManila } from './format'

export type BookingCharge = {
  charge_id: number
  booking_id: number
  description: string
  amount: number
  created_at: string
  voided_at: string | null
  void_reason: string | null
}

// True when the error is "table booking_charges doesn't exist yet" (its SQL
// hasn't been run). Balances then just count no added charges instead of
// breaking every page that shows one.
function isMissingTable(message: string) {
  return message.includes('booking_charges') && message.includes('schema cache')
}

// One extra charge on a booking's bill. date = when it was billed (Manila):
// a damage charge on the day it was decided, an added charge when added.
export type ExtraChargeItem = {
  id: number // damage_id or charge_id
  booking_id: number
  source: 'Damage' | 'Charge'
  date: string // YYYY-MM-DD
  description: string
  amount: number
}

// booking_id -> total extra charges (bookings with none are absent), and
// booking_id -> each charge, oldest first. The total is the items added up,
// so a bill's lines can't disagree with the balance.
export async function loadExtraChargesByBooking(bookingIds: number[]): Promise<{
  byBooking: Map<number, number>
  items: Map<number, ExtraChargeItem[]>
  error: string | null
}> {
  const byBooking = new Map<number, number>()
  const items = new Map<number, ExtraChargeItem[]>()
  if (bookingIds.length === 0) return { byBooking, items, error: null }
  const fail = (error: string) => ({ byBooking, items, error })

  // fetchIn: ids in chunks (a long list makes the URL too big) and every
  // page past Supabase's 1000-row cap.
  const [trips, charges] = await Promise.all([
    fetchIn<{ itinerary_id: number; booking_id: number }>(bookingIds, (chunk, from, to) =>
      supabase.from('itineraries').select('itinerary_id, booking_id').in('booking_id', chunk).range(from, to),
    ),
    fetchIn<{ charge_id: number; booking_id: number; description: string; amount: number | string; created_at: string }>(
      bookingIds,
      (chunk, from, to) =>
        supabase
          .from('booking_charges')
          .select('charge_id, booking_id, description, amount, created_at')
          .in('booking_id', chunk)
          .is('voided_at', null)
          .range(from, to),
    ),
  ])
  if (trips.error) return fail(trips.error)
  // booking_charges missing (its SQL not run yet) = no added charges.
  if (charges.error && !isMissingTable(charges.error)) return fail(charges.error)

  const damage = await fetchIn<{
    damage_id: number
    itinerary_id: number
    damage_description: string
    estimated_damage_cost: number | string | null
    approved_at: string | null
    created_at: string | null
  }>(
    trips.rows.map((t) => t.itinerary_id),
    (chunk, from, to) =>
      supabase
        .from('delivery_damage_records')
        .select('damage_id, itinerary_id, damage_description, estimated_damage_cost, approved_at, created_at')
        .in('itinerary_id', chunk)
        .eq('damage_status', 'Approved')
        .eq('charge_to', 'Client')
        .range(from, to),
  )
  if (damage.error) return fail(damage.error)

  const all: ExtraChargeItem[] = []
  const bookingByTrip = new Map(trips.rows.map((t) => [t.itinerary_id, t.booking_id]))
  for (const d of damage.rows) {
    const bookingId = bookingByTrip.get(d.itinerary_id)
    if (bookingId === undefined) continue
    all.push({
      id: d.damage_id,
      booking_id: bookingId,
      source: 'Damage',
      date: splitManila(d.approved_at ?? d.created_at ?? new Date()).date,
      description: `Damage, Trip #${d.itinerary_id} (${d.damage_description})`,
      amount: Number(d.estimated_damage_cost ?? 0),
    })
  }
  for (const c of charges.error ? [] : charges.rows) {
    all.push({
      id: c.charge_id,
      booking_id: c.booking_id,
      source: 'Charge',
      date: splitManila(c.created_at).date,
      description: c.description,
      amount: Number(c.amount),
    })
  }

  all.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  for (const item of all) {
    byBooking.set(item.booking_id, (byBooking.get(item.booking_id) ?? 0) + item.amount)
    items.set(item.booking_id, [...(items.get(item.booking_id) ?? []), item])
  }
  return { byBooking, items, error: null }
}

// One booking's added charges, newest first (voided ones included).
export async function loadBookingCharges(bookingId: number): Promise<{ charges: BookingCharge[]; error: string | null }> {
  const { data, error } = await supabase
    .from('booking_charges')
    .select('charge_id, booking_id, description, amount, created_at, voided_at, void_reason')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
  if (error) {
    return {
      charges: [],
      error: isMissingTable(error.message)
        ? 'Added charges are not set up yet: the booking_charges table is missing in Supabase (run its SQL first).'
        : error.message,
    }
  }
  return { charges: data.map((c) => ({ ...c, amount: Number(c.amount) })), error: null }
}

// Returns an error message, or null when saved.
export async function addBookingCharge(args: {
  bookingId: number
  description: string
  amount: number
  createdBy: number | null
}): Promise<string | null> {
  if (!args.description.trim()) return 'Say what the charge is for.'
  if (!(args.amount > 0)) return 'Enter an amount greater than zero.'
  const { error } = await supabase.from('booking_charges').insert({
    booking_id: args.bookingId,
    description: args.description.trim(),
    amount: Math.round(args.amount * 100) / 100,
    created_by: args.createdBy,
  })
  return error ? error.message : null
}

// Voids a charge (it stays on record, struck through, and stops counting).
export async function voidBookingCharge(chargeId: number, reason: string, voidedBy: number | null): Promise<string | null> {
  if (!reason.trim()) return 'Enter a reason to void a charge.'
  const { data, error } = await supabase
    .from('booking_charges')
    .update({ voided_at: new Date().toISOString(), voided_by: voidedBy, void_reason: reason.trim() })
    .eq('charge_id', chargeId)
    .is('voided_at', null)
    .select('charge_id')
    .maybeSingle()
  if (error) return error.message
  return data ? null : 'That charge was already voided (or you have no permission to void it).'
}
