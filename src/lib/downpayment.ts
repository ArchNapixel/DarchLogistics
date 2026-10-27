// downpayment: how much a client must pay before ANY trip of their booking
// may leave Awaiting (#10/#11). Same formula as the database function
// booking_downpayment() that the require_downpayment trigger uses --
// change both together.
//
//   cost     = cost_per_trip x trips (diesel + driver commission + per-trip
//              fee, saved on the booking at approval)
//   contract = the sum of the trips' rates (rate x trips when all the same)
//   downpayment = cost + 25% x (contract - cost)
//
// Cancelled trips don't count. A booking with no saved cost_per_trip (made
// before this existed) has no downpayment requirement (null). Once paid --
// or waived by an Admin -- all the booking's trips can go. The payment
// terms then apply to what's left after delivery, as before.

export const DOWNPAYMENT_SHARE_OF_REMAINING = 0.25

const cents = (n: number) => Math.round(n * 100) / 100

// `contract` = the sum of the trips' own rates (they can differ per cargo line).
export function downpaymentForContract(
  contract: number | null,
  costPerTrip: number | null,
  trips: number,
): number | null {
  if (costPerTrip === null || contract === null) return null
  const cost = costPerTrip * trips
  const remaining = Math.max(contract - cost, 0)
  return cents(cost + DOWNPAYMENT_SHARE_OF_REMAINING * remaining)
}

// Every trip at the same rate.
export function downpaymentFor(
  ratePerTrip: number | null,
  costPerTrip: number | null,
  trips: number,
): number | null {
  return downpaymentForContract(ratePerTrip === null ? null : ratePerTrip * trips, costPerTrip, trips)
}

export type DownpaymentStatus = {
  required: number
  paid: number
  // Still to pay before trips can start (0 once met).
  missing: number
  met: boolean
  waived: boolean
}

// null = this booking has no downpayment requirement.
// `contract` = the sum of the live (not cancelled) trips' own rates; `trips`
// = how many live trips there are (cost_per_trip x trips).
export function downpaymentStatus(args: {
  contract: number | null
  costPerTrip: number | null
  trips: number
  amountPaid: number | null
  waivedAt: string | null
}): DownpaymentStatus | null {
  const required = downpaymentForContract(args.contract, args.costPerTrip, args.trips)
  if (required === null) return null
  const paid = args.amountPaid ?? 0
  const missing = cents(Math.max(required - paid, 0))
  return { required, paid, missing, met: missing === 0, waived: args.waivedAt !== null }
}

// Can this booking's trips leave Awaiting?
export const tripsMayStart = (s: DownpaymentStatus | null) => s === null || s.met || s.waived
