// WorkOrderAcceptanceLogSection: admin read-only audit trail of every
// Task Board accept event (src/lib/workOrderAcceptanceLog.ts).
import { useEffect, useState } from 'react'
import { LoadMore, LOG_PAGE_SIZE } from '../../../components/LoadMore'
import {
  loadWorkOrderAcceptanceLog,
  type WorkOrderAcceptanceEntry,
} from '../../../lib/workOrderAcceptanceLog'

function WorkOrderAcceptanceLogSection() {
  const [entries, setEntries] = useState<WorkOrderAcceptanceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [limit, setLimit] = useState(LOG_PAGE_SIZE)

  useEffect(() => {
    load(limit)
  }, [limit])

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

  if (loading) {
    return <p className="text-slate-500">Loading acceptance log...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (entries.length === 0) {
    return <p className="text-slate-500">No work orders accepted yet.</p>
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Work Order</th>
              <th className="px-4 py-3 font-medium">Mechanic</th>
              <th className="px-4 py-3 font-medium">Accepted At</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.log_id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 text-slate-900">{entry.work_order_number}</td>
                <td className="px-4 py-3 text-slate-600">{entry.employee_name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(entry.accepted_at).toLocaleString()}
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
