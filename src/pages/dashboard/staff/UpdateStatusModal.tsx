// UpdateStatusModal: "Update Status" on a Dispatch Board trip (the canvas's
// "Dispatch Board: Update Status" board). The trip's statuses in order --
// done ones ticked, the current one highlighted, and the one(s) this person
// may pick as radio buttons (Dispatcher: the next step only; Admin: any
// other status, backward too). A forward move also asks when it really
// happened (StatusWhenField, defaults to now). Picking Delivered hands over
// to MarkDeliveredModal (cargo condition + damage), which has its own time.
// The board does the actual update -- this only collects the choice.
import { useEffect, useState } from 'react'
import { loadLastStatusTime, nowRounded, statusTimeError } from '../../../lib/statusTime'
import StatusWhenField from './StatusWhenField'

const CHECK = 'M5 12l5 5 9-10'
const CURRENT = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8v8 M8 12h8'
const CLOSE = 'M6 6l12 12 M18 6L6 18'

function Icon({ d, className = '' }: { d: string; className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

function UpdateStatusModal({
  itineraryId,
  subtitle,
  flow,
  labels,
  currentStatus,
  choices,
  blockedReason,
  correction,
  onConfirm,
  onClose,
}: {
  itineraryId: number
  // "Booking #47 · Roy Estoperes · MAD 1957"
  subtitle: string
  // Every status in order (Awaiting ... Delivered).
  flow: string[]
  labels: Record<string, string>
  currentStatus: string
  // The statuses this person may move to.
  choices: string[]
  // Why the trip can't leave Awaiting yet (needs a driver, downpayment...), or null.
  blockedReason: string | null
  // Dispatcher: going back goes through Admin.
  correction: { pending: boolean; onRequest: () => void } | null
  onConfirm: (newStatus: string, atMs?: number) => void
  onClose: () => void
}) {
  const currentIndex = flow.indexOf(currentStatus)
  const usable = choices.filter((s) => !(blockedReason && currentStatus === 'Awaiting' && s !== 'Awaiting'))
  // Pre-pick the next step when it's allowed.
  const [picked, setPicked] = useState<string | null>(usable.includes(flow[currentIndex + 1]) ? flow[currentIndex + 1] : null)
  const [at, setAt] = useState(nowRounded)
  const [lastChange, setLastChange] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadLastStatusTime(itineraryId).then(setLastChange)
  }, [itineraryId])

  const forward = picked !== null && flow.indexOf(picked) > currentIndex
  // Delivered asks its own questions (and its own time) in the next form.
  const asksTime = forward && picked !== 'Delivered'

  function confirm() {
    if (!picked) return
    if (asksTime) {
      const problem = statusTimeError(at, lastChange)
      if (problem) return setError(problem)
      return onConfirm(picked, at)
    }
    onConfirm(picked)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="us-title" className="card flex w-full max-w-[560px] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="us-title" className="text-xl leading-7 font-bold text-ink">
              Update Status · Trip #{itineraryId}
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <Icon d={CLOSE} />
          </button>
        </header>

        <fieldset className="m-0 flex flex-col gap-2 border-0 px-6 py-5">
          <legend className="pb-3 text-sm font-semibold text-ink">
            {choices.some((s) => flow.indexOf(s) < currentIndex)
              ? 'Pick the status this trip should have.'
              : 'Statuses go in order. You can only move to the next one.'}
          </legend>
          {flow.map((status, i) => {
            const label = labels[status] ?? status
            if (status === currentStatus) {
              return (
                <div key={status} className="grid min-h-14 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-2 border-primary bg-primary-soft px-4 text-[15px] font-semibold text-ink">
                  <Icon d={CURRENT} className="text-primary" />
                  <span>{label}</span>
                  <span className="text-xs font-semibold text-primary">Current</span>
                </div>
              )
            }
            const selectable = usable.includes(status)
            if (!selectable && i < currentIndex) {
              return (
                <div key={status} className="grid min-h-14 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border border-line bg-slate-50 px-4 text-[15px] text-ink-secondary">
                  <Icon d={CHECK} className="text-green-800" />
                  <span>{label}</span>
                  <span className="text-xs font-semibold text-ink-secondary">Done</span>
                </div>
              )
            }
            const isNext = i === currentIndex + 1
            return (
              <label
                key={status}
                className={`grid min-h-14 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 text-[15px] ${
                  selectable
                    ? `cursor-pointer bg-white font-semibold text-ink ${picked === status ? 'border-2 border-ink' : 'border border-line'}`
                    : 'border border-line bg-white text-ink-muted'
                }`}
              >
                <input
                  type="radio"
                  name="new-status"
                  value={status}
                  checked={picked === status}
                  disabled={!selectable}
                  onChange={() => {
                    setPicked(status)
                    setError(null)
                  }}
                  className="h-5 w-5 accent-primary"
                />
                <span>{label}</span>
                <span className={`text-xs font-semibold ${selectable ? 'text-ink' : 'text-ink-muted'}`}>
                  {selectable
                    ? i < currentIndex
                      ? 'Back'
                      : isNext
                        ? 'Next'
                        : 'Skip ahead'
                    : isNext && blockedReason
                      ? 'Not yet'
                      : `After ${labels[flow[i - 1]] ?? flow[i - 1]}`}
                </span>
              </label>
            )
          })}
        </fieldset>

        {blockedReason && currentStatus === 'Awaiting' && (
          <p className="mx-6 mb-4 border border-amber-600 bg-amber-100 px-3.5 py-3 text-[13px] leading-[18px] text-amber-900">
            {blockedReason}
          </p>
        )}

        {asksTime && (
          <div className="mx-6 mb-4">
            <StatusWhenField
              value={at}
              onChange={(ms) => {
                setAt(ms)
                setError(null)
              }}
            />
          </div>
        )}

        <p className="mx-6 mb-5 border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
          The change is saved to the trip's status log with your name and the time. Choosing Delivered opens the
          delivery form (cargo condition and any damage).
          {correction && currentStatus !== 'Awaiting' && (
            <>
              {' '}
              Need to go back a step?{' '}
              {correction.pending ? (
                <span className="font-semibold">Your correction request is pending.</span>
              ) : (
                <button type="button" onClick={correction.onRequest} className="font-semibold text-primary underline">
                  Request a correction
                </button>
              )}
            </>
          )}
        </p>

        {error && <p className="mx-6 mb-4 border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">{error}</p>}

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={!picked} className="btn-primary flex items-center gap-2 px-6 text-sm">
            <Icon d={CHECK} />
            {picked ? `Set to ${labels[picked] ?? picked}` : 'Pick a status'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default UpdateStatusModal
