// Self-check for src/lib/tripStatusFlow.ts -- run with:
//   node scripts/check-trip-status-flow.ts
import assert from 'node:assert/strict'
import {
  ACTIVE_TRIP_OR,
  FINISHED_IN,
  isCompleted,
  isDelivered,
  isFinished,
  isOnRoad,
  nextStatus,
  statusSteps,
} from '../src/lib/tripStatusFlow.ts'

// A normal trip is unchanged: it ends at Delivered.
assert.deepEqual(statusSteps(false), ['Awaiting', 'Dispatched', 'PickedUp', 'InTransit', 'Delivered'])
assert.equal(nextStatus('InTransit', false), 'Delivered')
assert.equal(nextStatus('Delivered', false), null)

// A container return goes on after Delivered.
assert.equal(nextStatus('Delivered', true), 'Unloading')
assert.equal(nextStatus('Unloading', true), 'ReturningContainer')
assert.equal(nextStatus('ReturningContainer', true), 'ContainerReturned')
assert.equal(nextStatus('ContainerReturned', true), null)
assert.equal(nextStatus('Cancelled', true), null)

// Delivered (billing) includes the return steps.
for (const s of ['Delivered', 'Unloading', 'ReturningContainer', 'ContainerReturned']) assert.equal(isDelivered(s), true, s)
for (const s of ['Awaiting', 'InTransit', 'Cancelled', null]) assert.equal(isDelivered(s), false, String(s))

// The truck is still out while unloading and returning the container.
for (const s of ['Dispatched', 'PickedUp', 'InTransit', 'Unloading', 'ReturningContainer']) assert.equal(isOnRoad(s), true, s)
for (const s of ['Awaiting', 'Delivered', 'ContainerReturned', 'Cancelled']) assert.equal(isOnRoad(s), false, s)

// Finished = Delivered, Container Returned or Cancelled; never on the road too.
for (const s of ['Delivered', 'ContainerReturned', 'Cancelled']) assert.equal(isFinished(s), true, s)
for (const s of ['Awaiting', 'Unloading', 'ReturningContainer', null]) assert.equal(isFinished(s), false, String(s))
assert.equal(isCompleted('Cancelled'), false)
assert.equal(isCompleted('ContainerReturned'), true)

assert.equal(FINISHED_IN, '(Delivered,ContainerReturned,Cancelled)')
assert.equal(ACTIVE_TRIP_OR, 'itinerary_status.is.null,itinerary_status.not.in.(Delivered,ContainerReturned,Cancelled)')

console.log('trip status flow: all checks passed')
