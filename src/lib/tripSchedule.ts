// tripSchedule: the rules for drivers'/helpers' trip time slots, as plain
// functions (no Supabase) so the Dispatch Board, Driver Schedule page and
// the self-check (scripts/check-trip-schedule.ts) all use the same logic.
//
// The database enforces the same overlap rule (crew_slot_conflict(),
// itinerary_crews_check_slot trigger) -- this file is what the screens
// use to grey out busy people, flag late trips and suggest who to pick.
//
// A trip's slot is trip_start_at -> trip_end_at. A trip already on the
// road (past Awaiting, not Delivered) keeps its crew busy until "now"
// even after its end time -- they're still out there. Delivered/Cancelled
// trips and trips with no start time never block anyone.

export type ScheduledTrip = {
  itinerary_id: number
  booking_id: number
  status: string
  trip_start_at: string | null
  trip_end_at: string | null
}

const DONE = ['Delivered', 'Cancelled']
const HOUR_MS = 3_600_000

const ms = (value: string) => new Date(value).getTime()

// When the trip's crew is free again (ms), or null if it doesn't block.
export function busyUntil(trip: ScheduledTrip, now: number): number | null {
  if (DONE.includes(trip.status) || !trip.trip_start_at || !trip.trip_end_at) return null
  const end = ms(trip.trip_end_at)
  return trip.status !== 'Awaiting' ? Math.max(end, now) : end
}

// Do two trips' slots overlap? Back-to-back (one ends 12 NN, the next
// starts 12 NN) is fine.
export function tripsClash(a: ScheduledTrip, b: ScheduledTrip, now: number): boolean {
  if (a.itinerary_id === b.itinerary_id) return false
  const aEnd = busyUntil(a, now)
  const bEnd = busyUntil(b, now)
  if (aEnd === null || bEnd === null) return false
  return ms(a.trip_start_at!) < bEnd && ms(b.trip_start_at!) < aEnd
}

// The first of `theirTrips` (one person's other active trips) that
// clashes with `trip`, or null when they're free for it.
export function findClash(
  trip: ScheduledTrip,
  theirTrips: ScheduledTrip[],
  now: number,
): ScheduledTrip | null {
  return theirTrips.find((other) => tripsClash(trip, other, now)) ?? null
}

// Statuses of a trip that is out on the road.
const ON_ROAD = ['Dispatched', 'PickedUp', 'InTransit']

// Is the trip physically out RIGHT NOW (Dispatch Board's Resources panel)?
// Picked Up / In Transit always are. Dispatched only means "told to go": it
// counts once its slot has started, so a trip dispatched early for a later
// day doesn't mark its truck and crew busy today.
export function isOutNow(trip: { status: string; trip_start_at: string | null }, now: number): boolean {
  if (trip.status === 'PickedUp' || trip.status === 'InTransit') return true
  return trip.status === 'Dispatched' && (!trip.trip_start_at || ms(trip.trip_start_at) <= now)
}

// Someone (driver or helper) can't start another trip while one of theirs is
// still on the road. Given one person's OTHER trips, returns the one they
// are on, or null when they're free to start. The database enforces the same
// rule (trigger require_crew_free_of_road) -- this is for greying things out.
export function tripOnRoad<T extends { itinerary_id: number; status: string }>(
  theirOtherTrips: T[],
  tripId: number,
): T | null {
  return theirOtherTrips.find((t) => t.itinerary_id !== tripId && ON_ROAD.includes(t.status)) ?? null
}

// Past its end time and still not Delivered/Cancelled.
export function isOverdue(trip: ScheduledTrip, now: number): boolean {
  return !DONE.includes(trip.status) && !!trip.trip_end_at && ms(trip.trip_end_at) < now
}

// For one person's trips: an earlier trip that is running late into
// `trip` (still not done, and busy past `trip`'s start). Used to flag
// "Juan's trip #57 is running late -- reassign?" on the later trip.
export function lateEarlierTrip(
  trip: ScheduledTrip,
  theirTrips: ScheduledTrip[],
  now: number,
): ScheduledTrip | null {
  if (DONE.includes(trip.status) || !trip.trip_start_at) return null
  const start = ms(trip.trip_start_at)
  return (
    theirTrips.find((other) => {
      if (other.itinerary_id === trip.itinerary_id || !other.trip_start_at) return false
      const until = busyUntil(other, now)
      return until !== null && ms(other.trip_start_at) < start && until > start && isOverdue(other, now)
    }) ?? null
  )
}

// Sunday 00:00 -> next Sunday 00:00 (Manila) around `at`, in ms -- the
// same Sun–Sat week payroll and attendance use.
export function manilaWeek(at: number): { from: number; to: number } {
  const MANILA_OFFSET = 8 * HOUR_MS
  const local = new Date(at + MANILA_OFFSET) // read with getUTC* = Manila wall clock
  const sundayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - local.getUTCDay())
  const from = sundayLocal - MANILA_OFFSET
  return { from, to: from + 7 * 24 * HOUR_MS }
}

export type Candidate = { employee_id: number; full_name: string }

export type RankedCandidate = Candidate & {
  // Why they can't take it ("busy … (trip #57)" / "on leave …"), or null if free.
  blockedBy: string | null
  // When their last trip ended (ms), for the "most rested" tie-break.
  lastEnd: number | null
}

