// dispatchStatusLog: read-only admin view of dispatch_status_logs --
// this table has been written to since itinerary status tracking was
// first built, but never had a SELECT policy, so there was never a way
// to actually look at the history. Fixed alongside adding this viewer.
import { supabase } from './supabaseClient'

export type DispatchStatusLogEntry = {
  log_id: number
  itinerary_id: number
  previous_status: string
  new_status: string
  changed_by_name: string
  changed_at: string
}

export async function loadDispatchStatusLog(): Promise<{
  entries: DispatchStatusLogEntry[]
  error: string | null
}> {
  return loadLogRows(
    supabase
      .from('dispatch_status_logs')
      .select('log_id, itinerary_id, previous_status, new_status, changed_by, status_changed_at')
      .order('status_changed_at', { ascending: false }),
  )
}

// Same data, scoped to one itinerary -- backs the "Logs" popup on each
// Dispatch Board row.
export async function loadDispatchStatusLogForItinerary(itineraryId: number): Promise<{
  entries: DispatchStatusLogEntry[]
  error: string | null
}> {
  return loadLogRows(
    supabase
      .from('dispatch_status_logs')
      .select('log_id, itinerary_id, previous_status, new_status, changed_by, status_changed_at')
      .eq('itinerary_id', itineraryId)
      .order('status_changed_at', { ascending: false }),
  )
}

async function loadLogRows(
  query: PromiseLike<{
    data:
      | {
          log_id: number
          itinerary_id: number
          previous_status: string
          new_status: string
          changed_by: number | null
          status_changed_at: string
        }[]
      | null
    error: { message: string } | null
  }>,
): Promise<{ entries: DispatchStatusLogEntry[]; error: string | null }> {
  const { data: rows, error } = await query

  if (error) {
    return { entries: [], error: error.message }
  }
  if (!rows || rows.length === 0) {
    return { entries: [], error: null }
  }

  // changed_by is null when the change was made from a staff login with
  // no linked employees row (see CLAUDE.md) -- skip those in the lookup,
  // since .in() with a null sends the text "null" and Postgres rejects it
  // as an integer.
  const employeeIds = Array.from(
    new Set(rows.map((r) => r.changed_by).filter((id): id is number => id !== null)),
  )
  const { data: employees, error: employeesError } = await supabase
    .from('employees')
    .select('employee_id, full_name')
    .in('employee_id', employeeIds)

  if (employeesError) {
    return { entries: [], error: employeesError.message }
  }

  const employeeNameById = new Map(employees.map((e) => [e.employee_id, e.full_name]))

  return {
    entries: rows.map((row) => ({
      log_id: row.log_id,
      itinerary_id: row.itinerary_id,
      previous_status: row.previous_status,
      new_status: row.new_status,
      changed_by_name:
        row.changed_by !== null
          ? (employeeNameById.get(row.changed_by) ?? `Employee #${row.changed_by}`)
          : 'Unknown (no linked employee)',
      changed_at: row.status_changed_at,
    })),
    error: null,
  }
}
