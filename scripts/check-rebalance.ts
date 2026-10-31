// Self-check for src/lib/rebalance.ts -- run with:
//   node scripts/check-rebalance.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { planRebalance, type RebalanceTrip } from '../src/lib/rebalance.ts'

const trip = (id: number, driverId: number | null, earn: number, movable = true, week = 1): RebalanceTrip => ({ id, driverId, earn, week, movable })
const anyone = () => true

// Driver 1 has 4 x 100, driver 2 has nothing: two trips move, 200 each.
const moves = planRebalance([trip(1, 1, 100), trip(2, 1, 100), trip(3, 1, 100), trip(4, 1, 100)], [1, 2], anyone)
assert.equal(moves.length, 2)
assert.ok(moves.every((m) => m.from === 1 && m.to === 2))

// Already even: nothing moves.
assert.deepEqual(planRebalance([trip(1, 1, 100), trip(2, 2, 100)], [1, 2], anyone), [])

// Started / delivered trips never move.
assert.deepEqual(planRebalance([trip(1, 1, 100, false), trip(2, 1, 100, false)], [1, 2], anyone), [])

// canTake = false (busy / on leave) blocks the move.
assert.deepEqual(planRebalance([trip(1, 1, 100), trip(2, 1, 100)], [1, 2], () => false), [])

// A trip bigger than the gap would only flip the imbalance -- left alone.
assert.deepEqual(planRebalance([trip(1, 1, 100)], [1, 2], anyone), [])

// Weeks are balanced separately: week 2's trips don't count toward week 1.
const two = planRebalance([trip(1, 1, 50, true, 1), trip(2, 1, 50, true, 1), trip(3, 2, 500, false, 2)], [1, 2], anyone)
assert.equal(two.length, 1)

console.log('ok')
