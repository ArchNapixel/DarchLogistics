// Self-check for src/lib/fleetMatch.ts -- run with:
//   node scripts/check-fleet-match.ts
// Prints "ok" or throws on the first wrong answer.
import assert from 'node:assert/strict'
import { earliestFreeStart, rankVehicles, type MatchTrip, type VehicleCandidate } from '../src/lib/fleetMatch.ts'
import type { ScheduledTrip } from '../src/lib/tripSchedule.ts'

const iso = (s: string) => new Date(s).toISOString()
const now = Date.parse('2026-10-24T09:00:00+08:00')
const trip = (id: number, booking: number, start: string, end: string, status = 'Awaiting'): ScheduledTrip => ({
  itinerary_id: id,
  booking_id: booking,
  status,
  trip_start_at: iso(start),
  trip_end_at: iso(end),
})
const vehicle = (id: string, extra: Partial<VehicleCandidate> = {}): VehicleCandidate => ({
  id,
  label: id,
  current_status: 'Available',
  workOrders: [],
  serviceDue: [],
  ...extra,
})

// Trip #105, Oct 25 6-11 AM, booking 52.
const t105: MatchTrip = { ...trip(105, 52, '2026-10-25T06:00:00+08:00', '2026-10-25T11:00:00+08:00'), required_trailer_type: 'Flatbed' }
const tripsBy: Record<string, ScheduledTrip[]> = {
  // T1 is on booking 52's trip #106 (11 AM-4 PM, back to back) -> continuity.
  T1: [trip(106, 52, '2026-10-25T11:00:00+08:00', '2026-10-25T16:00:00+08:00')],
  // T2 overlaps (booking 53, 6-9 AM) -> unavailable.
  T2: [trip(110, 53, '2026-10-25T06:00:00+08:00', '2026-10-25T09:00:00+08:00')],
  // T3 last worked Oct 20, T4 Oct 22 -> T3 rested longer.
  T3: [trip(90, 40, '2026-10-20T06:00:00+08:00', '2026-10-20T12:00:00+08:00', 'Delivered')],
  T4: [trip(91, 41, '2026-10-22T06:00:00+08:00', '2026-10-22T12:00:00+08:00', 'Delivered')],
}
const of = (id: string) => tripsBy[id] ?? []
const slot = (t: ScheduledTrip) => `${t.trip_start_at}`

const ranked = rankVehicles(
  t105,
  [vehicle('T4'), vehicle('T2'), vehicle('T3'), vehicle('T1'), vehicle('T5', { serviceDue: ['2026-10-25'] }), vehicle('T6', { current_status: 'Under Maintenance' })],
  of,
  now,
  slot,
)
// Same booking first, then idle longest (never used T5 would beat T3, but it
// has service due that day so it drops below the others), blocked last.
assert.deepEqual(ranked.map((v) => v.id), ['T1', 'T3', 'T4', 'T5', 'T2', 'T6'])
assert.equal(ranked[0].sameBooking, true)
assert.equal(ranked[3].note, 'service due 2026-10-25')
assert.equal(ranked[3].blockedBy, null) // labelled, not blocked
assert.ok(ranked[4].blockedBy?.startsWith('on trip #110'))
assert.equal(ranked[5].blockedBy, 'Under Maintenance')

// Work orders: In Progress blocks; Created with a date on the trip blocks;
// Created with no date (MAK 1452's WO-TR3) only moves it down. Wrong
// trailer type is left out entirely.
const trailers = rankVehicles(
  t105,
  [
    vehicle('F1', { trailer_type: 'Flatbed', workOrders: [{ status: 'In Progress', scheduledDate: null }] }),
    vehicle('S1', { trailer_type: 'Skeletal' }),
    vehicle('F2', { trailer_type: 'Flatbed' }),
    vehicle('F3', { trailer_type: 'Flatbed', workOrders: [{ status: 'Created', scheduledDate: null }] }),
    vehicle('F4', { trailer_type: 'Flatbed', workOrders: [{ status: 'Scheduled', scheduledDate: '2026-10-25' }] }),
    vehicle('F5', { trailer_type: 'Flatbed', workOrders: [{ status: 'Created', scheduledDate: '2026-11-02' }] }),
  ],
  () => [],
  now,
  slot,
)
assert.deepEqual(trailers.map((v) => v.id), ['F2', 'F3', 'F5', 'F1', 'F4'])
assert.equal(trailers[1].blockedBy, null)
assert.equal(trailers[1].note, 'work order pending')
assert.equal(trailers[3].blockedBy, 'in the shop (work order)')
assert.equal(trailers[4].blockedBy, 'work order scheduled 2026-10-25')

// Earliest free start: the only truck is on 6-9 AM, so a 5 h trip asked for
// 6 AM can start at 9 AM.
const onlyT2 = [vehicle('T2')]
assert.equal(earliestFreeStart(t105, onlyT2, of, now, Date.parse(t105.trip_start_at!)), Date.parse('2026-10-25T09:00:00+08:00'))
// Nothing ever free -> null.
assert.equal(earliestFreeStart(t105, [vehicle('T6', { current_status: 'Out of Service' })], of, now, Date.parse(t105.trip_start_at!), 1), null)

console.log('ok')
