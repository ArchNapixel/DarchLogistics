// CapacityCard: in Review Quote, tells staff whether the quote's trips can
// actually be run on the pickup date being offered -- enough drivers, trucks
// and trailers free, counting approved leave, trips already booked, the
// shop, and offers waiting for the client's answer -- and if not, the
// earliest date that works. Advisory: staff can still send the offer (the
// modal asks first). The rules live in lib/capacity.ts, the loading in
// lib/capacityLoad.ts. It reports its result up through onResult so the
// modal can ask before sending an offer that doesn't fit.
import { useEffect, useState } from 'react'
import { formatDate, formatDateTime } from '../../../lib/format'
import { toManilaDate } from '../../../lib/payslip'
import { availabilityBreakdown, checkCapacity, shortageLabel, type CapacityResult, type KindAvailability } from '../../../lib/capacity'
import { buildDemand, loadCapacityInputs } from '../../../lib/capacityLoad'

type Props = {
  quoteId: number
  // quote_requests.cargo_lines
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cargoLines: any
  hoursPerTrip: string
  pickupDate: string
  deadlineDate: string
  storage: boolean
  onResult: (result: CapacityResult | null) => void
  // Put the suggested pickup date (and a deadline that still fits) in the offer.
  onUseStart: (pickupDate: string, lastTripEndDate: string) => void
  onReject: () => void
}

// "driver(s)", "truck(s)", "Skeletal trailer(s)".
const kindLabel = (b: KindAvailability, count: number) =>
  `${b.kind === 'Trailer' && b.trailerType ? `${b.trailerType} ` : ''}${b.kind.toLowerCase()}${count === 1 ? '' : 's'}`

// Wait for typing to settle before asking the database.
const TYPING_DELAY_MS = 500

type View = { result: CapacityResult; requestedStart: number; hasHolds: boolean; breakdown: KindAvailability[] }

