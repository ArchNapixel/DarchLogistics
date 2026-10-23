// TripStorageBanner: on the driver's (and helper's) trip card while the
// trip is not picked up yet -- if the booking is a last-free-storage-day
// one, the container must leave the port by 11:59 PM that day (#15).
// Crew can't read bookings (on purpose), so this asks the
// get_trip_storage_deadline() database function, which only answers
// active crew of that trip and only with the date (null = no deadline).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { formatDate } from '../../../lib/format'
import { storageDeadlineEnd } from '../../../lib/storageDeadline'

function TripStorageBanner({ itineraryId }: { itineraryId: number }) {
  const [deadline, setDeadline] = useState<string | null>(null)
  // Time the card loaded -- enough to say "missed" (render must stay pure).
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_trip_storage_deadline', { p_itinerary_id: itineraryId }).then(({ data, error }) => {
      // On an error just show nothing -- dispatch still sees the deadline.
      if (!cancelled && !error) setDeadline((data as string | null) ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [itineraryId])

  if (!deadline) return null
  const missed = now > storageDeadlineEnd(deadline)
  return (
    <p
      className={`mt-3 border px-3 py-2 text-sm font-semibold ${
        missed ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      {missed
        ? `🔴 Storage deadline passed (${formatDate(deadline)}) -- call dispatch`
        : `⏰ Last free storage day: pick up from the port by 11:59 PM on ${formatDate(deadline)}`}
    </p>
  )
}

export default TripStorageBanner
