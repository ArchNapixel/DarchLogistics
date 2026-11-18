// clientNotifications: the client portal's bell (components/ClientNotifications.tsx).
// Rows in `client_notifications` are written by update_booking_details()
// when staff change a booking (prices, route, dates, terms) -- mostly agreed
// on a phone call, so the client sees what changed next time they log in.
// Each client reads and marks only their own (RLS).
import { supabase } from './supabaseClient'

export type ClientNotification = {
  notification_id: number
  booking_id: number | null
  message: string
  created_at: string
  read_at: string | null
}

const LIMIT = 20

export async function fetchClientNotifications(clientId: number): Promise<ClientNotification[]> {
  const { data, error } = await supabase
    .from('client_notifications')
    .select('notification_id, booking_id, message, created_at, read_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(LIMIT)
  if (error) throw new Error(error.message)
  return data ?? []
}

// Marks every unread one as read. Returns the error message, or null.
export async function markClientNotificationsRead(clientId: number, readAt: string): Promise<string | null> {
  const { error } = await supabase
    .from('client_notifications')
    .update({ read_at: readAt })
    .eq('client_id', clientId)
    .is('read_at', null)
  return error?.message ?? null
}
