// offerTiming: when an offer we sent (quote status Offered) goes stale, as a
// plain function so staff screens, the client card, Capacity Check and the
// self-check (scripts/check-offer-timing.ts) agree. Offers have no stored
// expiry -- it is worked out from the pickup date and today (Manila dates).
//
//   open           the pickup date is today or later: the client can accept
//   pickup-passed  the pickup date is over: accepting would create trips in
//                  the past, so the client has to counter with a new date
//                  (the database refuses an accept too)
//   expired        N days after the pickup date (Settings -> offer_expiry_days): the offer is dead -- shown
//                  "Expired" to staff, no longer holds capacity; staff
//                  withdraw it and send a new one
//
// An offer with no pickup date is always open.

// Used until the setting loads, or when its row is missing.
export const DEFAULT_OFFER_EXPIRY_DAYS = 3
export const OFFER_EXPIRY_DEFAULTS = { offer_expiry_days: DEFAULT_OFFER_EXPIRY_DAYS }

export type OfferTiming = 'open' | 'pickup-passed' | 'expired'

// YYYY-MM-DD + n days (calendar math, no time zones involved).
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function offerTiming(pickupDate: string | null, today: string, expiryDays: number): OfferTiming {
  if (!pickupDate || pickupDate >= today) return 'open'
  return today > addDays(pickupDate, expiryDays) ? 'expired' : 'pickup-passed'
}
