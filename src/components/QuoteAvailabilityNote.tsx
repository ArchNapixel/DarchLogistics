// QuoteAvailabilityNote: under the schedule step of the client's quote form --
// a one-line estimate of whether we can take the trips on the chosen pickup
// date, and if not, the earliest date we can. It's only an estimate (hours
// per trip are assumed; staff confirm the real date in their offer), and it
// never blocks submitting. Clients only learn dates -- the database function
// behind it (get_capacity_inputs) sends no names, plates or reasons to them.
import { useEffect, useState } from 'react'
import { formatDate } from '../lib/format'
import { toManilaDate } from '../lib/payslip'
import { checkCapacity } from '../lib/capacity'
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
  const storage = form.isLastDayOfPortStorage === 'Yes'
  const inputsKey = [cargoKey, form.preferredPickupDate, form.preferredDeliveryDate, storage].join('|')

  useEffect(() => {
    if (!form.preferredPickupDate) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const args = {
        cargoLines: JSON.parse(cargoKey),
        hours: DEFAULT_HOURS_PER_TRIP,
        pickupDate: form.preferredPickupDate,
        deadlineDate: form.preferredDeliveryDate || null,
        storage,
      }
      const { inputs } = await loadCapacityInputs(buildDemand({ ...args, defaultStartMinutes: 360 }), null)
      // Can't check (or nothing to check): say nothing rather than guess.
      if (cancelled || !inputs) return
      const demand = buildDemand({ ...args, defaultStartMinutes: inputs.defaultStartMinutes })
      if (demand.trips.length === 0) return
      const result = checkCapacity(demand, inputs.resources)
      if (result.status === 'fits') {
        setNote({ tone: 'ok', text: 'This date looks available. We confirm the final date in our offer.', forKey: inputsKey })
      } else if (result.status === 'none') {
        setNote({ tone: 'later', text: "We're fully booked around this date. Send the request anyway and we'll offer you the closest date we can.", forKey: inputsKey })
      } else {
        setNote({
          tone: 'later',
          text: `Earliest available start for your trips: ${formatDate(toManilaDate(new Date(result.start)))}. You can still send the request and we'll confirm a date in our offer.`,
          forKey: inputsKey,
        })
      }
    }, TYPING_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [form.preferredPickupDate, form.preferredDeliveryDate, cargoKey, storage, inputsKey])

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
