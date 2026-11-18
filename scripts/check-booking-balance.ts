// Self-check for src/lib/bookingBalance.ts -- run with:
//   node scripts/check-booking-balance.ts
// Prints "ok" or throws on the first wrong number.
import assert from 'node:assert/strict'
import {
  addDays,
  bookingBalances,
  bookingDueDate,
  daysBetween,
  openDueItems,
  originalRate,
  overdueAmount,
} from '../src/lib/bookingBalance.ts'

// ---- bookingBalances ----
const balances = bookingBalances(
  [
    { booking_id: 1, rate_of_delivery_service: 5000, amount_paid: 3000 },
    { booking_id: 2, rate_of_delivery_service: 6000, amount_paid: 0 },
  ],
  [
    { booking_id: 1, itinerary_status: 'Delivered', trip_rate: 5000 },
    { booking_id: 1, itinerary_status: 'ContainerReturned', trip_rate: null }, // no own rate -> booking's
    { booking_id: 1, itinerary_status: 'Awaiting', trip_rate: 7000 },
    { booking_id: 2, itinerary_status: 'Delivered', trip_rate: null },
    { booking_id: 2, itinerary_status: 'Cancelled', trip_rate: null },
  ],
  new Map([[1, 500]]),
)
const b1 = balances.get(1)!
assert.equal(b1.total_trips, 3)
assert.equal(b1.completed_trips, 2)
assert.equal(b1.cancelled_trips, 0)
assert.equal(b1.total_contract_value, 17000)
assert.equal(b1.computed_billable_amount, 10000)
assert.equal(b1.billable_amount, 10500) // + 500 extra charges
assert.equal(b1.balance_due, 7500)
const b2 = balances.get(2)!
assert.equal(b2.cancelled_trips, 1)
assert.equal(b2.billable_amount, 6000) // only the delivered trip; the cancelled one isn't billed

// ---- dates ----
assert.equal(addDays('2026-11-28', 7), '2026-12-05')
assert.equal(daysBetween('2026-11-18', '2026-11-15'), -3)
assert.equal(daysBetween('2026-11-18', '2026-11-18'), 0)

// ---- openDueItems: oldest unpaid trip decides ----
// Cash terms. Trip 1 delivered Nov 1 (unpaid), trip 2 delivered Nov 15.
const trips = [
  { date: '2026-11-15', amount: 5000 },
  { date: '2026-11-01', amount: 5000 },
]
let open = openDueItems(trips, 10000, 0, 0)
assert.deepEqual(open, [
  { amount: 5000, due_date: '2026-11-01' },
  { amount: 5000, due_date: '2026-11-15' },
])
// The newer delivery no longer hides the old unpaid one.
assert.equal(bookingDueDate(trips, open, 0), '2026-11-01')
assert.equal(overdueAmount(open, '2026-11-10'), 5000)

// A payment pays the oldest first.
open = openDueItems(trips, 10000, 6000, 7)
assert.deepEqual(open, [{ amount: 4000, due_date: '2026-11-22' }])
assert.equal(bookingDueDate(trips, open, 7), '2026-11-22')

// Paid in full -> nothing open; the due date is the last item's.
open = openDueItems(trips, 10000, 10000, 7)
assert.deepEqual(open, [])
assert.equal(bookingDueDate(trips, open, 7), '2026-11-22')

// Paid ahead (more than billed) -> nothing open.
assert.deepEqual(openDueItems(trips, 10000, 15000, 0), [])

// Billed less than the items (defensive) is used up like a payment, oldest first.
open = openDueItems(trips, 9000, 0, 0)
assert.deepEqual(open, [
  { amount: 4000, due_date: '2026-11-01' },
  { amount: 5000, due_date: '2026-11-15' },
])

// Billed more than the items (defensive -- nothing does this now): the extra
// is dated the last delivery; with nothing delivered it has no due date.
open = openDueItems([{ date: '2026-11-01', amount: 5000 }], 20000, 0, 0)
assert.deepEqual(open, [
  { amount: 5000, due_date: '2026-11-01' },
  { amount: 15000, due_date: '2026-11-01' },
])
open = openDueItems([], 20000, 0, 0)
assert.deepEqual(open, [{ amount: 20000, due_date: null }])
assert.equal(overdueAmount(open, '2026-12-01'), 0)

// Negative items are ignored as items.
assert.deepEqual(openDueItems([{ date: '2026-11-01', amount: 5000 }, { date: '2026-11-02', amount: -1000 }], 4000, 0, 0), [
  { amount: 4000, due_date: '2026-11-01' },
])

// The open parts always add up to the balance.
for (const [billable, paid] of [[10000, 2500], [10000, 0], [8000, 1234.56]]) {
  const sum = openDueItems(trips, billable, paid, 14).reduce((s, i) => s + i.amount, 0)
  assert.equal(Math.round(sum * 100) / 100, Math.max(Math.round((billable - paid) * 100) / 100, 0))
}

// A delivered trip repriced twice: delivered at 5,000, then 6,000, then 5,500.
assert.equal(originalRate(5500, [{ old_rate: 5000, new_rate: 6000 }, { old_rate: 6000, new_rate: 5500 }]), 5000)
assert.equal(originalRate(5000, []), 5000)

console.log('ok')
