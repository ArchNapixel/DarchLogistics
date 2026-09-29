// workOrderCompletions: admin-facing read of finished work
// (work_order_completions + the parts used per completion) for the
// Reports page's "Work Order Completions" tab. Submitting a completion
// itself happens in employee/CompleteWorkOrderModal.tsx -- this module
// is read-only.
import { supabase } from './supabaseClient'

export type WorkOrderCompletion = {
  completion_id: number
  work_order_id: number
  work_order_number: string
  vehicle_label: string
  employee_name: string
  description: string
  odometer_reading: number | null
  next_service_date: string | null
  notes: string | null
  completed_at: string
  parts_used: { item_name_text: string; quantity: number }[]
}

export async function loadWorkOrderCompletions(limit?: number): Promise<{
  completions: WorkOrderCompletion[]
  error: string | null
}> {
  const { data: completionRows, error: completionsError } = await supabase
    .from('work_order_completions')
    .select(
      'completion_id, work_order_id, employee_id, description, odometer_reading, next_service_date, notes, completed_at',
    )
    .order('completed_at', { ascending: false })
    .limit(limit ?? 100000)

  if (completionsError) {
    return { completions: [], error: completionsError.message }
  }
  if (completionRows.length === 0) {
    return { completions: [], error: null }
  }

  const workOrderIds = Array.from(new Set(completionRows.map((row) => row.work_order_id)))
  const employeeIds = Array.from(new Set(completionRows.map((row) => row.employee_id)))
  const completionIds = completionRows.map((row) => row.completion_id)

  const [workOrdersResult, employeesResult, partsResult] = await Promise.all([
    supabase
      .from('work_orders')
      .select('work_order_id, work_order_number, plate_number, trailer_id')
      .in('work_order_id', workOrderIds),
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
    supabase
      .from('work_order_parts_used')
      .select('completion_id, item_name_text, quantity')
      .in('completion_id', completionIds),
  ])

  if (workOrdersResult.error) {
    return { completions: [], error: workOrdersResult.error.message }
  }
  if (employeesResult.error) {
    return { completions: [], error: employeesResult.error.message }
  }
  if (partsResult.error) {
    return { completions: [], error: partsResult.error.message }
  }

  const trailerIds = Array.from(
    new Set(
      workOrdersResult.data
        .map((w) => w.trailer_id)
        .filter((id): id is number => id !== null),
    ),
  )

  const { data: trailerRows, error: trailerError } =
    trailerIds.length > 0
      ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : { data: [], error: null }

  if (trailerError) {
    return { completions: [], error: trailerError.message }
  }

  const trailerPlateById = new Map(
    (trailerRows ?? []).map((t) => [t.trailer_id, t.plate_number]),
  )
  const workOrderById = new Map(workOrdersResult.data.map((w) => [w.work_order_id, w]))
  const nameByEmployee = new Map(
    employeesResult.data.map((e) => [e.employee_id, e.full_name]),
  )
  const partsByCompletion = new Map<number, { item_name_text: string; quantity: number }[]>()
  partsResult.data.forEach((part) => {
    const list = partsByCompletion.get(part.completion_id) ?? []
    list.push({ item_name_text: part.item_name_text, quantity: part.quantity })
    partsByCompletion.set(part.completion_id, list)
  })

  return {
    completions: completionRows.map((row) => {
      const workOrder = workOrderById.get(row.work_order_id)
      const vehicleLabel = workOrder
        ? workOrder.plate_number
          ? `Truck: ${workOrder.plate_number}`
          : `Trailer: ${trailerPlateById.get(workOrder.trailer_id ?? -1) ?? `#${workOrder.trailer_id}`}`
        : '—'

      return {
        completion_id: row.completion_id,
        work_order_id: row.work_order_id,
        work_order_number: workOrder?.work_order_number ?? `#${row.work_order_id}`,
        vehicle_label: vehicleLabel,
        employee_name: nameByEmployee.get(row.employee_id) ?? `Employee #${row.employee_id}`,
        description: row.description,
        odometer_reading: row.odometer_reading,
        next_service_date: row.next_service_date,
        notes: row.notes,
        completed_at: row.completed_at,
        parts_used: partsByCompletion.get(row.completion_id) ?? [],
      }
    }),
    error: null,
  }
}
