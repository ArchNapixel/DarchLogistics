// MarkDeliveredModal: opened from the Dispatch Board when Dispatcher/Admin
// picks "Delivered" for a trip (or clicks "Mark delivered"). Marks the
// itinerary Delivered, logs it in dispatch_status_logs (that log's
// timestamp is the trip's delivery date for payroll and Payments Due),
// and -- if cargo arrived damaged, short or missing -- records a
// delivery_damage_records row for the Damage Charges page. Staff can also
// attach the signed DO here (TripDocuments, uploads independently).
//
// Steps aren't in a DB transaction: the status goes first, then the
// damage row. If the damage row fails, the trip is already Delivered, so
// the modal stays open and "Save" only retries the damage part.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import {
  EMPTY_DAMAGE,
  damageInputError,
  insertDamageRecord,
  type DamageInput,
} from '../../../lib/damageCharges'
import DamageFields from './DamageFields'
import TripDocuments from './TripDocuments'
import { showToast } from '../../../components/Toast'
import { retimeAfterDelivery } from '../../../lib/tripRetime'
import { loadLastStatusTime, nowRounded, statusTimeError } from '../../../lib/statusTime'
import StatusWhenField from './StatusWhenField'

function MarkDeliveredModal({
  itineraryId,
  currentStatus,
  subtitle,
  onClose,
  onDelivered,
}: {
  itineraryId: number
  currentStatus: string
  // "Booking #48 · pickup → delivery", under the title.
  subtitle?: string
  onClose: () => void
  onDelivered: () => void
}) {
  const { employeeId } = useAuth()
  const [damage, setDamage] = useState<DamageInput>(EMPTY_DAMAGE)
  // When it was really delivered (defaults to now). This is the delivery date
  // for payroll and Payments Due, and what the later trips re-time from.
  const [deliveredAt, setDeliveredAt] = useState(nowRounded)
  const [lastChange, setLastChange] = useState<number | null>(null)
  useEffect(() => {
    loadLastStatusTime(itineraryId).then(setLastChange)
  }, [itineraryId])
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
    const timeError = statusDone ? null : statusTimeError(deliveredAt, lastChange)
    if (timeError) {
      setError(timeError)
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
          status_changed_at: new Date(deliveredAt).toISOString(),
        })

      if (logError) {
        showToast(
          `Trip marked Delivered, but recording it in the dispatch log ` +
            `failed (${logError.message}). Its delivery date will be missing ` +
            `from payroll and Payments Due -- tell an admin.`,
          'error',
        )
      }

      // The slot ends at the real delivery time; later trips follow it.
      const retime = await retimeAfterDelivery(itineraryId, deliveredAt)
      if (retime.warning) showToast(retime.warning, 'error')
      // At the current pace a booking misses its delivery-by date: remind the admin.
      for (const message of retime.late) showToast(message, 'error')
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="md-title" className="card w-full max-w-[640px]">
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h2 id="md-title" className="text-xl leading-7 font-bold text-ink">
              Mark Delivered · Trip #{itineraryId}
            </h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>}
          </div>
          <button
            type="button"
            // Once the trip is Delivered, closing still has to move it to
            // the Completed table on the board.
            onClick={statusDone ? onDelivered : onClose}
            disabled={submitting}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          {!statusDone && (
            <div className="flex flex-col gap-1.5">
              <StatusWhenField label="When was it delivered?" value={deliveredAt} onChange={setDeliveredAt} />
              <span className="text-[13px] leading-[18px] text-ink-muted">
                Starts at the current time. The booking's later trips are re-timed from this.
              </span>
            </div>
          )}

          <DamageFields value={damage} onChange={setDamage} allowGood />

          {/* Optional: the signed DO usually comes back at delivery. Files
              upload right away, on their own -- separate from the button below. */}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-ink">
              Documents <span className="font-normal text-ink-muted">(optional)</span>
            </p>
            <span className="text-[13px] leading-[18px] text-ink-muted">Delivery receipt, waybill or photos. They upload as soon as you pick them.</span>
            <TripDocuments itineraryId={itineraryId} canEdit />
          </div>
        </div>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={statusDone ? onDelivered : onClose} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
            {statusDone ? 'Close' : 'Cancel'}
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary inline-flex items-center gap-2 px-6 text-sm">
            {!statusDone && (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12l5 5 9-10" />
              </svg>
            )}
            {submitting ? 'Saving...' : statusDone ? 'Save Damage Report' : 'Mark Delivered'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default MarkDeliveredModal
