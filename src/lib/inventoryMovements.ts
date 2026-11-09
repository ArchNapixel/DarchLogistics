// inventoryMovements: reads for the Inventory page -- open batches (what's
// on the shelf, at which price, oldest first) and one item's stock history.
// Nothing here writes: stock only changes through the DB functions
// (receive_stock, adjust_stock, set_item_price, log_part_used, ...).
import { supabase } from './supabaseClient'
import { fetchAll } from './dashboardExpenses'

export type OpenLot = {
  lot_id: number
  item_id: number
  received_at: string
  unit_cost: number | null
  qty_remaining: number
}

// Every batch with stock left, oldest first (the order parts are used in).
export async function loadOpenLots(): Promise<{ lots: OpenLot[]; error: string | null }> {
  const result = await fetchAll<OpenLot>((from, to) =>
    supabase
      .from('inventory_lots')
      .select('lot_id, item_id, received_at, unit_cost, qty_remaining')
      .gt('qty_remaining', 0)
      .order('received_at', { ascending: true })
      .order('lot_id', { ascending: true })
      .range(from, to),
  )
  return {
    lots: result.rows.map((l) => ({
      ...l,
      unit_cost: l.unit_cost === null ? null : Number(l.unit_cost),
      qty_remaining: Number(l.qty_remaining),
    })),
    error: result.error,
  }
}

export const MOVEMENT_LABELS: Record<string, string> = {
  opening: 'Opening stock',
  receive: 'Received',
  use: 'Used',
  return: 'Returned',
  adjust: 'Adjusted',
  write_off: 'Written off',
  count: 'Stock count',
}

export type StockMove = {
  movement_id: number
  created_at: string
  reason: string
  qty_change: number
  unit_cost: number | null
  note: string | null
  work_order_id: number | null
  work_order_number: string | null
  // the work order is closed (on a completion, or a cancelled job's write-off)
  // -- the Maintenance page shows it under "Completed & cancelled"
  work_order_closed: boolean
  by: string
}

// One item's stock history, newest first. `more` = there are older rows.
export async function loadStockHistory(
  itemId: number,
  limit: number,
): Promise<{ moves: StockMove[]; more: boolean; error: string | null }> {
  const { data: rows, error } = await supabase
    .from('inventory_movements')
    .select('movement_id, created_at, reason, qty_change, unit_cost, note, work_order_id, completion_id, employee_id')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .order('movement_id', { ascending: false })
    .limit(limit + 1)

  if (error) return { moves: [], more: false, error: error.message }

  const shown = rows.slice(0, limit)
  const orderIds = [...new Set(shown.map((r) => r.work_order_id).filter((id): id is number => id !== null))]
  const employeeIds = [...new Set(shown.map((r) => r.employee_id).filter((id): id is number => id !== null))]

  const [orders, employees] = await Promise.all([
    orderIds.length
      ? supabase.from('work_orders').select('work_order_id, work_order_number').in('work_order_id', orderIds)
      : Promise.resolve({ data: [] as { work_order_id: number; work_order_number: string }[], error: null }),
    employeeIds.length
      ? supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds)
      : Promise.resolve({ data: [] as { employee_id: number; full_name: string }[], error: null }),
  ])
  if (orders.error) return { moves: [], more: false, error: orders.error.message }
  if (employees.error) return { moves: [], more: false, error: employees.error.message }

  const numberById = new Map((orders.data ?? []).map((o) => [o.work_order_id, o.work_order_number]))
  const nameById = new Map((employees.data ?? []).map((e) => [e.employee_id, e.full_name]))

  return {
    moves: shown.map((r) => ({
      movement_id: r.movement_id,
      created_at: r.created_at,
      reason: r.reason,
      qty_change: Number(r.qty_change),
      unit_cost: r.unit_cost === null ? null : Number(r.unit_cost),
      note: r.note,
      work_order_id: r.work_order_id,
      work_order_number: r.work_order_id !== null ? (numberById.get(r.work_order_id) ?? `#${r.work_order_id}`) : null,
      work_order_closed: r.completion_id !== null || r.reason === 'write_off',
      // employee_id is null for an Admin login with no linked employee row
      by: r.employee_id !== null ? (nameById.get(r.employee_id) ?? `Employee #${r.employee_id}`) : 'Admin',
    })),
    more: rows.length > limit,
    error: null,
  }
}
