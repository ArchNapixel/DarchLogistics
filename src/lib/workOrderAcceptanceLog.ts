// workOrderAcceptanceLog: an immutable audit trail of every time a
// mechanic accepted a work order from the Task Board
// (employee/TaskBoard.tsx). Separate from work_orders.assigned_mechanic_id
// (which only holds the CURRENT assignment) -- this keeps every accept
// event, in case the same work order is ever accepted, reassigned, and
// accepted again.
import { supabase } from './supabaseClient'

export async function logWorkOrderAcceptance({
  workOrderId,
  employeeId,
}: {
  workOrderId: number
  employeeId: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('work_order_acceptance_log').insert({
    work_order_id: workOrderId,
    employee_id: employeeId,
  })

  return { error: error?.message ?? null }
}

export type WorkOrderAcceptanceEntry = {
  log_id: number
  work_order_id: number
  work_order_number: string
  employee_name: string
  accepted_at: string
}

export async function loadWorkOrderAcceptanceLog(): Promise<{
  entries: WorkOrderAcceptanceEntry[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('work_order_acceptance_log')
    .select('log_id, work_order_id, employee_id, accepted_at')
    .order('accepted_at', { ascending: false })

  if (error) {
    return { entries: [], error: error.message }
  }
  if (rows.length === 0) {
    return { entries: [], error: null }
  }

  const workOrderIds = Array.from(new Set(rows.map((row) => row.work_order_id)))
  const employeeIds = Array.from(new Set(rows.map((row) => row.employee_id)))

  const [workOrdersResult, employeesResult] = await Promise.all([
    supabase.from('work_orders').select('work_order_id, work_order_number').in('work_order_id', workOrderIds),
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
  ])

  if (workOrdersResult.error) {
    return { entries: [], error: workOrdersResult.error.message }
  }
  if (employeesResult.error) {
    return { entries: [], error: employeesResult.error.message }
  }

  const numberByWorkOrder = new Map(
    workOrdersResult.data.map((w) => [w.work_order_id, w.work_order_number]),
  )
  const nameByEmployee = new Map(
    employeesResult.data.map((e) => [e.employee_id, e.full_name]),
  )

  return {
    entries: rows.map((row) => ({
      log_id: row.log_id,
      work_order_id: row.work_order_id,
      work_order_number: numberByWorkOrder.get(row.work_order_id) ?? `#${row.work_order_id}`,
      employee_name: nameByEmployee.get(row.employee_id) ?? `Employee #${row.employee_id}`,
      accepted_at: row.accepted_at,
    })),
    error: null,
  }
}
