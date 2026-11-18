// tripPriceChanges: a DELIVERED trip repriced in Booking Detail -> Edit
// (table trip_price_changes, written by update_booking_details). So that a
// closed month never changes after the fact, the ledger keeps the trip at its
// ORIGINAL price on its delivery date and shows each change as its own line
// on the day it was made ("Price change, Trip #34: ₱5,000 → ₱6,000") -- the
// same idea as payroll, which pays the difference in the week it changed.
// Used by lib/paymentDue.ts (due dates) and lib/statement.ts (Statements,
// Billing, Financial Summary revenue). Totals are unchanged: original +
// changes = the trip's price today.
import { supabase } from './supabaseClient'
import { fetchIn } from './dashboardExpenses'
import { splitManila } from './format'

export type TripPriceChange = {
  change_id: number
  itinerary_id: number
  booking_id: number
  old_rate: number
  new_rate: number
  date: string // YYYY-MM-DD (Manila), when it was changed
}

// Changes on these trips, oldest first. A missing table (its SQL not run
// yet) = no changes, so nothing else breaks.
export async function loadTripPriceChanges(tripIds: number[]): Promise<{ rows: TripPriceChange[]; error: string | null }> {
  const result = await fetchIn<{
    change_id: number
    itinerary_id: number
    booking_id: number
    old_rate: number | string
    new_rate: number | string
    changed_at: string
  }>(tripIds, (chunk, from, to) =>
    supabase
      .from('trip_price_changes')
      .select('change_id, itinerary_id, booking_id, old_rate, new_rate, changed_at')
      .in('itinerary_id', chunk)
      .order('changed_at')
      .order('change_id')
      .range(from, to),
  )
  if (result.error) {
    if (result.error.includes('trip_price_changes')) return { rows: [], error: null }
    return { rows: [], error: result.error }
  }
  return {
    rows: result.rows.map((r) => ({
      change_id: r.change_id,
      itinerary_id: r.itinerary_id,
      booking_id: r.booking_id,
      old_rate: Number(r.old_rate),
      new_rate: Number(r.new_rate),
      date: splitManila(r.changed_at).date,
    })),
    error: null,
  }
}

export { originalRate } from './bookingBalance'

export const priceChangeText = (c: TripPriceChange) =>
  `Price change, Trip #${c.itinerary_id}: ₱${c.old_rate.toLocaleString()} → ₱${c.new_rate.toLocaleString()}`
