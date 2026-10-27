// clientPortal: the client portal's data loaders, shared by Home
// (ClientDashboard.tsx), My Bookings (MyBookingsSection) and Payments
// (ClientPaymentsSection). Everything is the logged-in client's own rows --
// RLS policies scope bookings / itineraries / quote_requests to the client.
//
// Deliberately does NOT fetch plate numbers, trailers or the crew: which
// truck or driver is on a trip is internal fleet info, not something
// clients see.
import { supabase } from './supabaseClient'
import { loadPaymentDueReport, type PaymentDueRow } from './paymentDue'
import { downpaymentStatus, type DownpaymentStatus } from './downpayment'
import { sumRates } from './lineRates'
import { clientPaymentState, type PaymentState } from './clientPaymentState'
import type { TripCargo } from './quoteRequest'

export type ClientTrip = {
  itinerary_id: number
  itinerary_status: string
  trip_date_from: string
  trip_date_to: string | null
  // The trip's time slot (null until Dispatch sets it).
  trip_start_at: string | null
  trip_end_at: string | null
  // This trip's own rate (cargo lines can be priced differently).
  trip_rate: number | null
  // This trip's own cargo (itineraries.cargo_*).
  cargo: TripCargo
}

export type ClientBooking = {
  booking_id: number
  booking_status: string
  booking_date: string
  rate_of_delivery_service: number | null
  // Downpayment inputs (lib/downpayment.ts): trips can't start until it's paid.
  cost_per_trip: number | null
  amount_paid: number | null
  downpayment_waived_at: string | null
  // The quote it came from ("Q-84KMUJ"), if any.
  quote_reference: string | null
  pickup_place_name: string
  delivery_place_name: string
  itineraries: ClientTrip[]
}

// Delivered and Cancelled bookings are finished -- everything else is
// still active (Draft/Confirmed/InProgress/...).
export function isActiveBooking(booking: { booking_status: string }): boolean {
  return booking.booking_status !== 'Delivered' && booking.booking_status !== 'Cancelled'
}

// Cancelled trips aren't billed (same rule as lib/paymentDue.ts).
export const billableTrips = (booking: ClientBooking) => booking.itineraries.filter((i) => i.itinerary_status !== 'Cancelled')

export function bookingDownpayment(booking: ClientBooking): DownpaymentStatus | null {
  if (booking.booking_status === 'Cancelled') return null
  return downpaymentStatus({
    contract:
      booking.rate_of_delivery_service === null
        ? null
        : sumRates(billableTrips(booking).map((t) => t.trip_rate ?? booking.rate_of_delivery_service ?? 0)),
    costPerTrip: booking.cost_per_trip,
    trips: billableTrips(booking).length,
    amountPaid: booking.amount_paid,
    waivedAt: booking.downpayment_waived_at,
  })
}

// quote_request_id -> "Q-XXXXXX".
async function loadQuoteReferences(quoteIds: number[]): Promise<Map<number, string>> {
  if (quoteIds.length === 0) return new Map()
  const { data } = await supabase.from('quote_requests').select('quote_request_id, reference_code').in('quote_request_id', quoteIds)
  return new Map((data ?? []).filter((q) => q.reference_code).map((q) => [q.quote_request_id, q.reference_code as string]))
}

