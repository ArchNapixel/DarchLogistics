// fleetMatch: "Fleet Match" -- which truck / trailer to put on a trip, as
// plain functions (no Supabase) so the Dispatch Board and the self-check
// (scripts/check-fleet-match.ts) use the same logic. Mirrors how drivers are
// suggested (lib/tripSchedule.ts rankCandidates).
//
// A vehicle can't take the trip (Unavailable, with the reason) when it is
// Under Maintenance / Out of Service, is in the shop (a work order In
// Progress / On Hold), has a Created / Scheduled work order scheduled on a
// day of the trip, or is on another trip whose slot overlaps (back to back is fine; a trip on the
// road stays busy until delivered). Trailers of the wrong type are left out
// entirely (the cargo decides Flatbed / Skeletal -- a container may also use
// the other of the two, see trailerRules.ts).
//
// Free vehicles are ranked:
//   1. already on this booking (so one rig stays with the booking),
//   2. no service coming up during the trip (a pending maintenance schedule
//      or next service date then) and no work order waiting to start (Created
//      / Scheduled with no date or another date) -- moved down and labelled,
//      not blocked,
//   3. idle longest since their last trip (never used first).
import { tripsClash, type ScheduledTrip } from './tripSchedule.ts'
import { substituteNote, trailerAllowed, trailerRank } from './trailerRules.ts'

export type VehicleCandidate = {
  id: string
  label: string
  current_status: string | null
  // Trailers only.
  trailer_type?: string | null
  // Its work orders that aren't Completed / Cancelled.
  workOrders: { status: string; scheduledDate: string | null }[]
  // Service due dates (YYYY-MM-DD): pending maintenance schedules, next service date.
  serviceDue: string[]
}

export type RankedVehicle = VehicleCandidate & {
  // Why it can't take this trip, or null when free.
  blockedBy: string | null
  // "service due Oct 26" -- shown, but still pickable.
  note: string | null
  // Already on another trip of the same booking.
  sameBooking: boolean
  // When its last trip ended (ms), for "idle longest".
  lastEnd: number | null
  // "Skeletal instead of the Flatbed asked for", or null.
  substitute: string | null
}

// cargo_type decides whether the other trailer type may stand in (trailerRules.ts).
export type MatchTrip = ScheduledTrip & { required_trailer_type?: string | null; cargo_type?: string | null }

// Work order statuses that mean the vehicle is in the shop right now.
const SHOP_STATUSES = ['In Progress', 'On Hold']

const MANILA_OFFSET_MS = 8 * 3_600_000
const manilaDate = (ms: number) => new Date(ms + MANILA_OFFSET_MS).toISOString().slice(0, 10)

export function rankVehicles(
  trip: MatchTrip,
  candidates: VehicleCandidate[],
  // That vehicle's trips (any status; this trip is skipped).
  tripsOf: (vehicleId: string) => ScheduledTrip[],
  now: number,
  // "6 AM – 11 AM" for the "on trip #X, …" label.
  describeSlot: (trip: ScheduledTrip) => string,
  // Turns a due date into "Oct 26".
  describeDate: (date: string) => string = (d) => d,
): RankedVehicle[] {
  const tripFrom = trip.trip_start_at ? manilaDate(Date.parse(trip.trip_start_at)) : null
  const tripTo = trip.trip_end_at ? manilaDate(Date.parse(trip.trip_end_at)) : tripFrom
  return candidates
    .filter((v) => trailerAllowed(trip.cargo_type, trip.required_trailer_type, v.trailer_type))
    .map((v) => {
      const theirs = tripsOf(v.id).filter((t) => t.itinerary_id !== trip.itinerary_id)
      const clash = theirs.find((t) => tripsClash(trip, t, now))
      const inShop = v.workOrders.some((w) => SHOP_STATUSES.includes(w.status))
      const onTripDay = (d: string | null) => !!d && !!tripFrom && !!tripTo && d >= tripFrom && d <= tripTo
      const scheduledThen = v.workOrders.find((w) => !SHOP_STATUSES.includes(w.status) && onTripDay(w.scheduledDate))
      const blockedBy =
        v.current_status === 'Under Maintenance' || v.current_status === 'Out of Service'
          ? v.current_status
          : inShop
            ? 'in the shop (work order)'
            : scheduledThen
              ? `work order scheduled ${describeDate(scheduledThen.scheduledDate!)}`
              : clash
                ? `on trip #${clash.itinerary_id}, ${describeSlot(clash)}`
                : null
      const due = tripFrom && tripTo ? v.serviceDue.filter((d) => d >= tripFrom && d <= tripTo).sort()[0] : undefined
      const pendingWorkOrder = v.workOrders.length > 0
      const ends = theirs
        .filter((t) => t.trip_end_at && t.status !== 'Cancelled' && Date.parse(t.trip_end_at) <= now)
        .map((t) => Date.parse(t.trip_end_at!))
      return {
        ...v,
        blockedBy,
        note: due ? `service due ${describeDate(due)}` : pendingWorkOrder ? 'work order pending' : null,
        // Set when a container rides the other trailer type than the one asked for.
        substitute: substituteNote(trip.required_trailer_type, v.trailer_type),
        sameBooking: theirs.some((t) => t.booking_id === trip.booking_id && t.status !== 'Cancelled'),
        lastEnd: ends.length ? Math.max(...ends) : null,
      }
    })
    .sort((a, b) => {
      if ((a.blockedBy === null) !== (b.blockedBy === null)) return a.blockedBy === null ? -1 : 1
      if (a.sameBooking !== b.sameBooking) return a.sameBooking ? -1 : 1
      if ((a.note === null) !== (b.note === null)) return a.note === null ? -1 : 1
      // A container goes on a Skeletal before a Flatbed (keeps Flatbeds for loose cargo).
      const byType = trailerRank(trip.cargo_type, a.trailer_type) - trailerRank(trip.cargo_type, b.trailer_type)
      if (byType !== 0) return byType
      return (a.lastEnd ?? -Infinity) - (b.lastEnd ?? -Infinity)
    })
}

// The earliest start (ms) from `from` at which some vehicle could take a
// trip of this length, trying every 30 minutes for up to `days` days --
// for "Move to earliest free time". null = none in that window.
export function earliestFreeStart(
  trip: MatchTrip,
  candidates: VehicleCandidate[],
  tripsOf: (vehicleId: string) => ScheduledTrip[],
  now: number,
  from: number,
  days = 14,
): number | null {
  if (!trip.trip_start_at || !trip.trip_end_at) return null
  const length = Date.parse(trip.trip_end_at) - Date.parse(trip.trip_start_at)
  const step = 30 * 60_000
  for (let start = Math.ceil(from / step) * step; start <= from + days * 86_400_000; start += step) {
    const moved = { ...trip, trip_start_at: new Date(start).toISOString(), trip_end_at: new Date(start + length).toISOString() }
    if (rankVehicles(moved, candidates, tripsOf, now, () => '').some((v) => v.blockedBy === null)) return start
  }
  return null
}
