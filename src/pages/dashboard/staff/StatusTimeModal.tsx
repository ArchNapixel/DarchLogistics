// StatusTimeModal: shown before the Dispatch Board moves a trip FORWARD
// (Awaiting -> Dispatched -> Picked Up -> In Transit). It asks when the
// move really happened, defaulting to now, so logging it late doesn't
// record the wrong time. Delivered has the same field inside
// MarkDeliveredModal. The board does the actual update with the chosen time.
import { useEffect, useState } from 'react'
import { loadLastStatusTime, nowRounded, statusTimeError } from '../../../lib/statusTime'
import StatusWhenField from './StatusWhenField'

function StatusTimeModal({
  itineraryId,
  statusLabel,
  onConfirm,
  onClose,
}: {
  itineraryId: number
  // The status it is moving to, e.g. "Picked Up".
  statusLabel: string
  onConfirm: (atMs: number) => void
  onClose: () => void
}) {
  const [at, setAt] = useState(nowRounded)
  const [lastChange, setLastChange] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadLastStatusTime(itineraryId).then(setLastChange)
  }, [itineraryId])

  function confirm() {
    const problem = statusTimeError(at, lastChange)
    if (problem) return setError(problem)
    onConfirm(at)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <h3 className="text-lg font-bold text-slate-900">
          Trip #{itineraryId} → {statusLabel}
        </h3>
        <p className="mt-1 text-sm text-slate-500">Leave it on now, or pick the time it really happened.</p>
        <div className="mt-4">
          <StatusWhenField
            value={at}
            onChange={(ms) => {
              setAt(ms)
              setError(null)
            }}
          />
        </div>
        {error && <p className="mt-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={confirm} className="btn-primary px-4 py-2 text-sm font-medium">
            Mark as {statusLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default StatusTimeModal
