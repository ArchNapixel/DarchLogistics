// paymentDue: shared calculation for "how much is this booking's
// payment, and when is it due" -- used by the admin Reports page (all
// clients), the admin Bookings page (all clients, simplified columns),
// and the client portal (their own bookings only, via the clientId
// filter).
//
// Billing rule (from the business owner): rate_of_delivery_service is
// the rate PER TRIP (per itinerary/deliverable), not the booking's flat
// total -- a booking with delivery_order_count 10 at ₱5,500/trip is a
// ₱55,000 contract, but the business can only actually bill for
// itineraries the driver has marked Delivered. So each booking tracks:
// - total_contract_value = rate x total itineraries (the full contract)
// - computed_billable_amount = rate x itineraries actually Delivered so
//   far (what the trips alone justify, always auto-calculated)
// - billable_amount = the EFFECTIVE amount currently due:
//   bookings.amount_to_pay if staff has manually overridden it in
//   Financial Records (FinancialSection.tsx -- e.g. a discount or
//   special arrangement), otherwise computed_billable_amount -- PLUS
//   damage_charges (approved Client damage, lib/damageCharges.ts)
// - balance_due = billable_amount - amount_paid (what's currently owed)
// Payments themselves are recorded in Financial Records, not here --
// this module only computes what's owed and when; it doesn't write
// amount_paid or amount_to_pay.
// This is one row per booking with a running/partial amount, not one
// row per itinerary -- as more trips complete, billable_amount and
// balance_due grow, independent of whether the rest of the booking is
// done yet (unless staff has overridden the total, in which case it
// stays fixed at that override until changed again).
//
// Due date rule: once at least one itinerary is Delivered, the date
// used is the latest moment one of them was marked Delivered
// (dispatch_status_logs, new_status 'Delivered' -- itineraries.trip_date_to
// is just the original plan and never gets updated when a trip actually
// finishes). Before any itinerary is delivered, there's nothing
// billable yet, so the due date shown is just an estimate based on the
// quote's preferred date (preferred_delivery_date normally, or
// preferred_pickup_date if the quote was flagged
// is_last_day_of_port_storage, since preferred_delivery_date was never
// collected in that case) -- a reminder to plan around, not a real bill.
// Cash terms are due on the base date itself; 7/14/30-day terms are due
// that many days after it.
//
// Cancelled bookings are included, billed only for their delivered trips
// (a cancelled booking's other trips are Cancelled, so it drops off like
// any other once those are paid; with nothing delivered it never shows).
//
// A booking drops off the report entirely once every itinerary is
// Delivered AND the balance is fully paid -- otherwise it stays,
// whether that's because nothing's billable yet, or because more will
// become billable as remaining trips complete.
import { supabase } from './supabaseClient'
import { loadClientDamageChargesByBooking } from './damageCharges'
import { fetchAll, fetchIn } from './dashboardExpenses'
import { toManilaDate } from './payslip'

// One row of the bookings / quote queries in loadPaymentDueReport().
type DueBookingRow = {
  booking_id: number
  booking_date: string
  client_id: number
  quote_request_id: number | null
  booking_status: string | null
  cancelled_at: string | null
  payment_terms: string
  rate_of_delivery_service: number | null
  amount_to_pay: number | null
  amount_paid: number | null
  place_of_pickup_id: number
  place_of_delivery_id: number
}
type DueQuoteRow = {
  quote_request_id: number
  preferred_pickup_date: string | null
  preferred_delivery_date: string | null
  is_last_day_of_port_storage: boolean | null
}

// What a booking's DELIVERY amount is (damage is added on top elsewhere).
// Normally staff's locked/overridden amount_to_pay, else rate x delivered
// trips. Once a booking had ANY cancellation -- fully Cancelled, or
// cancelled partway and ended Delivered -- it's only billed for trips
// actually delivered, so an earlier lock at the full contract value is
// capped. Shared by Payments Due, Bills Receivable, Bookings and the
// client booking history so they can't disagree.
export function deliveryAmountFor(args: {
  amountToPay: number | null
  computedBillable: number // rate x delivered trips
  hadCancellation: boolean // booking_status Cancelled OR cancelled_at set
}): number {
  return args.hadCancellation
    ? Math.min(args.amountToPay ?? Infinity, args.computedBillable)
    : (args.amountToPay ?? args.computedBillable)
}

