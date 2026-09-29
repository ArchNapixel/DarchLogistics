// workOrderStatusLog: shared data access for work_order_status_log --
// every work order status change gets logged here (see MechanicTasks.tsx
// and CompleteWorkOrderModal.tsx), mirroring how dispatch_status_logs
// tracks itinerary status changes.
import { supabase } from './supabaseClient'
import { setVehicleStatus } from './fleetStatus'

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

// A job is "closed" once it's Completed or Cancelled -- its vehicle
// should be free again. Any other status means the vehicle is in the shop.
const CLOSED_STATUSES = ['Completed', 'Cancelled']

// setVehicleStatus (only flips a vehicle still at the expected status)
// lives in fleetStatus.ts -- shared with the Dispatch Board.

// The one place a work order's status gets changed directly (everything
// except "Completed", which goes through CompleteWorkOrderModal.tsx).
// Used by MechanicTasks.tsx, the admin WorkOrderDetailModal.tsx, and
// approving a Status Relog Request. It:
//   1. Updates the status ONLY if it's still `previousStatus` (someone
//      else may have changed it meanwhile), and uses .select() so an RLS
//      silent no-op shows up as an error instead of fake success.
//   2. Logs the change to work_order_status_log (best effort).
//   3. Keeps the vehicle's fleet status in sync: closing a job (Cancelled)
//      frees the vehicle; reopening a closed job puts it back in the shop.
// `statusChanged` tells the caller whether step 1 went through -- an
// error can still come back with statusChanged: true if only step 3 failed.
export async function changeWorkOrderStatus({
  workOrderId,
  plateNumber,
  trailerId,
  previousStatus,
  newStatus,
  changedByEmployeeId,
}: {
  workOrderId: number
  plateNumber: string | null
  trailerId: number | null
  previousStatus: string
  newStatus: string
  changedByEmployeeId: number | null
}): Promise<{ error: string | null; statusChanged: boolean }> {
  const { data: updated, error: updateError } = await supabase
    .from('work_orders')
    .update({ work_order_status: newStatus })
    .eq('work_order_id', workOrderId)
    .eq('work_order_status', previousStatus)
    .select('work_order_id')
    .maybeSingle()

  if (updateError) {
    return { error: updateError.message, statusChanged: false }
  }
  if (!updated) {
    return {
      error: `This work order is no longer "${previousStatus}" -- someone else changed it. Reload the page and try again.`,
      statusChanged: false,
    }
  }

  if (changedByEmployeeId !== null) {
    logWorkOrderStatusChange({ workOrderId, previousStatus, newStatus, changedByEmployeeId })
  }

  const wasClosed = CLOSED_STATUSES.includes(previousStatus)
  const isClosed = CLOSED_STATUSES.includes(newStatus)
  let vehicleError: string | null = null

  if (!wasClosed && isClosed) {
    vehicleError = await setVehicleStatus(plateNumber, trailerId, 'Under Maintenance', 'Available')
  } else if (wasClosed && !isClosed) {
    vehicleError = await setVehicleStatus(plateNumber, trailerId, 'Available', 'Under Maintenance')
  }

  if (vehicleError) {
    return {
      error: `Status changed to ${newStatus}, but the vehicle's fleet status could not be updated (${vehicleError}). Check it on the Fleet page.`,
      statusChanged: true,
    }
  }

  return { error: null, statusChanged: true }
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

export async function loadWorkOrderStatusLog(limit?: number): Promise<{
  entries: WorkOrderStatusLogEntry[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('work_order_status_log')
    .select('log_id, work_order_id, previous_status, new_status, changed_by, created_at')
    .order('created_at', { ascending: false })
    .limit(limit ?? 100000)

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
