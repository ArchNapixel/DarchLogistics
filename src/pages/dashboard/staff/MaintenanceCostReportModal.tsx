// MaintenanceCostReportModal: "Cost Report" on the Maintenance page --
// pick a month, see what the fleet's maintenance cost in parts (per
// vehicle, then per work order), and download it as a CSV. See
// lib/maintenanceCostReport.ts for how costs are counted.
import { useEffect, useState } from 'react'
import {
  loadMaintenanceCostReport,
  summarizeCostByVehicle,
  buildMaintenanceCostCsv,
  currentReportMonth,
  type WorkOrderCost,
} from '../../../lib/maintenanceCostReport'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'

function formatMoney(value: number | null): string {
  return value !== null ? `₱${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'
}

function MaintenanceCostReportModal({ onClose }: { onClose: () => void }) {
  const [month, setMonth] = useState(currentReportMonth())
  const [workOrders, setWorkOrders] = useState<WorkOrderCost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const vehicles = summarizeCostByVehicle(workOrders)
  const fleetTotal = vehicles.reduce((sum, v) => sum + v.parts_cost, 0)
  const unpricedTotal = vehicles.reduce((sum, v) => sum + v.unpriced_lines, 0)

  useEffect(() => {
    if (month) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  async function load() {
    setLoading(true)
    const { workOrders: loaded, error: loadError } = await loadMaintenanceCostReport(month)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setWorkOrders(loaded)
    setError(null)
    setLoading(false)
  }

  function handleDownload() {
    const csv = buildMaintenanceCostCsv(month, workOrders)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `maintenance-cost-report_${month}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Maintenance Cost Report</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <p className="mt-2 text-sm text-slate-500">
          Parts used on work orders completed in the selected month, at the price each part had
          when it was used.
        </p>

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700 sm:w-72">
          Month
          <input
            type="month"
            value={month}
            max={currentReportMonth()}
            onChange={(e) => setMonth(e.target.value)}
            className={fieldClasses}
          />
        </label>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        {loading ? (
          <p className="mt-4 text-slate-500">Loading...</p>
        ) : workOrders.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No work orders were completed this month.</p>
        ) : (
          <div className="mt-4 grid gap-6">
            <div className="flex flex-wrap gap-6 rounded-lg border border-slate-200 px-4 py-3">
              <div>
                <p className="text-xs text-slate-500">Fleet total (parts)</p>
                <p className="text-lg font-bold text-slate-900">{formatMoney(fleetTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Work orders completed</p>
                <p className="text-lg font-bold text-slate-900">{workOrders.length}</p>
              </div>
            </div>

            {unpricedTotal > 0 && (
              <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {unpricedTotal} part {unpricedTotal === 1 ? 'entry has' : 'entries have'} no price
                on record (used before prices were set), so {unpricedTotal === 1 ? "it isn't" : "they aren't"}{' '}
                in the totals.
              </p>
            )}

            <div>
              <h4 className="text-sm font-semibold text-slate-700">Cost by Vehicle</h4>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Vehicle</th>
                      <th className="px-3 py-2 font-medium">Work Orders</th>
                      <th className="px-3 py-2 font-medium">Parts Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => (
                      <tr key={v.vehicle_label} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-2 text-slate-900">{v.vehicle_label}</td>
                        <td className="px-3 py-2 text-slate-600">{v.work_order_count}</td>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {formatMoney(v.parts_cost)}
                          {v.unpriced_lines > 0 && (
                            <span className="ml-2 text-xs font-normal text-amber-700">
                              +{v.unpriced_lines} unpriced
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-700">By Work Order</h4>
              <div className="mt-2 grid gap-3">
                {workOrders.map((wo) => (
                  <div key={`${wo.work_order_id}-${wo.completed_at}`} className="rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-medium text-slate-900">
                        {wo.work_order_number} · {wo.vehicle_label}
                      </span>
                      <span className="text-slate-600">
                        {wo.maintenance_type} · {new Date(wo.completed_at).toLocaleDateString()} ·{' '}
                        <span className="font-medium text-slate-900">{formatMoney(wo.total)}</span>
                      </span>
                    </div>
                    {wo.lines.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-500">No parts used.</p>
                    ) : (
                      <table className="w-full text-left text-sm">
                        <tbody>
                          {wo.lines.map((line, index) => (
                            <tr key={index} className="border-b border-slate-100 last:border-0">
                              <td className="px-3 py-2 text-slate-900">{line.item_name_text}</td>
                              <td className="px-3 py-2 text-slate-600">
                                {line.quantity} × {line.unit_cost !== null ? formatMoney(line.unit_cost) : 'no price'}
                              </td>
                              <td className="px-3 py-2 text-right text-slate-900">
                                {formatMoney(line.line_total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
          <button
            onClick={handleDownload}
            disabled={loading || !month || workOrders.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Download CSV
          </button>
        </div>
      </div>
    </div>
  )
}

export default MaintenanceCostReportModal
