// quoteOffers: the price negotiation on a quote (since 2026-10-23).
// Clients no longer enter a rate. Staff price the quote and send an
// offer; the client accepts it, counters (rate and/or dates) or declines
// with a reason. No expiry, no limit on rounds. All of it goes through
// database functions (SQL given in chat):
//   send_quote_offer       staff: Pending/Countered -> Offered
//   respond_to_quote_offer client (or staff for a phone/walk-in client):
//                          Offered -> Approved (booking created) /
//                          Countered / Declined
//   accept_quote_counter   staff: Countered -> Approved (booking created)
// and every step is kept in quote_rate_offers (read here).
import { supabase } from './supabaseClient'

// quote_requests.request_status, as staff and clients see it.
export const QUOTE_STATUS_LABELS: Record<string, string> = {
  Pending: 'Needs pricing',
  Offered: 'Offer sent',
  Countered: 'Client countered',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Declined: 'Declined by client',
}

// One row of quote_rate_offers.
export type QuoteOfferRow = {
  offer_id: number
  party: 'Business' | 'Client'
  action: 'Offer' | 'Counter' | 'Accept' | 'Decline'
  rate: number | null
  pickup_date: string | null
  deadline_date: string | null
  note: string | null
  entered_by_staff: boolean
  created_at: string
}

// A quote's history, oldest first.
export async function loadQuoteOffers(quoteId: number): Promise<{ rows: QuoteOfferRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('quote_rate_offers')
    .select('offer_id, party, action, rate, pickup_date, deadline_date, note, entered_by_staff, created_at')
    .eq('quote_request_id', quoteId)
    .order('offer_id', { ascending: true })
  return { rows: (data ?? []) as QuoteOfferRow[], error: error?.message ?? null }
}

// A price proposal: our offer or the client's counter (accept/decline
// aren't proposals -- they don't change anything).
export const isProposal = (row: QuoteOfferRow) => row.action === 'Offer' || row.action === 'Counter'

// The proposal made just before rows[index] (any side), for "what changed".
export function previousProposal(rows: QuoteOfferRow[], index: number): QuoteOfferRow | undefined {
  return rows.slice(0, index).reverse().find(isProposal)
}

export type OfferChanges = { rate: boolean; pickup: boolean; deadline: boolean }

// Which terms `current` changed compared with `previous` -- highlighted on
// counter-offers and new offers. Null when there's nothing to compare.
export function offerChanges(
  previous: Pick<QuoteOfferRow, 'rate' | 'pickup_date' | 'deadline_date'> | undefined,
  current: Pick<QuoteOfferRow, 'rate' | 'pickup_date' | 'deadline_date'>,
): OfferChanges | null {
  if (!previous) return null
  return {
    rate: Number(previous.rate ?? 0) !== Number(current.rate ?? 0),
    pickup: (previous.pickup_date ?? null) !== (current.pickup_date ?? null),
    deadline: (previous.deadline_date ?? null) !== (current.deadline_date ?? null),
  }
}

// "We offered" / "Client countered (by phone)" ...
export function offerActionLabel(row: QuoteOfferRow): string {
  const who = row.party === 'Business' ? 'We' : 'Client'
  const verb = { Offer: 'offered', Counter: 'countered', Accept: 'accepted', Decline: 'declined' }[row.action]
  return `${who} ${verb}${row.entered_by_staff ? ' (by phone)' : ''}`
}

// The client's answer to an offer. Accept returns the new booking's id.
export async function respondToQuoteOffer(args: {
  quoteId: number
  action: 'accept' | 'counter' | 'decline'
  rate?: number | null
  pickupDate?: string | null
  deadlineDate?: string | null
  note?: string | null
}): Promise<{ bookingId: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc('respond_to_quote_offer', {
    p_quote_id: args.quoteId,
    p_action: args.action,
    p_rate: args.rate ?? null,
    p_pickup_date: args.pickupDate ?? null,
    p_deadline_date: args.deadlineDate ?? null,
    p_note: args.note ?? null,
  })
  return { bookingId: (data as number | null) ?? null, error: error?.message ?? null }
}
