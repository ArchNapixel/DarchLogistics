// DeliveryReceiptModal: shown when a driver marks a trip "Delivered".
// Records the delivery_receipts row (and, if the cargo arrived damaged,
// a delivery_damage_records row), then updates the itinerary's status
// and logs the change in dispatch_status_logs.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

type DeliveryCondition = 'Good' | 'Damaged' | 'Partial' | 'Missing'

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

  async function handleSubmit() {
    if (!receiverName.trim()) {
      setError('Enter the receiver name.')
      return
    }
    if (
      condition === 'Damaged' &&
      (!damageDescription.trim() || !estimatedCost)
    ) {
      setError('Enter a damage description and estimated cost.')
      return
    }

    setSubmitting(true)
    setError(null)

    // 1. Record the delivery receipt.
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

    // 2. If damaged, also record the damage details.
    if (condition === 'Damaged') {
      const { error: damageError } = await supabase
        .from('delivery_damage_records')
        .insert({
          delivery_receipt_id: receipt.delivery_receipt_id,
          damage_description: damageDescription,
          estimated_damage_cost: Number(estimatedCost),
          charge_to: chargeTo,
        })

      if (damageError) {
        setError(damageError.message)
        setSubmitting(false)
        return
      }
    }

    // 3. Update the itinerary's status.
    const { error: statusError } = await supabase
      .from('itineraries')
      .update({ itinerary_status: 'Delivered' })
      .eq('itinerary_id', itineraryId)

    if (statusError) {
      setError(statusError.message)
      setSubmitting(false)
      return
    }

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

    if (logError) {
      setError(logError.message)
      return
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

          {condition === 'Damaged' && (
            <>
              <label className={labelClasses}>
                Damage description
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
