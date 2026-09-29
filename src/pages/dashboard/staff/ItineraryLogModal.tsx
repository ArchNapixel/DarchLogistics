// ItineraryLogModal: pop-up on a single Dispatch Board row showing that
// itinerary's full status change history -- who changed it, from what,
// to what, and when. Same data as the Reports -> Dispatch Status Log
// tab, just scoped to one itinerary instead of the whole board.
import { useEffect, useState } from 'react'
import {
  loadDispatchStatusLogForItinerary,
  type DispatchStatusLogEntry,
} from '../../../lib/dispatchStatusLog'

function ItineraryLogModal({
  itineraryId,
  onClose,
}: {
  itineraryId: number
  onClose: () => void
}) {
  const [entries, setEntries] = useState<DispatchStatusLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { entries: loaded, error: loadError } =
        await loadDispatchStatusLogForItinerary(itineraryId)

      if (loadError) {
        setError(loadError)
        setLoading(false)
        return
      }

      setEntries(loaded)
      setError(null)
      setLoading(false)
    }

    load()
  }, [itineraryId])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Status Log — Itinerary #{itineraryId}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-96 overflow-y-auto">
          {loading && <p className="text-slate-500">Loading log...</p>}
          {!loading && error && <p className="text-red-700">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="text-slate-500">No status changes logged for this itinerary yet.</p>
          )}
          {!loading && !error && entries.length > 0 && (
            <div className="grid gap-3">
              {entries.map((entry) => (
                <div
                  key={entry.log_id}
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {entry.previous_status} → {entry.new_status}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.changed_by_name} · {new Date(entry.changed_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default ItineraryLogModal
