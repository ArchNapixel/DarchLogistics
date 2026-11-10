// InventoryReportModal: "Inventory Report" on the Inventory page -- pick a
// Sunday-through-Saturday week, preview per item opening / in / used /
// returned / adjusted / written off / closing (from the stock history,
// lib/inventoryReport.ts) and download it as a CSV with every movement of
// the week.
import { previewCsv } from '../../../components/CsvPreview'
import { useEffect, useEffectEvent, useState } from 'react'
import {
  loadReportWeekOptions,
  loadInventoryReport,
  buildInventoryReportCsv,
  type ReportWeekOption,
  type ReportRow,
  type ReportLine,
} from '../../../lib/inventoryReport'
import { formatDate, formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'
const TH = 'px-2 py-2 text-right first:pl-3 first:text-left last:pr-3'
const TD = 'px-2 py-2 text-right tabular-nums first:pl-3 first:text-left last:pr-3'

function InventoryReportModal({ onClose }: { onClose: () => void }) {
  const [weekOptions, setWeekOptions] = useState<ReportWeekOption[]>([])
  const [selectedWeek, setSelectedWeek] = useState<ReportWeekOption | null>(null)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [lines, setLines] = useState<ReportLine[]>([])
  const [historyStart, setHistoryStart] = useState<string | null>(null)
  const [loadingWeeks, setLoadingWeeks] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    const result = await loadInventoryReport(selectedWeek.start, selectedWeek.end)

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setRows(result.rows)
    setLines(result.lines)
    setHistoryStart(result.historyStart)
    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever selectedWeek changes.
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
      rows,
      lines,
      historyStart,
    })
    previewCsv(csv, `inventory-report_${selectedWeek.start}_to_${selectedWeek.end}.csv`)
  }

  const usedValue = rows.reduce((s, r) => s + r.used_value, 0)
  const writtenOffValue = rows.reduce((s, r) => s + r.written_off_value, 0)
  const beforeHistory = historyStart !== null && selectedWeek !== null && historyStart > selectedWeek.start

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto bg-white p-6 border-2 border-line-card">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Inventory Report</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

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

        {error && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {loadingWeeks || loading ? (
          <p className="mt-4 text-slate-500">Loading...</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {beforeHistory && (
              <p className="bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Stock history starts {formatDate(historyStart)}. Stock before that wasn't tracked, so this week starts at 0.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="card px-4 py-3">
                <p className="text-sm text-ink-secondary">Parts used (value)</p>
                <p className="text-xl font-bold tabular-nums text-ink">{formatMoney(usedValue)}</p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-sm text-ink-secondary">Written off (value)</p>
                <p className={`text-xl font-bold tabular-nums ${writtenOffValue > 0 ? 'text-red-700' : 'text-ink'}`}>
                  {formatMoney(writtenOffValue)}
                </p>
              </div>
              <div className="card px-4 py-3">
                <p className="text-sm text-ink-secondary">Stock movements</p>
                <p className="text-xl font-bold tabular-nums text-ink">{lines.length}</p>
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState message="No items to report for this week." />
            ) : (
              <div className="overflow-x-auto border border-slate-200">
                <table className="w-full min-w-[760px] text-sm text-ink-metric">
                  <thead>
                    <tr>
                      <th className={TH}>Item</th>
                      <th className={TH}>Opening</th>
                      <th className={TH}>In</th>
                      <th className={TH}>Used</th>
                      <th className={TH}>Returned</th>
                      <th className={TH}>Adjusted</th>
                      <th className={TH}>Written off</th>
                      <th className={TH}>Closing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.item_id} className="border-b border-slate-200 last:border-0">
                        <td className={TD}>
                          <span className="font-semibold text-ink">{r.name}</span>
                          <span className="ml-1.5 text-xs text-ink-muted">
                            {r.unit}
                            {r.archived ? ' · archived' : ''}
                          </span>
                        </td>
                        <td className={TD}>{r.opening}</td>
                        <td className={TD}>{r.in || '—'}</td>
                        <td className={TD}>{r.used || '—'}</td>
                        <td className={TD}>{r.returned || '—'}</td>
                        <td className={TD}>{r.adjusted ? (r.adjusted > 0 ? `+${r.adjusted}` : r.adjusted) : '—'}</td>
                        <td className={`${TD} ${r.written_off ? 'text-red-700' : ''}`}>{r.written_off || '—'}</td>
                        <td className={`${TD} font-semibold text-ink`}>{r.closing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[13px] text-ink-muted">
              Opening + In − Used + Returned ± Adjusted − Written off = Closing. "In" is deliveries and starting stock. The CSV also
              lists every movement of the week.
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button onClick={onClose} className="btn-secondary px-4 text-sm font-medium">
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || loadingWeeks || !selectedWeek}
            className="btn-primary px-4 text-sm font-medium"
          >
            Download CSV
          </button>
        </div>
      </div>
    </div>
  )
}

export default InventoryReportModal
