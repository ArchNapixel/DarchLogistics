// payables: loading and saving for Accounting -> Accounts Payable.
// Bills and their payments are written ONLY through database functions
// (create_bill, record_bill_payment, void_bill_payment, void_bill) -- each
// runs in one transaction, checks the caller is an Admin, and the payment
// one refuses to pay more than is still owed. A trigger keeps
// bills.amount_paid = sum of the bill's non-voided payments. Creditors are
// plain table writes (Admin insert/update policies). Rules/totals:
// payableTotals.ts.
import { supabase } from './supabaseClient'
import { fetchAll, fetchIn } from './dashboardExpenses'

export type Creditor = {
  creditor_id: number
  creditor_name: string
  contact_person: string | null
  phone: string | null
  tin_number: string | null
  note: string | null
}

export type BillPayment = {
  bill_payment_id: number
  bill_id: number
  amount: number
  paid_on: string
  method: string
  reference_no: string | null
  note: string | null
  voided_at: string | null
  void_reason: string | null
}

export type Bill = {
  bill_id: number
  creditor_id: number | null
  creditor_name: string | null
  category: string
  description: string
  bill_date: string
  due_date: string | null
  amount: number
  amount_paid: number
  reference_no: string | null
  note: string | null
  voided_at: string | null
  void_reason: string | null
  payments: BillPayment[]
}

export async function loadCreditors(): Promise<{ creditors: Creditor[]; error: string | null }> {
  const result = await fetchAll<Creditor>((a, b) =>
    supabase
      .from('creditors')
      .select('creditor_id, creditor_name, contact_person, phone, tin_number, note')
      .order('creditor_name')
      .range(a, b),
  )
  return { creditors: result.rows, error: result.error }
}

// Every bill (newest first) with its creditor name and payments.
export async function loadBills(): Promise<{ bills: Bill[]; error: string | null }> {
  type Raw = Omit<Bill, 'creditor_name' | 'payments'>
  const [bills, creditors] = await Promise.all([
    fetchAll<Raw>((a, b) =>
      supabase
        .from('bills')
        .select(
          'bill_id, creditor_id, category, description, bill_date, due_date, amount, amount_paid, reference_no, note, voided_at, void_reason',
        )
        .order('bill_date', { ascending: false })
        .order('bill_id', { ascending: false })
        .range(a, b),
    ),
    loadCreditors(),
  ])
  if (bills.error) return { bills: [], error: bills.error }
  if (creditors.error) return { bills: [], error: creditors.error }

  const payments = await fetchIn<BillPayment>(
    bills.rows.map((b) => b.bill_id),
    (chunk, a, b) =>
      supabase
        .from('bill_payments')
        .select('bill_payment_id, bill_id, amount, paid_on, method, reference_no, note, voided_at, void_reason')
        .in('bill_id', chunk)
        .order('paid_on')
        .range(a, b),
  )
  if (payments.error) return { bills: [], error: payments.error }

  const creditorName = new Map(creditors.creditors.map((s) => [s.creditor_id, s.creditor_name]))
  const paymentsByBill = new Map<number, BillPayment[]>()
  payments.rows.forEach((p) => {
    paymentsByBill.set(p.bill_id, [...(paymentsByBill.get(p.bill_id) ?? []), { ...p, amount: Number(p.amount) }])
  })

  return {
    bills: bills.rows.map((b) => ({
      ...b,
      amount: Number(b.amount),
      amount_paid: Number(b.amount_paid),
      creditor_name: b.creditor_id !== null ? (creditorName.get(b.creditor_id) ?? null) : null,
      payments: paymentsByBill.get(b.bill_id) ?? [],
    })),
    error: null,
  }
}

// Each returns an error message, or null when saved.

export async function createBill(args: {
  category: string
  description: string
  amount: number
  creditorId: number | null
  billDate: string
  dueDate: string
  referenceNo: string
  note: string
  // A one-off expense already paid: also records the full payment.
  paidNow: boolean
  method: string
}): Promise<string | null> {
  const { error } = await supabase.rpc('create_bill', {
    p_category: args.category,
    p_description: args.description,
    p_amount: args.amount,
    p_creditor_id: args.creditorId,
    p_bill_date: args.billDate || null,
    p_due_date: args.dueDate || null,
    p_reference_no: args.referenceNo || null,
    p_note: args.note || null,
    p_paid_now: args.paidNow,
    p_method: args.method,
  })
  return error ? error.message : null
}

export async function recordBillPayment(args: {
  billId: number
  amount: number
  method: string
  paidOn: string
  referenceNo: string
  note: string
}): Promise<string | null> {
  const { error } = await supabase.rpc('record_bill_payment', {
    p_bill_id: args.billId,
    p_amount: args.amount,
    p_method: args.method,
    p_paid_on: args.paidOn || null,
    p_reference_no: args.referenceNo || null,
    p_note: args.note || null,
  })
  return error ? error.message : null
}

export async function voidBillPayment(billPaymentId: number, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('void_bill_payment', {
    p_bill_payment_id: billPaymentId,
    p_reason: reason,
  })
  return error ? error.message : null
}

export async function voidBill(billId: number, reason: string): Promise<string | null> {
  const { error } = await supabase.rpc('void_bill', { p_bill_id: billId, p_reason: reason })
  return error ? error.message : null
}

// Add (no id) or edit a creditor. Blank optional fields are saved as null.
export async function saveCreditor(
  creditor: Omit<Creditor, 'creditor_id'> & { creditor_id?: number },
): Promise<string | null> {
  const values = {
    creditor_name: creditor.creditor_name.trim(),
    contact_person: creditor.contact_person?.trim() || null,
    phone: creditor.phone?.trim() || null,
    tin_number: creditor.tin_number?.trim() || null,
    note: creditor.note?.trim() || null,
  }
  const query = creditor.creditor_id
    ? supabase.from('creditors').update(values).eq('creditor_id', creditor.creditor_id).select('creditor_id').maybeSingle()
    : supabase.from('creditors').insert(values).select('creditor_id').maybeSingle()
  const { data, error } = await query
  if (error) {
    // 23505 = the unique index on the creditor name.
    return error.code === '23505' ? 'A creditor with that name already exists.' : error.message
  }
  // An UPDATE blocked by RLS reports no error but matches no row.
  return data ? null : "The creditor wasn't saved (no permission?)."
}
