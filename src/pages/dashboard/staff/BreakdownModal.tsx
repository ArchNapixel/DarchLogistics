// BreakdownModal: Dispatch Board -> a trip's ⋮ menu -> "Report breakdown", for
// a trip already on the road whose truck or trailer broke down. It:
//   1. swaps the broken vehicle for a free one of your choice on this trip
//      (the board's own truck / trailer change, so the overlap rules apply),
//   2. opens a Corrective work order for the broken vehicle and puts it
//      Under Maintenance (so its other trips show up under At-risk trips, with
//      "Replace on remaining trips"),
//   3. optionally logs what it cost (tow, repair) as a trip expense.
// Steps run one after another, not in a transaction: a failure partway says
// which steps are done ("needs manual review"), same as the other multi-step
// forms.
import { useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabaseClient'
import { setVehicleStatus } from '../../../lib/fleetStatus'
import { filterAmountInput, parseAmount } from '../../../lib/amountInput'
import { toManilaDate } from '../../../lib/payslip'

export type BreakdownTrip = {
  itinerary_id: number
  plate_number: string | null
  trailer_id: number | null
  trailer_label: string | null
  assigned_employee_id: number | null
}
type Option = { id: string; label: string }

function BreakdownModal({
  trip,
  free,
  onSwap,
  onClose,
  onDone,
}: {
  trip: BreakdownTrip
  // Free replacements for this trip's slot, best first (Fleet Match).
  free: { Truck: Option[]; Trailer: Option[] }
  // Puts the replacement on the trip (the board's handlers); false = it failed.
  onSwap: (kind: 'Truck' | 'Trailer', newId: string) => Promise<boolean>
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { employeeId } = useAuth()
  const [kind, setKind] = useState<'Truck' | 'Trailer'>(trip.plate_number ? 'Truck' : 'Trailer')
  const [replacementId, setReplacementId] = useState('')
  const [what, setWhat] = useState('')
  const [cost, setCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = free[kind]
  const brokenLabel = kind === 'Truck' ? trip.plate_number : trip.trailer_label

  async function save() {
    const amount = cost.trim() ? parseAmount(cost) : { value: null, error: null }
    if (!replacementId) return setError(`Pick the ${kind.toLowerCase()} that takes over.`)
    if (!what.trim()) return setError('Say what happened (for example: engine overheated, flat tire).')
    if (amount.error) return setError(amount.error)

    setSaving(true)
    setError(null)

    // 1. Swap the vehicle on the trip.
    if (!(await onSwap(kind, replacementId))) {
      setSaving(false)
      return setError("The swap didn't go through -- see the message at the top of the board.")
    }

    // 2. Work order + take the broken vehicle off the road.
    const identifier = kind === 'Truck' ? trip.plate_number : `TR${trip.trailer_id}`
    const workOrderNumber = `WO-${identifier}-${Date.now()}`
    const { error: workOrderError } = await supabase.from('work_orders').insert({
      work_order_number: workOrderNumber,
      plate_number: kind === 'Truck' ? trip.plate_number : null,
      trailer_id: kind === 'Trailer' ? trip.trailer_id : null,
      assigned_mechanic_id: null,
      maintenance_type: 'Corrective',
      work_description: `Breakdown on trip #${trip.itinerary_id}: ${what.trim()}`,
      scheduled_start_date: toManilaDate(new Date()),
    })
    if (workOrderError) {
      setSaving(false)
      return setError(
        `The ${kind.toLowerCase()} was swapped on trip #${trip.itinerary_id}, but the work order wasn't created (${workOrderError.message}). This needs manual review: create it from Maintenance.`,
      )
    }
    // Freed by the swap (Available) or still out on another trip (In Transit).
    const plate = kind === 'Truck' ? trip.plate_number : null
    const trailerId = kind === 'Trailer' ? trip.trailer_id : null
    const statusError =
      (await setVehicleStatus(plate, trailerId, 'Available', 'Under Maintenance')) ??
      (await setVehicleStatus(plate, trailerId, 'In Transit', 'Under Maintenance'))

    // 3. The cost, as a trip expense (on the trip's driver; else on you).
    let expenseNote = ''
    if (amount.value && amount.value > 0) {
      const { error: expenseError } = await supabase.from('itinerary_expenses').insert({
        itinerary_id: trip.itinerary_id,
        employee_id: trip.assigned_employee_id ?? employeeId,
        amount: amount.value,
        category: 'Other',
        description: `Breakdown: ${what.trim()}`,
      })
      if (expenseError) expenseNote = ` The cost wasn't saved (${expenseError.message}) -- add it from the booking.`
    }

    setSaving(false)
    onDone(
      `${brokenLabel} reported broken; ${workOrderNumber} opened.${statusError ? ` Its status couldn't be updated (${statusError}).` : ''}${expenseNote}`,
    )
  }

  const fieldClass = 'border border-line-control bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary rounded-[2px] min-h-11'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="w-full max-w-md bg-white p-6 border-2 border-line-card">
        <h3 className="text-lg font-bold text-slate-900">Report breakdown · Trip #{trip.itinerary_id}</h3>
        <p className="mt-1 text-sm text-slate-500">
          The replacement takes over this trip. The broken one goes to the shop with a work order, and its other trips show under
          At-risk trips.
        </p>

        {trip.plate_number && trip.trailer_id !== null && (
          <fieldset className="mt-4 flex gap-5 text-sm">
            <legend className="mb-1 font-medium text-slate-700">What broke down?</legend>
            {(['Truck', 'Trailer'] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={kind === k}
                  onChange={() => {
                    setKind(k)
                    setReplacementId('')
                  }}
                  className="accent-slate-900"
                />
                {k} {k === 'Truck' ? trip.plate_number : trip.trailer_label}
              </label>
            ))}
          </fieldset>
        )}

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
          {kind} that takes over
          <select value={replacementId} onChange={(e) => setReplacementId(e.target.value)} className={fieldClass}>
            <option value="">{options.length ? 'Choose…' : `No free ${kind.toLowerCase()} for this trip`}</option>
            {options.map((o, i) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {i === 0 ? ' (suggested)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
          What happened
          <input
            type="text"
            value={what}
            maxLength={200}
            onChange={(e) => setWhat(e.target.value)}
            placeholder="e.g. Engine overheated near Tagum"
            className={fieldClass}
          />
        </label>

        <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700">
          Cost so far (PHP) <span className="font-normal text-slate-400">optional: tow, roadside repair</span>
          <input
            type="text"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(filterAmountInput(e.target.value))}
            className={fieldClass}
          />
        </label>

        {error && <p className="mt-3 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="btn-primary px-4 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Report breakdown'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default BreakdownModal
