// UpdateStatusControl: lets a driver advance an itinerary's status one
// step at a time: Awaiting -> Dispatched -> PickedUp -> InTransit, and on a
// trip that brings the empty container back, Unloading -> ReturningContainer
// too (lib/tripStatusFlow.ts). It's a
// single "Mark as <next>" button that opens a confirm pop-up listing the
// steps (done / now / next / later -- the canvas's "Mark trip as" board),
// since only Admin can move a status back, so skipping steps or going
// backward isn't possible. The driver stops before Delivered and before
// Container Returned -- only Dispatcher/Admin confirm those, from the
// Dispatch Board (DISPATCH_CONFIRMS).
//
// The update only applies if the trip is still at the status this
// screen shows (.eq on itinerary_status) and checks a row actually
// changed -- so a dispatcher's newer change isn't overwritten, and a
// silent RLS no-op (e.g. the driver was reassigned off this trip) shows
// an error instead of looking like it worked.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { DISPATCH_CONFIRMS, driverStatusLabel } from '../../../lib/driverTripStatus'
import { nextStatus as nextStep, statusSteps } from '../../../lib/tripStatusFlow'

const STEP_ICON = {
  done: 'M5 12l5 5 9-10',
  now: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8v8 M8 12h8',
  next: 'M5 12h14 M13 6l6 6-6 6',
  later: 'M6 11V8a6 6 0 0 1 12 0v3 M5 11h14v10H5z',
}

