// workOrderNotes: a running progress log a mechanic can add to while
// actually working a job (e.g. "diagnosed the issue", "waiting on part
// X") -- separate from the final description/parts breakdown recorded
// at Completion (CompleteWorkOrderModal.tsx). Backs the notes list in
// AccessWorkOrderModal.tsx.
import { supabase } from './supabaseClient'

export type WorkOrderNote = {
  note_id: number
  work_order_id: number
  employee_name: string
  note: string
  created_at: string
}

export async function loadWorkOrderNotes(workOrderId: number): Promise<{
  notes: WorkOrderNote[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('work_order_notes')
    .select('note_id, work_order_id, employee_id, note, created_at')
    .eq('work_order_id', workOrderId)
    .order('created_at', { ascending: false })

  if (error) {
    return { notes: [], error: error.message }
  }
  if (rows.length === 0) {
    return { notes: [], error: null }
  }

  const employeeIds = Array.from(new Set(rows.map((r) => r.employee_id)))
  const { data: employees, error: employeesError } = await supabase
    .from('employees')
    .select('employee_id, full_name')
    .in('employee_id', employeeIds)

  if (employeesError) {
    return { notes: [], error: employeesError.message }
  }

  const nameById = new Map(employees.map((e) => [e.employee_id, e.full_name]))

  return {
    notes: rows.map((row) => ({
      note_id: row.note_id,
      work_order_id: row.work_order_id,
      employee_name: nameById.get(row.employee_id) ?? `Employee #${row.employee_id}`,
      note: row.note,
      created_at: row.created_at,
    })),
    error: null,
  }
}

export async function addWorkOrderNote({
  workOrderId,
  employeeId,
  note,
}: {
  workOrderId: number
  employeeId: number
  note: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('work_order_notes').insert({
    work_order_id: workOrderId,
    employee_id: employeeId,
    note,
  })

  return { error: error?.message ?? null }
}
