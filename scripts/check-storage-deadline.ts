// Self-check for src/lib/storageDeadline.ts -- run with:
//   node scripts/check-storage-deadline.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { storageDeadlineEnd, storageState } from '../src/lib/storageDeadline.ts'

// 11:59:59.999 PM Manila on Oct 25 = 15:59:59.999 UTC.
assert.equal(new Date(storageDeadlineEnd('2026-10-25')).toISOString(), '2026-10-25T15:59:59.999Z')

const at = (iso: string) => Date.parse(iso)
const base = { deadline: '2026-10-25', pickedUpAt: null }

// No deadline / cancelled: nothing to show.
assert.equal(storageState({ ...base, deadline: null, status: 'Awaiting', now: at('2026-10-25T00:00:00Z') }), null)
assert.equal(storageState({ ...base, status: 'Cancelled', now: at('2026-10-26T00:00:00Z') }), null)

// Not picked up: pending until 11:59 PM Manila, missed after.
assert.equal(storageState({ ...base, status: 'Dispatched', now: at('2026-10-25T15:59:00Z') }), 'pending')
assert.equal(storageState({ ...base, status: 'Awaiting', now: at('2026-10-25T16:00:00Z') }), 'missed')

// Picked up: judged by the logged pickup time, not by "now".
assert.equal(
  storageState({ ...base, status: 'InTransit', pickedUpAt: '2026-10-25T15:30:00Z', now: at('2026-10-27T00:00:00Z') }),
  'met',
)
assert.equal(
  storageState({ ...base, status: 'Delivered', pickedUpAt: '2026-10-25T16:30:00Z', now: at('2026-10-27T00:00:00Z') }),
  'late',
)
// Picked up but no logged time: can't judge.
assert.equal(storageState({ ...base, status: 'PickedUp', now: at('2026-10-27T00:00:00Z') }), null)

console.log('ok')
