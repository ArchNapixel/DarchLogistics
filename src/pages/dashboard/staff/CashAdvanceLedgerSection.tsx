import { useCallback, useEffect, useState } from 'react'
import StatusBadge from '../../../components/StatusBadge'
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

// `side` = a panel shown to the right of the table (the page's Issue form).
function CashAdvanceLedgerSection({ side }: { side?: React.ReactNode } = {}) {
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
  const tile = 'card min-w-0 flex-1 px-[18px] py-3.5'
  const tileLabel = 'text-sm font-medium text-ink-secondary'
  const tileValue = 'text-[28px] leading-9 font-bold tracking-[-0.01em] text-ink tabular-nums'
  const deductedShare = totals.issued > 0 ? Math.min((totals.deducted / totals.issued) * 100, 100) : 0
  const TH = 'px-2 py-2.5 first:pl-5 last:pr-5'
  const TD = 'px-2 py-2 first:pl-5 last:pr-5'

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Totals" className="flex flex-col gap-3 sm:flex-row">
        <div className={tile}>
          <p className={tileLabel}>Disbursed</p>
          <p className={tileValue}>{formatMoney(totals.issued)}</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Deducted</p>
          <p className={tileValue}>{formatMoney(totals.deducted)}</p>
          <div className="mt-1.5 h-2 bg-slate-200" aria-hidden="true">
            <div className="h-2 bg-ink-secondary" style={{ width: `${deductedShare}%` }} />
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">{deductedShare.toFixed(1)}% of disbursed</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Current balance</p>
          <p className={`${tileValue} text-primary`}>{formatMoney(totals.total)}</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            {formatMoney(totals.issued)} − {formatMoney(totals.deducted)}
          </p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Pending approval</p>
          <p className={tileValue}>{formatMoney(totals.pending)}</p>
        </div>
      </section>

      <div className={side ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start' : ''}>
        <section aria-label="Cash advances" className="card flex min-h-[calc(100dvh-24rem)] flex-col">
          {loading ? (
            <p className="p-5 text-ink-muted">Loading cash advance ledger...</p>
          ) : error ? (
            <p className="p-5 text-red-700">{error}</p>
          ) : rows.length === 0 ? (
            <EmptyState message="No cash advances recorded." className="m-5" />
          ) : (
            <div className="flex-1 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm text-ink-metric">
                <thead>
                  <tr>
                    <th className={TH}>Employee</th>
                    <th className={TH}>Reason</th>
                    <th className={TH}>Date</th>
                    <th className={`${TH} text-right`}>Amount</th>
                    <th className={`${TH} text-right`}>Remaining</th>
                    <th className={TH}>Deduction</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((row) => {
                    const amount = Number(row.amount)
                    const settled = row.status === 'Approved' && row.repaid >= amount
                    return (
                      <tr key={row.cash_advance_id} className="h-[60px] border-b border-slate-200">
                        <td className={`${TD} font-semibold text-ink`}>{row.employee_name}</td>
                        <td className={`${TD} ${row.note ? '' : 'text-ink-muted'}`}>{row.note ?? '—'}</td>
                        <td className={`${TD} whitespace-nowrap`}>{formatDate(row.created_at)}</td>
                        <td className={`${TD} text-right font-semibold tabular-nums`}>{formatMoney(amount)}</td>
                        <td className={`${TD} text-right tabular-nums`}>
                          {row.status === 'Approved' ? formatMoney(Math.max(amount - row.repaid, 0)) : '—'}
                        </td>
                        <td className={TD}>
                          {settled ? (
                            <StatusBadge status="Paid" label="Settled" icon />
                          ) : row.status === 'Approved' ? (
                            <StatusBadge status="In Progress" label="Deducting" icon />
                          ) : (
                            <StatusBadge status={row.status} icon />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex min-h-[60px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-5 py-2 text-sm text-ink-secondary">
            <span>Remaining amounts are deducted from each employee&apos;s next payslips.</span>
            {paged.pager.pageCount > 1 && (
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                  disabled={paged.pager.page === 0}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  ‹ Previous
                </button>
                <button
                  type="button"
                  onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                  disabled={paged.pager.page >= paged.pager.pageCount - 1}
                  className="btn-secondary px-3.5 text-sm font-medium"
                >
                  Next ›
                </button>
              </span>
            )}
          </div>
        </section>
        {side}
      </div>
    </div>
  )
}

export default CashAdvanceLedgerSection