function CapacityCard({ quoteId, cargoLines, hoursPerTrip, pickupDate, deadlineDate, storage, onResult, onUseStart, onReject }: Props) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const hours = Number(hoursPerTrip)
  const ready = hours > 0 && pickupDate !== ''

  useEffect(() => {
    if (!ready) {
      setView(null)
      onResult(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const args = { cargoLines, hours, pickupDate, deadlineDate: deadlineDate || null, storage }
      // The default start time is only known once loaded; the first demand
      // (6 AM) is just for how far to read, then it's rebuilt with the real one.
      const { inputs, error: loadError } = await loadCapacityInputs(buildDemand({ ...args, defaultStartMinutes: 360 }), quoteId)
      if (cancelled) return
      setLoading(false)
      if (!inputs) {
        setError(loadError)
        setView(null)
        onResult(null)
        return
      }
      setError(null)
      const demand = buildDemand({ ...args, defaultStartMinutes: inputs.defaultStartMinutes })
      const result = checkCapacity(demand, inputs.resources)
      setView({
        result,
        requestedStart: demand.requestedStart,
        hasHolds: inputs.resources.some((r) => r.busy.some((b) => b.tentative)),
        breakdown: availabilityBreakdown(demand, inputs.resources),
      })
      onResult(result)
    }, TYPING_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // onResult is a state setter from the modal -- stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cargoLines, hours, pickupDate, deadlineDate, storage, quoteId])

  const dayOf = (ms: number) => toManilaDate(new Date(ms))
  const unique = (labels: string[]) => [...new Set(labels)].join(', ')

  let tone = 'border-slate-300'
  let body: React.ReactNode = null
  if (!ready) {
    body = <p className="text-sm text-slate-500">Enter the hours per trip and pickup date to check availability.</p>
  } else if (error) {
    tone = 'border-amber-300 bg-amber-50'
    body = <p className="text-sm text-amber-900">Couldn't check availability ({error}).</p>
  } else if (!view) {
    body = <p className="text-sm text-slate-500">Checking availability…</p>
  } else {
    const { result } = view
    const needs = result.status === 'fits' || result.status === 'later' || result.status === 'late' ? result.placements : []
    const crew = unique(needs.map((p) => p.driver.label))
    const vehicles = unique(needs.map((p) => `${p.truck.label} / ${p.trailer.label}`))
    const useButton = (label: string) =>
      result.status === 'later' || result.status === 'late' ? (
        <button
          type="button"
          onClick={() => onUseStart(dayOf(result.start), dayOf(result.placements[result.placements.length - 1].end - 1))}
          className="border-2 border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          {label}
        </button>
      ) : null
    const rejectButton = (
      <button type="button" onClick={onReject} className="border-2 border-red-700 px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-50">
        Reject: schedule unavailable
      </button>
    )

    if (result.status === 'fits') {
      tone = 'border-green-300 bg-green-50'
      body = (
        <>
          <p className="text-sm font-semibold text-green-900">Can run as asked</p>
          <p className="mt-1 text-sm text-green-900">
            Free: {crew} · {vehicles}
          </p>
        </>
      )
    } else if (result.status === 'later') {
      tone = 'border-amber-300 bg-amber-50'
      body = (
        <>
          <p className="text-sm font-semibold text-amber-900">
            {shortageLabel(result.shortageAtRequested)} on {formatDate(dayOf(view.requestedStart))}
          </p>
          <p className="mt-1 text-sm text-amber-900">
            Earliest that works: <span className="font-semibold">{formatDate(dayOf(result.start))}</span> ({crew}), still before the
            deadline.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {useButton(`Use ${formatDate(dayOf(result.start))} as the pickup date`)}
            {rejectButton}
          </div>
        </>
      )
    } else if (result.status === 'late') {
      tone = 'border-red-300 bg-red-50'
      body = (
        <>
          <p className="text-sm font-semibold text-red-900">Nothing free before the deadline</p>
          <p className="mt-1 text-sm text-red-900">
            {shortageLabel(result.shortageAtRequested)} on {formatDate(dayOf(view.requestedStart))}. The earliest we can do it is{' '}
            <span className="font-semibold">{formatDate(dayOf(result.start))}</span> ({crew}), after the client's deadline.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {useButton(`Offer ${formatDate(dayOf(result.start))} instead`)}
            {rejectButton}
          </div>
        </>
      )
    } else {
      tone = 'border-red-300 bg-red-50'
      body = (
        <>
          <p className="text-sm font-semibold text-red-900">Nothing free</p>
          <p className="mt-1 text-sm text-red-900">
            {shortageLabel(result.shortageAtRequested)} on {formatDate(dayOf(view.requestedStart))}, and nothing opens up in the next 2
            weeks after the deadline.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">{rejectButton}</div>
        </>
      )
    }
    // The fleet can never do this quote as asked (more needed at once than we own).
    const tooSmall = view.breakdown.find((b) => b.need > b.have)
    if (tooSmall) {
      tone = 'border-red-300 bg-red-50'
      body = (
        <>
          <p className="text-sm font-semibold text-red-900">Our fleet is too small for this quote</p>
          <p className="mt-1 text-sm text-red-900">
            We only have {tooSmall.have} {kindLabel(tooSmall, tooSmall.have)}; this needs {tooSmall.need} at the same time. Offer fewer
            trips at once, or reject it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">{rejectButton}</div>
        </>
      )
    }
    body = (
      <>
        {body}
        <table className="mt-3 w-full text-left text-[13px]">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-medium">Needed at once</th>
              <th className="py-1 font-medium">Free at that time</th>
              <th className="py-1 font-medium">Earliest free</th>
            </tr>
          </thead>
          <tbody className="text-slate-800">
            {view.breakdown.map((b) => {
              const short = b.freeAtRequested < b.need
              return (
                <tr key={`${b.kind}-${b.trailerType}`} className={short ? 'font-semibold text-red-800' : ''}>
                  <td className="py-1">
                    {b.need} {kindLabel(b, b.need)}
                  </td>
                  <td className="py-1">
                    {b.freeAtRequested} of {b.have}
                    {short ? ' ⚠' : ''}
                  </td>
                  <td className="py-1">{short ? (b.earliestFree !== null ? formatDateTime(new Date(b.earliestFree).toISOString()) : 'not within 2 weeks') : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </>
    )
    if (view.hasHolds) {
      body = (
        <>
          {body}
          <p className="mt-2 text-xs text-slate-600">Offers still waiting for the client's answer are counted as booked.</p>
        </>
      )
    }
  }

  return (
    <section className={`border-2 px-5 py-5 ${tone}`} aria-busy={loading}>
      <h3 className="text-[17px] font-semibold text-slate-900">Capacity</h3>
      <div className="mt-2">{body}</div>
    </section>
  )
}

export default CapacityCard
