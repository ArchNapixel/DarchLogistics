// DispatchStatusLogSection: read-only history of every itinerary status
// change -- who changed it, from what, to what, and when. Backed by
// dispatch_status_logs, which was write-only until this section was
// built (it had no SELECT policy before).
import { useEffect, useState } from 'react'
import { LoadMore, LOG_PAGE_SIZE } from '../../../components/LoadMore'
import {
  loadDispatchStatusLog,
  type DispatchStatusLogEntry,
} from '../../../lib/dispatchStatusLog'

function DispatchStatusLogSection() {
  const [entries, setEntries] = useState<DispatchStatusLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [limit, setLimit] = useState(LOG_PAGE_SIZE)

  useEffect(() => {
    load(limit)
  }, [limit])

  // No setLoading(true) here: "Show more" keeps the table on screen.
  async function load(rowLimit: number) {
    const { entries: loaded, error: loadError } = await loadDispatchStatusLog(rowLimit)

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
    <div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Itinerary</th>
              <th className="px-4 py-3 font-medium">Change</th>
              <th className="px-4 py-3 font-medium">Changed By</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.log_id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 text-slate-900">#{entry.itinerary_id}</td>
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
      <LoadMore shown={entries.length} limit={limit} onMore={() => setLimit((n) => n + LOG_PAGE_SIZE)} />
    </div>
  )
}

export default DispatchStatusLogSection