// Ranks people for a trip: free ones first, then whoever finished their
// last trip longest ago (never-worked first). The
// caller decides what "blocked" means beyond clashes (e.g. leave) via
// `extraBlock`. `tripsOf(id)` = that person's other trips (any status).
export function rankCandidates(
  trip: ScheduledTrip,
  candidates: Candidate[],
  tripsOf: (employeeId: number) => ScheduledTrip[],
  now: number,
  describeClash: (clash: ScheduledTrip) => string,
  extraBlock: (employeeId: number) => string | null = () => null,
): RankedCandidate[] {
  return candidates
    .map((c) => {
      const theirs = tripsOf(c.employee_id).filter((t) => t.itinerary_id !== trip.itinerary_id)
      const clash = findClash(trip, theirs, now)
      const ends = theirs
        .filter((t) => t.trip_end_at && t.status !== 'Cancelled' && ms(t.trip_end_at) <= now)
        .map((t) => ms(t.trip_end_at!))
      return {
        ...c,
        blockedBy: clash ? describeClash(clash) : extraBlock(c.employee_id),
        lastEnd: ends.length ? Math.max(...ends) : null,
      }
    })
    .sort((a, b) => {
      if ((a.blockedBy === null) !== (b.blockedBy === null)) return a.blockedBy === null ? -1 : 1
      // Never worked / finished longest ago first.
      return (a.lastEnd ?? -Infinity) - (b.lastEnd ?? -Infinity)
    })
}

// How many of the free, top-ranked people to show as "Suggested".
export const SUGGESTED_COUNT = 3

// A booking's trips run one after another: trip 2 starts the moment trip
// 1 ends, and so on (no gap, no night cut-off). Given the first trip's
// start and each trip's length (ms), returns every trip's slot (ms).
export function chainSlots(firstStart: number, lengths: number[]): { start: number; end: number }[] {
  const slots: { start: number; end: number }[] = []
  let start = firstStart
  for (const length of lengths) {
    slots.push({ start, end: start + length })
    start += length
  }
  return slots
}

// One trip still to start, for flowAfterDelivery.
export type FlowTrip = {
  itinerary_id: number
  booking_id: number
  // Its planned slot (ms).
  start: number
  end: number
  // The earliest it may start: its booking's pickup date (ms, Manila midnight).
  notBefore: number
  // true = one of the delivering driver's trips; false = another crew's trip
  // on a booking that is affected, which only follows its booking's previous trip.
  mine: boolean
}

// A driver delivers a trip at `deliveredAt` and is free from then. Works out
// the new slot of every trip that still has to start (the driver's own, across
// all bookings, plus the later trips of the same bookings):
//   - the driver's next trip starts right then -- if its pickup date has
//     arrived and its booking's previous trip is done. A trip that can't start
//     yet is skipped (it keeps its planned time) and the next one that can goes
//     first;
//   - a trip that runs into a skipped trip pushes it later; a late delivery
//     pushes everything after it;
//   - a booking's trips stay back to back, each keeping its own length.
// Returns the slot of each trip by id (unchanged ones included).
export function flowAfterDelivery(
  deliveredAt: number,
  deliveredBooking: number,
  trips: FlowTrip[],
  // When each booking's earlier trips (done or on the road) are over, for bookings other than the delivered one.
  bookingFloor: Map<number, number> = new Map(),
): Map<number, { start: number; end: number }> {
  const out = new Map<number, { start: number; end: number }>()
  const bookingFree = new Map<number, number>([...bookingFloor, [deliveredBooking, deliveredAt]])
  let driverFree = deliveredAt
  const remaining = [...trips].sort((a, b) => a.start - b.start || a.itinerary_id - b.itinerary_id)
  const floorOf = (t: FlowTrip) => Math.max(t.notBefore, bookingFree.get(t.booking_id) ?? -Infinity)
  // Where a trip would start if it can't go right now.
  const startOf = (t: FlowTrip) =>
    t.mine ? Math.max(driverFree, t.start, floorOf(t)) : bookingFree.has(t.booking_id) ? floorOf(t) : t.start

  while (remaining.length > 0) {
    // A booking's trips go in order: not before its earlier ones.
    const ready = remaining.filter((t) => !remaining.some((o) => o !== t && o.booking_id === t.booking_id && remaining.indexOf(o) < remaining.indexOf(t)))
    const now = ready.find((t) => t.mine && floorOf(t) <= driverFree)
    const pick = now ?? ready.reduce((best, t) => (startOf(t) < startOf(best) ? t : best))
    const start = now ? driverFree : startOf(pick)
    const end = start + (pick.end - pick.start)
    out.set(pick.itinerary_id, { start, end })
    bookingFree.set(pick.booking_id, end)
    if (pick.mine) driverFree = end
    remaining.splice(remaining.indexOf(pick), 1)
  }
  return out
}

// Whole hours the last trip ends after the delivery-by date (end of that day), or 0.
export function hoursLate(lastEnd: number, deadlineEnd: number | null): number {
  return deadlineEnd !== null && lastEnd > deadlineEnd ? Math.ceil((lastEnd - deadlineEnd) / HOUR_MS) : 0
}