export type PaymentDueRow = {
  booking_id: number
  booking_date: string
  client_id: number
  client_name: string
  pickup_place_name: string
  delivery_place_name: string
  rate_per_trip: number | null
  total_trips: number
  completed_trips: number
  total_contract_value: number
  computed_billable_amount: number
  amount_to_pay_override: number | null
  damage_charges: number
  billable_amount: number
  amount_paid: number
  balance_due: number
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

// Done in UTC on purpose: building the date at local midnight and then
// calling toISOString() shifts it back a day in Manila (UTC+8).
function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

function daysFromToday(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${dateStr}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// Pass clientId to scope the report to one client's own bookings
// (the client portal); omit it for the admin view across all clients.
// includeSettled keeps the fully delivered + fully paid bookings too
// (the Statement of Account needs every booking, not just open ones).
export async function loadPaymentDueReport(
  clientId?: number,
  options?: { includeSettled?: boolean },
): Promise<{ rows: PaymentDueRow[]; error: string | null }> {
  // Cancelled bookings stay in: they still owe for trips delivered before
  // the cancellation (billed below, same cap as FinancialSection). Ones with
  // nothing delivered owe 0 and drop off at the filter at the bottom.
  // fetchAll / fetchIn below: every page (Supabase stops at 1000 rows) and
  // ids in chunks (one long id list makes the request URL too big).
  const { rows: bookingRows, error: bookingError } = await fetchAll<DueBookingRow>((from, to) => {
    let query = supabase
      .from('bookings')
      .select(
        'booking_id, booking_date, client_id, quote_request_id, booking_status, cancelled_at, payment_terms, rate_of_delivery_service, amount_to_pay, amount_paid, place_of_pickup_id, place_of_delivery_id',
      )
      .order('booking_id', { ascending: true })
    if (clientId !== undefined) query = query.eq('client_id', clientId)
    return query.range(from, to)
  })

  if (bookingError) {
    return { rows: [], error: bookingError }
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

  // Damage charges only need the booking ids, so they load alongside the
  // rest instead of as a separate round afterwards.
  const [clientsResult, quotesResult, placesResult, itinerariesResult, damageResult] =
    await Promise.all([
      fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, from, to) =>
        supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(from, to),
      ),
      fetchIn<DueQuoteRow>(quoteIds, (chunk, from, to) =>
        supabase
          .from('quote_requests')
          .select(
            'quote_request_id, preferred_pickup_date, preferred_delivery_date, is_last_day_of_port_storage',
          )
          .in('quote_request_id', chunk)
          .range(from, to),
      ),
      fetchIn<{ place_id: number; place_name: string }>(placeIds, (chunk, from, to) =>
        supabase.from('places').select('place_id, place_name').in('place_id', chunk).range(from, to),
      ),
      fetchIn<{ itinerary_id: number; booking_id: number; itinerary_status: string }>(
        bookingIds,
        (chunk, from, to) =>
          supabase
            .from('itineraries')
            .select('itinerary_id, booking_id, itinerary_status')
            .in('booking_id', chunk)
            // Cancelled trips aren't billed and don't count toward the
            // contract -- otherwise a partly cancelled booking could never
            // reach "all trips done" and would stay on the report forever.
            .neq('itinerary_status', 'Cancelled')
            .range(from, to),
      ),
      loadClientDamageChargesByBooking(bookingIds),
    ])

  if (clientsResult.error) {
    return { rows: [], error: clientsResult.error }
  }
  if (quotesResult.error) {
    return { rows: [], error: quotesResult.error }
  }
  if (placesResult.error) {
    return { rows: [], error: placesResult.error }
  }
  if (itinerariesResult.error) {
    return { rows: [], error: itinerariesResult.error }
  }

  const { byBooking: damageByBooking, error: damageError } = damageResult
  if (damageError) {
    return { rows: [], error: damageError }
  }

  const deliveredItineraryIds = itinerariesResult.rows
    .filter((i) => i.itinerary_status === 'Delivered')
    .map((i) => i.itinerary_id)

  // When each trip was marked Delivered on the Dispatch Board. Oldest
  // first, so the Map below keeps the latest one per trip.
  const { rows: deliveredLogRows, error: deliveredLogError } = await fetchIn<{
    itinerary_id: number
    status_changed_at: string
  }>(deliveredItineraryIds, (chunk, from, to) =>
    supabase
      .from('dispatch_status_logs')
      .select('itinerary_id, status_changed_at')
      .in('itinerary_id', chunk)
      .eq('new_status', 'Delivered')
      .order('status_changed_at', { ascending: true })
      .order('itinerary_id', { ascending: true })
      .range(from, to),
  )

  if (deliveredLogError) {
    return { rows: [], error: deliveredLogError }
  }

  const clientNameById = new Map(
    clientsResult.rows.map((c) => [c.client_id, c.client_name]),
  )
  const quoteById = new Map(
    quotesResult.rows.map((q) => [q.quote_request_id, q]),
  )
  const placeNameById = new Map(
    placesResult.rows.map((p) => [p.place_id, p.place_name]),
  )
  const receivedAtByItinerary = new Map(
    (deliveredLogRows ?? []).map((r) => [r.itinerary_id, r.status_changed_at as string]),
  )

  const itinerariesByBooking = new Map<
    number,
    { itinerary_id: number; itinerary_status: string }[]
  >()
  itinerariesResult.rows.forEach((itinerary) => {
    const list = itinerariesByBooking.get(itinerary.booking_id) ?? []
    list.push(itinerary)
    itinerariesByBooking.set(itinerary.booking_id, list)
  })

  const rows: PaymentDueRow[] = bookingRows
    .map((booking) => {
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
      const deliveredItineraries = itineraries.filter(
        (itinerary) => itinerary.itinerary_status === 'Delivered',
      )
      const totalTrips = itineraries.length
      const completedTrips = deliveredItineraries.length

      const rate = booking.rate_of_delivery_service ?? 0
      const totalContractValue = rate * totalTrips
      const computedBillableAmount = rate * completedTrips
      const damageCharges = damageByBooking.get(booking.booking_id) ?? 0
      // Any cancellation: only delivered trips are billable (deliveryAmountFor).
      const deliveryAmount = deliveryAmountFor({
        amountToPay: booking.amount_to_pay,
        computedBillable: computedBillableAmount,
        hadCancellation: booking.booking_status === 'Cancelled' || booking.cancelled_at != null,
      })
      const billableAmount = deliveryAmount + damageCharges
      const amountPaid = booking.amount_paid ?? 0
      const balanceDue = billableAmount - amountPaid

      let baseDate: string | null = null
      let baseDateSource: PaymentDueRow['base_date_source'] = 'unknown'

      if (completedTrips > 0) {
        const receiptDates = deliveredItineraries
          .map((itinerary) => receivedAtByItinerary.get(itinerary.itinerary_id))
          .filter((date): date is string => Boolean(date))
          // Manila date (like Statements/payroll) -- slicing the UTC timestamp
          // put deliveries made 12 MN-8 AM on the day before.
          .map((date) => toManilaDate(date))

        if (receiptDates.length > 0) {
          baseDate = receiptDates.reduce((latest, date) =>
            date > latest ? date : latest,
          )
          baseDateSource = 'actual'
        }
      }

      if (baseDate === null && preferredDate) {
        baseDate = preferredDate
        baseDateSource = 'preferred'
      }

      const daysToAdd = PAYMENT_TERM_DAYS[booking.payment_terms] ?? 0
      const dueDate = baseDate ? addDays(baseDate, daysToAdd) : null

      return {
        booking_id: booking.booking_id,
        booking_date: booking.booking_date,
        client_id: booking.client_id,
        client_name: clientNameById.get(booking.client_id) ?? '—',
        pickup_place_name: placeNameById.get(booking.place_of_pickup_id) ?? '—',
        delivery_place_name:
          placeNameById.get(booking.place_of_delivery_id) ?? '—',
        rate_per_trip: booking.rate_of_delivery_service,
        total_trips: totalTrips,
        completed_trips: completedTrips,
        total_contract_value: totalContractValue,
        computed_billable_amount: computedBillableAmount,
        amount_to_pay_override: booking.amount_to_pay,
        damage_charges: damageCharges,
        billable_amount: billableAmount,
        amount_paid: amountPaid,
        balance_due: balanceDue,
        payment_terms: booking.payment_terms,
        base_date: baseDate,
        base_date_source: baseDateSource,
        due_date: dueDate,
        days_until_due: dueDate ? daysFromToday(dueDate) : null,
      }
    })
    // Drop bookings that are fully delivered AND fully settled -- there's
    // nothing left to track. Anything else stays, including bookings with
    // nothing billable yet (shown as an estimate) and partially-paid ones.
    .filter(
      (row) =>
        options?.includeSettled ||
        !(row.completed_trips === row.total_trips && row.balance_due <= 0),
    )

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
// Pass the balance: a booking with nothing owed (paid up, or paid ahead
// with trips still to come) is never "Overdue", whatever its date.
export function formatDaysUntilDue(
  days: number | null,
  balanceDue?: number,
): {
  label: string
  tone: DueTone
} {
  if (balanceDue !== undefined && balanceDue <= 0) {
    return { label: 'Nothing due', tone: 'normal' }
  }
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
