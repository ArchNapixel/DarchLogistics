import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type LedgerRow = {
  cash_advance_id: number
  employee_id: number
  employee_name: string
  amount: number
  note: string | null
  status: string
  created_at: string
}

type LedgerTotals = {
  issued: number
  deducted: number
  outstanding: number
}

function money(value: number) {
  return `₱${value.toLocaleString()}`
}

function CashAdvanceLedgerSection() {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [totals, setTotals] = useState<LedgerTotals>({ issued: 0, deducted: 0, outstanding: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLedger = useCallback(async () => {
    setLoading(true)
    const { data: advanceRows, error: advanceError } = await supabase
      .from('cash_advances')
      .select('cash_advance_id, employee_id, amount, note, status, created_at')
      .order('created_at', { ascending: false })

    if (advanceError) {
      setError(advanceError.message)
      setLoading(false)
      return
    }

    const employeeIds = Array.from(new Set((advanceRows ?? []).map((row) => row.employee_id)))
    const [employeesResult, payslipsResult] = await Promise.all([
      employeeIds.length > 0
        ? supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('payroll_payslips').select('employee_id, cash_advance_deducted'),
    ])

    const lookupError = employeesResult.error ?? payslipsResult.error
    if (lookupError) {
      setError(lookupError.message)
      setLoading(false)
      return
    }

    const names = new Map((employeesResult.data ?? []).map((employee) => [employee.employee_id, employee.full_name]))
    const ledgerRows = (advanceRows ?? []).map((row) => ({
      ...row,
      employee_name: names.get(row.employee_id) ?? `Employee #${row.employee_id}`,
    }))
    const issued = ledgerRows
      .filter((row) => row.status === 'Approved')
      .reduce((sum, row) => sum + Number(row.amount), 0)
    const deducted = (payslipsResult.data ?? []).reduce(
      (sum, row) => sum + Number(row.cash_advance_deducted ?? 0),
      0,
    )

    setRows(ledgerRows)
    setTotals({ issued, deducted, outstanding: Math.max(0, issued - deducted) })
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLedger(), 0)
    return () => window.clearTimeout(timer)
  }, [loadLedger])

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Approved advances</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{money(totals.issued)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Deducted through payroll</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{money(totals.deducted)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Outstanding</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{money(totals.outstanding)}</p>
        </div>
      </div>

      {loading && <p className="mt-4 text-slate-500">Loading cash advance ledger...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && rows.length === 0 && <p className="mt-4 text-slate-500">No cash advances recorded.</p>}
      {!loading && !error && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cash_advance_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-900">{row.employee_name}</td>
                  <td className="px-4 py-3 text-slate-600">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{money(Number(row.amount))}</td>
                  <td className="px-4 py-3 text-slate-600">{row.status}</td>
                  <td className="px-4 py-3 text-slate-600">{row.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default CashAdvanceLedgerSection
