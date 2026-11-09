// partsRequests: "Request this part" -- a mechanic flags an out-of-stock
// item (from the Open Work Order picker), Admin sees it on the Inventory
// page and in the header bell, and restocks it.
// Rules live in the DB (SQL given in chat 2026-11-10):
//   - request_part(): Mechanic / Admin only, one OPEN request per item
//     (a second one says who already asked).
//   - Receiving stock for the item closes its open request automatically
//     (trigger on inventory_movements) -- nobody has to remember to.
//   - close_part_request(): Admin closes one without restocking.
// No direct writes from the app (no insert / update policies).
import { supabase } from './supabaseClient'

export type PartRequest = {
  request_id: number
  item_id: number
  item_name: string
  work_order_id: number | null
  work_order_number: string | null
  requested_by: string
  note: string | null
  created_at: string
}

export async function loadOpenPartRequests(): Promise<{ requests: PartRequest[]; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('parts_requests')
    .select('request_id, item_id, work_order_id, employee_id, note, created_at')
    .eq('status', 'Open')
    .order('created_at', { ascending: true })
  if (error) return { requests: [], error: error.message }
  if (rows.length === 0) return { requests: [], error: null }

  const itemIds = [...new Set(rows.map((r) => r.item_id))]
  const employeeIds = [...new Set(rows.map((r) => r.employee_id))]
  const orderIds = [...new Set(rows.map((r) => r.work_order_id).filter((id): id is number => id !== null))]

  const [items, employees, orders] = await Promise.all([
    supabase.from('inventory_items').select('item_id, name').in('item_id', itemIds),
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
    orderIds.length
      ? supabase.from('work_orders').select('work_order_id, work_order_number').in('work_order_id', orderIds)
      : Promise.resolve({ data: [] as { work_order_id: number; work_order_number: string }[], error: null }),
  ])
  const lookupError = items.error ?? employees.error ?? orders.error
  if (lookupError) return { requests: [], error: lookupError.message }

  const nameById = new Map((items.data ?? []).map((i) => [i.item_id, i.name]))
  const personById = new Map((employees.data ?? []).map((e) => [e.employee_id, e.full_name]))
  const numberById = new Map((orders.data ?? []).map((o) => [o.work_order_id, o.work_order_number]))

  return {
    requests: rows.map((r) => ({
      request_id: r.request_id,
      item_id: r.item_id,
      item_name: nameById.get(r.item_id) ?? `Item #${r.item_id}`,
      work_order_id: r.work_order_id,
      work_order_number: r.work_order_id !== null ? (numberById.get(r.work_order_id) ?? `#${r.work_order_id}`) : null,
      requested_by: personById.get(r.employee_id) ?? `Employee #${r.employee_id}`,
      note: r.note,
      created_at: r.created_at,
    })),
    error: null,
  }
}

export async function requestPart(itemId: number, workOrderId: number | null): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('request_part', { p_item_id: itemId, p_work_order_id: workOrderId })
  return { error: error?.message ?? null }
}

export async function closePartRequest(requestId: number): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('close_part_request', { p_request_id: requestId })
  return { error: error?.message ?? null }
}
