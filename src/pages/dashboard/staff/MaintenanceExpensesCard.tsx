// MaintenanceExpensesCard: the Admin dashboard card showing what
// maintenance cost in the chosen period -- parts the mechanics used, with
// a pie of cost by inventory item type and the top items. Numbers come
// from loadMaintenanceExpenses() (lib/dashboardExpenses.ts); it reloads
// whenever `period` or `refreshKey` changes.
import { useEffect, useState } from 'react'
import {
  loadMaintenanceExpenses,
  type MaintenanceExpenses,
} from '../../../lib/dashboardExpenses'
import type { Period } from '../../../lib/expenseTotals'

const peso = (n: number) =>
  `₱${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

// One fill per slice, darkest = biggest. The legend beside the pie repeats
// every value in text, so the chart never depends on color alone.
const SLICE_FILLS = [
  'fill-accent-900',
  'fill-accent-700',
  'fill-accent-500',
  'fill-accent-300',
  'fill-neutral-400',
]
const SWATCH_BG = [
  'bg-accent-900',
  'bg-accent-700',
  'bg-accent-500',
  'bg-accent-300',
  'bg-neutral-400',
]

// SVG pie, drawn from 12 o'clock clockwise. Only slices with cost > 0.
function Pie({ slices }: { slices: { type: string; cost: number }[] }) {
  const total = slices.reduce((s, x) => s + x.cost, 0)
  const drawn = slices
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => s.cost > 0)
  const point = (angle: number) =>
    `${60 + 56 * Math.cos(angle)} ${60 + 56 * Math.sin(angle)}`

  let angle = -Math.PI / 2
  return (
    <svg viewBox="0 0 120 120" className="h-40 w-40 shrink-0" role="img" aria-label="Maintenance cost by item type">
      {drawn.length === 1 ? (
        // A single slice is a full circle (an arc can't start and end on the same point).
        <circle cx="60" cy="60" r="56" className={SLICE_FILLS[drawn[0].index % SLICE_FILLS.length]} />
      ) : (
        drawn.map((s) => {
          const sweep = (s.cost / total) * Math.PI * 2
          const start = angle
          angle += sweep
          return (
            <path
              key={s.type}
              d={`M 60 60 L ${point(start)} A 56 56 0 ${sweep > Math.PI ? 1 : 0} 1 ${point(angle)} Z`}
              className={`${SLICE_FILLS[s.index % SLICE_FILLS.length]} stroke-white`}
              strokeWidth="1"
            />
          )
        })
      )}
    </svg>
  )
}

function MaintenanceExpensesCard({
  period,
  refreshKey,
}: {
  period: Period
  refreshKey: number
}) {
  const [data, setData] = useState<MaintenanceExpenses | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const result = await loadMaintenanceExpenses(period)
      if (cancelled) return
      if (result.error) {
        console.error('Failed to load maintenance expenses', result.error)
        setError(`Couldn't load maintenance expenses (${result.error}).`)
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
    <div className="reports-blueprint-card px-[22px] pt-[22px] pb-5">
      <p className="font-ui text-[11px] font-medium tracking-[0.16em] text-neutral-500 uppercase">
        Maintenance Expenses <span className="normal-case">(parts used)</span>
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
              {data.inProgressCost > 0 && (
                <p className="mt-1 font-ui text-xs text-neutral-500">
                  Includes {peso(data.inProgressCost)} on work orders still in progress.
                </p>
              )}
              {data.unpricedLines > 0 && (
                <p className="mt-1 font-ui text-xs text-amber-700">
                  {data.unpricedLines} part {data.unpricedLines === 1 ? 'entry has' : 'entries have'} no
                  price on record and count as ₱0. Set prices on the Inventory page.
                </p>
              )}

              {data.byType.length === 0 ? (
                <p className="mt-4 font-ui text-sm text-neutral-500">
                  No maintenance parts used in this period.
                </p>
              ) : (
                <>
                  <p className="mt-5 font-ui text-[11px] font-medium tracking-[0.16em] text-neutral-500 uppercase">
                    Cost by item type
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-6">
                    {data.total > 0 && <Pie slices={data.byType} />}
                    <ul className="min-w-[10rem] flex-1 font-ui text-sm">
                      {data.byType.map((t, i) => (
                        <li key={t.type} className="flex items-center justify-between gap-3 py-1">
                          <span className="flex items-center gap-2 text-reports-ink">
                            <span
                              className={`inline-block h-3 w-3 ${SWATCH_BG[i % SWATCH_BG.length]}`}
                            />
                            {t.type}
                          </span>
                          <span className="text-neutral-600">
                            {peso(t.cost)}
                            {data.total > 0 && (
                              <span className="ml-2 text-neutral-400">
                                {Math.round((t.cost / data.total) * 100)}%
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="mt-5 font-ui text-[11px] font-medium tracking-[0.16em] text-neutral-500 uppercase">
                    Biggest items
                  </p>
                  <ul className="mt-2 font-ui text-sm">
                    {data.topItems.map((item) => (
                      <li
                        key={`${item.type}|${item.name}`}
                        className="flex items-center justify-between gap-3 border-b border-reports-hairline py-1.5 last:border-0"
                      >
                        <span className="text-reports-ink">
                          {item.name}{' '}
                          <span className="text-neutral-400">
                            · {item.type} · {item.quantity} used
                          </span>
                        </span>
                        <span className="text-neutral-600">{peso(item.cost)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default MaintenanceExpensesCard
