// CapacityCard: in Review Quote, tells staff whether the quote's trips can
// actually be run from the pickup date being offered -- each trip on the
// earliest free driver (with his truck) and trailer, counting approved leave,
// trips already booked, the shop, and offers waiting for the client's answer --
// and when the last trip would end. Shows the plan (who does which trip) and
// any driver changes on booked trips the plan needs. Advisory: staff can still
// send the offer (the modal asks first). The rules live in lib/capacity.ts
// (planTrips), the loading in lib/capacityLoad.ts. It reports its result up
// through onResult so the modal can ask before sending an offer that doesn't fit.
import { useEffect, useState } from 'react'
import { formatDateTime, formatSlot } from '../../../lib/format'
import { planTrips, shortageLabel, type CapacityCheck, type Resource, type TripPlan } from '../../../lib/capacity'
import { buildDemand, loadCapacityInputs } from '../../../lib/capacityLoad'
import { substituteNote } from '../../../lib/trailerRules'

type Props = {
  quoteId: number
  // quote_requests.cargo_lines
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cargoLines: any
  hoursPerTrip: string
  pickupDate: string
  deadlineDate: string
  onResult: (result: CapacityCheck | null) => void
  onReject: () => void
}

// Wait for typing to settle before asking the database.
const TYPING_DELAY_MS = 500

type View = {
  plan: TripPlan
  tripCount: number
  // Trips ending after it are shown in red.
  deadlineEnd: number | null
  // Names / plates by id.
  byId: Map<string, Resource>
  swapLines: string[]
  hasHolds: boolean
  // "Skeletal instead of the Flatbed asked for" -- containers on the other trailer type.
  substitutes: string[]
}

