// WorkOrderStatusLogSection: read-only history of every work order
// status change -- who changed it, from what, to what, and when.
// Backed by work_order_status_log.
import { useEffect, useState } from 'react'
import {
  loadWorkOrderStatusLog,
  type WorkOrderStatusLogEntry,
} from '../../../lib/workOrderStatusLog'

function WorkOrderStatusLogSection() {
  const [entries, setEntries] = useState<WorkOrderStatusLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { entries: loaded, error: loadError } = await loadWorkOrderStatusLog()

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
    return <p className="text-slate-500">Loading status log...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (entries.length === 0) {
    return <p className="text-slate-500">No status changes logged yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Work Order</th>
            <th className="px-4 py-3 font-medium">Change</th>
            <th className="px-4 py-3 font-medium">Changed By</th>
            <th className="px-4 py-3 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.log_id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-3 text-slate-900">{entry.work_order_number}</td>
              <td className="px-4 py-3 text-slate-600">
                {entry.previous_status} → {entry.new_status}
              </td>
              <td className="px-4 py-3 text-slate-600">{entry.changed_by_name}</td>
              <td className="px-4 py-3 text-slate-600">
                {new Date(entry.changed_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default WorkOrderStatusLogSection
