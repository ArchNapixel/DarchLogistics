// UpdateStatusControl: lets a driver advance an itinerary's status one
// step at a time: Awaiting -> Dispatched -> PickedUp -> InTransit. It's a
// single "Mark as <next>" button (with a confirm, since only Admin can
// move a status back), so skipping steps or going backward isn't
// possible. The driver stops at In Transit -- only Dispatcher/Admin mark
// a trip Delivered, from the Dispatch Board.
//
// The update only applies if the trip is still at the status this
// screen shows (.eq on itinerary_status) and checks a row actually
// changed -- so a dispatcher's newer change isn't overwritten, and a
// silent RLS no-op (e.g. the driver was reassigned off this trip) shows
// an error instead of looking like it worked.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { confirmDialog } from '../../../components/ConfirmDialog'

// The driver's part of the flow -- Delivered is set by dispatch.
const STATUS_FLOW = [
  'Awaiting',
  'Dispatched',
  'PickedUp',
  'InTransit',
]

// Same wording as the Dispatch Board's STATUS_LABELS.
export const TRIP_STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked Up',
  InTransit: 'In Transit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
}

function UpdateStatusControl({
  itineraryId,
  currentStatus,
  hasTruck,
  onStatusChanged,
}: {
  itineraryId: number
  currentStatus: string
  hasTruck: boolean
  onStatusChanged: (itineraryId: number, newStatus: string) => void
}) {
  const { employeeId } = useAuth()
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentIndex = STATUS_FLOW.indexOf(currentStatus)
  const nextStatus =
    currentIndex >= 0 ? STATUS_FLOW[currentIndex + 1] : undefined

  // In Transit: the rest is up to dispatch.
  if (currentStatus === 'InTransit') {
    return (
      <p className="mt-3 text-xs text-slate-500">
        Dispatch will mark this trip Delivered once it arrives.
      </p>
    )
  }

  // Delivered/Cancelled/unrecognized -- nothing further to advance to.
  if (!nextStatus) return null

  const nextLabel = TRIP_STATUS_LABELS[nextStatus] ?? nextStatus

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

  async function handleClick() {
    if (
      !(await confirmDialog({
        message: `Mark this trip as "${nextLabel}"? This can't be undone from your side.`,
        confirmLabel: `Mark as ${nextLabel}`,
      }))
    ) {
      return
    }
    advanceTo(nextStatus!)
  }

  // A trip can't leave Awaiting without a truck on it.
  const blockedNoTruck = currentStatus === 'Awaiting' && !hasTruck

  return (
    <div className="mt-3">
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}

      <button
        onClick={handleClick}
        disabled={updating || blockedNoTruck}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 sm:w-auto"
      >
        {updating ? 'Saving...' : `Mark as ${nextLabel}`}
      </button>
      {blockedNoTruck && (
        <p className="mt-1 text-xs text-slate-500">
          Waiting for dispatch to assign a truck.
        </p>
      )}
    </div>
  )
}

export default UpdateStatusControl
