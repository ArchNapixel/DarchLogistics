// bookingCharges: extra charges added to a booking's bill by hand ("Add
// Charge" on the Billing page) -- e.g. waiting time, an extra drop, a
// re-delivery. One row each in `booking_charges` (SQL given in chat
// 2026-10-25): booking_id, description, amount, created_by, created_at, and
// voided_at / voided_by / void_reason (a wrong charge is VOIDED, not
// deleted, so the bill's history stays readable).
//
// A booking's "extra charges" = approved Client damage
// (lib/damageCharges.ts) + its non-voided added charges. Everything that
// shows a balance adds that ON TOP of the trips' amount, through
// loadExtraChargesByBooking() below (the `damage_charges` field on Booking
// / PaymentDueRow holds this total).
import { supabase } from './supabaseClient'
import { fetchIn } from './dashboardExpenses'
import { loadClientDamageChargesByBooking } from './damageCharges'

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

// booking_id -> approved Client damage + added charges (bookings with none are absent).
export async function loadExtraChargesByBooking(bookingIds: number[]): Promise<{
  byBooking: Map<number, number>
  error: string | null
}> {
  const damage = await loadClientDamageChargesByBooking(bookingIds)
  if (damage.error) return damage
  const byBooking = new Map(damage.byBooking)
  if (bookingIds.length === 0) return { byBooking, error: null }

  const { rows, error } = await fetchIn<{ booking_id: number; amount: number | string }>(bookingIds, (chunk, from, to) =>
    supabase
      .from('booking_charges')
      .select('booking_id, amount')
      .in('booking_id', chunk)
      .is('voided_at', null)
      .range(from, to),
  )
  if (error) return { byBooking, error: isMissingTable(error) ? null : error }
  for (const r of rows) byBooking.set(r.booking_id, (byBooking.get(r.booking_id) ?? 0) + Number(r.amount))
  return { byBooking, error: null }
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
