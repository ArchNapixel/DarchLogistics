// statusRelogRequests: the "status relog request" ticket. Dispatchers
// (itinerary status) and Mechanics (work order status) can't set a
// status backward directly -- they submit a request naming the current
// status, the status they want instead, and why. Admin alone approves
// (which actually applies the change and logs it, same shape as every
// direct change) or rejects it. Exactly one of itinerary_id/work_order_id
// is ever set (enforced by a DB check constraint).
import { supabase } from './supabaseClient'

export type RelogTargetType = 'itinerary' | 'work_order'

export async function createStatusRelogRequest({
  targetType,
  itineraryId,
  workOrderId,
  requestedByEmployeeId,
  currentStatus,
  requestedStatus,
  reason,
}: {
  targetType: RelogTargetType
  itineraryId?: number
  workOrderId?: number
  requestedByEmployeeId: number
  currentStatus: string
  requestedStatus: string
  reason: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('status_relog_requests').insert({
    itinerary_id: targetType === 'itinerary' ? itineraryId : null,
    work_order_id: targetType === 'work_order' ? workOrderId : null,
    requested_by_employee_id: requestedByEmployeeId,
    current_status: currentStatus,
    requested_status: requestedStatus,
    reason,
  })

  return { error: error?.message ?? null }
}

export type PendingRelogRequest = {
  request_id: number
  target_type: RelogTargetType
  itinerary_id: number | null
  work_order_id: number | null
  target_label: string
  requested_by_name: string
  current_status: string
  requested_status: string
  reason: string
  created_at: string
}

export async function loadPendingRelogRequests(): Promise<{
  requests: PendingRelogRequest[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('status_relog_requests')
    .select(
      'request_id, itinerary_id, work_order_id, requested_by_employee_id, current_status, requested_status, reason, created_at',
    )
    .eq('status', 'Pending')
    .order('created_at', { ascending: true })

  if (error) {
    return { requests: [], error: error.message }
  }
  if (rows.length === 0) {
    return { requests: [], error: null }
  }

  const employeeIds = Array.from(new Set(rows.map((r) => r.requested_by_employee_id)))
  const workOrderIds = Array.from(
    new Set(rows.filter((r) => r.work_order_id !== null).map((r) => r.work_order_id as number)),
  )

  const [employeesResult, workOrdersResult] = await Promise.all([
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
    workOrderIds.length > 0
      ? supabase
          .from('work_orders')
          .select('work_order_id, work_order_number')
          .in('work_order_id', workOrderIds)
      : Promise.resolve({
          data: [] as { work_order_id: number; work_order_number: string }[],
          error: null,
        }),
  ])

  if (employeesResult.error) {
    return { requests: [], error: employeesResult.error.message }
  }
  if (workOrdersResult.error) {
    return { requests: [], error: workOrdersResult.error.message }
  }

  const employeeNameById = new Map(employeesResult.data.map((e) => [e.employee_id, e.full_name]))
  const workOrderNumberById = new Map(
    workOrdersResult.data.map((w) => [w.work_order_id, w.work_order_number]),
  )

  return {
    requests: rows.map((row) => ({
      request_id: row.request_id,
      target_type: row.itinerary_id !== null ? 'itinerary' : 'work_order',
      itinerary_id: row.itinerary_id,
      work_order_id: row.work_order_id,
      target_label:
        row.itinerary_id !== null
          ? `Itinerary #${row.itinerary_id}`
          : (workOrderNumberById.get(row.work_order_id as number) ??
            `Work Order #${row.work_order_id}`),
      requested_by_name:
        employeeNameById.get(row.requested_by_employee_id) ??
        `Employee #${row.requested_by_employee_id}`,
      current_status: row.current_status,
      requested_status: row.requested_status,
      reason: row.reason,
      created_at: row.created_at,
    })),
    error: null,
  }
}

// Approving both applies the real status change (and logs it to the
// same table a direct change would use) AND marks the request Approved
// -- two writes, not wrapped in a DB transaction (same known limitation
// as QuoteReviewModal/payslip.ts). If the status update succeeds but
// marking the request Approved fails, the request is left Pending even
// though the status already changed -- rare, and re-approving it is
// harmless (it would just reapply the same status), so this doesn't
// need a "needs manual review" message the way money-affecting flows do.
export async function approveStatusRelogRequest({
  request,
  resolvedByEmployeeId,
}: {
  request: PendingRelogRequest
  resolvedByEmployeeId: number
}): Promise<{ error: string | null }> {
  if (request.target_type === 'itinerary' && request.itinerary_id !== null) {
    const { error: updateError } = await supabase
      .from('itineraries')
      .update({ itinerary_status: request.requested_status })
      .eq('itinerary_id', request.itinerary_id)

    if (updateError) {
      return { error: updateError.message }
    }

    await supabase.from('dispatch_status_logs').insert({
      itinerary_id: request.itinerary_id,
      previous_status: request.current_status,
      new_status: request.requested_status,
      changed_by: resolvedByEmployeeId,
    })
  } else if (request.target_type === 'work_order' && request.work_order_id !== null) {
    const { error: updateError } = await supabase
      .from('work_orders')
      .update({ work_order_status: request.requested_status })
      .eq('work_order_id', request.work_order_id)

    if (updateError) {
      return { error: updateError.message }
    }

    await supabase.from('work_order_status_log').insert({
      work_order_id: request.work_order_id,
      previous_status: request.current_status,
      new_status: request.requested_status,
      changed_by: resolvedByEmployeeId,
    })
  }

  const { error: resolveError } = await supabase
    .from('status_relog_requests')
    .update({
      status: 'Approved',
      resolved_by_employee_id: resolvedByEmployeeId,
      resolved_at: new Date().toISOString(),
    })
    .eq('request_id', request.request_id)
    .eq('status', 'Pending')

  return { error: resolveError?.message ?? null }
}

export async function rejectStatusRelogRequest({
  requestId,
  resolvedByEmployeeId,
  resolutionNote,
}: {
  requestId: number
  resolvedByEmployeeId: number
  resolutionNote: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('status_relog_requests')
    .update({
      status: 'Rejected',
      resolved_by_employee_id: resolvedByEmployeeId,
      resolution_note: resolutionNote,
      resolved_at: new Date().toISOString(),
    })
    .eq('request_id', requestId)
    .eq('status', 'Pending')

  return { error: error?.message ?? null }
}
