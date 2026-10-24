// offerTiming: when an offer we sent (quote status Offered) goes stale, as a
// plain function so staff screens, the client card, Capacity Check and the
// self-check (scripts/check-offer-timing.ts) agree. Offers have no stored
// expiry -- it is worked out from the pickup date and today (Manila dates).
//
//   open           the pickup date is today or later: the client can accept
//   pickup-passed  the pickup date is over: accepting would create trips in
//                  the past, so the client has to counter with a new date
//                  (the database refuses an accept too)
//   expired        3 days after the pickup date: the offer is dead -- shown
//                  "Expired" to staff, no longer holds capacity; staff
//                  withdraw it and send a new one
//
// An offer with no pickup date is always open.

export const OFFER_EXPIRY_DAYS = 3

export type OfferTiming = 'open' | 'pickup-passed' | 'expired'

// YYYY-MM-DD + n days (calendar math, no time zones involved).
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function offerTiming(pickupDate: string | null, today: string): OfferTiming {
  if (!pickupDate || pickupDate >= today) return 'open'
  return today > addDays(pickupDate, OFFER_EXPIRY_DAYS) ? 'expired' : 'pickup-passed'
}
