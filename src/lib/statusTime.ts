// statusTime: the "When did it happen?" time on a trip's status change. Dispatch
// can pick the real time when they log a move late (a driver called in after
// the fact), instead of the moment they clicked. That time is saved as the
// dispatch_status_logs row's status_changed_at -- the Delivered row's time is
// the delivery date for payroll and Payments Due, and what the later trips
// re-time from.
import { supabase } from './supabaseClient'

// 5-minute steps, matching the time pickers (TimeInput12).
const STEP_MS = 5 * 60_000

// "Now", rounded down to the picker's 5 minutes (never in the future).
export const nowRounded = () => Math.floor(Date.now() / STEP_MS) * STEP_MS

// When the trip last changed status, or null if it never has.
export async function loadLastStatusTime(itineraryId: number): Promise<number | null> {
  const { data } = await supabase
    .from('dispatch_status_logs')
    .select('status_changed_at')
    .eq('itinerary_id', itineraryId)
    .order('status_changed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.status_changed_at ? new Date(data.status_changed_at).getTime() : null
}

// Why `at` can't be used, or null. Not in the future, and not before the
// trip's previous status change (the log must stay in order).
export function statusTimeError(at: number, lastChange: number | null, now = Date.now()): string | null {
  if (at > now + 60_000) return "That time is in the future."
  if (lastChange !== null && at < lastChange - 60_000) {
    const when = new Date(lastChange).toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    return `That is before the trip's last status change (${when}).`
  }
  return null
}
