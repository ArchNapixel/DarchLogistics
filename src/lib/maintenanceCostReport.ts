// maintenanceCostReport.ts: builds the data behind the Maintenance page's
// "Cost Report" button -- what the fleet's maintenance cost in one month.
//
// Cost = parts only: every work_order_parts_used row is quantity x its
// unit_cost (the item's price copied at the time it was used -- see
// workOrderPartsLog.ts / CompleteWorkOrderModal.tsx). No labor cost:
// mechanics are on a fixed weekly salary, already counted in payroll.
//
// A work order counts in the month it was COMPLETED (work_order_completions
// .completed_at, Manila time) -- same "final record" source as
// inventoryReport.ts, so the two reports always agree on what was used.
// Parts used before prices existed have unit_cost null: they're counted
// as ₱0 but flagged, never silently hidden.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'
import { csvField } from './inventoryReport'

export type CostLine = {
  item_name_text: string
  quantity: number
  unit_cost: number | null
  // null when the part has no price on record
  line_total: number | null
}

export type WorkOrderCost = {
  work_order_id: number
  work_order_number: string
  vehicle_label: string
  maintenance_type: string
  completed_at: string
  lines: CostLine[]
  total: number
  unpriced_lines: number
}

export type VehicleCost = {
  vehicle_label: string
  work_order_count: number
  parts_cost: number
  unpriced_lines: number
}

// The current month in Manila time, as 'yyyy-mm' (what <input type="month"> uses).
export function currentReportMonth(): string {
  return toManilaDate(new Date()).slice(0, 7)
}

function nextMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`
}

export async function loadMaintenanceCostReport(month: string): Promise<{
  workOrders: WorkOrderCost[]
  error: string | null
}> {
  // Month bounds in Manila time (+08:00).
  const { data: completions, error: completionsError } = await supabase
    .from('work_order_completions')
    .select('completion_id, work_order_id, completed_at')
    .gte('completed_at', `${month}-01T00:00:00+08:00`)
    .lt('completed_at', `${nextMonth(month)}-01T00:00:00+08:00`)
    .order('completed_at', { ascending: true })

  if (completionsError) {
    return { workOrders: [], error: completionsError.message }
  }
  if (completions.length === 0) {
    return { workOrders: [], error: null }
  }

  const completionIds = completions.map((c) => c.completion_id)
  const workOrderIds = Array.from(new Set(completions.map((c) => c.work_order_id)))

  const [partsResult, workOrdersResult] = await Promise.all([
    supabase
      .from('work_order_parts_used')
      .select('completion_id, item_name_text, quantity, unit_cost')
      .in('completion_id', completionIds),
    supabase
      .from('work_orders')
      .select('work_order_id, work_order_number, plate_number, trailer_id, maintenance_type')
      .in('work_order_id', workOrderIds),
  ])

  if (partsResult.error) {
    return { workOrders: [], error: partsResult.error.message }
  }
  if (workOrdersResult.error) {
    return { workOrders: [], error: workOrdersResult.error.message }
  }

  const trailerIds = Array.from(
    new Set(
      workOrdersResult.data
        .filter((w) => w.trailer_id !== null)
        .map((w) => w.trailer_id as number),
    ),
  )
  const { data: trailers, error: trailersError } =
    trailerIds.length > 0
      ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : { data: [] as { trailer_id: number; plate_number: string | null }[], error: null }

  if (trailersError) {
    return { workOrders: [], error: trailersError.message }
  }

  const trailerPlateById = new Map(trailers.map((t) => [t.trailer_id, t.plate_number]))
  const workOrderById = new Map(workOrdersResult.data.map((w) => [w.work_order_id, w]))

  const linesByCompletion = new Map<number, CostLine[]>()
  for (const p of partsResult.data) {
    const unitCost = p.unit_cost === null ? null : Number(p.unit_cost)
    const quantity = Number(p.quantity)
    const lines = linesByCompletion.get(p.completion_id) ?? []
    lines.push({
      item_name_text: p.item_name_text,
      quantity,
      unit_cost: unitCost,
      line_total: unitCost === null ? null : quantity * unitCost,
    })
    linesByCompletion.set(p.completion_id, lines)
  }

  const workOrders: WorkOrderCost[] = completions.map((c) => {
    const wo = workOrderById.get(c.work_order_id)
    const lines = linesByCompletion.get(c.completion_id) ?? []
    return {
      work_order_id: c.work_order_id,
      work_order_number: wo?.work_order_number ?? `#${c.work_order_id}`,
      vehicle_label: !wo
        ? 'Unknown vehicle'
        : wo.plate_number
          ? `Truck: ${wo.plate_number}`
          : `Trailer: ${trailerPlateById.get(wo.trailer_id as number) ?? `#${wo.trailer_id}`}`,
      maintenance_type: wo?.maintenance_type ?? '—',
      completed_at: c.completed_at,
      lines,
      total: lines.reduce((sum, l) => sum + (l.line_total ?? 0), 0),
      unpriced_lines: lines.filter((l) => l.line_total === null).length,
    }
  })

  return { workOrders, error: null }
}

