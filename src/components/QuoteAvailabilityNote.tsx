// QuoteAvailabilityNote: under the schedule step of the client's quote form --
// a one-line estimate of whether we can finish the trips by the chosen
// deadline, and if not, when they would finish. It's only an estimate (hours
// per trip are assumed; staff confirm the real date in their offer), and it
// never blocks submitting. Clients only learn dates -- the database function
// behind it (get_capacity_inputs) sends no names, plates or reasons to them.
import { useEffect, useState } from 'react'
import { formatDate } from '../lib/format'
import { toManilaDate } from '../lib/payslip'
import { planTrips } from '../lib/capacity'
import { DEFAULT_HOURS_PER_TRIP, buildDemand, loadCapacityInputs } from '../lib/capacityLoad'
import type { ShipmentForm } from '../lib/quoteRequest'

// Wait for typing to settle before asking the database.
const TYPING_DELAY_MS = 600

// `forKey` = the inputs it was worked out for; a note for older inputs isn't
// shown (instead of clearing it in the effect, which React's lint forbids).
type Note = { tone: 'ok' | 'later'; text: string; forKey: string }

function QuoteAvailabilityNote({ form }: { form: ShipmentForm }) {
  const [note, setNote] = useState<Note | null>(null)

  // Just what the check reads from the cargo lines; JSON so the effect only
  // re-runs when it really changes.
  const cargoKey = JSON.stringify(
    form.cargoLines.map((l) => ({ trailer_type: l.trailerType, quantity: Number(l.quantity) || 1 })),
  )
  const inputsKey = [cargoKey, form.preferredPickupDate, form.preferredDeliveryDate].join('|')

  useEffect(() => {
    if (!form.preferredPickupDate) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const args = {
        cargoLines: JSON.parse(cargoKey),
        hours: DEFAULT_HOURS_PER_TRIP,
        pickupDate: form.preferredPickupDate,
        deadlineDate: form.preferredDeliveryDate || null,
      }
      const { inputs } = await loadCapacityInputs(buildDemand({ ...args, defaultStartMinutes: 480 }), null)
      // Can't check (or nothing to check): say nothing rather than guess.
      if (cancelled || !inputs) return
      const demand = buildDemand({ ...args, defaultStartMinutes: inputs.defaultStartMinutes })
      if (demand.trips.length === 0) return
      const plan = planTrips(demand, inputs.world)
      const trips = demand.trips.length
      if (plan.status === 'fits') {
        setNote({ tone: 'ok', text: 'This date looks available. We confirm the final date in our offer.', forKey: inputsKey })
      } else if (plan.status === 'none') {
        setNote({ tone: 'later', text: "We're fully booked around this date. Send the request anyway and we'll offer you the closest date we can.", forKey: inputsKey })
      } else {
        setNote({
          tone: 'later',
          text: `Starting on this date, your trips would finish around ${formatDate(toManilaDate(new Date(plan.lastEnd!)))}, after your deadline (${plan.doneByDeadline} of ${trips} by then). You can still send the request and we'll confirm the dates in our offer.`,
          forKey: inputsKey,
        })
      }
    }, TYPING_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [form.preferredPickupDate, form.preferredDeliveryDate, cargoKey, inputsKey])

  if (!note || note.forKey !== inputsKey) return null
  return (
    <p
      className={`col-span-full border px-4 py-3 text-sm ${
        note.tone === 'ok' ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      {note.text}
    </p>
  )
}

export default QuoteAvailabilityNote
