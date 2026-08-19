// UpdateStatusControl: lets a driver advance an itinerary's status one
// step at a time through the fixed flow: Awaiting -> Dispatched ->
// PickedUp -> InTransit -> Delivered. The dropdown only ever offers the
// current status and the single valid next step, so skipping steps or
// going backward isn't possible. Moving to "Delivered" opens
// DeliveryReceiptModal instead of updating immediately.
import { useState, type ChangeEvent } from 'react'
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

function UpdateStatusControl({
  itineraryId,
  currentStatus,
  onStatusChanged,
}: {
  itineraryId: number
  currentStatus: string
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

  async function advanceTo(newStatus: string) {
    setUpdating(true)
    setError(null)

    const { error: updateError } = await supabase
      .from('itineraries')
      .update({ itinerary_status: newStatus })
      .eq('itinerary_id', itineraryId)

    if (updateError) {
      setError(updateError.message)
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

    if (logError) {
      setError(logError.message)
      return
    }

    onStatusChanged(itineraryId, newStatus)
  }

  function handleSelectChange(e: ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value
    if (selected !== nextStatus) return

    if (selected === 'Delivered') {
      setShowDeliveryModal(true)
      return
    }

    advanceTo(selected)
  }

  return (
    <div className="mt-3">
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}

      <select
        value={currentStatus}
        onChange={handleSelectChange}
        disabled={updating}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
      >
        <option value={currentStatus}>{currentStatus}</option>
        <option value={nextStatus}>Mark as {nextStatus}</option>
      </select>

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
