// mechanicWorkOrders: the work-order shape, columns, statuses and vehicle
// labels shared by the Mechanic screens (MechanicTasks, TaskBoard, Open Work
// Order) and Admin's WorkOrderDetailModal. Moved out of MechanicTasks.tsx so
// component files only export components (fast refresh).
import { supabase } from './supabaseClient'

export type WorkOrder = {
  work_order_id: number
  work_order_number: string
  plate_number: string | null
  trailer_id: number | null
  vehicle_label: string
  work_order_status: string
  maintenance_type: string
  work_description: string | null
  scheduled_start_date: string | null
}

export const WORK_ORDER_COLUMNS =
  'work_order_id, work_order_number, plate_number, trailer_id, work_order_status, maintenance_type, work_description, scheduled_start_date'

// A free-choice dropdown, not a fixed progression -- the mechanic picks
// whatever status actually applies (including going back to "On Hold"
// or jumping straight to "Cancelled"), rather than being forced through
// one status at a time. "Completed" is kept in this list (other screens
// use it for labels), but the dropdowns leave it out -- completing is
// the separate "Mark Complete" button.
export const ALL_STATUSES = [
  'Created',
  'Scheduled',
  'In Progress',
  'On Hold',
  'Completed',
  'Cancelled',
]

// Adds the "Truck ABC-123" / "Trailer XYZ-789" label -- trailers need a
// lookup, since work_orders only stores trailer_id for them. Also used by
// TaskBoard.tsx.
export async function withVehicleLabels(
  rows: Omit<WorkOrder, 'vehicle_label'>[],
): Promise<{ orders: WorkOrder[]; error: string | null }> {
  const trailerIds = Array.from(
    new Set(rows.filter((o) => o.trailer_id != null).map((o) => o.trailer_id)),
  )

  const { data: trailers, error } =
    trailerIds.length > 0
      ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : { data: [], error: null }

  if (error) {
    return { orders: [], error: error.message }
  }

  const trailerPlateById = new Map(trailers.map((t) => [t.trailer_id, t.plate_number]))

  return {
    orders: rows.map((order) => ({
      ...order,
      vehicle_label: order.plate_number
        ? `Truck ${order.plate_number}`
        : `Trailer ${trailerPlateById.get(order.trailer_id) ?? `#${order.trailer_id}`}`,
    })),
    error: null,
  }
}
