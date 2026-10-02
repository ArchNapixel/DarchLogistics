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
        {
          label: 'Payroll (gross pay)',
          note: 'Includes driver commission and per-trip fees',
          value: data.payroll,
        },
        {
          label: 'Employer contributions',
          note: 'SSS, PhilHealth, Pag-IBIG',
          value: data.employerShares,
        },
        {
          label: 'Diesel (logged)',
          note: 'Fuel the crew recorded',
          value: data.dieselActual,
        },
        {
          label: 'Diesel (estimated)',
          note: `${data.estimatedTrips} delivered ${data.estimatedTrips === 1 ? 'trip' : 'trips'} with no fuel logged, from the quote calculator`,
          value: data.dieselEstimated,
        },
        {
          label: 'Other trip expenses',
          note: 'Tolls, parking, other',
          value: data.tripExpenses,
        },
        {
          label: 'Damage charged to company',
          note: 'Approved damage the company absorbs',
          value: data.damageCompany,
        },
      ]
    : []

  return (
    <div className="reports-blueprint-card px-[22px] pt-[22px] pb-5">
      <p className="font-ui text-[11px] font-medium tracking-[0.16em] text-neutral-500 uppercase">
        Operational Expenses
      </p>

      {error ? (
        <p className="mt-2 font-ui text-sm text-red-700">{error}</p>
      ) : (
        <>
          <p className="font-condensed mt-2 text-[40px] leading-none font-bold text-reports-ink">
            {loading || !data ? '--' : peso(data.total)}
          </p>

          {data && !loading && (
            <>
              {data.draftPayroll > 0 && (
                <p className="mt-1 font-ui text-xs text-neutral-500">
                  Includes {peso(data.draftPayroll)} from draft payslips (not yet finalized) --
                  this changes as payroll is edited.
                </p>
              )}
              {data.dieselPriceMissing && (
                <p className="mt-1 font-ui text-xs text-amber-700">
                  No diesel price set under Settings, so estimated diesel shows ₱0.
                </p>
              )}
              {data.tripsMissingDistance > 0 && (
                <p className="mt-1 font-ui text-xs text-amber-700">
                  {data.tripsMissingDistance} delivered{' '}
                  {data.tripsMissingDistance === 1 ? 'trip has' : 'trips have'} no distance on
                  the booking, so its diesel estimate is ₱0.
                </p>
              )}

              <ul className="mt-5 font-ui text-sm">
                {lines.map((line) => (
                  <li
                    key={line.label}
                    className="border-b border-reports-hairline py-2 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-3">
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
                    <p className="mt-1 text-xs text-neutral-400">{line.note}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default OperationalExpensesCard
