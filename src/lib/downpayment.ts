// downpayment: how much a client must pay before ANY trip of their booking
// may leave Awaiting (#10/#11). Same formula as the database function
// booking_downpayment() that the require_downpayment trigger uses --
// change both together.
//
//   cost     = cost_per_trip x trips (diesel + driver commission + per-trip
//              fee, saved on the booking at approval)
//   contract = the sum of the trips' rates (rate x trips when all the same)
//   downpayment = cost + P% x (contract - cost)
//
// P = bookings.downpayment_percent, saved on the booking when it's created
// (from Settings -> downpayment_percent), so changing the setting only
// affects new bookings. Quotes (no booking yet) use the current setting.
//
// Cancelled trips don't count. A booking with no saved cost_per_trip (made
// before this existed) has no downpayment requirement (null). Once paid --
// or waived by an Admin -- all the booking's trips can go. The payment
// terms then apply to what's left after delivery, as before.
//
// Repriced after it was paid (2026-11-18): the downpayment stays what it
// was (bookings.downpayment_fixed, saved by update_booking_details) -- the
// new prices only change the balance. booking_downpayment() in SQL returns
// the fixed amount too.

// When a booking has no saved % (or Settings has no row) -- same as the SQL coalesce.
export const DEFAULT_DOWNPAYMENT_PERCENT = 25
// Number(): a numeric column can arrive as text.
const share = (percent: number | null) => (percent == null ? DEFAULT_DOWNPAYMENT_PERCENT : Number(percent)) / 100

// Rounds to centavos the way Postgres round(x, 2) does (half up on the exact
// decimal). A plain Math.round(n * 100) rounds â‚±34,565.325 DOWN (the float is
// 34565.32499...) while the DB trigger asks for .33 -- the client then pays a
// centavo short and no trip can start. toPrecision(12) drops that float noise.
const cents = (n: number) => Math.round(Number((n * 100).toPrecision(12))) / 100

// `contract` = the sum of the trips' own rates (they can differ per cargo line).
export function downpaymentForContract(
  contract: number | null,
  costPerTrip: number | null,
  trips: number,
  percent: number | null,
): number | null {
  if (costPerTrip === null || contract === null) return null
  const cost = costPerTrip * trips
  const remaining = Math.max(contract - cost, 0)
  return cents(cost + share(percent) * remaining)
}

// Every trip at the same rate.
export function downpaymentFor(
  ratePerTrip: number | null,
  costPerTrip: number | null,
  trips: number,
  percent: number | null,
): number | null {
  return downpaymentForContract(ratePerTrip === null ? null : ratePerTrip * trips, costPerTrip, trips, percent)
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
  // bookings.downpayment_fixed: kept as it was when repriced after paying it.
  fixed?: number | null
  // bookings.downpayment_percent (null = DEFAULT_DOWNPAYMENT_PERCENT).
  percent: number | null
}): DownpaymentStatus | null {
  const required =
    args.fixed !== undefined && args.fixed !== null
      ? Number(args.fixed)
      : downpaymentForContract(args.contract, args.costPerTrip, args.trips, args.percent)
  if (required === null) return null
  const paid = args.amountPaid ?? 0
  const missing = cents(Math.max(required - paid, 0))
  return { required, paid, missing, met: missing === 0, waived: args.waivedAt !== null }
}

// Can this booking's trips leave Awaiting?
export const tripsMayStart = (s: DownpaymentStatus | null) => s === null || s.met || s.waived