// The client's bookings with their trips, newest first.
export async function loadClientBookings(clientId: number): Promise<{ bookings: ClientBooking[]; error: string | null }> {
  const { data: bookingRows, error: bookingError } = await supabase
    .from('bookings')
    .select(
      'booking_id, booking_status, booking_date, rate_of_delivery_service, cost_per_trip, amount_paid, downpayment_waived_at, quote_request_id, place_of_pickup_id, place_of_delivery_id',
    )
    .eq('client_id', clientId)
    .order('booking_date', { ascending: false })

  if (bookingError) return { bookings: [], error: bookingError.message }

  // Pickup/delivery place names (bookings only stores IDs).
  const placeIds = Array.from(new Set(bookingRows.flatMap((b) => [b.place_of_pickup_id, b.place_of_delivery_id])))
  const bookingIds = bookingRows.map((b) => b.booking_id)
  const quoteIds = bookingRows.flatMap((b) => (b.quote_request_id ? [b.quote_request_id] : []))

  const [placesResult, itinerariesResult, references] = await Promise.all([
    placeIds.length > 0
      ? supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length > 0
      ? supabase
          .from('itineraries')
          .select(
            'itinerary_id, booking_id, itinerary_status, trip_date_from, trip_date_to, trip_start_at, trip_end_at, cargo_type, container_type, trailer_type, weight, cargo_description, trip_rate',
          )
          .in('booking_id', bookingIds)
          .order('itinerary_id', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    loadQuoteReferences(quoteIds),
  ])

  if (placesResult.error) return { bookings: [], error: placesResult.error.message }
  if (itinerariesResult.error) return { bookings: [], error: itinerariesResult.error.message }

  const placeNameById = new Map(placesResult.data.map((place) => [place.place_id, place.place_name]))

  const tripsByBooking = new Map<number, ClientTrip[]>()
  for (const row of itinerariesResult.data) {
    const list = tripsByBooking.get(row.booking_id) ?? []
    list.push({
      itinerary_id: row.itinerary_id,
      itinerary_status: row.itinerary_status,
      trip_date_from: row.trip_date_from,
      trip_date_to: row.trip_date_to,
      trip_start_at: row.trip_start_at,
      trip_end_at: row.trip_end_at,
      trip_rate: row.trip_rate === null ? null : Number(row.trip_rate),
      cargo: {
        cargo_type: row.cargo_type,
        container_type: row.container_type,
        trailer_type: row.trailer_type,
        weight: row.weight,
        cargo_description: row.cargo_description,
      },
    })
    tripsByBooking.set(row.booking_id, list)
  }

  return {
    bookings: bookingRows.map((b) => ({
      booking_id: b.booking_id,
      booking_status: b.booking_status,
      booking_date: b.booking_date,
      rate_of_delivery_service: b.rate_of_delivery_service,
      cost_per_trip: b.cost_per_trip,
      amount_paid: b.amount_paid,
      downpayment_waived_at: b.downpayment_waived_at,
      quote_reference: b.quote_request_id ? (references.get(b.quote_request_id) ?? null) : null,
      pickup_place_name: placeNameById.get(b.place_of_pickup_id) ?? '—',
      delivery_place_name: placeNameById.get(b.place_of_delivery_id) ?? '—',
      itineraries: tripsByBooking.get(b.booking_id) ?? [],
    })),
    error: null,
  }
}

// One Payments card: the booking's payment-due row (lib/paymentDue.ts, paid
// ones included) plus its quote reference and payment state.
export type PaymentCard = {
  row: PaymentDueRow
  reference: string | null
  state: PaymentState
}

export async function loadClientPaymentCards(clientId: number): Promise<{ cards: PaymentCard[]; error: string | null }> {
  const { rows, error } = await loadPaymentDueReport(clientId, { includeSettled: true })
  if (error) return { cards: [], error }
  if (rows.length === 0) return { cards: [], error: null }

  // The downpayment needs each booking's saved cost and waiver.
  const { data: extras, error: extrasError } = await supabase
    .from('bookings')
    .select('booking_id, booking_status, cost_per_trip, downpayment_waived_at, quote_request_id')
    .in(
      'booking_id',
      rows.map((r) => r.booking_id),
    )
  if (extrasError) return { cards: [], error: extrasError.message }

  const extraById = new Map((extras ?? []).map((b) => [b.booking_id, b]))
  const references = await loadQuoteReferences((extras ?? []).flatMap((b) => (b.quote_request_id ? [b.quote_request_id] : [])))

  return {
    cards: rows.map((row) => {
      const extra = extraById.get(row.booking_id)
      const downpayment =
        !extra || extra.booking_status === 'Cancelled'
          ? null
          : downpaymentStatus({
              contract: row.rate_per_trip === null ? null : sumRates(row.trip_rates),
              costPerTrip: extra.cost_per_trip,
              trips: row.total_trips,
              amountPaid: row.amount_paid,
              waivedAt: extra.downpayment_waived_at,
            })
      return {
        row,
        reference: extra?.quote_request_id ? (references.get(extra.quote_request_id) ?? null) : null,
        state: clientPaymentState(row, downpayment),
      }
    }),
    error: null,
  }
}

// Home's quote line: the reference codes waiting for our price, and the
// offers waiting for the client's answer.
export async function loadOpenQuoteCounts(clientId: number): Promise<{ waitingForPrice: string[]; offers: string[] }> {
  const { data } = await supabase
    .from('quote_requests')
    .select('quote_request_id, reference_code, request_status')
    .eq('client_id', clientId)
    .in('request_status', ['Pending', 'Offered'])
  const ref = (q: { quote_request_id: number; reference_code: string | null }) => q.reference_code ?? `Quote #${q.quote_request_id}`
  return {
    waitingForPrice: (data ?? []).filter((q) => q.request_status === 'Pending').map(ref),
    offers: (data ?? []).filter((q) => q.request_status === 'Offered').map(ref),
  }
}
