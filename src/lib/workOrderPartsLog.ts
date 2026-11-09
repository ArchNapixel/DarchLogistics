// workOrderPartsLog: lets a mechanic log a part as used WHILE working a
// job (AccessWorkOrderModal.tsx), instead of only being able to record
// parts all at once at the very end (CompleteWorkOrderModal.tsx).
// Deliberately a separate table from work_order_parts_used: that one only
// exists once a work_order_completions row exists. At completion the
// complete_work_order database function copies these rows onto the
// completion (setting their completion_id) without taking stock out again.
//
// Stock changes go through database functions, never a direct write:
// log_part_used takes stock out of the oldest batch first (FIFO) and
// records the log row + stock history in one transaction; a use that
// spans two batches becomes two log rows, each at its batch's real price.
// return_logged_part puts a part back into the batch it came from -- only
// while the job is open and the part isn't on a completion yet.
import { supabase } from './supabaseClient'

export type LoggedPart = {
  log_id: number
  item_id: number
  item_name_text: string
  quantity: number
  unit_cost: number | null
  employee_name: string
  used_at: string
  // set once the part is on a completion record -- can't be returned then
  completion_id: number | null
}

export async function loadWorkOrderPartsLog(workOrderId: number): Promise<{
  parts: LoggedPart[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('work_order_parts_log')
    .select('log_id, item_id, item_name_text, quantity, unit_cost, employee_id, used_at, completion_id')
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
      quantity: Number(row.quantity),
      unit_cost: row.unit_cost,
      employee_name: nameById.get(row.employee_id) ?? `Employee #${row.employee_id}`,
      used_at: row.used_at,
      completion_id: row.completion_id,
    })),
    error: null,
  }
}

export type InventoryItemOption = {
  item_id: number
  name: string
  item_type: string
  unit: string
  quantity: number
}

// Items a mechanic can use up on a job: not archived, and not Tools /
// Equipment (those are counted, not consumed -- the DB refuses them too).
export async function loadInventoryItems(): Promise<{
  items: InventoryItemOption[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('item_id, name, item_type, unit, quantity')
    .is('archived_at', null)
    .not('item_type', 'in', '("Tools","Equipment")')
    .order('name', { ascending: true })

  if (error) {
    return { items: [], error: error.message }
  }

  return { items: data.map((item) => ({ ...item, quantity: Number(item.quantity) })), error: null }
}

// Takes `quantity` of an item out of stock for this work order.
export async function logPartUsed({
  workOrderId,
  itemId,
  quantity,
}: {
  workOrderId: number
  itemId: number
  quantity: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('log_part_used', {
    p_work_order_id: workOrderId,
    p_item_id: itemId,
    p_quantity: quantity,
  })
  return { error: error?.message ?? null }
}

// Undoes one logged part: puts it back on the shelf and removes the log row.
export async function returnPart(part: LoggedPart): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('return_logged_part', { p_log_id: part.log_id })
  return { error: error?.message ?? null }
}
