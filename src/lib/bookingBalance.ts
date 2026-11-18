// bookingBalance: the ONE rule for what a booking is billed, what it still
// owes, and when each part of that falls due. Pure functions (no Supabase),
// self-check: node scripts/check-booking-balance.ts.
//
// Used by Payments Due (lib/paymentDue.ts -- which Bills Receivable,
// Statements, Billing, Financial Summary and the client portal all read),
// Bookings & Trips and Client Booking History, so no two screens can work a
// balance out differently.
//
// Billing rule:
//   contract       = the rates of the booking's live (not cancelled) trips
//   delivered      = the rates of the trips delivered so far
//   billable       = delivered + extra charges (approved client damage +
//                    added charges, lib/bookingCharges.ts)
// There is no "amount to pay" override any more (removed 2026-11-18): a
// price is changed by editing the trip's own rate (Booking Detail -> Edit).
//   balance        = billable - amount paid (negative = paid ahead / refund)
//
// Due dates (2026-11-18): EACH billed item falls due on its own -- a
// delivered trip on its delivery date + the payment terms, an extra charge on
// the day it was added + the terms. Payments pay the OLDEST items first. The
// booking's due date is the due date of the oldest item not fully paid, so a
// later delivery can no longer hide an older unpaid trip.
import { isDelivered } from './tripStatusFlow.ts'
import { sumRates, type TripRateRow } from './lineRates.ts'

const cents = (n: number) => Math.round(n * 100) / 100

// The booking columns the balance needs.
export type BalanceBookingRow = {
  booking_id: number
  rate_of_delivery_service: number | string | null
  amount_paid: number | string | null
}

export type BookingBalance = {
  trip_rates: number[] // each live trip's rate
  total_trips: number // live trips (cancelled left out)
  completed_trips: number // delivered among them
  cancelled_trips: number
  total_contract_value: number
  computed_billable_amount: number // delivered trips' rates
  damage_charges: number // extra charges (client damage + added charges)
  billable_amount: number
  amount_paid: number
  balance_due: number
}

// booking_id -> its balance. `trips` may include cancelled trips (they're
// counted separately); `extras` = net extra charges per booking.
export function bookingBalances(
  bookings: BalanceBookingRow[],
  trips: TripRateRow[],
  extras: Map<number, number>,
): Map<number, BookingBalance> {
  const tripsByBooking = new Map<number, TripRateRow[]>()
  for (const t of trips) tripsByBooking.set(t.booking_id, [...(tripsByBooking.get(t.booking_id) ?? []), t])

  const result = new Map<number, BookingBalance>()
  for (const b of bookings) {
    const own = tripsByBooking.get(b.booking_id) ?? []
    const fallback = b.rate_of_delivery_service === null ? 0 : Number(b.rate_of_delivery_service)
    const live = own.filter((t) => t.itinerary_status !== 'Cancelled')
    const rateOf = (t: TripRateRow) => Number(t.trip_rate ?? fallback)
    const liveRates = live.map(rateOf)
    const deliveredRates = live.filter((t) => isDelivered(t.itinerary_status)).map(rateOf)
    const computed = sumRates(deliveredRates)
    const damage = cents(extras.get(b.booking_id) ?? 0)
    const billable = cents(computed + damage)
    const paid = cents(Number(b.amount_paid ?? 0))
    result.set(b.booking_id, {
      trip_rates: liveRates,
      total_trips: live.length,
      completed_trips: deliveredRates.length,
      cancelled_trips: own.length - live.length,
      total_contract_value: sumRates(liveRates),
      computed_billable_amount: computed,
      damage_charges: damage,
      billable_amount: billable,
      amount_paid: paid,
      balance_due: cents(billable - paid),
    })
  }
  return result
}

// ---- Due dates ----

export const PAYMENT_TERM_DAYS: Record<string, number> = {
  Cash: 0,
  '7Days': 7,
  '14Days': 14,
  '30Days': 30,
}

// Done in UTC on purpose: a local-midnight Date shifts a day in Manila.
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

// Whole days from `today` to `dateStr` (both YYYY-MM-DD); negative = past.
export function daysBetween(today: string, dateStr: string): number {
  const ms = (d: string) => {
    const [y, m, day] = d.split('-').map(Number)
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((ms(dateStr) - ms(today)) / 86400000)
}

// Something billed on a date (a delivered trip, a charge).
export type BilledItem = { date: string; amount: number }

// The unpaid part of one billed item and when it falls due (null = nothing
// delivered yet).
export type OpenItem = { amount: number; due_date: string | null }

// The parts of the bill still unpaid, oldest first. Payments pay the oldest
// items first.
// The open amounts always add up to max(billable - paid, 0).
export function openDueItems(items: BilledItem[], billable: number, paid: number, termDays: number): OpenItem[] {
  const billed = items.filter((i) => i.amount > 0).sort((a, b) => a.date.localeCompare(b.date))
  const itemsTotal = cents(billed.reduce((s, i) => s + i.amount, 0))
  const list: { date: string | null; amount: number }[] = billed.map((i) => ({ date: i.date, amount: i.amount }))
  // Billed more than the items (shouldn't happen now there's no override):
  // the rest is dated the last item, or undated when nothing was delivered.
  if (billable > itemsTotal) list.push({ date: billed.at(-1)?.date ?? null, amount: cents(billable - itemsTotal) })
  let credit = cents(paid + Math.max(itemsTotal - billable, 0))
  const open: OpenItem[] = []
  for (const item of list) {
    const covered = Math.min(Math.max(credit, 0), item.amount)
    credit = cents(credit - covered)
    const left = cents(item.amount - covered)
    if (left > 0) open.push({ amount: left, due_date: item.date === null ? null : addDays(item.date, termDays) })
  }
  return open
}

// The booking's due date: the oldest open item's, else (nothing owed) the
// last item's -- so a settled bill still shows when it was due.
export function bookingDueDate(items: BilledItem[], open: OpenItem[], termDays: number): string | null {
  if (open.length > 0) return open[0].due_date
  const dates = items.filter((i) => i.amount > 0).map((i) => i.date).sort()
  return dates.length > 0 ? addDays(dates[dates.length - 1], termDays) : null
}

// Amount of `open` already past due on `today` (YYYY-MM-DD).
export function overdueAmount(open: OpenItem[], today: string): number {
  return cents(open.filter((i) => i.due_date !== null && i.due_date < today).reduce((s, i) => s + i.amount, 0))
}

// A delivered trip repriced later (lib/tripPriceChanges.ts): its price when it
// was delivered = today's price minus every change since.
export function originalRate(currentRate: number, changes: { old_rate: number; new_rate: number }[]): number {
  return cents(currentRate - changes.reduce((s, c) => s + (c.new_rate - c.old_rate), 0))
}
