// Self-check for src/lib/offerTiming.ts -- run with:
//   node scripts/check-offer-timing.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { offerTiming } from '../src/lib/offerTiming.ts'

// Pickup today or later -> open.
assert.equal(offerTiming('2026-10-25', '2026-10-24', 3), 'open')
assert.equal(offerTiming('2026-10-24', '2026-10-24', 3), 'open')
// Day after the pickup date up to 3 days later -> pickup passed, can't accept.
assert.equal(offerTiming('2026-10-24', '2026-10-25', 3), 'pickup-passed')
assert.equal(offerTiming('2026-10-24', '2026-10-27', 3), 'pickup-passed')
// More than 3 days after -> expired.
assert.equal(offerTiming('2026-10-24', '2026-10-28', 3), 'expired')
// Month and year ends.
assert.equal(offerTiming('2026-10-30', '2026-11-02', 3), 'pickup-passed')
assert.equal(offerTiming('2026-10-30', '2026-11-03', 3), 'expired')
assert.equal(offerTiming('2026-12-30', '2027-01-02', 3), 'pickup-passed')
// No pickup date -> never stale.
assert.equal(offerTiming(null, '2026-10-24', 3), 'open')

// A longer expiry from Settings: 5 days after a Oct 24 pickup is still 'pickup-passed' on Oct 29.
assert.equal(offerTiming('2026-10-24', '2026-10-29', 5), 'pickup-passed')
assert.equal(offerTiming('2026-10-24', '2026-10-30', 5), 'expired')

console.log('ok')
