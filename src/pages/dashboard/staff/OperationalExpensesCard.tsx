// OperationalExpensesCard: the Admin dashboard card showing what running
// the business cost in the chosen period -- payroll, trip expenses, diesel
// and damage charged to the Company. Numbers come from
// loadOperationalExpenses() (lib/dashboardExpenses.ts, which explains what
// is counted and why nothing is counted twice). Reloads whenever `period`
// or `refreshKey` changes.
import { useEffect, useState } from 'react'
import {
  loadOperationalExpenses,
  type OperationalExpenses,
} from '../../../lib/dashboardExpenses'
import type { Period } from '../../../lib/expenseTotals'
import { formatMoney } from '../../../lib/format'

function OperationalExpensesCard({
  period,
  refreshKey,
  collapsed = false,
  onTotal,
}: {
  period: Period
  refreshKey: number
  collapsed?: boolean // true = show only the big number
  // Reports this card's total to the dashboard (null while loading/failed),
  // so it can work out the net figure.
  onTotal?: (total: number | null) => void
}) {
  const [data, setData] = useState<OperationalExpenses | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await loadOperationalExpenses(period)
      if (cancelled) return
      if (result.error) {
        console.error('Failed to load operational expenses', result.error)
        setError(`Couldn't load operational expenses (${result.error}).`)
      } else {
        setError(null)
        setData(result.data)
      }
      onTotal?.(result.error ? null : (result.data?.total ?? null))
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onTotal is a state setter
  }, [period, refreshKey])

  const lines = data
    ? [
        { label: 'Payroll', value: data.payroll },
        { label: 'Employer contributions', value: data.employerShares },
        { label: 'Diesel (logged)', value: data.dieselActual },
        {
          label: `Diesel (estimated, ${data.estimatedTrips} ${data.estimatedTrips === 1 ? 'trip' : 'trips'})`,
          value: data.dieselEstimated,
        },
        { label: 'Tolls & other trip costs', value: data.tripExpenses },
        { label: 'Company-paid damage', value: data.damageCompany },
      ]
    : []

  return (
    <div className="reports-blueprint-card px-3 py-2.5 sm:px-5 sm:py-3">
      <p className="font-ui text-xs leading-tight font-medium text-neutral-500 sm:text-sm">
        Operational Expenses
      </p>

      {error ? (
        <p className="mt-2 font-ui text-sm text-red-700">{error}</p>
      ) : (
        <>
          <p className="font-condensed mt-1 text-2xl sm:text-[28px] leading-none font-bold text-reports-ink">
            {loading || !data ? '--' : formatMoney(data.total)}
          </p>

          {data && !loading && (
            // Height slides between 0 and full via the grid-rows trick
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"}`}
            >
            <div className="overflow-hidden">
            <div className="max-sm:hidden">
              {data.draftPayroll > 0 && (
                <p className="mt-1 font-ui text-xs text-neutral-500">
                  Includes {formatMoney(data.draftPayroll)} in draft payslips.
                </p>
              )}
              {data.dieselPriceMissing && (
                <p className="mt-1 font-ui text-xs text-amber-700">
                  No diesel price set in Settings.
                </p>
              )}
              {data.tripsMissingDistance > 0 && (
                <p className="mt-1 font-ui text-xs text-amber-700">
                  {data.tripsMissingDistance}{' '}
                  {data.tripsMissingDistance === 1 ? 'trip has' : 'trips have'} no distance
                  (estimated as ₱0).
                </p>
              )}

              <ul className="mt-5 font-ui text-sm">
                {lines.map((line) => (
                  <li
                    key={line.label}
                    className="py-2"
                  >
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <span className="text-reports-ink">{line.label}</span>
                      <span className="text-neutral-600">
                        {formatMoney(line.value)}
                        {data.total > 0 && (
                          <span className="ml-2 text-neutral-400">
                            {Math.round((line.value / data.total) * 100)}%
                          </span>
                        )}
                      </span>
                    </div>
                    {data.total > 0 && (
                      <div className="mt-1 h-1 bg-neutral-100">
                        <div
                          className="h-1 bg-accent-500"
                          style={{ width: `${(line.value / data.total) * 100}%` }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default OperationalExpensesCard
