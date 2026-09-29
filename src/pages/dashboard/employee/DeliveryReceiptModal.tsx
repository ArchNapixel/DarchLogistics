// DeliveryReceiptModal: shown when a driver marks a trip "Delivered".
// Records the delivery_receipts row (and, if the cargo arrived damaged,
// short or missing, a delivery_damage_records row so it shows up on the
// Damage Charges page), then updates the itinerary's status and logs
// the change in dispatch_status_logs.
//
// Retry-safe: delivery_receipts.itinerary_id is UNIQUE, so if an earlier
// attempt already saved the receipt and failed on a later step, the
// existing receipt is reused instead of failing on the duplicate.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type DeliveryCondition = 'Good' | 'Damaged' | 'Partial' | 'Missing'

// Every condition except Good means some loss staff must decide on.
const LOSS_LABELS: Record<Exclude<DeliveryCondition, 'Good'>, string> = {
  Damaged: 'What was damaged?',
  Partial: 'What was short / not delivered?',
  Missing: 'What went missing?',
}

function DeliveryReceiptModal({
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
  const [receiverName, setReceiverName] = useState('')
  const [receiverContact, setReceiverContact] = useState('')
  const [condition, setCondition] = useState<DeliveryCondition>('Good')
  const [damageDescription, setDamageDescription] = useState('')
  const [estimatedCost, setEstimatedCost] = useState('')
  const [chargeTo, setChargeTo] = useState<'Client' | 'Company'>('Client')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Remembers which steps already succeeded, so pressing Confirm again
  // after a failure doesn't record the damage twice.
  const [damageSaved, setDamageSaved] = useState(false)

  const hasLoss = condition !== 'Good'

  async function handleSubmit() {
    if (!receiverName.trim()) {
      setError('Enter the receiver name.')
      return
    }
    if (hasLoss && (!damageDescription.trim() || !estimatedCost)) {
      setError('Describe the problem and enter an estimated cost.')
      return
    }
    if (hasLoss && Number(estimatedCost) < 0) {
      setError('Estimated cost can\'t be negative.')
      return
    }

    setSubmitting(true)
    setError(null)

    // 1. Record the delivery receipt -- or reuse the one an earlier,
    // partly-failed attempt already saved.
    const { data: existingReceipt, error: existingError } = await supabase
      .from('delivery_receipts')
      .select('delivery_receipt_id')
      .eq('itinerary_id', itineraryId)
      .maybeSingle()

    if (existingError) {
      setError(existingError.message)
      setSubmitting(false)
      return
    }

    let receiptId = existingReceipt?.delivery_receipt_id as number | undefined
    if (receiptId === undefined) {
      const { data: receipt, error: receiptError } = await supabase
        .from('delivery_receipts')
        .insert({
          itinerary_id: itineraryId,
          receiver_name: receiverName,
          receiver_contact: receiverContact || null,
          delivery_condition: condition,
          received_at: new Date().toISOString(),
          recorded_by: employeeId,
        })
        .select('delivery_receipt_id')
        .single()

      if (receiptError || !receipt) {
        setError(receiptError?.message ?? 'Could not save delivery receipt.')
        setSubmitting(false)
        return
      }
      receiptId = receipt.delivery_receipt_id as number
    }

    // 2. If anything was damaged/short/missing, record it for staff.
    // ponytail: damageSaved only survives while this modal is open -- a
    // retry after closing/reopening can add a second damage row (staff
    // can spot it on Damage Charges). Drivers can't read
    // delivery_damage_records to check; add a SELECT policy if it matters.
    if (hasLoss && !damageSaved) {
      const { error: damageError } = await supabase
        .from('delivery_damage_records')
        .insert({
          delivery_receipt_id: receiptId,
          damage_description: `${condition}: ${damageDescription.trim()}`,
          estimated_damage_cost: Number(estimatedCost),
          charge_to: chargeTo,
        })

      if (damageError) {
        setError(damageError.message)
        setSubmitting(false)
        return
      }
      setDamageSaved(true)
    }

    // 3. Update the itinerary's status -- only if it's still where this
    // screen thinks it is, and check a row really changed (RLS no-op).
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
        'The receipt was saved, but the trip status was not updated -- it ' +
          'may have been changed by dispatch, or it is no longer assigned ' +
          'to you. Reload the page and check with dispatch.',
      )
      setSubmitting(false)
      return
    }

    // The booking's own status (Delivered once every trip is) and freeing
    // the truck/trailer both follow automatically -- the
    // sync_booking_status and free_vehicles_on_delivery triggers on
    // itineraries handle them in the database.

    // 4. Log the status change.
    const { error: logError } = await supabase
      .from('dispatch_status_logs')
      .insert({
        itinerary_id: itineraryId,
        previous_status: currentStatus,
        new_status: 'Delivered',
        changed_by: employeeId,
      })

    setSubmitting(false)

    // The trip IS delivered at this point -- don't leave the driver stuck
    // in the modal over a log failure (a retry would now fail the status
    // guard above). Warn, then carry on.
    if (logError) {
      window.alert(
        `Delivery saved, but recording it in the dispatch log failed ` +
          `(${logError.message}). Please tell dispatch.`,
      )
    }

    onDelivered()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 className="text-lg font-bold text-slate-900">Delivery Receipt</h3>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Receiver name
            <input
              type="text"
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Receiver contact (optional)
            <input
              type="text"
              value={receiverContact}
              onChange={(e) => setReceiverContact(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Delivery condition
            <select
              value={condition}
              onChange={(e) =>
                setCondition(e.target.value as DeliveryCondition)
              }
              className={fieldClasses}
            >
              <option value="Good">Good</option>
              <option value="Damaged">Damaged</option>
              <option value="Partial">Partial</option>
              <option value="Missing">Missing</option>
            </select>
          </label>

          {condition !== 'Good' && (
            <>
              <label className={labelClasses}>
                {LOSS_LABELS[condition]}
                <textarea
                  value={damageDescription}
                  onChange={(e) => setDamageDescription(e.target.value)}
                  rows={3}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Estimated cost
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={estimatedCost}
                  onChange={(e) => setEstimatedCost(e.target.value)}
                  className={fieldClasses}
                />
              </label>

              <label className={labelClasses}>
                Charge to
                <select
                  value={chargeTo}
                  onChange={(e) =>
                    setChargeTo(e.target.value as 'Client' | 'Company')
                  }
                  className={fieldClasses}
                >
                  <option value="Client">Client</option>
                  <option value="Company">Company</option>
                </select>
              </label>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Confirm Delivery'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default DeliveryReceiptModal
