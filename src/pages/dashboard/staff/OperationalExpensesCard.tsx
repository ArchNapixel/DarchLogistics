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

const peso = (n: number) =>
  `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

function OperationalExpensesCard({
  period,
  refreshKey,
}: {
  period: Period
  refreshKey: number
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
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
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
    <div className="reports-blueprint-card dashboard-card-bold px-3 pt-3 pb-3 sm:px-[22px] sm:pt-[22px] sm:pb-5">
      <p className="font-ui text-xs leading-tight font-medium text-neutral-500 sm:text-sm">
        Operational Expenses
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
              {data.draftPayroll > 0 && (
                <p className="mt-1 font-ui text-xs text-neutral-500">
                  Includes {peso(data.draftPayroll)} in draft payslips.
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
                        {peso(line.value)}
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
          )}
        </>
      )}
    </div>
  )
}

export default OperationalExpensesCard
