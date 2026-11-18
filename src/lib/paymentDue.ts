// paymentDue: shared calculation for "how much is this booking's
// payment, and when is it due" -- used by the admin Reports page (all
// clients), the admin Bookings page (all clients, simplified columns),
// and the client portal (their own bookings only, via the clientId
// filter).
//
// Billing rule (from the business owner): the rate is PER TRIP (per
// itinerary/deliverable), not the booking's flat total -- a booking with
// delivery_order_count 10 at ₱5,500/trip is a ₱55,000 contract, but the
// business can only actually bill for itineraries the driver has marked
// Delivered. Each trip carries its own rate (itineraries.trip_rate: cargo
// lines of one quote can be priced differently; bookings.
// rate_of_delivery_service is only their average). So each booking tracks:
// - total_contract_value = the sum of its live trips' rates (the full contract)
// - computed_billable_amount = the sum of the rates of the trips actually
//   Delivered so far (what the trips alone justify, always auto-calculated)
// - billable_amount = the EFFECTIVE amount currently due:
//   computed_billable_amount (no override since 2026-11-18 -- prices are
//   edited on the trips) PLUS damage_charges = EXTRA charges: approved
//   Client damage + added charges (lib/bookingCharges.ts). The math is
//   lib/bookingBalance.ts.
// - balance_due = billable_amount - amount_paid (what's currently owed)
// Payments themselves are recorded in Financial Records, not here --
// this module only computes what's owed and when; it doesn't write
// amount_paid.
// This is one row per booking with a running/partial amount, not one
// row per itinerary -- as more trips complete, billable_amount and
// balance_due grow, independent of whether the rest of the booking is
// done yet (unless staff has overridden the total, in which case it
// stays fixed at that override until changed again).
//
// Due date rule (2026-11-18, lib/bookingBalance.ts): each delivered trip
// falls due on its OWN delivery date (dispatch_status_logs, latest Delivered
// row, Manila date) + the payment terms, each extra charge on the day it was
// added + the terms. Payments pay the oldest first; the booking's due date is
// that of the oldest part still unpaid (open_items / overdue_amount give the
// detail). Before any trip is delivered there is NO due date (screens say
// "Starts when delivered") -- a booking can't be overdue before delivery.
// Cash terms are due on the day itself; 7/14/30-day terms that many days after.
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
import { loadExtraChargesByBooking, type ExtraChargeItem } from './bookingCharges'
import { fetchAll, fetchIn } from './dashboardExpenses'
import { toManilaDate } from './payslip'
import { isDelivered } from './tripStatusFlow'
import { loadTripPriceChanges } from './tripPriceChanges'
import {
  PAYMENT_TERM_DAYS,
  bookingBalances,
  bookingDueDate,
  daysBetween,
  openDueItems,
  originalRate,
  overdueAmount,
  type BilledItem,
  type OpenItem,
} from './bookingBalance'

export type { OpenItem } from './bookingBalance'

// One row of the bookings query in loadPaymentDueReport().
type DueBookingRow = {
  booking_id: number
  booking_date: string
  created_at: string | null
  client_id: number
  booking_status: string | null
  cancelled_at: string | null
  payment_terms: string
  rate_of_delivery_service: number | null
  amount_paid: number | null
  cost_per_trip: number | null
  downpayment_waived_at: string | null
  downpayment_fixed: number | null
  downpayment_percent: number | null
  place_of_pickup_id: number
  place_of_delivery_id: number
}

export type PaymentDueRow = {
  booking_id: number
  booking_date: string
  created_at: string | null
  client_id: number
  client_name: string
  pickup_place_name: string
  delivery_place_name: string
  booking_status: string | null
  cancelled_at: string | null
  cost_per_trip: number | null
  downpayment_waived_at: string | null
  // Downpayment kept as it was when the booking was repriced after paying it.
  downpayment_fixed: number | null
  downpayment_percent: number | null
  // Average per trip; trip_rates = each live trip's own rate (cargo lines
  // can be priced differently -- the contract / billed amounts add these up).
  rate_per_trip: number | null
  trip_rates: number[]
  total_trips: number
  completed_trips: number
  cancelled_trips: number
  total_contract_value: number
  computed_billable_amount: number
  damage_charges: number
  // The extra charges / discounts one by one, oldest first.
  extra_items: ExtraChargeItem[]
  billable_amount: number
  amount_paid: number
  balance_due: number
  payment_terms: string
  base_date: string | null // latest delivery (Manila date)
  base_date_source: 'actual' | 'none' // 'none' = nothing delivered yet
  // Oldest unpaid part's due date (else the last item's); null = nothing delivered.
  due_date: string | null
  days_until_due: number | null
  // The unpaid parts of the bill, oldest first, and how much is past due.
  open_items: OpenItem[]
  overdue_amount: number
}

