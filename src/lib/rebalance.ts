// planRebalance: evens out what drivers earn in a week by moving trips that
// haven't started from the busiest-paid driver to the least-paid one.
// Pure -- the Dispatch Board supplies `canTake` (overlap / leave / licence
// rules) and applies the moves after staff confirm. Self-check:
//   node scripts/check-rebalance.ts

export type RebalanceTrip = {
  id: number
  driverId: number | null
  // What the trip pays its driver (commission + per-trip fee).
  earn: number
  // Sun-Sat week key; trips are only balanced within their own week.
  week: number
  // Awaiting trips only -- anything started or delivered stays put.
  movable: boolean
}

export type RebalanceMove = { tripId: number; from: number; to: number; earn: number }

// canTake(tripId, driverId, owners): can this driver take the trip, given who
// owns every trip right now (owners: tripId -> driverId)?
export function planRebalance(
  trips: RebalanceTrip[],
  driverIds: number[],
  canTake: (tripId: number, driverId: number, owners: Map<number, number | null>) => boolean,
): RebalanceMove[] {
  const owner = new Map(trips.map((t) => [t.id, t.driverId]))
  const original = new Map(owner)
  const lastHop = new Map<number, number>()
  let hop = 0

  for (const week of new Set(trips.map((t) => t.week))) {
    const inWeek = trips.filter((t) => t.week === week)
    // Every move shrinks the sum of squared totals, so this ends; the cap is a safety net.
    for (let i = 0; i < 200; i++) {
      const total = new Map(driverIds.map((d) => [d, 0]))
      for (const t of inWeek) {
        const d = owner.get(t.id)
        if (d != null && total.has(d)) total.set(d, total.get(d)! + t.earn)
      }
      const order = [...total].sort((a, b) => b[1] - a[1])
      let found: { id: number; to: number } | null = null
      search: for (const [from, hi] of order) {
        for (const [to, lo] of [...order].reverse()) {
          const gap = hi - lo
          if (from === to || gap <= 0) continue
          // A trip that pays less than the gap always narrows it; the one
          // closest to half the gap narrows it most.
          const best = inWeek
            .filter((t) => t.movable && owner.get(t.id) === from && t.earn > 0 && t.earn < gap && canTake(t.id, to, owner))
            .sort((a, b) => Math.abs(a.earn - gap / 2) - Math.abs(b.earn - gap / 2))[0]
          if (best) {
            found = { id: best.id, to }
            break search
          }
        }
      }
      if (!found) break
      owner.set(found.id, found.to)
      lastHop.set(found.id, hop++)
    }
  }

  // A trip that hopped twice is one move from where it started; keep the
  // order they were found in so each is still valid when applied.
  return [...lastHop]
    .sort((a, b) => a[1] - b[1])
    .flatMap(([id]) => {
      const from = original.get(id) ?? null
      const to = owner.get(id) ?? null
      const t = trips.find((x) => x.id === id)!
      return from !== null && to !== null && from !== to ? [{ tripId: id, from, to, earn: t.earn }] : []
    })
}
