// EditTripTimeModal: Dispatcher/Admin set or change one trip's time slot
// (itineraries.trip_start_at / trip_end_at) from the Dispatch Board.
// Moving the start moves the end with it (same length); the end can also
// be pushed later on its own -- e.g. a trip running long (#6). Times are
// picked in 12-hour format (TimeInput12) and saved as Manila timestamps.
//
// Saving cascades (retimeTrips in lib/tripRetime.ts): the trips after this
// one in its driver's, truck's and trailer's lines -- any booking -- start
// when the one before them ends, earlier or later, each keeping its length.
// Trips already on the road or delivered never move. Starting a
// last-free-storage-day trip after 11:59 PM of the storage day asks first.
//
// The database re-checks the trip's driver/helper on save
// (itineraries_after_reschedule trigger): if the new time overlaps
// another of their trips, the save is refused with a message naming that
// trip, shown here as-is. It also logs the change and notifies the crew.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import TimeInput12 from '../../../components/TimeInput12'
import { formatSlot, manilaTimestamp, splitManila } from '../../../lib/format'
import { retimeTrips } from '../../../lib/tripRetime'
import { storageDeadlineEnd } from '../../../lib/storageDeadline'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { formatDate } from '../../../lib/format'

const HOUR_MS = 3_600_000
const fieldClasses =
  'border border-line-control px-3 py-2 text-slate-900 focus:border-primary rounded-[2px] min-h-11'

function EditTripTimeModal({
  itineraryId,
  start,
  end,
  fallbackDate,
  defaultStartMinutes,
  hoursPerTrip,
  storageDeadline = null,
  onClose,
  onSaved,
}: {
  // bookings.storage_deadline -- the trip must be picked up by 11:59 PM that day.
  storageDeadline?: string | null
  itineraryId: number
  start: string | null
  end: string | null
  // Used when the trip has no start yet: its trip date + the default time.
  fallbackDate: string
  defaultStartMinutes: number
  // The booking's hours per trip -- the length a brand-new slot gets.
  hoursPerTrip: number | null
  onClose: () => void
  // `warning` = this trip saved, but some later trips couldn't be moved, or a
  // booking now finishes after its delivery-by date.
  onSaved: (warning: string | null) => void
}) {
  // Work in ms; inputs read/write through splitManila/manilaTimestamp.
  const initialStart = start
    ? new Date(start).getTime()
    : new Date(manilaTimestamp(fallbackDate, defaultStartMinutes)).getTime()
  const initialEnd = end ? new Date(end).getTime() : initialStart + (hoursPerTrip ?? 6) * HOUR_MS
  const [startMs, setStartMs] = useState(initialStart)
  const [endMs, setEndMs] = useState(initialEnd)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startParts = splitManila(startMs)
  const endParts = splitManila(endMs)
  const toMs = (date: string, minutes: number) => new Date(manilaTimestamp(date, minutes)).getTime()

  // Moving the start keeps the trip's length.
  function moveStart(date: string, minutes: number) {
    if (!date) return
    const next = toMs(date, minutes)
    setEndMs(next + (endMs - startMs))
    setStartMs(next)
  }

  async function save() {
    if (endMs <= startMs) {
      setError('The trip has to end after it starts.')
      return
    }
    if (
      storageDeadline &&
      startMs > storageDeadlineEnd(storageDeadline) &&
      !(await confirmDialog({
        title: 'After the storage deadline',
        message: `This trip must be picked up from the port by 11:59 PM on ${formatDate(storageDeadline)} (last free storage day). The new time starts after that. Save anyway?`,
        confirmLabel: 'Save anyway',
        danger: true,
      }))
    ) {
      return
    }
    setSaving(true)
    setError(null)
    // No time yet: save its first slot directly (the cascade only knows trips that have one).
    if (!start) {
      const { data, error: saveError } = await supabase
        .from('itineraries')
        .update({ trip_start_at: new Date(startMs).toISOString(), trip_end_at: new Date(endMs).toISOString() })
        .eq('itinerary_id', itineraryId)
        .select('itinerary_id')
        .maybeSingle()
      if (saveError || !data) {
        setSaving(false)
        setError(saveError?.message ?? 'The trip was not updated. Refresh the board and try again.')
        return
      }
    }
    const result = await retimeTrips({ fixed: new Map([[itineraryId, { start: startMs, end: endMs }]]) }, Math.min(startMs, initialStart))
    setSaving(false)
    // This trip itself was refused (e.g. "That time overlaps trip #57 for
    // Juan…" -- written for people, shown as is): stay open.
    if (result.failedTripId === itineraryId) {
      setError(result.warning)
      return
    }
    const notes = [result.warning, ...result.late].filter(Boolean)
    onSaved(notes.length > 0 ? `Trip #${itineraryId} time saved. ${notes.join(' ')}` : null)
  }

  const hours = (endMs - startMs) / HOUR_MS

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <h2 className="text-lg font-bold text-slate-900">Trip #{itineraryId} time</h2>
        <p className="mt-1 text-sm text-slate-500">
          Changing the start moves the end with it. Push the end later if the trip is running long.
        </p>

        <div className="mt-5 grid gap-4">
          <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Start
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Start date"
                value={startParts.date}
                onChange={(e) => moveStart(e.target.value, startParts.minutes)}
                className={fieldClasses}
              />
              <TimeInput12
                label="Start time"
                value={startParts.minutes}
                onChange={(minutes) => moveStart(startParts.date, minutes)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            End
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="End date"
                value={endParts.date}
                onChange={(e) => e.target.value && setEndMs(toMs(e.target.value, endParts.minutes))}
                className={fieldClasses}
              />
              <TimeInput12
                label="End time"
                value={endParts.minutes}
                onChange={(minutes) => setEndMs(toMs(endParts.date, minutes))}
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            The next trips of this trip's driver, truck and trailer move to follow straight after.
          </p>
          <p className="bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {formatSlot(startMs, endMs)}
            {hours > 0 && (
              <span className="text-slate-500"> · {Number.isInteger(hours) ? hours : hours.toFixed(1)} h</span>
            )}
          </p>
        </div>

        {error && <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            {saving ? 'Saving…' : 'Save time'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EditTripTimeModal