function CapacityCard({ quoteId, cargoLines, hoursPerTrip, pickupDate, deadlineDate, onResult, onReject }: Props) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The inputs of the last finished check -- "loading" = not the current ones.
  const [checkedKey, setCheckedKey] = useState<string | null>(null)

  const hours = Number(hoursPerTrip)
  const ready = hours > 0 && pickupDate !== ''
  const inputsKey = JSON.stringify([cargoLines, hours, pickupDate, deadlineDate, quoteId])
  const loading = ready && checkedKey !== inputsKey

  useEffect(() => {
    // Not ready: the card shows "Enter the hours..." (view isn't read).
    if (!ready) {
      onResult(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const args = { cargoLines, hours, pickupDate, deadlineDate: deadlineDate || null }
      // The default start time is only known once loaded; the first demand
      // (8 AM) is just for how far to read, then it's rebuilt with the real one.
      const { inputs, error: loadError } = await loadCapacityInputs(buildDemand({ ...args, defaultStartMinutes: 480 }), quoteId)
      if (cancelled) return
      setCheckedKey(inputsKey)
      if (!inputs) {
        setError(loadError)
        setView(null)
        onResult(null)
        return
      }
      setError(null)
      const demand = buildDemand({ ...args, defaultStartMinutes: inputs.defaultStartMinutes })
      const plan = planTrips(demand, inputs.world)
      const byId = new Map(inputs.world.resources.map((r) => [r.id, r]))
      const name = (id: string | null) => (id ? (byId.get(id)?.label ?? id) : 'nobody')
      const swapLines = plan.swaps.map((s) => `Trip #${s.itineraryId}: ${name(s.fromDriverId)} → ${name(s.toDriverId)} (truck ${name(s.toTruckId)})`)
      setView({
        plan,
        tripCount: demand.trips.length,
        deadlineEnd: demand.deadlineEnd,
        byId,
        swapLines,
        hasHolds: inputs.world.resources.some((r) => r.busy.some((b) => b.tentative)),
        substitutes: [
          ...new Set(plan.trips.flatMap((p, i) => substituteNote(demand.trips[i].trailerType, byId.get(p.trailerId)?.trailerType) ?? [])),
        ],
      })
      onResult({ plan, swapLines })
    }, TYPING_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // onResult is a state setter from the modal -- stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cargoLines, hours, pickupDate, deadlineDate, quoteId, inputsKey])

  let tone = 'border-slate-300'
  let body: React.ReactNode
  if (!ready) {
    body = <p className="text-sm text-slate-500">Enter the hours per trip and pickup date to check availability.</p>
  } else if (error) {
    tone = 'border-amber-300 bg-amber-50'
    body = <p className="text-sm text-amber-900">Couldn't check availability ({error}).</p>
  } else if (!view) {
    body = <p className="text-sm text-slate-500">Checking availability…</p>
  } else {
    const { plan, tripCount, byId } = view
    const label = (id: string) => byId.get(id)?.label ?? id
    const drivers = `${plan.driversUsed} ${plan.driversUsed === 1 ? 'driver' : 'drivers'}`
    const rejectButton = (
      <button type="button" onClick={onReject} className="btn-danger mt-3">
        Reject: schedule unavailable
      </button>
    )

    let verdict: React.ReactNode
    if (plan.status === 'fits') {
      tone = 'border-green-300 bg-green-50'
      verdict = (
        <>
          <p className="text-sm font-semibold text-green-900">Can run as asked</p>
          <p className="mt-1 text-sm text-green-900">
            All {tripCount} {tripCount === 1 ? 'trip' : 'trips'} done by <span className="font-semibold">{formatDateTime(plan.lastEnd)}</span> · {drivers}
          </p>
        </>
      )
    } else if (plan.status === 'late') {
      tone = 'border-red-300 bg-red-50'
      verdict = (
        <>
          <p className="text-sm font-semibold text-red-900">Finishes after the deadline</p>
          <p className="mt-1 text-sm text-red-900">
            Starting as offered, the last trip ends <span className="font-semibold">{formatDateTime(plan.lastEnd)}</span>, {plan.hoursLate} h after the
            deadline · <span className="font-semibold">{plan.doneByDeadline} of {tripCount}</span> trips by the deadline · {drivers}
          </p>
          {rejectButton}
        </>
      )
    } else {
      tone = 'border-red-300 bg-red-50'
      const shortage = plan.shortage!
      const what = shortageLabel(shortage).replace(/^No /, '').replace(/ free$/, '')
      verdict = shortage.missing ? (
        <>
          <p className="text-sm font-semibold text-red-900">Our fleet can't carry this</p>
          <p className="mt-1 text-sm text-red-900">We don't have any {what} for these trips.</p>
          {rejectButton}
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-red-900">Nothing free</p>
          <p className="mt-1 text-sm text-red-900">
            {shortageLabel(shortage)} for trip {shortage.tripIndex + 1} of {tripCount} within 2 weeks after the deadline
            {plan.trips.length > 0 ? ` (${plan.trips.length} of ${tripCount} could be placed)` : ''}.
          </p>
          {rejectButton}
        </>
      )
    }

    body = (
      <>
        {verdict}
        {plan.trips.length > 0 && (
          <table className="mt-3 w-full text-left text-[13px]">
            <thead>
              <tr>
                <th className="py-1 pr-2">Trip</th>
                <th className="py-1 pr-2">Slot</th>
                <th className="py-1 pr-2">Driver</th>
                <th className="py-1 pr-2">Truck</th>
                <th className="py-1">Trailer</th>
              </tr>
            </thead>
            <tbody className="text-slate-800">
              {plan.trips.map((t, i) => (
                <tr key={i} className={view.deadlineEnd !== null && t.end > view.deadlineEnd ? 'font-semibold text-red-800' : ''}>
                  <td className="py-1 pr-2">{i + 1}</td>
                  <td className="py-1 pr-2">{formatSlot(t.start, t.end)}</td>
                  <td className="py-1 pr-2">{label(t.driverId)}</td>
                  <td className="py-1 pr-2">
                    {label(t.truckId)}
                    {t.spareTruck ? ' (spare)' : ''}
                  </td>
                  <td className="py-1">{label(t.trailerId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.swapLines.length > 0 && (
          <div className="mt-3 text-sm text-slate-800">
            <p className="font-semibold">Driver changes needed on booked trips</p>
            <ul className="mt-1 list-disc pl-5">
              {view.swapLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        {view.substitutes.length > 0 && <p className="mt-2 text-xs text-slate-600">Using a {view.substitutes.join(', ')}.</p>}
        {view.hasHolds && <p className="mt-2 text-xs text-slate-600">Offers still waiting for the client's answer are counted as booked.</p>}
      </>
    )
  }

  return (
    <section className={`border-2 px-5 py-5 ${tone}`} aria-busy={loading}>
      <h3 className="text-[17px] font-semibold text-slate-900">Capacity</h3>
      <div className="mt-2">{body}</div>
    </section>
  )
}

export default CapacityCard