// Per-vehicle totals, most expensive first.
export function summarizeCostByVehicle(workOrders: WorkOrderCost[]): VehicleCost[] {
  const byVehicle = new Map<string, VehicleCost>()
  for (const wo of workOrders) {
    const entry = byVehicle.get(wo.vehicle_label) ?? {
      vehicle_label: wo.vehicle_label,
      work_order_count: 0,
      parts_cost: 0,
      unpriced_lines: 0,
    }
    entry.work_order_count += 1
    entry.parts_cost += wo.total
    entry.unpriced_lines += wo.unpriced_lines
    byVehicle.set(wo.vehicle_label, entry)
  }
  return Array.from(byVehicle.values()).sort((a, b) => b.parts_cost - a.parts_cost)
}

export function formatReportMonth(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

// Plain numbers (no ₱ / thousands separators) so the CSV opens as
// numbers in Excel.
const amount = (value: number) => value.toFixed(2)

export function buildMaintenanceCostCsv(month: string, workOrders: WorkOrderCost[]): string {
  const vehicles = summarizeCostByVehicle(workOrders)
  const fleetTotal = vehicles.reduce((sum, v) => sum + v.parts_cost, 0)
  const lines: string[] = []

  lines.push('Darch Logistics Maintenance Cost Report')
  lines.push(`Month: ${formatReportMonth(month)}`)
  lines.push(`Fleet total (parts): ${amount(fleetTotal)}`)
  lines.push('')

  lines.push('Cost by Vehicle')
  lines.push(['Vehicle', 'Work Orders', 'Parts Cost', 'Parts With No Price'].map(csvField).join(','))
  for (const v of vehicles) {
    lines.push(
      [v.vehicle_label, v.work_order_count, amount(v.parts_cost), v.unpriced_lines]
        .map(csvField)
        .join(','),
    )
  }

  lines.push('')
  lines.push('Detail')
  lines.push(
    ['Completed', 'Work Order', 'Vehicle', 'Type', 'Part', 'Qty', 'Unit Price', 'Line Total']
      .map(csvField)
      .join(','),
  )
  for (const wo of workOrders) {
    const completed = toManilaDate(wo.completed_at)
    if (wo.lines.length === 0) {
      lines.push(
        [completed, wo.work_order_number, wo.vehicle_label, wo.maintenance_type, 'No parts used', '', '', amount(0)]
          .map(csvField)
          .join(','),
      )
    }
    for (const l of wo.lines) {
      lines.push(
        [
          completed,
          wo.work_order_number,
          wo.vehicle_label,
          wo.maintenance_type,
          l.item_name_text,
          l.quantity,
          l.unit_cost === null ? 'No price' : amount(l.unit_cost),
          l.line_total === null ? '' : amount(l.line_total),
        ]
          .map(csvField)
          .join(','),
      )
    }
  }

  return lines.join('\n')
}
