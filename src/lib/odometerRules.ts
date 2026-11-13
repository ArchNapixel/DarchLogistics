// odometerRules: how a delivered trip's km are worked out for the truck's
// odometer (which PMS counts on). Pure -- self-check:
//   node scripts/check-odometer-rules.ts
//
// Every truck is based at Brgy. J.P. Laurel, Panabo City. A trip adds
// drive out + the trip itself + drive back:
//  - Drive out starts at base, unless the truck's previous counted trip
//    didn't go home (its drive back was 0) -- then it starts from that
//    trip's delivery spot.
//  - Drive back to base is counted unless the truck has another trip
//    starting within HOME_GAP_HOURS of this delivery (it goes straight on).

export const HOME_GAP_HOURS = 12

// Did the truck go home after a delivery? Not if an open trip of the same
// truck starts within HOME_GAP_HOURS (a start already in the past counts --
// that trip is waiting for this truck).
export function goesHome(deliveredMs: number, otherTripStartsMs: number[]): boolean {
  const limit = deliveredMs + HOME_GAP_HOURS * 3_600_000
  return !otherTripStartsMs.some((start) => start <= limit)
}

const round2 = (km: number) => Math.round(km * 100) / 100

// The three legs to save, from the routed distances (null = couldn't be
// routed). Drive out not routed -> 0, left out rather than guessed. Drive
// back not routed -> same as the trip (same road back).
export function tripLegs({
  outKm,
  tripKm,
  backKm,
  home,
}: {
  outKm: number | null
  tripKm: number
  backKm: number | null
  home: boolean
}): { out: number; trip: number; back: number; total: number; notes: string[] } {
  const notes: string[] = []
  const out = outKm ?? 0
  if (outKm === null) notes.push("Drive out couldn't be routed, not counted")
  let back = 0
  if (!home) notes.push(`Next trip within ${HOME_GAP_HOURS} h, no drive back`)
  else if (backKm === null) {
    back = tripKm
    notes.push("Drive back couldn't be routed, same as trip")
  } else back = backKm
  const legs = { out: round2(out), trip: round2(tripKm), back: round2(back) }
  return { ...legs, total: round2(legs.out + legs.trip + legs.back), notes }
}

export type DeliveredTrip = { itinerary_id: number; plate_number: string; delivered_at: string }
export type LogEntryKey = { plate_number: string; source: string; itinerary_id: number | null; recorded_at: string }

// Delivered trips whose km aren't on the odometer yet, oldest first (the
// order they must be counted in). A trip delivered before the truck's
// latest real reading (starting reading, typed reading, work order) is
// already inside that reading, so it isn't listed.
export function uncountedTrips(trips: DeliveredTrip[], log: LogEntryKey[]): DeliveredTrip[] {
  const counted = new Set(log.filter((e) => e.source === 'trip').map((e) => e.itinerary_id))
  const lastReal = new Map<string, string>()
  for (const e of log) {
    if (e.source === 'trip') continue
    const prev = lastReal.get(e.plate_number)
    if (!prev || e.recorded_at > prev) lastReal.set(e.plate_number, e.recorded_at)
  }
  return trips
    .filter((t) => {
      const real = lastReal.get(t.plate_number)
      // No log at all for this truck = nothing to count from yet.
      return real !== undefined && !counted.has(t.itinerary_id) && Date.parse(t.delivered_at) > Date.parse(real)
    })
    .sort((a, b) => Date.parse(a.delivered_at) - Date.parse(b.delivered_at) || a.itinerary_id - b.itinerary_id)
}
