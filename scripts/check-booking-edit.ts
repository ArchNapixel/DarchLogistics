// Self-check for src/lib/bookingEdit.ts -- run with:
//   node scripts/check-booking-edit.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import {
  clientMessage,
  datesError,
  distanceError,
  distanceJumped,
  hoursError,
  priceError,
  priceLockReason,
  readOnlyReason,
} from '../src/lib/bookingEdit.ts'

const money = (paid: number) => ({ contract: 20000, delivered: 10000, extras: 500, paid })

// Read-only: cancelled, or all completed and fully paid.
assert.ok(readOnlyReason('Cancelled', ['Cancelled'], money(0)))
assert.ok(readOnlyReason('Delivered', ['Delivered', 'ContainerReturned', 'Cancelled'], { ...money(10500), contract: 10000 }))
assert.equal(readOnlyReason('Delivered', ['Delivered', 'Delivered'], { ...money(9000), contract: 10000 }), null) // still owes
assert.equal(readOnlyReason('InProgress', ['Delivered', 'Awaiting'], money(10500)), null) // trips to come

// Price locks.
assert.equal(priceLockReason('Awaiting', money(0)), null)
assert.equal(priceLockReason('Delivered', money(5000)), null) // delivered but not all paid
assert.equal(priceLockReason('Delivered', money(10500)), 'Delivered and paid')
assert.equal(priceLockReason('Awaiting', money(10500)), null) // a trip to come stays editable
assert.equal(priceLockReason('Awaiting', money(20500)), 'Fully paid') // whole contract paid
assert.equal(priceLockReason('Cancelled', money(0)), 'Cancelled')

// Inputs.
assert.equal(priceError('5500'), null)
assert.equal(priceError('5500.50'), null)
assert.ok(priceError('5,500'))
assert.ok(priceError('0'))
assert.ok(priceError('1.234'))
assert.equal(distanceError('67.5'), null)
assert.ok(distanceError('0'))
assert.ok(distanceError('6000'))
assert.equal(hoursError('6'), null)
assert.ok(hoursError('80'))
assert.equal(datesError('2026-11-20', ''), null)
assert.ok(datesError('2026-11-20', '2026-11-19'))

// Distance jump: 50% more and 20 km more.
assert.equal(distanceJumped(40, 70), true)
assert.equal(distanceJumped(40, 55), false) // under 50% more
assert.equal(distanceJumped(10, 25), false) // 150% more but only 15 km
assert.equal(distanceJumped(null, 70), false)

// Client message.
assert.equal(clientMessage(12, []), '')
assert.equal(clientMessage(12, ['a', 'b']), 'Booking #12 was updated: a; b.')
assert.equal(clientMessage(12, ['a', 'b', 'c', 'd', 'e']), 'Booking #12 was updated: a; b; c; d; and 1 more change.')

console.log('ok')
