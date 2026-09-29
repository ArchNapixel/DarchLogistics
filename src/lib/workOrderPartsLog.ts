// workOrderPartsLog: lets a mechanic log a part as used WHILE working a
// job (AccessWorkOrderModal.tsx), immediately decrementing inventory --
// instead of only being able to record parts all at once at the very
// end (CompleteWorkOrderModal.tsx). Deliberately a separate table from
// work_order_parts_used: that one only exists once a
// work_order_completions row exists (i.e. the job is actually marked
// Completed), so there's nothing to attach a mid-job part to yet.
// CompleteWorkOrderModal.tsx reads these back and copies them into
// work_order_parts_used at completion time WITHOUT decrementing stock
// again -- the deduction already happened here.
//
// unit_cost is copied from inventory_items at the moment the part is
// logged, so a later price change never rewrites what this job cost
// (the maintenance cost report sums quantity x unit_cost).
import { supabase } from './supabaseClient'

export type LoggedPart = {
  log_id: number
  item_id: number
  item_name_text: string
  quantity: number
  unit_cost: number | null
  employee_name: string
  used_at: string
}

export async function loadWorkOrderPartsLog(workOrderId: number): Promise<{
  parts: LoggedPart[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('work_order_parts_log')
    .select('log_id, item_id, item_name_text, quantity, unit_cost, employee_id, used_at')
    .eq('work_order_id', workOrderId)
    .order('used_at', { ascending: false })

  if (error) {
    return { parts: [], error: error.message }
  }
  if (rows.length === 0) {
    return { parts: [], error: null }
  }

  const employeeIds = Array.from(new Set(rows.map((r) => r.employee_id)))
  const { data: employees, error: employeesError } = await supabase
    .from('employees')
    .select('employee_id, full_name')
    .in('employee_id', employeeIds)

  if (employeesError) {
    return { parts: [], error: employeesError.message }
  }

  const nameById = new Map(employees.map((e) => [e.employee_id, e.full_name]))

  return {
    parts: rows.map((row) => ({
      log_id: row.log_id,
      item_id: row.item_id,
      item_name_text: row.item_name_text,
      quantity: row.quantity,
      unit_cost: row.unit_cost,
      employee_name: nameById.get(row.employee_id) ?? `Employee #${row.employee_id}`,
      used_at: row.used_at,
    })),
    error: null,
  }
}

export type InventoryItemOption = {
  item_id: number
  name: string
  item_type: string
  quantity: number
}

export async function loadInventoryItems(): Promise<{
  items: InventoryItemOption[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('item_id, name, item_type, quantity')
    .order('name', { ascending: true })

  if (error) {
    return { items: [], error: error.message }
  }

  return { items: data, error: null }
}

// Re-checks stock fresh right before decrementing (same race-guard
// pattern as CompleteWorkOrderModal.tsx), so two mechanics logging the
// same part at once can't push stock negative.
export async function logPartUsed({
  workOrderId,
  itemId,
  itemName,
  quantity,
  employeeId,
}: {
  workOrderId: number
  itemId: number
  itemName: string
  quantity: number
  employeeId: number
}): Promise<{ error: string | null }> {
  const { data: current, error: readError } = await supabase
    .from('inventory_items')
    .select('quantity, unit_cost')
    .eq('item_id', itemId)
    .single()

  if (readError || !current) {
    return { error: readError?.message ?? 'Could not read current stock.' }
  }

  if (current.quantity < quantity) {
    return { error: `Only ${current.quantity} in stock -- not enough for ${quantity}.` }
  }

  const { error: logError } = await supabase.from('work_order_parts_log').insert({
    work_order_id: workOrderId,
    item_id: itemId,
    item_name_text: itemName,
    quantity,
    unit_cost: current.unit_cost,
    employee_id: employeeId,
  })

  if (logError) {
    return { error: logError.message }
  }

  const { error: decrementError } = await supabase
    .from('inventory_items')
    .update({ quantity: current.quantity - quantity })
    .eq('item_id', itemId)

  if (decrementError) {
    return {
      error: `Logged the part, but could not decrement stock (${decrementError.message}). This needs manual review.`,
    }
  }

  return { error: null }
}
