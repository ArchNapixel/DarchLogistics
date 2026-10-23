// billing: loads everything for the printable "Billing" of ONE booking
// (the bill you give the client). It's the Statement of Account ledger
// (statement.ts / statementTotals.ts) narrowed to this booking, so the
// lines, billed amount, paid amount and balance are exactly what Bills
// Receivable and the client's statement show; this file only adds the
// booking's own details (route, cargo, terms, invoice number).
import { supabase } from './supabaseClient'
import { loadLedgerInputs } from './statement'
import { buildStatement } from './statementTotals'
import { groupTripCargo } from './quoteRequest'

export type Billing = {
  booking_id: number
  client_id: number
  booking_date: string
  invoice_number: string | null
  client_name: string
  pickup: string
  delivery: string
  cargo: string
  payment_terms: string
  due_date: string | null
  trips_delivered: number
  trips_total: number
  billed: number // delivery amount + client damage charges
  paid: number // payments received minus refunds
  balance_due: number
  // Dated lines (delivered trips, adjustment, payments) with running balance.
  lines: ReturnType<typeof buildStatement>['lines']
}

type PlaceRow = { place_id: number; place_name: string; city: string | null; barangay: string | null }

export async function loadBilling(
  bookingId: number,
): Promise<{ billing: Billing | null; error: string | null }> {
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'booking_id, client_id, booking_date, invoice_number, payment_terms, place_of_pickup_id, place_of_delivery_id, pickup_address_detail, delivery_address_detail',
    )
    .eq('booking_id', bookingId)
    .maybeSingle()
  if (bookingError) return { billing: null, error: bookingError.message }
  if (!booking) return { billing: null, error: `Booking #${bookingId} not found.` }

  const [ledger, places, tripCargo] = await Promise.all([
    loadLedgerInputs(booking.client_id),
    supabase
      .from('places')
      .select('place_id, place_name, city, barangay')
      .in('place_id', [booking.place_of_pickup_id, booking.place_of_delivery_id]),
    // Cargo is per trip (itineraries.cargo_*) -- cancelled trips left out.
    supabase
      .from('itineraries')
      .select('cargo_type, container_type, trailer_type, weight')
      .eq('booking_id', bookingId)
      .or('itinerary_status.is.null,itinerary_status.neq.Cancelled'),
  ])
  if (ledger.error) return { billing: null, error: ledger.error }
  if (places.error) return { billing: null, error: places.error.message }
  if (tripCargo.error) return { billing: null, error: tripCargo.error.message }

  const row = ledger.rows.find((r) => r.booking_id === bookingId)
  if (!row) return { billing: null, error: `Booking #${bookingId} has no billing data.` }

  // "detail, Barangay, City" like the rest of the app; falls back to the
  // place name when the place has no city/barangay.
  const placeById = new Map((places.data as PlaceRow[]).map((p) => [p.place_id, p]))
  const location = (placeId: number, detail: string | null) => {
    const place = placeById.get(placeId)
    const parts = place?.city && place?.barangay ? [detail, place.barangay, place.city] : [detail, place?.place_name]
    return parts.filter(Boolean).join(', ') || '—'
  }

  // Whole history of this booking: everything dated up to today and before.
  const statement = buildStatement(
    {
      bookings: ledger.input.bookings.filter((b) => b.booking_id === bookingId),
      trips: ledger.input.trips.filter((t) => t.booking_id === bookingId),
      payments: ledger.input.payments.filter((p) => p.booking_id === bookingId),
    },
    '0000-01-01',
    '9999-12-31',
  )

  return {
    billing: {
      booking_id: bookingId,
      client_id: booking.client_id,
      booking_date: booking.booking_date,
      invoice_number: booking.invoice_number,
      client_name: row.client_name,
      pickup: location(booking.place_of_pickup_id, booking.pickup_address_detail),
      delivery: location(booking.place_of_delivery_id, booking.delivery_address_detail),
      cargo: groupTripCargo(tripCargo.data),
      payment_terms: booking.payment_terms,
      due_date: row.due_date,
      trips_delivered: row.completed_trips,
      trips_total: row.total_trips,
      billed: row.billable_amount,
      paid: row.amount_paid,
      balance_due: row.balance_due,
      lines: statement.lines,
    },
    error: null,
  }
}
