// InventoryReportModal: "Print Inventory Report" on the Inventory page --
// pick any date and it snaps to that Sunday-through-Saturday week,
// previews a CSV of current stock levels plus everything used out of
// stock that week, and lets staff download it. See
// lib/inventoryReport.ts for how "used stock" is sourced.
import { useEffect, useEffectEvent, useState } from 'react'
import {
  loadReportWeekOptions,
  loadInventoryReport,
  buildInventoryReportCsv,
  summarizeUsageByItem,
  type ReportWeekOption,
  type CurrentStockRow,
  type UsedStockRow,
} from '../../../lib/inventoryReport'
import { formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'

function InventoryReportModal({ onClose }: { onClose: () => void }) {
  const [weekOptions, setWeekOptions] = useState<ReportWeekOption[]>([])
  const [selectedWeek, setSelectedWeek] = useState<ReportWeekOption | null>(null)
  const [currentStock, setCurrentStock] = useState<CurrentStockRow[]>([])
  const [usedStock, setUsedStock] = useState<UsedStockRow[]>([])
  const [loadingWeeks, setLoadingWeeks] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usageTotals = summarizeUsageByItem(usedStock)

  async function loadWeeks() {
    setLoadingWeeks(true)
    const { weeks, error: weeksError } = await loadReportWeekOptions()

    if (weeksError) {
      setError(weeksError)
      setLoadingWeeks(false)
      return
    }

    setWeekOptions(weeks)
    setSelectedWeek(weeks[0] ?? null)
    setLoadingWeeks(false)
  }

  // Load once, when this opens.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    loadWeeks()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [])

  async function load() {
    if (!selectedWeek) return

    setLoading(true)
    const {
      currentStock: stock,
      usedStock: used,
      error: loadError,
    } = await loadInventoryReport(selectedWeek.start, selectedWeek.end)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setCurrentStock(stock)
    setUsedStock(used)
    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever selectedWeek changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow2 = useEffectEvent(() => {
    if (selectedWeek) load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow2, 0)
    return () => clearTimeout(timer)
  }, [selectedWeek])

  function handleDownload() {
    if (!selectedWeek) return

    const csv = buildInventoryReportCsv({
      weekStart: selectedWeek.start,
      weekEnd: selectedWeek.end,
      currentStock,
      usedStock,
    })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `inventory-report_${selectedWeek.start}_to_${selectedWeek.end}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Print Inventory Report</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-500">
          Reports run Sunday through Saturday.
        </p>

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700 sm:w-72">
          Week
          {loadingWeeks ? (
            <p className="text-sm text-slate-500">Loading weeks...</p>
          ) : (
            <select
              value={selectedWeek?.start ?? ''}
              onChange={(e) => {
                const week = weekOptions.find((w) => w.start === e.target.value)
                if (week) setSelectedWeek(week)
              }}
              className={fieldClasses}
            >
              {weekOptions.map((week) => (
                <option key={week.start} value={week.start}>
                  {week.label}
                </option>
              ))}
            </select>
          )}
        </label>

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        {loadingWeeks || loading ? (
          <p className="mt-4 text-slate-500">Loading...</p>
        ) : (
          <div className="mt-4 grid gap-6">
            <div>
              <h4 className="text-sm font-semibold text-slate-700">
                Current Stock ({currentStock.length} items)
              </h4>
              <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200">
                <table className="w-full text-left text-sm text-ink-metric">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentStock.map((item) => (
                      <tr key={item.item_id} className="border-b border-slate-200 last:border-0">
                        <td className="px-3 py-2 text-slate-900">{item.name}</td>
                        <td className="px-3 py-2 text-slate-600">{item.item_type}</td>
                        <td className="px-3 py-2 text-slate-600">{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-700">Usage by Item</h4>
              {usageTotals.length === 0 ? (
                <EmptyState message="No stock used this week." className="mt-2" />
              ) : (
                <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200">
                  <table className="w-full text-left text-sm text-ink-metric">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Total Used</th>
                        <th className="px-3 py-2">Work Orders</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageTotals.map((row) => (
                        <tr key={row.item_id} className="border-b border-slate-200 last:border-0">
                          <td className="px-3 py-2 text-slate-900">{row.name}</td>
                          <td className="px-3 py-2 font-medium text-slate-900">{row.total_used}</td>
                          <td className="px-3 py-2 text-slate-600">{row.work_order_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-700">
                Stock Used This Week ({usedStock.length} entries)
              </h4>
              {usedStock.length === 0 ? (
                <EmptyState message="No stock used this week." className="mt-2" />
              ) : (
                <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200">
                  <table className="w-full text-left text-sm text-ink-metric">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Qty Used</th>
                        <th className="px-3 py-2">Work Order</th>
                        <th className="px-3 py-2">Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usedStock.map((row, index) => (
                        <tr key={index} className="border-b border-slate-200 last:border-0">
                          <td className="px-3 py-2 text-slate-900">{row.item_name_text}</td>
                          <td className="px-3 py-2 text-slate-600">{row.quantity}</td>
                          <td className="px-3 py-2 text-slate-600">{row.work_order_number}</td>
                          <td className="px-3 py-2 text-slate-600">
                            {formatDate(row.completed_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || loadingWeeks || !selectedWeek}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            Download CSV
          </button>
        </div>
      </div>
    </div>
  )
}

export default InventoryReportModal
