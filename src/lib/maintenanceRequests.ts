// maintenanceRequests: a Driver or Mechanic flags a truck/trailer as
// needing maintenance NOW (unlike maintenanceSchedules.ts, which is a
// future heads-up needing no approval) -- Admin reviews it and either
// Approves (which creates a real, unassigned work_orders row landing on
// the Task Board for any mechanic to accept, same as
// CreateWorkOrderModal.tsx) or Rejects it with a reason. Nothing lands
// on the work order board until Admin approves it.
import { supabase } from './supabaseClient'

export async function createMaintenanceRequest({
  plateNumber,
  trailerId,
  requestedByEmployeeId,
  maintenanceType,
  description,
}: {
  plateNumber: string | null
  trailerId: number | null
  requestedByEmployeeId: number
  maintenanceType: string
  description: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('maintenance_requests').insert({
    plate_number: plateNumber,
    trailer_id: trailerId,
    requested_by_employee_id: requestedByEmployeeId,
    maintenance_type: maintenanceType,
    description,
  })

  return { error: error?.message ?? null }
}

export type PendingMaintenanceRequest = {
  request_id: number
  plate_number: string | null
  trailer_id: number | null
  vehicle_label: string
  requested_by_name: string
  maintenance_type: string
  description: string
  created_at: string
}

export async function loadPendingMaintenanceRequests(): Promise<{
  requests: PendingMaintenanceRequest[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('maintenance_requests')
    .select(
      'request_id, plate_number, trailer_id, requested_by_employee_id, maintenance_type, description, created_at',
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
  const trailerIds = Array.from(
    new Set(rows.filter((r) => r.trailer_id !== null).map((r) => r.trailer_id as number)),
  )

  const [employeesResult, trailersResult] = await Promise.all([
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
    trailerIds.length > 0
      ? supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : Promise.resolve({ data: [] as { trailer_id: number; plate_number: string | null }[], error: null }),
  ])

  if (employeesResult.error) {
    return { requests: [], error: employeesResult.error.message }
  }
  if (trailersResult.error) {
    return { requests: [], error: trailersResult.error.message }
  }

  const employeeNameById = new Map(employeesResult.data.map((e) => [e.employee_id, e.full_name]))
  const trailerPlateById = new Map(trailersResult.data.map((t) => [t.trailer_id, t.plate_number]))

  return {
    requests: rows.map((row) => ({
      request_id: row.request_id,
      plate_number: row.plate_number,
      trailer_id: row.trailer_id,
      vehicle_label: row.plate_number
        ? `Truck: ${row.plate_number}`
        : `Trailer: ${trailerPlateById.get(row.trailer_id as number) ?? `#${row.trailer_id}`}`,
      requested_by_name:
        employeeNameById.get(row.requested_by_employee_id) ??
        `Employee #${row.requested_by_employee_id}`,
      maintenance_type: row.maintenance_type,
      description: row.description,
      created_at: row.created_at,
    })),
    error: null,
  }
}

export type MyMaintenanceRequest = {
  request_id: number
  vehicle_label: string
  maintenance_type: string
  description: string
  status: string
  rejection_reason: string | null
  created_at: string
}

export async function loadMyMaintenanceRequests(employeeId: number): Promise<{
  requests: MyMaintenanceRequest[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('maintenance_requests')
    .select(
      'request_id, plate_number, trailer_id, maintenance_type, description, status, rejection_reason, created_at',
    )
    .eq('requested_by_employee_id', employeeId)
    .order('created_at', { ascending: false })

  if (error) {
    return { requests: [], error: error.message }
  }
  if (rows.length === 0) {
    return { requests: [], error: null }
  }

  const trailerIds = Array.from(
    new Set(rows.filter((r) => r.trailer_id !== null).map((r) => r.trailer_id as number)),
  )
  const { data: trailers, error: trailersError } =
    trailerIds.length > 0
      ? await supabase.from('trailers').select('trailer_id, plate_number').in('trailer_id', trailerIds)
      : { data: [] as { trailer_id: number; plate_number: string | null }[], error: null }

  if (trailersError) {
    return { requests: [], error: trailersError.message }
  }

  const trailerPlateById = new Map(trailers.map((t) => [t.trailer_id, t.plate_number]))

  return {
    requests: rows.map((row) => ({
      request_id: row.request_id,
      vehicle_label: row.plate_number
        ? `Truck: ${row.plate_number}`
        : `Trailer: ${trailerPlateById.get(row.trailer_id as number) ?? `#${row.trailer_id}`}`,
      maintenance_type: row.maintenance_type,
      description: row.description,
      status: row.status,
      rejection_reason: row.rejection_reason,
      created_at: row.created_at,
    })),
    error: null,
  }
}

// Approving creates the real work order (unassigned, so it lands on the
// Task Board for any mechanic to accept -- same shape as
// CreateWorkOrderModal.tsx), flips the vehicle to "Under Maintenance"
// (same as that modal does too), and links the two records together.
// Not wrapped in a DB transaction -- same known limitation as elsewhere
// in this app -- so a failure partway is surfaced naming what happened.
//
// The request is claimed FIRST (Pending -> Approved, race-guarded), and
// only the admin who wins that claim goes on to create the work order.
// Doing the claim last (as before) let two admins approving at once --
// or a retry after a failed last step -- each create a work order.
export async function approveMaintenanceRequest({
  request,
  resolvedByEmployeeId,
}: {
  request: PendingMaintenanceRequest
  resolvedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { data: claimed, error: claimError } = await supabase
    .from('maintenance_requests')
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

  const identifier = request.plate_number ?? `TR${request.trailer_id}`
  const workOrderNumber = `WO-${identifier}-${Date.now()}`

  const { data: newWorkOrder, error: workOrderError } = await supabase
    .from('work_orders')
    .insert({
      work_order_number: workOrderNumber,
      plate_number: request.plate_number,
      trailer_id: request.trailer_id,
      assigned_mechanic_id: null,
      maintenance_type: request.maintenance_type,
      work_description: `${request.description} (requested by ${request.requested_by_name})`,
    })
    .select('work_order_id')
    .single()

  if (workOrderError || !newWorkOrder) {
    // Put the request back in the queue so it can be approved again.
    const { error: revertError } = await supabase
      .from('maintenance_requests')
      .update({ status: 'Pending', resolved_by_employee_id: null, resolved_at: null })
      .eq('request_id', request.request_id)
    const reason = workOrderError?.message ?? 'Could not create the work order.'
    return {
      error: revertError
        ? `${reason} The request is marked Approved but has no work order -- this needs manual review.`
        : reason,
    }
  }

  const { error: linkError } = await supabase
    .from('maintenance_requests')
    .update({ work_order_id: newWorkOrder.work_order_id })
    .eq('request_id', request.request_id)

  if (linkError) {
    return {
      error: `Work order ${workOrderNumber} was created, but couldn't be linked to the request (${linkError.message}). This needs manual review.`,
    }
  }

  const { error: statusError } = request.plate_number
    ? await supabase
        .from('truck_profiles')
        .update({ current_status: 'Under Maintenance' })
        .eq('plate_number', request.plate_number)
    : await supabase
        .from('trailers')
        .update({ current_status: 'Under Maintenance' })
        .eq('trailer_id', request.trailer_id)

  if (statusError) {
    return {
      error: `Work order ${workOrderNumber} was created, but the vehicle's status could not be updated (${statusError.message}). This needs manual review.`,
    }
  }

  return { error: null }
}

export async function rejectMaintenanceRequest({
  requestId,
  resolvedByEmployeeId,
  rejectionReason,
}: {
  requestId: number
  resolvedByEmployeeId: number
  rejectionReason: string
}): Promise<{ error: string | null }> {
  const { data: updated, error } = await supabase
    .from('maintenance_requests')
    .update({
      status: 'Rejected',
      resolved_by_employee_id: resolvedByEmployeeId,
      rejection_reason: rejectionReason,
      resolved_at: new Date().toISOString(),
    })
    .eq('request_id', requestId)
    .eq('status', 'Pending')
    .select('request_id')
    .maybeSingle()

  if (error) return { error: error.message }
  // 0 rows matched -- someone else already decided it (or RLS silently
  // blocked the update), so don't report a rejection that didn't happen.
  if (!updated) return { error: 'This request was already approved or rejected by someone else.' }
  return { error: null }
}
