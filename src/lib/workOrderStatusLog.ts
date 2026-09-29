// workOrderStatusLog: shared data access for work_order_status_log --
// every work order status change gets logged here (see MechanicTasks.tsx
// and CompleteWorkOrderModal.tsx), mirroring how dispatch_status_logs
// tracks itinerary status changes.
import { supabase } from './supabaseClient'

export async function logWorkOrderStatusChange({
  workOrderId,
  previousStatus,
  newStatus,
  changedByEmployeeId,
}: {
  workOrderId: number
  previousStatus: string
  newStatus: string
  changedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('work_order_status_log').insert({
    work_order_id: workOrderId,
    previous_status: previousStatus,
    new_status: newStatus,
    changed_by: changedByEmployeeId,
  })

  return { error: error?.message ?? null }
}

export type WorkOrderStatusLogEntry = {
  log_id: number
  work_order_id: number
  work_order_number: string
  previous_status: string
  new_status: string
  changed_by_name: string
  changed_at: string
}

export async function loadWorkOrderStatusLog(): Promise<{
  entries: WorkOrderStatusLogEntry[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('work_order_status_log')
    .select('log_id, work_order_id, previous_status, new_status, changed_by, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return { entries: [], error: error.message }
  }
  if (rows.length === 0) {
    return { entries: [], error: null }
  }

  // changed_by is null when the change was made from a staff login with
  // no linked employees row (see CLAUDE.md) -- skip those in the lookup,
  // since .in() with a null sends the text "null" and Postgres rejects it
  // as an integer.
  const employeeIds = Array.from(
    new Set(
      rows
        .map((r) => r.changed_by as number | null)
        .filter((id): id is number => id !== null),
    ),
  )
  const workOrderIds = Array.from(new Set(rows.map((r) => r.work_order_id)))

  const [employeesResult, workOrdersResult] = await Promise.all([
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
    supabase
      .from('work_orders')
      .select('work_order_id, work_order_number')
      .in('work_order_id', workOrderIds),
  ])

  if (employeesResult.error) {
    return { entries: [], error: employeesResult.error.message }
  }
  if (workOrdersResult.error) {
    return { entries: [], error: workOrdersResult.error.message }
  }

  const employeeNameById = new Map(employeesResult.data.map((e) => [e.employee_id, e.full_name]))
  const workOrderNumberById = new Map(
    workOrdersResult.data.map((w) => [w.work_order_id, w.work_order_number]),
  )

  return {
    entries: rows.map((row) => ({
      log_id: row.log_id,
      work_order_id: row.work_order_id,
      work_order_number: workOrderNumberById.get(row.work_order_id) ?? `#${row.work_order_id}`,
      previous_status: row.previous_status,
      new_status: row.new_status,
      changed_by_name:
        row.changed_by !== null
          ? (employeeNameById.get(row.changed_by) ?? `Employee #${row.changed_by}`)
          : 'Unknown (no linked employee)',
      changed_at: row.created_at,
    })),
    error: null,
  }
}
