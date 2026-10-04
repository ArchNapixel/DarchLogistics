// PayrollExpensesCard: the Admin dashboard card showing what payroll cost
// the company in the chosen period -- gross pay plus the employer's
// government shares (draft payslips included), then each employee ranked
// by gross earnings. Numbers come from
// loadPayrollExpenses() (lib/dashboardExpenses.ts). Reloads whenever
// `period` or `refreshKey` changes.
import { useEffect, useState } from 'react'
import { loadPayrollExpenses, type PayrollExpenses } from '../../../lib/dashboardExpenses'
import type { Period } from '../../../lib/expenseTotals'

const peso = (n: number) =>
  `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

function PayrollExpensesCard({
  period,
  refreshKey,
  className = '',
}: {
  period: Period
  refreshKey: number
  className?: string
}) {
  const [data, setData] = useState<PayrollExpenses | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await loadPayrollExpenses(period)
      if (cancelled) return
      if (result.error) {
        console.error('Failed to load payroll expenses', result.error)
        setError(`Couldn't load payroll expenses (${result.error}).`)
      } else {
        setError(null)
        setData(result.data)
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [period, refreshKey])

  return (
    <div className={`reports-blueprint-card dashboard-card-bold px-3 pt-3 pb-3 sm:px-[22px] sm:pt-[22px] sm:pb-5 ${className}`}>
      <p className="font-ui text-xs leading-tight font-medium text-neutral-500 sm:text-sm">
        Payroll Expenses
      </p>

      {error ? (
        <p className="mt-2 font-ui text-sm text-red-700">{error}</p>
      ) : (
        <>
          <p className="font-condensed mt-1.5 text-2xl sm:mt-2 sm:text-[40px] leading-none font-bold text-reports-ink">
            {loading || !data ? '--' : peso(data.total)}
          </p>

          {data && !loading && (
            <div className="max-sm:hidden">
              <p className="mt-1 font-ui text-xs text-neutral-500">
                {data.payslips} {data.payslips === 1 ? 'payslip' : 'payslips'}
                {data.draft > 0 && <>, incl. {peso(data.draft)} in drafts</>}.
              </p>

              {/* Employees ranked by gross earnings; bars are relative to the top earner */}
              <ul className="mt-5 max-h-72 overflow-y-auto pr-1 font-ui text-sm">
                {data.earners.map((e, i) => (
                  <li key={e.id} className="py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-reports-ink">
                        <span className="mr-2 text-neutral-400">{i + 1}.</span>
                        {e.name}
                        <span className="ml-2 text-xs text-neutral-400">{e.position}</span>
                      </span>
                      <span className="text-neutral-600">{peso(e.gross)}</span>
                    </div>
                    <div className="mt-1 h-1 bg-neutral-100">
                      <div
                        className="h-1 bg-accent-500"
                        style={{ width: `${(e.gross / data.earners[0].gross) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default PayrollExpensesCard
