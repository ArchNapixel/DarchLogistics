// paymentDue: shared calculation for "when is this booking's payment
// due" -- used by the admin Reports page (all clients), the admin
// Bookings page (all clients, simplified columns), and the client
// portal (their own bookings only, via the clientId filter).
//
// Due date rule (from the business owner):
// - Cash: due the day the booking is fully delivered. Until every
//   itinerary under the booking is actually marked Delivered, there's
//   no real delivery day yet, so it falls back to the "preferred" date
//   as a reminder estimate -- preferred_delivery_date normally, or
//   preferred_pickup_date if the quote was flagged
//   is_last_day_of_port_storage (in which case preferred_delivery_date
//   was never collected at quote time).
// - 7Days/14Days/30Days: due N days after that same base date (actual
//   completion once known, preferred date as an estimate until then).
//
// "Actual completion" means every itinerary on the booking has
// itinerary_status = 'Delivered', and the date used is the latest
// delivery_receipts.received_at among them (that's the real recorded
// delivery moment -- itineraries.trip_date_to is just the original
// plan and is never updated when a trip actually finishes).
//
// A booking can finish earlier or later than its preferred date (some
// itineraries done early, others delayed) -- that's exactly why the
// estimate gets replaced by the real date once all deliveries land,
// rather than always trusting the original preferred date.
import { supabase } from './supabaseClient'

export type PaymentDueRow = {
  booking_id: number
  client_name: string
  pickup_place_name: string
  delivery_place_name: string
  rate_of_delivery_service: number | null
  payment_terms: string
  base_date: string | null
  base_date_source: 'actual' | 'preferred' | 'unknown'
  due_date: string | null
  days_until_due: number | null
}

