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
