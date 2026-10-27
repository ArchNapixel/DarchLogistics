// WorkOrderAcceptanceLogSection: admin read-only audit trail of every
// Task Board accept event (src/lib/workOrderAcceptanceLog.ts).
import { useEffect, useEffectEvent, useState } from 'react'
import { LoadMore, LOG_PAGE_SIZE } from '../../../components/LoadMore'
import {
  loadWorkOrderAcceptanceLog,
  type WorkOrderAcceptanceEntry,
} from '../../../lib/workOrderAcceptanceLog'
import { formatDateTime } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function WorkOrderAcceptanceLogSection() {
  const [entries, setEntries] = useState<WorkOrderAcceptanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [limit, setLimit] = useState(LOG_PAGE_SIZE)

  // No setLoading(true) here: "Show more" keeps the table on screen.
  async function load(rowLimit: number) {
    const { entries: loaded, error: loadError } = await loadWorkOrderAcceptanceLog(rowLimit)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setEntries(loaded)
    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever limit changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    load(limit)
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [limit])

  if (loading) {
    return <p className="text-slate-500">Loading acceptance log...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (entries.length === 0) {
    return <EmptyState message="No work orders accepted yet." />
  }

  return (
    <div>
      <div className="overflow-x-auto border-2 border-line-card bg-white">
        <table className="w-full text-left text-sm text-ink-metric">
          <thead>
            <tr>
              <th className="px-4 py-2.5">Work Order</th>
              <th className="px-4 py-2.5">Mechanic</th>
              <th className="px-4 py-2.5">Accepted At</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.log_id} className="border-b border-slate-200 last:border-0">
                <td className="px-4 py-3 text-slate-900">{entry.work_order_number}</td>
                <td className="px-4 py-3 text-slate-600">{entry.employee_name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDateTime(entry.accepted_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMore shown={entries.length} limit={limit} onMore={() => setLimit((n) => n + LOG_PAGE_SIZE)} />
    </div>
  )
}

export default WorkOrderAcceptanceLogSection
