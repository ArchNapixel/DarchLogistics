// DispatchStatusLogSection: read-only history of every itinerary status
// change -- who changed it, from what, to what, and when. Backed by
// dispatch_status_logs, which was write-only until this section was
// built (it had no SELECT policy before).
import { useEffect, useEffectEvent, useState } from 'react'
import { LoadMore, LOG_PAGE_SIZE } from '../../../components/LoadMore'
import {
  loadDispatchStatusLog,
  type DispatchStatusLogEntry,
} from '../../../lib/dispatchStatusLog'
import { formatDateTime } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

function DispatchStatusLogSection() {
  const [entries, setEntries] = useState<DispatchStatusLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [limit, setLimit] = useState(LOG_PAGE_SIZE)

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
    return <p className="text-slate-500">Loading status log...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (entries.length === 0) {
    return <EmptyState message="No status changes logged yet." />
  }

  return (
    <div>
      <div className="overflow-x-auto border-2 border-line-card bg-white">
        <table className="w-full text-left text-sm text-ink-metric">
          <thead>
            <tr>
              <th className="px-4 py-2.5">Itinerary</th>
              <th className="px-4 py-2.5">Change</th>
              <th className="px-4 py-2.5">Changed By</th>
              <th className="px-4 py-2.5">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.log_id} className="border-b border-slate-200 last:border-0">
                <td className="px-4 py-3 text-slate-900">#{entry.itinerary_id}</td>
                <td className="px-4 py-3 text-slate-600">
                  {entry.previous_status} → {entry.new_status}
                </td>
                <td className="px-4 py-3 text-slate-600">{entry.changed_by_name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {formatDateTime(entry.changed_at)}
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
