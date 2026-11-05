// payslipPeriod: which delivered trips a payslip run pays. Pure functions --
// lib/payslip.ts reads a week's data once for everybody and these pick out
// each driver's trips. Self-check: node scripts/check-payslip-period.ts

// date = the log's Manila date (YYYY-MM-DD). Logs must come oldest first.
export type DeliveryLog = { itinerary_id: number; date: string }

// itinerary id -> delivery date, for trips delivered inside the period. A
// trip's delivery date is its LATEST Delivered log (it may have cycled
// through Delivered more than once), so one re-delivered after the period
// is left out.
export function deliveryDatesInPeriod(logs: DeliveryLog[], periodStart: string, periodEnd: string) {
  const latest = new Map<number, string>()
  for (const log of logs) latest.set(log.itinerary_id, log.date)
  for (const [id, date] of latest) {
    if (date < periodStart || date > periodEnd) latest.delete(id)
  }
  return latest
}

export const tripKey = (employeeId: number, itineraryId: number) => `${employeeId}|${itineraryId}`

// This employee's trips: they're on its crew and it isn't on any of THEIR
// payslips yet. "Already paid" is per employee, never per trip -- another
// person being paid for a trip must not stop this one being paid for it.
export function tripsToPay<T extends { itinerary_id: number }>(
  employeeId: number,
  trips: T[],
  crew: Set<string>,
  alreadyPaid: Set<string>,
): T[] {
  return trips.filter((trip) => {
    const key = tripKey(employeeId, trip.itinerary_id)
    return crew.has(key) && !alreadyPaid.has(key)
  })
}
