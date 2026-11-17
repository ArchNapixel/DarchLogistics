// ReplanTripsModal: "Re-plan" from Booking Detail (one booking) and Schedule
// Overview (pick the booking here). Admin + Dispatcher. Two choices:
//   - Blocked trips: Awaiting trips whose driver, truck or trailer is blocked
//     during the slot (leave, expired licence, in the shop until solved).
//   - All waiting trips: every Awaiting trip of the booking, spread again over
//     whoever is free -- e.g. once a truck is back from the shop.
// Shows where the Capacity planner would put them now -- the driver's own free
// truck, else a spare, else another driver, else later (lib/capacity.ts
// replanTrips). Trips whose plan doesn't change aren't saved. Nothing changes
// until Save; the save is one transaction (replan_booking_trips), all or
// nothing. Trips that can't be placed keep their time and are listed.
import { useEffect, useState } from 'react'
import { formatDateTime, formatSlot } from '../../../lib/format'
import { loadReplan, loadWaitingBookings, saveReplan, type ReplanLoad, type ReplanScope, type WaitingBooking } from '../../../lib/capacityLoad'
import { hoursLate } from '../../../lib/tripSchedule'
import { showToast } from '../../../components/Toast'

const fieldClasses = 'min-h-11 rounded-[2px] border border-line-control bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary'