// "Mark Trip #N as Picked Up?" -- every step of the trip with where it is.
function StatusStepsModal({
  itineraryId,
  summary,
  currentStatus,
  nextStatus,
  returnContainer,
  onConfirm,
  onClose,
}: {
  itineraryId: number
  summary: string
  currentStatus: string
  nextStatus: string
  returnContainer: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const flow = statusSteps(returnContainer)
  const nextLabel = driverStatusLabel(nextStatus, returnContainer)
  const currentIndex = flow.indexOf(currentStatus)
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="status-title" className="card w-full max-w-[560px]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div>
            <h2 id="status-title" className="text-xl leading-7 font-bold text-ink">
              Mark Trip #{itineraryId} as {nextLabel}?
            </h2>
            <p className="mt-0.5 text-sm text-ink-secondary">{summary}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="flex flex-col gap-2 px-6 py-5">
          <ol className="flex flex-col gap-2">
            {flow.map((status, i) => {
              const step = i < currentIndex ? 'done' : i === currentIndex ? 'now' : status === nextStatus ? 'next' : 'later'
              return (
                <li
                  key={status}
                  className={`grid min-h-[52px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 px-4 text-[15px] ${
                    step === 'done'
                      ? 'border border-line bg-slate-50 text-ink-secondary'
                      : step === 'now'
                        ? 'border-2 border-primary bg-primary-soft font-semibold'
                        : step === 'next'
                          ? 'border-2 border-ink font-semibold'
                          : 'border border-line text-ink-muted'
                  }`}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={step === 'done' ? 'text-green-800' : step === 'now' ? 'text-primary' : ''}
                    aria-hidden="true"
                  >
                    <path d={STEP_ICON[step]} />
                  </svg>
                  <span>
                    {driverStatusLabel(status, returnContainer)}
                    {DISPATCH_CONFIRMS.includes(status) && <span className="font-normal text-ink-muted"> · dispatch confirms</span>}
                  </span>
                  <span className={`text-xs font-semibold ${step === 'now' ? 'text-primary' : ''}`}>
                    {step === 'done' ? 'Done' : step === 'now' ? 'Now' : step === 'next' ? 'Next' : 'Later'}
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="mt-2 text-[13px] leading-[18px] text-ink-muted">
            {nextStatus === 'InTransit'
              ? returnContainer
                ? "Confirm you've arrived. Dispatch then confirms the delivery, and you go on to unloading. "
                : "Confirm you've arrived and delivered. Dispatch then confirms it as Delivered. "
              : nextStatus === 'ReturningContainer'
                ? "Confirm the container is empty and you're taking it back. Dispatch confirms when it's returned. "
                : ''}
            You can't skip a step or go back. If dispatch changed this trip in the meantime, you'll see a message
            instead and nothing is overwritten.
          </p>
        </div>
        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="btn-primary px-6 text-sm">
            Mark as {nextLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}

function UpdateStatusControl({
  itineraryId,
  currentStatus,
  hasTruck,
  busyOnTripId = null,
  returnContainer = false,
  summary,
  onStatusChanged,
  children,
}: {
  itineraryId: number
  currentStatus: string
  hasTruck: boolean
  // Another of this driver's trips that is still on the road (blocks starting this one).
  busyOnTripId?: number | null
  // Brings the empty container back (itineraries.return_container).
  returnContainer?: boolean
  // "Pickup → Delivery · truck · trailer", shown in the confirm pop-up.
  summary: string
  onStatusChanged: (itineraryId: number, newStatus: string) => void
  // Extra buttons shown next to the status button (e.g. "+ Add Expense").
  children?: React.ReactNode
}) {
  const { employeeId } = useAuth()
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const nextStatus = nextStep(currentStatus, returnContainer)

  // The next step is dispatch's to confirm (Delivered / Container Returned).
  if (nextStatus && DISPATCH_CONFIRMS.includes(nextStatus)) {
    return (
      <div className="flex flex-col gap-1.5">
        {children && <div className="flex flex-wrap gap-2">{children}</div>}
        <p className="text-[13px] text-ink-muted">
          {nextStatus === 'Delivered'
            ? 'Waiting for dispatch to confirm the delivery.'
            : 'Waiting for dispatch to confirm the container is back.'}
        </p>
      </div>
    )
  }

  // Finished/Cancelled/unrecognized -- nothing further to advance to.
  if (!nextStatus) return children ? <div className="flex flex-wrap gap-2">{children}</div> : null

  const nextLabel = driverStatusLabel(nextStatus, returnContainer)

  async function advanceTo(newStatus: string) {
    setUpdating(true)
    setError(null)

    const { data: updated, error: updateError } = await supabase
      .from('itineraries')
      .update({ itinerary_status: newStatus })
      .eq('itinerary_id', itineraryId)
      .eq('itinerary_status', currentStatus)
      .select('itinerary_id')
      .maybeSingle()

    if (updateError) {
      setError(updateError.message)
      setUpdating(false)
      return
    }
    if (!updated) {
      setError(
        'This trip was not updated -- its status may have been changed by ' +
          'dispatch, or it is no longer assigned to you. Reload the page.',
      )
      setUpdating(false)
      return
    }

    const { error: logError } = await supabase
      .from('dispatch_status_logs')
      .insert({
        itinerary_id: itineraryId,
        previous_status: currentStatus,
        new_status: newStatus,
        changed_by: employeeId,
      })

    setUpdating(false)

    // The status update above already succeeded even if the log insert
    // fails -- tell the parent about the real status change either way,
    // and only use the log failure to show a warning.
    onStatusChanged(itineraryId, newStatus)

    if (logError) {
      setError(
        `Status was updated to "${newStatus}", but recording it in the ` +
          `dispatch log failed (${logError.message}). The status change ` +
          `itself went through.`,
      )
    }
  }


  // A trip can't leave Awaiting without a truck AND trailer on it (the
  // `hasTruck` prop means both; the driver is the one logged in).
  const blockedNoTruck = currentStatus === 'Awaiting' && !hasTruck
  // ...nor while another of their trips hasn't been delivered yet.
  const blockedBusy = currentStatus === 'Awaiting' && busyOnTripId !== null

  const blockedId = `status-blocked-${itineraryId}`
  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={updating || blockedNoTruck || blockedBusy}
          aria-describedby={blockedNoTruck || blockedBusy ? blockedId : undefined}
          className="btn-primary px-5 text-sm"
        >
          {updating ? 'Saving...' : `Mark as ${nextLabel}`}
        </button>
        {children}
      </div>
      {blockedNoTruck ? (
        <span id={blockedId} className="text-[13px] text-amber-900">
          Needs a truck and trailer first.
        </span>
      ) : (
        blockedBusy && (
          <span id={blockedId} className="text-[13px] text-amber-900">
            Finish trip #{busyOnTripId} first.
          </span>
        )
      )}

      {confirming && (
        <StatusStepsModal
          itineraryId={itineraryId}
          summary={summary}
          currentStatus={currentStatus}
          nextStatus={nextStatus}
          returnContainer={returnContainer}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            void advanceTo(nextStatus)
          }}
        />
      )}
    </div>
  )
}

export default UpdateStatusControl
