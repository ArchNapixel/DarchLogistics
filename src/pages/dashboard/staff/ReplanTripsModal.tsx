// ReplanTripsModal: "Re-plan waiting trips" from Booking Detail (Admin +
// Dispatcher). Finds the booking's Awaiting trips whose driver, truck or
// trailer is blocked during the slot (leave, expired licence, in the shop
// until solved) and shows where the Capacity planner would put them now --
// the driver's own free truck, else a spare, else another driver, else later
// (lib/capacity.ts replanTrips). Nothing changes until Save; the save is one
// transaction (replan_booking_trips), all or nothing. Trips that still can't
// be placed keep their time and are listed so staff can fix them by hand.
import { useEffect, useEffectEvent, useState } from 'react'
import { formatDateTime, formatSlot } from '../../../lib/format'
import { loadReplan, saveReplan, type ReplanLoad } from '../../../lib/capacityLoad'
import { hoursLate } from '../../../lib/tripSchedule'
import { showToast } from '../../../components/Toast'

function ReplanTripsModal({ bookingId, onClose, onSaved }: { bookingId: number; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<ReplanLoad | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const result = await loadReplan(bookingId)
    setData(result.data)
    setError(result.error ? `Couldn't work out a new plan: ${result.error}` : null)
  }
  const loadNow = useEffectEvent(() => {
    void load()
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [bookingId])

  async function handleSave() {
    if (!data) return
    setSaving(true)
    setError(null)
    const saveError = await saveReplan(bookingId, data.replan.moves)
    setSaving(false)
    if (saveError) {
      // Nothing was saved (one transaction) -- the plan may be out of date.
      setError(`Nothing was changed: ${saveError}`)
      return
    }
    const n = data.replan.moves.length
    showToast(`Re-planned ${n} ${n === 1 ? 'trip' : 'trips'}.`)
    onSaved()
  }

  const name = (id: string | null) => (id ? (data?.labels.get(id) ?? id) : '—')
  const moves = data?.replan.moves ?? []
  const stuck = data?.replan.stuck ?? []
  const lastEnd = moves.length ? Math.max(...moves.map((m) => m.to.end)) : null
  const late = lastEnd !== null ? hoursLate(lastEnd, data?.deadlineEnd ?? null) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto border-2 border-line-card bg-white p-6">
        <h2 className="text-lg font-bold text-slate-900">Re-plan waiting trips · Booking #{bookingId}</h2>
        <p className="mt-1 text-sm text-slate-500">
          Trips whose driver, truck or trailer is blocked (on leave, licence expired, in the shop until solved) get the earliest free
          driver, truck and trailer. Other trips aren't touched.
        </p>

        {!data && !error && <p className="mt-5 text-sm text-slate-500">Working out a new plan…</p>}

        {data && moves.length === 0 && stuck.length === 0 && (
          <p className="mt-5 bg-green-50 px-4 py-3 text-sm text-green-900">No waiting trip is blocked. Nothing to re-plan.</p>
        )}

        {moves.length > 0 && (
          <>
            <p
              className={`mt-5 px-4 py-3 text-sm ${late > 0 ? 'bg-red-50 text-red-900' : 'bg-green-50 text-green-900'}`}
              role={late > 0 ? 'alert' : undefined}
            >
              {late > 0
                ? `The last moved trip ends ${formatDateTime(lastEnd)}, ${late} h after the delivery-by date.`
                : `All ${moves.length} moved ${moves.length === 1 ? 'trip ends' : 'trips end'} by ${formatDateTime(lastEnd)}${data?.deadlineEnd ? ', on time' : ''}.`}
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
                      <td className={`px-3 py-2 ${data?.deadlineEnd !== null && to.end > (data?.deadlineEnd ?? Infinity) ? 'text-red-800' : ''}`}>
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

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
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
