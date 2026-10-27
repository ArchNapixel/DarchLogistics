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
      className={`flex items-center gap-2.5 border px-3.5 py-2.5 text-sm ${
        missed ? 'border-red-700 bg-red-50 text-red-900' : 'border-amber-600 bg-amber-100 text-amber-900'
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2" />
      </svg>
      {missed ? (
        <span>
          <strong>Storage deadline passed</strong> ({formatDate(deadline)}) -- call dispatch
        </span>
      ) : (
        <span>
          <strong>Storage deadline:</strong> container must leave the port by 11:59 PM, {formatDate(deadline)}
        </span>
      )}
    </p>
  )
}

export default TripStorageBanner
