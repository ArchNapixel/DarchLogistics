// financeSnapshot: the extra Financial Summary panels (pure math is in
// lib/moneySummary.ts):
//   loadStanding          "Where we stand" today: clients owe us (Payments Due
//                         rules; overdue = the unpaid parts past their own
//                         due date), employees owe us (Cash Advance Ledger,
//                         minus deductions already on draft payslips --
//                         the same balance payroll and the advance limit use),
//                         we owe employees (finalized payslips not marked Paid),
//                         stock on the shelf (open inventory batches x price)
//   loadCollectedByClient money received this month per client (Collections)
//   loadRemittances       what the month's FINALIZED payslips say is due to
//                         each agency vs government_remittances recorded for it
import { supabase } from './supabaseClient'
import { fetchAll, fetchIn } from './dashboardExpenses'
import { loadLedgerInputs } from './statement'
import { loadCashAdvanceLedger } from './cashAdvanceLedger'
import { loadOpenLots } from './inventoryMovements'
import { agencyAmounts, nextMonthStart, summarizeRemittances, type PayslipRemitRow } from './remittanceTotals'
import { AGENCIES, type Agency } from './moneySummary'

const cents = (n: number) => Math.round(n * 100) / 100

export type Standing = {
  clientsOwe: number
  clientsOverdue: number
  employeesOwe: number
  weOweEmployees: number
  unpaidPayslips: number
  stockOnShelf: number
}

export async function loadStanding(): Promise<{ data: Standing | null; error: string | null }> {
  const [due, ledger, unpaid, lots] = await Promise.all([
    // The all-clients ledger Financial Summary already loaded (shortCache).
    loadLedgerInputs(),
    loadCashAdvanceLedger(),
    fetchAll<{ net_pay: number }>((a, b) =>
      supabase
        .from('payroll_payslips')
        .select('net_pay')
        .not('finalized_at', 'is', null)
        .neq('payslip_status', 'Paid')
        .order('payroll_id')
        .range(a, b),
    ),
    loadOpenLots(),
  ])
  const error = due.error ?? ledger.error ?? unpaid.error ?? lots.error
  if (error) return { data: null, error }

  const owing = due.rows.filter((r) => r.balance_due > 0)
  return {
    data: {
      clientsOwe: cents(owing.reduce((s, r) => s + r.balance_due, 0)),
      clientsOverdue: cents(owing.reduce((s, r) => s + r.overdue_amount, 0)),
      employeesOwe: cents(ledger.employees.reduce((s, e) => s + Math.max(e.outstanding - e.draftDeducted, 0), 0)),
      weOweEmployees: cents(unpaid.rows.reduce((s, p) => s + Number(p.net_pay), 0)),
      unpaidPayslips: unpaid.rows.length,
      // A batch with no price counts as ₱0 (same as the Inventory tile).
      stockOnShelf: cents(lots.lots.reduce((s, l) => s + l.qty_remaining * (l.unit_cost ?? 0), 0)),
    },
    error: null,
  }
}

// Money received this month, per client (refunds left out).
export async function loadCollectedByClient(
  month: string,
): Promise<{ rows: { client_id: number | null; client_name: string; amount: number }[]; error: string | null }> {
  const payments = await fetchAll<{ booking_id: number; amount: number }>((a, b) =>
    supabase
      .from('booking_payments')
      .select('booking_id, amount')
      .is('voided_at', null)
      .gt('amount', 0)
      .gte('paid_on', `${month}-01`)
      .lt('paid_on', nextMonthStart(month))
      .order('payment_id')
      .range(a, b),
  )
  if (payments.error) return { rows: [], error: payments.error }
  const bookingIds = [...new Set(payments.rows.map((p) => p.booking_id))]
  const bookings = await fetchIn<{ booking_id: number; client_id: number }>(bookingIds, (chunk, a, b) =>
    supabase.from('bookings').select('booking_id, client_id').in('booking_id', chunk).range(a, b),
  )
  if (bookings.error) return { rows: [], error: bookings.error }
  const clientIds = [...new Set(bookings.rows.map((b) => b.client_id))]
  const clients = await fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, a, b) =>
    supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(a, b),
  )
  if (clients.error) return { rows: [], error: clients.error }
  const clientOf = new Map(bookings.rows.map((b) => [b.booking_id, b.client_id]))
  const nameOf = new Map(clients.rows.map((c) => [c.client_id, c.client_name]))
  return {
    rows: payments.rows.map((p) => ({
      client_id: clientOf.get(p.booking_id) ?? null,
      client_name: nameOf.get(clientOf.get(p.booking_id) ?? -1) ?? `Booking #${p.booking_id}`,
      amount: Number(p.amount),
    })),
    error: null,
  }
}

