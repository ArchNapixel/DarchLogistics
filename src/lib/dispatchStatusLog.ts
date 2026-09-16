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
  const { data: rows, error } = await supabase
    .from('dispatch_status_logs')
    .select('log_id, itinerary_id, previous_status, new_status, changed_by, status_changed_at')
    .order('status_changed_at', { ascending: false })

  if (error) {
    return { entries: [], error: error.message }
  }
  if (rows.length === 0) {
    return { entries: [], error: null }
  }

  const employeeIds = Array.from(new Set(rows.map((r) => r.changed_by)))
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
      changed_by_name: employeeNameById.get(row.changed_by) ?? `Employee #${row.changed_by}`,
      changed_at: row.status_changed_at,
    })),
    error: null,
  }
}