// Pass clientId to scope the report to one client's own bookings
// (the client portal); omit it for the admin view across all clients.
// includeSettled keeps the fully delivered + fully paid bookings too
// (the Statement of Account needs every booking, not just open ones).
// bookingId narrows it to one booking (the Billing page).
export async function loadPaymentDueReport(
  clientId?: number,
  options?: { includeSettled?: boolean; bookingId?: number },
): Promise<{ rows: PaymentDueRow[]; error: string | null }> {
  // Cancelled bookings stay in: they still owe for trips delivered before
  // the cancellation. Ones with nothing delivered owe 0 and drop off at the
  // filter at the bottom.
  // fetchAll / fetchIn below: every page (Supabase stops at 1000 rows) and
  // ids in chunks (one long id list makes the request URL too big).
  const { rows: bookingRows, error: bookingError } = await fetchAll<DueBookingRow>((from, to) => {
    let query = supabase
      .from('bookings')
      .select(
        'booking_id, booking_date, created_at, client_id, booking_status, cancelled_at, payment_terms, rate_of_delivery_service, amount_paid, cost_per_trip, downpayment_waived_at, downpayment_fixed, downpayment_percent, place_of_pickup_id, place_of_delivery_id',
      )
      .order('booking_id', { ascending: true })
    if (clientId !== undefined) query = query.eq('client_id', clientId)
    if (options?.bookingId !== undefined) query = query.eq('booking_id', options.bookingId)
    return query.range(from, to)
  })

  if (bookingError) {
    return { rows: [], error: bookingError }
  }
  if (bookingRows.length === 0) {
    return { rows: [], error: null }
  }

  const clientIds = Array.from(new Set(bookingRows.map((b) => b.client_id)))
  const placeIds = Array.from(
    new Set(
      bookingRows.flatMap((b) => [
        b.place_of_pickup_id,
        b.place_of_delivery_id,
      ]),
    ),
  )
  const bookingIds = bookingRows.map((b) => b.booking_id)

  const [clientsResult, placesResult, itinerariesResult, extrasResult] =
    await Promise.all([
      fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, from, to) =>
        supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(from, to),
      ),
      fetchIn<{ place_id: number; place_name: string }>(placeIds, (chunk, from, to) =>
        supabase.from('places').select('place_id, place_name').in('place_id', chunk).range(from, to),
      ),
      // Every trip, cancelled ones too (counted separately, never billed).
      fetchIn<{ itinerary_id: number; booking_id: number; itinerary_status: string | null; trip_rate: number | string | null }>(
        bookingIds,
        (chunk, from, to) =>
          supabase
            .from('itineraries')
            .select('itinerary_id, booking_id, itinerary_status, trip_rate')
            .in('booking_id', chunk)
            .range(from, to),
      ),
      loadExtraChargesByBooking(bookingIds),
    ])

  if (clientsResult.error) {
    return { rows: [], error: clientsResult.error }
  }
  if (placesResult.error) {
    return { rows: [], error: placesResult.error }
  }
  if (itinerariesResult.error) {
    return { rows: [], error: itinerariesResult.error }
  }
  if (extrasResult.error) {
    return { rows: [], error: extrasResult.error }
  }

  const deliveredTrips = itinerariesResult.rows.filter((i) => isDelivered(i.itinerary_status))

  // When each trip was marked Delivered on the Dispatch Board (latest row
  // wins), and any price change made after it was delivered.
  const deliveredIds = deliveredTrips.map((i) => i.itinerary_id)
  const [deliveredLogs, priceChanges] = await Promise.all([
    fetchIn<{ itinerary_id: number; status_changed_at: string }>(deliveredIds, (chunk, from, to) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .in('itinerary_id', chunk)
        .eq('new_status', 'Delivered')
        .order('status_changed_at', { ascending: true })
        .order('itinerary_id', { ascending: true })
        .range(from, to),
    ),
    loadTripPriceChanges(deliveredIds),
  ])
  const deliveredLogRows = deliveredLogs.rows
  if (deliveredLogs.error) return { rows: [], error: deliveredLogs.error }
  if (priceChanges.error) return { rows: [], error: priceChanges.error }
  const changesByTrip = new Map<number, typeof priceChanges.rows>()
  for (const c of priceChanges.rows) changesByTrip.set(c.itinerary_id, [...(changesByTrip.get(c.itinerary_id) ?? []), c])

  const clientNameById = new Map(clientsResult.rows.map((c) => [c.client_id, c.client_name]))
  const placeNameById = new Map(placesResult.rows.map((p) => [p.place_id, p.place_name]))
  // Manila date (like Statements/payroll) -- slicing the UTC timestamp put
  // deliveries made 12 MN-8 AM on the day before.
  const deliveredOnByTrip = new Map(
    deliveredLogRows.map((r) => [r.itinerary_id, toManilaDate(r.status_changed_at)]),
  )

  const balances = bookingBalances(bookingRows, itinerariesResult.rows, extrasResult.byBooking)
  const bookingById = new Map(bookingRows.map((b) => [b.booking_id, b]))

  // Billed items per booking: each delivered trip at its ORIGINAL price on
  // its delivery date (a trip with no Delivered log -- shouldn't happen -- on
  // the booking date), each later price change on the day it was made, each
  // extra charge on its own date. Discounts (negative) are left to the
  // balance; openDueItems uses them up like a payment.
  const itemsByBooking = new Map<number, BilledItem[]>()
  const lastDeliveryByBooking = new Map<number, string>()
  for (const trip of deliveredTrips) {
    const deliveredOn = deliveredOnByTrip.get(trip.itinerary_id)
    if (deliveredOn && deliveredOn > (lastDeliveryByBooking.get(trip.booking_id) ?? '')) {
      lastDeliveryByBooking.set(trip.booking_id, deliveredOn)
    }
    const booking = bookingById.get(trip.booking_id)
    if (!booking) continue
    const fallback = booking.rate_of_delivery_service ?? 0
    const list = itemsByBooking.get(trip.booking_id) ?? []
    const changes = changesByTrip.get(trip.itinerary_id) ?? []
    list.push({
      date: deliveredOn ?? booking.booking_date,
      amount: originalRate(Number(trip.trip_rate ?? fallback), changes),
    })
    for (const c of changes) list.push({ date: c.date, amount: c.new_rate - c.old_rate })
    itemsByBooking.set(trip.booking_id, list)
  }
  for (const [bookingId, items] of extrasResult.items) {
    const list = itemsByBooking.get(bookingId) ?? []
    items.forEach((i) => list.push({ date: i.date, amount: i.amount }))
    itemsByBooking.set(bookingId, list)
  }

  const today = toManilaDate(new Date())

  const rows: PaymentDueRow[] = bookingRows
    .map((booking) => {
      const balance = balances.get(booking.booking_id)!
      const termDays = PAYMENT_TERM_DAYS[booking.payment_terms] ?? 0
      const items = itemsByBooking.get(booking.booking_id) ?? []
      const baseDate = lastDeliveryByBooking.get(booking.booking_id) ?? null
      const open = openDueItems(items, balance.billable_amount, balance.amount_paid, termDays)
      const dueDate = bookingDueDate(items, open, termDays)

      return {
        booking_id: booking.booking_id,
        booking_date: booking.booking_date,
        created_at: booking.created_at,
        client_id: booking.client_id,
        client_name: clientNameById.get(booking.client_id) ?? '—',
        pickup_place_name: placeNameById.get(booking.place_of_pickup_id) ?? '—',
        delivery_place_name: placeNameById.get(booking.place_of_delivery_id) ?? '—',
        booking_status: booking.booking_status,
        cancelled_at: booking.cancelled_at,
        cost_per_trip: booking.cost_per_trip,
        downpayment_waived_at: booking.downpayment_waived_at,
        downpayment_fixed: booking.downpayment_fixed === null ? null : Number(booking.downpayment_fixed),
        downpayment_percent: booking.downpayment_percent === null ? null : Number(booking.downpayment_percent),
        rate_per_trip: booking.rate_of_delivery_service,
        trip_rates: balance.trip_rates,
        total_trips: balance.total_trips,
        completed_trips: balance.completed_trips,
        cancelled_trips: balance.cancelled_trips,
        total_contract_value: balance.total_contract_value,
        computed_billable_amount: balance.computed_billable_amount,
        damage_charges: balance.damage_charges,
        extra_items: extrasResult.items.get(booking.booking_id) ?? [],
        billable_amount: balance.billable_amount,
        amount_paid: balance.amount_paid,
        balance_due: balance.balance_due,
        payment_terms: booking.payment_terms,
        base_date: baseDate,
        base_date_source: baseDate ? 'actual' : 'none',
        due_date: dueDate,
        days_until_due: dueDate ? daysBetween(today, dueDate) : null,
        open_items: open,
        overdue_amount: overdueAmount(open, today),
      } satisfies PaymentDueRow
    })
    // Drop bookings that are fully delivered AND fully settled -- there's
    // nothing left to track. Anything else stays, including bookings with
    // nothing delivered yet (no due date) and partially-paid ones.
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
  // No due date = nothing delivered yet; the countdown starts at delivery.
  if (days === null) {
    return { label: 'Starts when delivered', tone: 'unknown' }
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