export type RemittanceRow = {
  remittance_id: number
  agency: Agency
  amount: number
  paid_on: string
  reference_no: string | null
  voided_at: string | null
}

export type Remittances = {
  due: Record<Agency, number>
  paid: Record<Agency, number>
  entries: RemittanceRow[]
  draftPayslips: number // payslips of the month not finalized yet (not counted)
}

const zero = (): Record<Agency, number> => ({ SSS: 0, PhilHealth: 0, 'Pag-IBIG': 0, BIR: 0 })

export async function loadRemittances(month: string): Promise<{ data: Remittances | null; error: string | null }> {
  const [payslips, entries] = await Promise.all([
    fetchAll<PayslipRemitRow & { finalized_at: string | null }>((a, b) =>
      supabase
        .from('payroll_payslips')
        .select(
          'employee_id, gross_pay, cash_advance_deducted, net_pay, sss_ee, sss_er, sss_ec, philhealth_ee, philhealth_er, pagibig_ee, pagibig_er, withholding_tax, finalized_at',
        )
        .gte('payroll_period_end', `${month}-01`)
        .lt('payroll_period_end', nextMonthStart(month))
        .order('payroll_id')
        .range(a, b),
    ),
    fetchAll<RemittanceRow>((a, b) =>
      supabase
        .from('government_remittances')
        .select('remittance_id, agency, amount, paid_on, reference_no, voided_at')
        .eq('period_month', `${month}-01`)
        .order('paid_on')
        .order('remittance_id')
        .range(a, b),
    ),
  ])
  const error = payslips.error ?? entries.error
  if (error) return { data: null, error }

  const finalized = payslips.rows.filter((p) => p.finalized_at)
  const amounts = agencyAmounts(summarizeRemittances(finalized, new Map()).totals)
  const due = { SSS: amounts.SSS, PhilHealth: amounts.PhilHealth, 'Pag-IBIG': amounts['Pag-IBIG'], BIR: amounts['BIR (withholding tax)'] }
  const paid = zero()
  for (const e of entries.rows) if (!e.voided_at) paid[e.agency] = cents(paid[e.agency] + Number(e.amount))
  return {
    data: {
      due,
      paid,
      entries: entries.rows.map((e) => ({ ...e, amount: Number(e.amount) })),
      draftPayslips: payslips.rows.length - finalized.length,
    },
    error: null,
  }
}

// Error text, or null when saved.
export async function recordRemittance(args: {
  month: string
  agency: Agency
  amount: number
  paidOn: string
  referenceNo: string
  employeeId: number | null
}): Promise<string | null> {
  if (!AGENCIES.includes(args.agency)) return 'Pick an agency.'
  const { data, error } = await supabase
    .from('government_remittances')
    .insert({
      period_month: `${args.month}-01`,
      agency: args.agency,
      amount: args.amount,
      paid_on: args.paidOn,
      reference_no: args.referenceNo.trim() || null,
      recorded_by: args.employeeId,
    })
    .select('remittance_id')
    .maybeSingle()
  if (error) return error.message
  return data ? null : 'The remittance was not saved (no permission?).'
}

export async function voidRemittance(id: number, reason: string, employeeId: number | null): Promise<string | null> {
  // The database also refuses a void without a reason (government_remittances_guard).
  if (!reason.trim()) return 'Enter a reason to void a remittance.'
  const { data, error } = await supabase
    .from('government_remittances')
    .update({ voided_at: new Date().toISOString(), voided_by: employeeId, void_reason: reason.trim() })
    .eq('remittance_id', id)
    .is('voided_at', null)
    .select('remittance_id')
    .maybeSingle()
  if (error) return error.message
  return data ? null : 'That remittance was already voided.'
}
