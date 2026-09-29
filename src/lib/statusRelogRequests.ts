// statusRelogRequests: the "status relog request" ticket. Dispatchers
// (itinerary status) and Mechanics (work order status) can't set a
// status backward directly -- they submit a request naming the current
// status, the status they want instead, and why. Admin alone approves
// (which actually applies the change and logs it, same shape as every
// direct change) or rejects it. Exactly one of itinerary_id/work_order_id
// is ever set (enforced by a DB check constraint).
import { supabase } from './supabaseClient'
import { changeWorkOrderStatus } from './workOrderStatusLog'

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

// Approving both marks the request Approved AND applies the real status
// change (logged to the same table a direct change would use) -- not
// wrapped in a DB transaction (same known limitation as elsewhere).
//
// The request is claimed FIRST (Pending -> Approved, race-guarded), and
// only the admin who wins that claim applies the change -- same pattern
// as approveMaintenanceRequest(). Applying first (as before) let two
// admins approving at once each apply and log it. If applying fails, the
// request is put back to Pending so it can be retried or rejected.
export async function approveStatusRelogRequest({
  request,
  resolvedByEmployeeId,
}: {
  request: PendingRelogRequest
  resolvedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { data: claimed, error: claimError } = await supabase
    .from('status_relog_requests')
    .update({
      status: 'Approved',
      resolved_by_employee_id: resolvedByEmployeeId,
      resolved_at: new Date().toISOString(),
    })
    .eq('request_id', request.request_id)
    .eq('status', 'Pending')
    .select('request_id')
    .maybeSingle()

  if (claimError) {
    return { error: claimError.message }
  }
  if (!claimed) {
    return { error: 'This request was already approved or rejected by someone else.' }
  }

  let applyError: string | null = null

  if (request.target_type === 'itinerary' && request.itinerary_id !== null) {
    // Only applies if the trip is still at the status the request was
    // made against -- otherwise the driver/dispatch moved it since.
    const { data: updated, error: updateError } = await supabase
      .from('itineraries')
      .update({ itinerary_status: request.requested_status })
      .eq('itinerary_id', request.itinerary_id)
      .eq('itinerary_status', request.current_status)
      .select('itinerary_id')
      .maybeSingle()

    if (updateError) {
      applyError = updateError.message
    } else if (!updated) {
      applyError =
        `The trip is no longer "${request.current_status}" -- it changed after ` +
        'this request was made. Reject it and ask for a new one if still needed.'
    } else {
      await supabase.from('dispatch_status_logs').insert({
        itinerary_id: request.itinerary_id,
        previous_status: request.current_status,
        new_status: request.requested_status,
        changed_by: resolvedByEmployeeId,
      })
    }
  } else if (request.target_type === 'work_order' && request.work_order_id !== null) {
    // Need the vehicle so reopening a Completed/Cancelled job puts its
    // truck/trailer back to "Under Maintenance" (changeWorkOrderStatus).
    const { data: order, error: orderError } = await supabase
      .from('work_orders')
      .select('plate_number, trailer_id')
      .eq('work_order_id', request.work_order_id)
      .single()

    if (orderError || !order) {
      applyError = orderError?.message ?? 'Could not load the work order.'
    } else {
      const { error, statusChanged } = await changeWorkOrderStatus({
        workOrderId: request.work_order_id,
        plateNumber: order.plate_number,
        trailerId: order.trailer_id,
        previousStatus: request.current_status,
        newStatus: request.requested_status,
        changedByEmployeeId: resolvedByEmployeeId,
      })
      // If the status DID change (only the vehicle sync failed), keep the
      // request Approved and just surface the message.
      if (statusChanged) return { error }
      applyError = error
    }
  }

  if (applyError) {
    await supabase
      .from('status_relog_requests')
      .update({ status: 'Pending', resolved_by_employee_id: null, resolved_at: null })
      .eq('request_id', request.request_id)
    return { error: `${applyError} The request was put back to Pending.` }
  }

  return { error: null }
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
  const { data: updated, error } = await supabase
    .from('status_relog_requests')
    .update({
      status: 'Rejected',
      resolved_by_employee_id: resolvedByEmployeeId,
      resolution_note: resolutionNote,
      resolved_at: new Date().toISOString(),
    })
    .eq('request_id', requestId)
    .eq('status', 'Pending')
    .select('request_id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!updated) return { error: 'This request was already approved or rejected by someone else.' }
  return { error: null }
}

// Mechanic side: work order ids that already have a Pending request from
// this employee, so MechanicTasks.tsx can hide "Request correction" on
// them instead of letting the same request be sent twice.
export async function loadMyPendingWorkOrderRelogIds(employeeId: number): Promise<number[]> {
  const { data } = await supabase
    .from('status_relog_requests')
    .select('work_order_id')
    .eq('requested_by_employee_id', employeeId)
    .eq('status', 'Pending')
    .not('work_order_id', 'is', null)

  return (data ?? []).map((row) => row.work_order_id as number)
}

export type MyItineraryRelogRequest = {
  request_id: number
  itinerary_id: number
  current_status: string
  requested_status: string
  reason: string
  status: string
  resolution_note: string | null
  created_at: string
}

// Dispatcher side: this employee's own trip correction requests (every
// status, newest first) -- the Dispatch Board shows them in "My
// correction requests" and hides "Request correction" on trips that
// already have a Pending one. Readable via status_relog_requests_select_own.
export async function loadMyItineraryRelogRequests(employeeId: number): Promise<{
  requests: MyItineraryRelogRequest[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('status_relog_requests')
    .select(
      'request_id, itinerary_id, current_status, requested_status, reason, status, resolution_note, created_at',
    )
    .eq('requested_by_employee_id', employeeId)
    .not('itinerary_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return { requests: [], error: error.message }
  return { requests: data as MyItineraryRelogRequest[], error: null }
}
