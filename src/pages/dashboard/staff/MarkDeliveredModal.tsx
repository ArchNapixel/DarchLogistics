// MarkDeliveredModal: opened from the Dispatch Board when Dispatcher/Admin
// picks "Delivered" for a trip (or clicks "Mark delivered"). Marks the
// itinerary Delivered, logs it in dispatch_status_logs (that log's
// timestamp is the trip's delivery date for payroll and Payments Due),
// and -- if cargo arrived damaged, short or missing -- records a
// delivery_damage_records row for the Damage Charges page.
//
// Steps aren't in a DB transaction: the status goes first, then the
// damage row. If the damage row fails, the trip is already Delivered, so
// the modal stays open and "Save" only retries the damage part.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import {
  EMPTY_DAMAGE,
  damageInputError,
  insertDamageRecord,
  type DamageInput,
} from '../../../lib/damageCharges'
import DamageFields from './DamageFields'

function MarkDeliveredModal({
  itineraryId,
  currentStatus,
  onClose,
  onDelivered,
}: {
  itineraryId: number
  currentStatus: string
  onClose: () => void
  onDelivered: () => void
}) {
  const { employeeId } = useAuth()
  const [damage, setDamage] = useState<DamageInput>(EMPTY_DAMAGE)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // True once the trip is Delivered -- a retry then only saves the damage.
  const [statusDone, setStatusDone] = useState(false)

  async function handleSubmit() {
    const inputError = damageInputError(damage)
    if (inputError) {
      setError(inputError)
      return
    }

    setSubmitting(true)
    setError(null)

    // 1. Mark the trip Delivered -- only if it's still at the status the
    // board showed, and check a row really changed (RLS no-op).
    if (!statusDone) {
      const { data: updated, error: statusError } = await supabase
        .from('itineraries')
        .update({ itinerary_status: 'Delivered' })
        .eq('itinerary_id', itineraryId)
        .eq('itinerary_status', currentStatus)
        .select('itinerary_id')
        .maybeSingle()

      if (statusError) {
        setError(statusError.message)
        setSubmitting(false)
        return
      }
      if (!updated) {
        setError(
          'This trip was not updated -- its status was changed by someone ' +
            'else in the meantime. Close this and reload the board.',
        )
        setSubmitting(false)
        return
      }
      setStatusDone(true)

      // The booking's own status and freeing the truck/trailer follow
      // automatically (sync_booking_status / free_vehicles_on_delivery
      // triggers on itineraries).

      // 2. Log it -- this row's timestamp is the delivery date.
      const { error: logError } = await supabase
        .from('dispatch_status_logs')
        .insert({
          itinerary_id: itineraryId,
          previous_status: currentStatus,
          new_status: 'Delivered',
          changed_by: employeeId,
        })

      if (logError) {
        window.alert(
          `Trip marked Delivered, but recording it in the dispatch log ` +
            `failed (${logError.message}). Its delivery date will be missing ` +
            `from payroll and Payments Due -- tell an admin.`,
        )
      }
    }

    // 3. Damage, if any.
    if (damage.condition !== 'Good') {
      const damageError = await insertDamageRecord(itineraryId, damage)
      if (damageError) {
        setError(
          `The trip is marked Delivered, but the damage report wasn't saved ` +
            `(${damageError}). Press Save to try again.`,
        )
        setSubmitting(false)
        return
      }
    }

    setSubmitting(false)
    onDelivered()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 className="text-lg font-bold text-slate-900">Mark Trip #{itineraryId} Delivered</h3>
        <p className="mt-1 text-sm text-slate-500">
          If any cargo arrived damaged, short or missing, record it here.
        </p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 grid gap-4">
          <DamageFields value={damage} onChange={setDamage} allowGood />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            // Once the trip is Delivered, closing still has to move it to
            // the Completed table on the board.
            onClick={statusDone ? onDelivered : onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            {statusDone ? 'Close' : 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : statusDone ? 'Save damage report' : 'Mark Delivered'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MarkDeliveredModal