function ReplanTripsModal({ bookingId: fixedBookingId, onClose, onSaved }: { bookingId?: number; onClose: () => void; onSaved: () => void }) {
  // Schedule Overview: the bookings to pick from (null = still loading).
  const [bookings, setBookings] = useState<WaitingBooking[] | null>(null)
  const [pickedId, setPickedId] = useState<number | null>(null)
  // null = the default: Blocked trips when there are any, else All.
  const [scopeChoice, setScopeChoice] = useState<ReplanScope | null>(null)
  // The plan, stored with the booking it was loaded for (loading = no plan for the current one yet).
  const [result, setResult] = useState<{ bookingId: number; data: ReplanLoad | null; error: string | null } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Default pick: the first booking with blocked trips, else the first one.
  const bookingId = fixedBookingId ?? pickedId ?? bookings?.find((b) => b.blocked > 0)?.bookingId ?? bookings?.[0]?.bookingId ?? null

  useEffect(() => {
    if (fixedBookingId !== undefined) return
    let cancelled = false
    loadWaitingBookings().then((r) => !cancelled && setBookings(r.data))
    return () => {
      cancelled = true
    }
  }, [fixedBookingId])

  useEffect(() => {
    if (bookingId === null) return
    let cancelled = false
    loadReplan(bookingId).then((r) => {
      if (!cancelled) setResult({ bookingId, data: r.data, error: r.error })
    })
    return () => {
      cancelled = true
    }
  }, [bookingId])

  const current = result && result.bookingId === bookingId ? result : null
  const data = current?.data ?? null
  const scope: ReplanScope = scopeChoice ?? (data && data.blocked === 0 ? 'all' : 'blocked')
  const replan = data?.replans[scope] ?? null

  async function handleSave() {
    if (!replan || bookingId === null) return
    setSaving(true)
    setSaveError(null)
    const error = await saveReplan(bookingId, replan.moves)
    setSaving(false)
    if (error) {
      // Nothing was saved (one transaction) -- the plan may be out of date.
      setSaveError(`Nothing was changed: ${error}`)
      return
    }
    const n = replan.moves.length
    showToast(`Re-planned ${n} ${n === 1 ? 'trip' : 'trips'} of booking #${bookingId}.`)
    onSaved()
  }

  const name = (id: string | null) => (id ? (data?.labels.get(id) ?? id) : '—')
  const moves = replan?.moves ?? []
  const stuck = replan?.stuck ?? []
  // When the re-planned trips are done (moved, unchanged and stuck ones).
  const ends = [...(replan?.plan.trips.map((t) => t.end) ?? []), ...stuck.map((t) => t.end)]
  const lastEnd = ends.length ? Math.max(...ends) : null
  const late = lastEnd !== null ? hoursLate(lastEnd, data?.deadlineEnd ?? null) : 0
  const loadError = current?.error ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto border-2 border-line-card bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">Re-plan waiting trips{fixedBookingId !== undefined ? ` · Booking #${fixedBookingId}` : ''}</h2>
        <p className="mt-1 text-sm text-slate-500">
          Gives trips the earliest free driver, truck and trailer. Trips already on the road and other bookings aren't touched.
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-6">
          {fixedBookingId === undefined && (
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Booking
              {bookings === null ? (
                <span className="text-sm font-normal text-slate-500">Loading bookings…</span>
              ) : bookings.length === 0 ? (
                <span className="text-sm font-normal text-slate-500">No booking has waiting trips.</span>
              ) : (
                <select
                  value={bookingId ?? ''}
                  onChange={(e) => {
                    setPickedId(Number(e.target.value))
                    setScopeChoice(null)
                    setSaveError(null)
                  }}
                  className={fieldClasses}
                >
                  {bookings.map((b) => (
                    <option key={b.bookingId} value={b.bookingId}>
                      Booking #{b.bookingId} · {b.waiting} waiting{b.blocked > 0 ? ` · ${b.blocked} blocked` : ''}
                    </option>
                  ))}
                </select>
              )}
            </label>
          )}
          {data && (
            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-1 text-sm font-medium text-slate-700">Which trips</legend>
              {(['blocked', 'all'] as ReplanScope[]).map((s) => (
                <label
                  key={s}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[2px] border px-3 text-sm ${
                    scope === s ? 'border-primary bg-primary-soft font-semibold text-ink' : 'border-line-control text-ink-secondary'
                  }`}
                >
                  <input type="radio" name="replan-scope" checked={scope === s} onChange={() => setScopeChoice(s)} />
                  {s === 'blocked' ? `Blocked trips (${data.blocked})` : `All waiting trips (${data.waiting})`}
                </label>
              ))}
            </fieldset>
          )}
        </div>

        {bookingId !== null && !current && <p className="mt-5 text-sm text-slate-500">Working out a new plan…</p>}

        {replan && moves.length === 0 && stuck.length === 0 && (
          <p className="mt-5 bg-green-50 px-4 py-3 text-sm text-green-900">
            {scope === 'blocked' && data?.blocked === 0
              ? 'No waiting trip is blocked. Choose All waiting trips to spread them over whoever is free.'
              : 'These trips are already in their best slots. Nothing to change.'}
          </p>
        )}

        {moves.length > 0 && (
          <>
            <p
              className={`mt-5 px-4 py-3 text-sm ${late > 0 ? 'bg-red-50 text-red-900' : 'bg-green-50 text-green-900'}`}
              role={late > 0 ? 'alert' : undefined}
            >
              {late > 0
                ? `These trips would be done ${formatDateTime(lastEnd)}, ${late} h after the delivery-by date.`
                : `These trips would be done ${formatDateTime(lastEnd)}${data?.deadlineEnd ? ', on time' : ''}.`}
              {replan && replan.unchanged > 0 ? ` ${replan.unchanged} already in the right slot stay as they are.` : ''}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm text-ink-metric">
                <thead>
                  <tr>
                    <th className="px-3 py-2">Trip</th>
                    <th className="px-3 py-2">Now</th>
                    <th className="px-3 py-2">New</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map(({ trip, to }) => (
                    <tr key={trip.id} className="border-t border-line align-top">
                      <td className="px-3 py-2 font-semibold">#{trip.id}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatSlot(trip.start, trip.end)}
                        <br />
                        {name(trip.driverId)} · {name(trip.truckId)} · {name(trip.trailerId)}
                      </td>
                      <td className={`px-3 py-2 ${data?.deadlineEnd != null && to.end > data.deadlineEnd ? 'text-red-800' : ''}`}>
                        {formatSlot(to.start, to.end)}
                        <br />
                        {name(to.driverId)} · {name(to.truckId)}
                        {to.spareTruck ? ' (spare)' : ''} · {name(to.trailerId)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {stuck.length > 0 && (
          <p className="mt-4 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Can't place {stuck.map((t) => `#${t.id}`).join(', ')}: no driver, truck and trailer free together in the next two weeks after the
            deadline. {stuck.length === 1 ? 'It keeps its' : 'They keep their'} time. Fix {stuck.length === 1 ? 'it' : 'them'} on the Dispatch Board.
          </p>
        )}

        {(loadError || saveError) && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {saveError ?? `Couldn't work out a new plan: ${loadError}`}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm font-medium" disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="btn-primary px-4 py-2 text-sm font-medium"
            disabled={saving || moves.length === 0}
          >
            {saving ? 'Saving…' : `Save new plan (${moves.length} ${moves.length === 1 ? 'trip' : 'trips'})`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReplanTripsModal
