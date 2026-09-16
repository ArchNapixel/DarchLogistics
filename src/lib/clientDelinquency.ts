// clientDelinquency: shared data access for flagging a client as
// delinquent (overdue payments or other reasons). Append-only history --
// every mark/unmark is its own logged row with a required reason and who
// did it (same shape as workOrderAcceptanceLog.ts), rather than a single
// status column that would lose the "why" and "when" over time.
// "Currently delinquent" is derived, not stored: whichever action is
// most recent for that client wins.
import { supabase } from './supabaseClient'
import { loadPaymentDueReport } from './paymentDue'

export type DelinquencyAction = 'Marked' | 'Unmarked'

export type DelinquencyLogEntry = {
  log_id: number
  client_id: number
  client_name: string
  action: DelinquencyAction
  reason: string
  changed_by_name: string
  created_at: string
}

async function withNamesJoined(rows: {
  log_id: number
  client_id: number
  action: string
  reason: string
  changed_by_employee_id: number
  created_at: string
}[]): Promise<{ entries: DelinquencyLogEntry[]; error: string | null }> {
  if (rows.length === 0) {
    return { entries: [], error: null }
  }

  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)))
  const employeeIds = Array.from(new Set(rows.map((r) => r.changed_by_employee_id)))

  const [clientsResult, employeesResult] = await Promise.all([
    supabase.from('clients').select('client_id, client_name').in('client_id', clientIds),
    supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds),
  ])

  if (clientsResult.error) {
    return { entries: [], error: clientsResult.error.message }
  }
  if (employeesResult.error) {
    return { entries: [], error: employeesResult.error.message }
  }

  const clientNameById = new Map(clientsResult.data.map((c) => [c.client_id, c.client_name]))
  const employeeNameById = new Map(
    employeesResult.data.map((e) => [e.employee_id, e.full_name]),
  )

  return {
    entries: rows.map((row) => ({
      log_id: row.log_id,
      client_id: row.client_id,
      client_name: clientNameById.get(row.client_id) ?? `Client #${row.client_id}`,
      action: row.action as DelinquencyAction,
      reason: row.reason,
      changed_by_name: employeeNameById.get(row.changed_by_employee_id) ?? '—',
      created_at: row.created_at,
    })),
    error: null,
  }
}

// Full history, newest first -- the read-only audit trail.
export async function loadDelinquencyLog(): Promise<{
  entries: DelinquencyLogEntry[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('client_delinquency_log')
    .select('log_id, client_id, action, reason, changed_by_employee_id, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return { entries: [], error: error.message }
  }

  return withNamesJoined(rows)
}

export type CurrentDelinquentClient = {
  client_id: number
  client_name: string
  reason: string
  since: string
}

// Derives "who is currently delinquent" from the log: for each client,
// the most recent row decides. Only clients whose latest action is
// "Marked" (and never since "Unmarked") show up here.
export async function loadCurrentlyDelinquentClients(): Promise<{
  clients: CurrentDelinquentClient[]
  error: string | null
}> {
  const { entries, error } = await loadDelinquencyLog()

  if (error) {
    return { clients: [], error }
  }

  // entries is newest-first, so the first entry seen per client_id is
  // its most recent action.
  const latestByClient = new Map<number, DelinquencyLogEntry>()
  for (const entry of entries) {
    if (!latestByClient.has(entry.client_id)) {
      latestByClient.set(entry.client_id, entry)
    }
  }

  const clients: CurrentDelinquentClient[] = Array.from(latestByClient.values())
    .filter((entry) => entry.action === 'Marked')
    .map((entry) => ({
      client_id: entry.client_id,
      client_name: entry.client_name,
      reason: entry.reason,
      since: entry.created_at,
    }))

  return { clients, error: null }
}

export async function markClientDelinquent({
  clientId,
  reason,
  changedByEmployeeId,
}: {
  clientId: number
  reason: string
  changedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('client_delinquency_log').insert({
    client_id: clientId,
    action: 'Marked',
    reason,
    changed_by_employee_id: changedByEmployeeId,
  })

  return { error: error?.message ?? null }
}

export async function unmarkClientDelinquent({
  clientId,
  reason,
  changedByEmployeeId,
}: {
  clientId: number
  reason: string
  changedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('client_delinquency_log').insert({
    client_id: clientId,
    action: 'Unmarked',
    reason,
    changed_by_employee_id: changedByEmployeeId,
  })

  return { error: error?.message ?? null }
}

export type OverdueRiskClient = {
  client_id: number
  client_name: string
  days_overdue: number
  booking_id: number
}

// Auto-suggestion, not an auto-write: reuses paymentDue.ts's existing
// days_until_due calculation to flag clients with a balance overdue
// past `thresholdDays`. Nothing is written here -- staff still has to
// click "Mark as Delinquent" to actually log it (the "manual override"
// half of the feature).
export async function loadOverdueRiskClients(
  thresholdDays: number,
): Promise<{ clients: OverdueRiskClient[]; error: string | null }> {
  const { rows, error } = await loadPaymentDueReport()

  if (error) {
    return { clients: [], error }
  }

  const worstByClient = new Map<number, OverdueRiskClient>()

  for (const row of rows) {
    if (row.days_until_due === null || row.days_until_due >= -thresholdDays) continue
    const daysOverdue = -row.days_until_due
    const existing = worstByClient.get(row.client_id)
    if (!existing || daysOverdue > existing.days_overdue) {
      worstByClient.set(row.client_id, {
        client_id: row.client_id,
        client_name: row.client_name,
        days_overdue: daysOverdue,
        booking_id: row.booking_id,
      })
    }
  }

  return { clients: Array.from(worstByClient.values()), error: null }
}

export const DELINQUENCY_THRESHOLD_SETTING_KEY = 'delinquency_overdue_days_threshold'

export async function loadDelinquencyThresholdDays(): Promise<{
  days: number
  error: string | null
}> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('setting_value')
    .eq('setting_key', DELINQUENCY_THRESHOLD_SETTING_KEY)
    .maybeSingle()

  if (error) {
    return { days: 7, error: error.message }
  }

  return { days: data ? Number(data.setting_value) : 7, error: null }
}
