// markAbsent: "Mark absent today" on the Dispatch Board -- a driver or helper
// who doesn't show up. The database function mark_absent_today (SQL given in
// chat, Admin + Dispatcher only) records an approved one-day Emergency leave
// for today (so the board, Schedule Overview, At-risk and Capacity Check all
// treat them as unavailable without any new rule) and, for helpers and other
// non-drivers, an Unpaid Leave attendance day (drivers are paid per trip, so
// they have no attendance rows).
import { supabase } from './supabaseClient'

export async function markAbsentToday(employeeId: number, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('mark_absent_today', { p_employee_id: employeeId, p_reason: reason.trim() })
  return error?.message ?? null
}
