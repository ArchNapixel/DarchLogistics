// UpdateStatusControl: lets a driver advance an itinerary's status one
// step at a time through the fixed flow: Awaiting -> Dispatched ->
// PickedUp -> InTransit -> Delivered. It's a single "Mark as <next>"
// button (with a confirm, since only Admin can move a status back), so
// skipping steps or going backward isn't possible. Moving to "Delivered"
// opens DeliveryReceiptModal instead of updating immediately.
//
// The update only applies if the trip is still at the status this
// screen shows (.eq on itinerary_status) and checks a row actually
// changed -- so a dispatcher's newer change isn't overwritten, and a
// silent RLS no-op (e.g. the driver was reassigned off this trip) shows
// an error instead of looking like it worked.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import DeliveryReceiptModal from './DeliveryReceiptModal'

const STATUS_FLOW = [
  'Awaiting',
  'Dispatched',
  'PickedUp',
  'InTransit',
  'Delivered',
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
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)

  const currentIndex = STATUS_FLOW.indexOf(currentStatus)
  const nextStatus =
    currentIndex >= 0 ? STATUS_FLOW[currentIndex + 1] : undefined

  // Already at the end of the flow (or an unrecognized/cancelled status)
  // -- nothing further to advance to.
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

  function handleClick() {
    if (nextStatus === 'Delivered') {
      setShowDeliveryModal(true)
      return
    }
    if (!window.confirm(`Mark this trip as "${nextLabel}"? This can't be undone from your side.`)) {
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

      {showDeliveryModal && (
        <DeliveryReceiptModal
          itineraryId={itineraryId}
          currentStatus={currentStatus}
          onClose={() => setShowDeliveryModal(false)}
          onDelivered={() => {
            setShowDeliveryModal(false)
            onStatusChanged(itineraryId, 'Delivered')
          }}
        />
      )}
    </div>
  )
}

export default UpdateStatusControl
