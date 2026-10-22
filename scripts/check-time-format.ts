// Self-check for the 12-hour time helpers in src/lib/format.ts -- run with:
//   node scripts/check-time-format.ts
// Prints "ok" or throws on the first wrong value.
import assert from 'node:assert/strict'
import {
  formatClock,
  formatMinutesOfDay,
  formatSlot,
  formatTime,
  manilaTimestamp,
  splitManila,
} from '../src/lib/format.ts'

// Noon / midnight words, whole hours without ":00".
assert.equal(formatClock(12, 0), '12 NN')
assert.equal(formatClock(0, 0), '12 MN')
assert.equal(formatClock(6, 0), '6 AM')
assert.equal(formatClock(17, 30), '5:30 PM')
assert.equal(formatClock(12, 30), '12:30 PM')
assert.equal(formatClock(0, 5), '12:05 AM')
assert.equal(formatClock(23, 0), '11 PM')

// app_settings minutes after midnight.
assert.equal(formatMinutesOfDay(360), '6 AM')
assert.equal(formatMinutesOfDay(720), '12 NN')
assert.equal(formatMinutesOfDay(0), '12 MN')

// Manila date + minutes -> +08:00 timestamp, and back.
const start = manilaTimestamp('2026-10-22', 360)
assert.equal(start, '2026-10-22T06:00:00+08:00')
assert.equal(formatTime(start), '6 AM')
assert.deepEqual(splitManila(start), { date: '2026-10-22', minutes: 360 })
assert.deepEqual(splitManila('2026-10-21T22:30:00Z'), { date: '2026-10-22', minutes: 390 })

// Same-day slot shows one date; crossing midnight shows both.
assert.equal(formatSlot(start, '2026-10-22T12:00:00+08:00'), 'Oct 22, 2026, 6 AM – 12 NN')
assert.equal(
  formatSlot('2026-10-22T22:00:00+08:00', '2026-10-23T04:00:00+08:00'),
  'Oct 22, 2026, 10 PM – Oct 23, 2026, 4 AM',
)
// A UTC timestamp is shown in Manila time (UTC 22:00 = Manila 6 AM next day).
assert.equal(formatSlot('2026-10-21T22:00:00Z', null), 'Oct 22, 2026, 6 AM')
assert.equal(formatSlot(null, null), 'No start time')

console.log('ok')