const PAYMENT_TERM_DAYS: Record<string, number> = {
  Cash: 0,
  '7Days': 7,
  '14Days': 14,
  '30Days': 30,
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysFromToday(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${dateStr}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Pass clientId to scope the report to one client's own bookings
// (the client portal); omit it for the admin view across all clients.
export async function loadPaymentDueReport(
  clientId?: number,
): Promise<{ rows: PaymentDueRow[]; error: string | null }> {
  let bookingsQuery = supabase
    .from('bookings')
    .select(
      'booking_id, client_id, quote_request_id, booking_status, payment_terms, rate_of_delivery_service, place_of_pickup_id, place_of_delivery_id',
    )
    .neq('booking_status', 'Cancelled')

  if (clientId !== undefined) {
    bookingsQuery = bookingsQuery.eq('client_id', clientId)
  }

  const { data: bookingRows, error: bookingError } = await bookingsQuery

  if (bookingError) {
    return { rows: [], error: bookingError.message }
  }
  if (bookingRows.length === 0) {
    return { rows: [], error: null }
  }

  const clientIds = Array.from(new Set(bookingRows.map((b) => b.client_id)))
  const quoteIds = Array.from(
    new Set(
      bookingRows
        .map((b) => b.quote_request_id)
        .filter((id): id is number => id !== null),
    ),
  )
  const placeIds = Array.from(
    new Set(
      bookingRows.flatMap((b) => [
        b.place_of_pickup_id,
        b.place_of_delivery_id,
      ]),
    ),
  )
  const bookingIds = bookingRows.map((b) => b.booking_id)

  const [clientsResult, quotesResult, placesResult, itinerariesResult] =
    await Promise.all([
      supabase
        .from('clients')
        .select('client_id, client_name')
        .in('client_id', clientIds),
      quoteIds.length > 0
        ? supabase
            .from('quote_requests')
            .select(
              'quote_request_id, preferred_pickup_date, preferred_delivery_date, is_last_day_of_port_storage',
            )
            .in('quote_request_id', quoteIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('places')
        .select('place_id, place_name')
        .in('place_id', placeIds),
      supabase
        .from('itineraries')
        .select('itinerary_id, booking_id, itinerary_status')
        .in('booking_id', bookingIds),
    ])

  if (clientsResult.error) {
    return { rows: [], error: clientsResult.error.message }
  }
  if (quotesResult.error) {
    return { rows: [], error: quotesResult.error.message }
  }
  if (placesResult.error) {
    return { rows: [], error: placesResult.error.message }
  }
  if (itinerariesResult.error) {
    return { rows: [], error: itinerariesResult.error.message }
  }

  const itineraryIds = itinerariesResult.data.map((i) => i.itinerary_id)

  const { data: receiptRows, error: receiptError } =
    itineraryIds.length > 0
      ? await supabase
          .from('delivery_receipts')
          .select('itinerary_id, received_at')
          .in('itinerary_id', itineraryIds)
      : { data: [], error: null }

  if (receiptError) {
    return { rows: [], error: receiptError.message }
  }

  const clientNameById = new Map(
    clientsResult.data.map((c) => [c.client_id, c.client_name]),
  )
  const quoteById = new Map(
    quotesResult.data.map((q) => [q.quote_request_id, q]),
  )
  const placeNameById = new Map(
    placesResult.data.map((p) => [p.place_id, p.place_name]),
  )
  const receivedAtByItinerary = new Map(
    (receiptRows ?? []).map((r) => [r.itinerary_id, r.received_at]),
  )

  const itinerariesByBooking = new Map<
    number,
    { itinerary_id: number; itinerary_status: string }[]
  >()
  itinerariesResult.data.forEach((itinerary) => {
    const list = itinerariesByBooking.get(itinerary.booking_id) ?? []
    list.push(itinerary)
    itinerariesByBooking.set(itinerary.booking_id, list)
  })

  const rows: PaymentDueRow[] = bookingRows.map((booking) => {
    const quote =
      booking.quote_request_id !== null
        ? quoteById.get(booking.quote_request_id)
        : undefined

    const preferredDate = quote
      ? quote.is_last_day_of_port_storage
        ? quote.preferred_pickup_date
        : quote.preferred_delivery_date
      : null

    const itineraries = itinerariesByBooking.get(booking.booking_id) ?? []
    const allDelivered =
      itineraries.length > 0 &&
      itineraries.every((itinerary) => itinerary.itinerary_status === 'Delivered')

    let baseDate: string | null = null
    let baseDateSource: PaymentDueRow['base_date_source'] = 'unknown'

    if (allDelivered) {
      const receiptDates = itineraries
        .map((itinerary) => receivedAtByItinerary.get(itinerary.itinerary_id))
        .filter((date): date is string => Boolean(date))
        .map((date) => date.slice(0, 10))

      if (receiptDates.length > 0) {
        baseDate = receiptDates.reduce((latest, date) =>
          date > latest ? date : latest,
        )
        baseDateSource = 'actual'
      } else if (preferredDate) {
        baseDate = preferredDate
        baseDateSource = 'preferred'
      }
    } else if (preferredDate) {
      baseDate = preferredDate
      baseDateSource = 'preferred'
    }

    const daysToAdd = PAYMENT_TERM_DAYS[booking.payment_terms] ?? 0
    const dueDate = baseDate ? addDays(baseDate, daysToAdd) : null

    return {
      booking_id: booking.booking_id,
      client_name: clientNameById.get(booking.client_id) ?? '—',
      pickup_place_name: placeNameById.get(booking.place_of_pickup_id) ?? '—',
      delivery_place_name:
        placeNameById.get(booking.place_of_delivery_id) ?? '—',
      rate_of_delivery_service: booking.rate_of_delivery_service,
      payment_terms: booking.payment_terms,
      base_date: baseDate,
      base_date_source: baseDateSource,
      due_date: dueDate,
      days_until_due: dueDate ? daysFromToday(dueDate) : null,
    }
  })

  rows.sort((a, b) => {
    if (a.days_until_due === null) return 1
    if (b.days_until_due === null) return -1
    return a.days_until_due - b.days_until_due
  })

  return { rows, error: null }
}

export type DueTone = 'overdue' | 'dueSoon' | 'normal' | 'unknown'

// Tailwind classes per tone, so every page's day-counter badge looks
// identical without each one redefining the same color map.
export const DUE_TONE_STYLES: Record<DueTone, string> = {
  overdue: 'bg-red-100 text-red-700',
  dueSoon: 'bg-amber-100 text-amber-700',
  normal: 'bg-green-100 text-green-700',
  unknown: 'bg-gray-100 text-gray-500',
}

// Shared day-counter label + color tone, so the Reports page, the
// Bookings side panel, and the client portal all read the same way.
export function formatDaysUntilDue(days: number | null): {
  label: string
  tone: DueTone
} {
  if (days === null) {
    return { label: 'Unknown', tone: 'unknown' }
  }
  if (days < 0) {
    return { label: `Overdue by ${Math.abs(days)}d`, tone: 'overdue' }
  }
  if (days === 0) {
    return { label: 'Due today', tone: 'dueSoon' }
  }
  if (days <= 3) {
    return { label: `Due in ${days}d`, tone: 'dueSoon' }
  }
  return { label: `Due in ${days}d`, tone: 'normal' }
}
