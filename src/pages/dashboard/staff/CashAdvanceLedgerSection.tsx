import { useCallback, useEffect, useState } from 'react'
import Pager from '../../../components/Pager'
import { usePaged } from '../../../lib/usePaged'
import { supabase } from '../../../lib/supabaseClient'
import { fetchAll } from '../../../lib/dashboardExpenses'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

type LedgerRow = {
  cash_advance_id: number
  employee_id: number
  employee_name: string
  amount: number
  note: string | null
  status: string
  created_at: string
  // How much of this advance payroll has already taken back (oldest
  // advances are repaid first -- payslips don't say which one they paid).
  repaid: number
}

type LedgerTotals = {
  pending: number
  issued: number
  deducted: number
  total: number
}

function CashAdvanceLedgerSection() {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [totals, setTotals] = useState<LedgerTotals>({ pending: 0, issued: 0, deducted: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLedger = useCallback(async () => {
    setLoading(true)
    // Every page -- Supabase stops at 1000 rows.
    const { rows: advanceRows, error: advanceError } = await fetchAll<{
      cash_advance_id: number
      employee_id: number
      amount: number
      note: string | null
      status: string
      created_at: string
    }>((from, to) =>
      supabase
        .from('cash_advances')
        .select('cash_advance_id, employee_id, amount, note, status, created_at')
        .order('created_at', { ascending: false })
        .order('cash_advance_id', { ascending: false })
        .range(from, to),
    )

    if (advanceError) {
      setError(advanceError)
      setLoading(false)
      return
    }

    const employeeIds = Array.from(new Set(advanceRows.map((row) => row.employee_id)))
    const [employeesResult, payslipsResult] = await Promise.all([
      employeeIds.length > 0
        ? supabase.from('employees').select('employee_id, full_name').in('employee_id', employeeIds)
        : Promise.resolve({ data: [], error: null }),
      // Only FINALIZED payslips: a draft's deduction hasn't been taken
      // from anyone yet and can still be edited or regenerated.
      fetchAll<{ employee_id: number; cash_advance_deducted: number | null }>((from, to) =>
        supabase
          .from('payroll_payslips')
          .select('employee_id, cash_advance_deducted')
          .not('finalized_at', 'is', null)
          .range(from, to),
      ),
    ])

    const lookupError = employeesResult.error?.message ?? payslipsResult.error
    if (lookupError) {
      setError(lookupError)
      setLoading(false)
      return
    }

    const names = new Map((employeesResult.data ?? []).map((employee) => [employee.employee_id, employee.full_name]))
    // Pool each employee's deductions, then hand them to their Approved
    // advances oldest-first.
    const leftToAllocate = new Map<number, number>()
    for (const p of payslipsResult.rows) {
      leftToAllocate.set(
        p.employee_id,
        (leftToAllocate.get(p.employee_id) ?? 0) + Number(p.cash_advance_deducted ?? 0),
      )
    }
    const repaidById = new Map<number, number>()
    ;[...advanceRows]
      .filter((row) => row.status === 'Approved')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .forEach((row) => {
        const left = leftToAllocate.get(row.employee_id) ?? 0
        const part = Math.min(left, Number(row.amount))
        repaidById.set(row.cash_advance_id, part)
        leftToAllocate.set(row.employee_id, left - part)
      })

    const ledgerRows = advanceRows.map((row) => ({
      ...row,
      employee_name: names.get(row.employee_id) ?? `Employee #${row.employee_id}`,
      repaid: repaidById.get(row.cash_advance_id) ?? 0,
    }))
    const pending = ledgerRows
      .filter((row) => row.status === 'Pending')
      .reduce((sum, row) => sum + Number(row.amount), 0)
    const issued = ledgerRows
      .filter((row) => row.status === 'Approved')
      .reduce((sum, row) => sum + Number(row.amount), 0)
    const deducted = payslipsResult.rows.reduce(
      (sum, row) => sum + Number(row.cash_advance_deducted ?? 0),
      0,
    )

    setRows(ledgerRows)
    // Current = disbursed minus what payroll has already taken back
    setTotals({ pending, issued, deducted, total: Math.max(0, issued - deducted) })
    setError(null)
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLedger(), 0)
  return () => window.clearTimeout(timer)
  }, [loadLedger])

  // One page at a time.
  const paged = usePaged(rows, '')
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pending approval</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{formatMoney(totals.pending)}</p>
        </div>
        <div className="border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Disbursed to employee</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{formatMoney(totals.issued)}</p>
        </div>
        <div className="border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Deducted from payroll</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{formatMoney(totals.deducted)}</p>
        </div>
        <div className="border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total current cash advances</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{formatMoney(totals.total)}</p>
        </div>
      </div>

      {loading && <p className="mt-4 text-slate-500">Loading cash advance ledger...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && rows.length === 0 && <EmptyState message="No cash advances recorded." className="mt-4" />}
      {!loading && !error && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Repaid</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((row) => (
                <tr key={row.cash_advance_id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-900">{row.employee_name}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(row.created_at)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{formatMoney(Number(row.amount))}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.status === 'Approved' ? `${formatMoney(row.repaid)} / ${formatMoney(Number(row.amount))}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.status === 'Approved' && row.repaid >= Number(row.amount) ? 'Settled' : row.status}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager {...paged.pager} />
        </div>
      )}
    </div>
  )
}

export default CashAdvanceLedgerSection
