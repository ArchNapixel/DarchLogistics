// bookingEdit: the rules for Booking Detail -> Edit (staff, Admin + Dispatcher).
// Pure (self-check: node scripts/check-booking-edit.ts). The database function
// update_booking_details() repeats the locks -- change both together.
//
//   - Read-only: a Cancelled booking, or one whose trips are all completed
//     and fully paid ("closed").
//   - Prices are locked once the whole contract (+ extra charges) is paid,
//     and a delivered trip's price once everything delivered so far is paid.
//   - A downpayment already paid stays what it was (the database keeps it);
//     the new prices only move the balance.
//   - The client is fixed. Crew, trucks and trailers stay on the Dispatch Board.
import { isCompleted, isDelivered } from './tripStatusFlow.ts'

// Booking money right now (lib/bookingBalance.ts figures).
export type EditMoney = {
  contract: number // all live trips' prices
  delivered: number // delivered trips' prices
  extras: number // approved client damage + added charges
  paid: number
}

const EPS = 0.005

export function readOnlyReason(status: string, tripStatuses: string[], money: EditMoney): string | null {
  if (status === 'Cancelled') return "This booking is cancelled, so it can't be edited."
  const live = tripStatuses.filter((s) => s !== 'Cancelled')
  if (live.length > 0 && live.every((s) => isCompleted(s)) && money.paid >= money.delivered + money.extras - EPS) {
    return "This booking is delivered and fully paid, so it can't be edited."
  }
  return null
}

// Why this trip's price can't change, or null.
export function priceLockReason(tripStatus: string, money: EditMoney): string | null {
  if (tripStatus === 'Cancelled') return 'Cancelled'
  if (money.paid >= money.contract + money.extras - EPS) return 'Fully paid'
  if (isDelivered(tripStatus) && money.paid >= money.delivered + money.extras - EPS) return 'Delivered and paid'
  return null
}

// A trip price as typed: error text, or null when fine.
export function priceError(text: string): string | null {
  const t = text.trim()
  if (!t) return 'Enter a price.'
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'Numbers only, at most 2 decimals.'
  const n = Number(t)
  if (!(n > 0)) return 'Must be more than ₱0.'
  if (n > 10_000_000) return 'Too big.'
  return null
}

// Distance as typed (km): error text, or null.
export function distanceError(text: string, label = 'Distance'): string | null {
  const t = text.trim()
  if (!t) return `Enter the ${label.toLowerCase()}.`
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return `${label} must be more than 0 km.`
  if (n > 5000) return `${label} can be 5,000 km at most.`
  return null
}

export function hoursError(text: string): string | null {
  const n = Number(text)
  if (!text.trim() || !Number.isFinite(n) || n <= 0 || n > 72) return 'Hours per trip: more than 0, up to 72.'
  return null
}

export function datesError(pickup: string, deadline: string): string | null {
  if (!pickup) return 'Enter the pickup date.'
  if (deadline && deadline < pickup) return 'The deadline is before the pickup date.'
  return null
}

// "Drastically bigger" distance: at least 50% more AND at least 20 km more.
// The saved cost per trip and downpayment don't change on their own, so
// their boxes get a red outline and a "may need updating" note.
export function distanceJumped(oldKm: number | null, newKm: number | null): boolean {
  if (oldKm === null || newKm === null || !(oldKm > 0)) return false
  return newKm >= oldKm * 1.5 && newKm - oldKm >= 20
}

// What the client's bell says: the booking, then the changes (first 4).
export function clientMessage(bookingId: number, lines: string[]): string {
  if (lines.length === 0) return ''
  const shown = lines.slice(0, 4).join('; ')
  const more = lines.length > 4 ? `; and ${lines.length - 4} more ${lines.length - 4 === 1 ? 'change' : 'changes'}` : ''
  return `Booking #${bookingId} was updated: ${shown}${more}.`
}
