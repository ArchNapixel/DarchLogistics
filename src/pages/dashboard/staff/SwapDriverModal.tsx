// SwapDriverModal: the Dispatch Board's driver dropdown offers a driver who
// is planned on another trip that hasn't started (2026-10-31, Phase 5).
// Picking him asks what happens to that other trip -- nothing changes until
// the dispatcher / admin confirms here:
//   - Move it after this one: he keeps it, it starts when this trip ends
//     (his later trips follow -- lib/tripRetime.ts).
//   - Hand it to another driver: the free driver who earned least this week
//     takes it at its own time.
// Chosen by default: move, unless that makes its booking miss its
// delivery-by date (then hand over, when someone is free).
import { useState } from 'react'

export type SwapChoice = 'move' | 'handover'

function SwapDriverModal({
  tripId,
  driverName,
  otherTripId,
  otherSlot,
  movedSlot,
  moveLateHours,
  handOverName,
  onCancel,
  onConfirm,
}: {
  tripId: number
  driverName: string
  otherTripId: number
  // "Oct 31, 10:00 AM – 4:00 PM"
  otherSlot: string
  // Where the other trip lands if moved after this one.
  movedSlot: string
  // Hours the other trip's booking would be late if moved (0 = on time).
  moveLateHours: number
  // The free driver who would take it (null = nobody free).
  handOverName: string | null
  onCancel: () => void
  onConfirm: (choice: SwapChoice) => void
}) {
  const [choice, setChoice] = useState<SwapChoice>(moveLateHours > 0 && handOverName ? 'handover' : 'move')

  const option = (value: SwapChoice, title: string, detail: string, disabled = false) => (
    <label
      className={`flex gap-3 border-2 px-4 py-3 ${choice === value ? 'border-primary bg-primary-soft' : 'border-line-control'} ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <input type="radio" name="swap" checked={choice === value} disabled={disabled} onChange={() => setChoice(value)} className="mt-1" />
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-sm text-ink-secondary">{detail}</span>
      </span>
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="card w-full max-w-lg p-6">
        <h2 className="text-lg font-bold text-ink">Put {driverName} on trip #{tripId}?</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          {driverName} is planned on trip #{otherTripId} ({otherSlot}) at the same time. What happens to trip #{otherTripId}?
        </p>
        <div className="mt-4 grid gap-3">
          {option(
            'move',
            `Move trip #${otherTripId} after this one`,
            `${driverName} keeps it: ${movedSlot}${moveLateHours > 0 ? ` -- its booking would be ${moveLateHours} h late` : ''}. His later trips follow.`,
          )}
          {option(
            'handover',
            handOverName ? `Hand trip #${otherTripId} to ${handOverName}` : `Hand trip #${otherTripId} to another driver`,
            handOverName ? `${handOverName} takes it at its own time (${otherSlot}).` : 'Nobody else is free at that time.',
            !handOverName,
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(choice)} className="btn-primary">
            Swap
          </button>
        </div>
      </div>
    </div>
  )
}

export default SwapDriverModal
