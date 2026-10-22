// TripPaymentBanner: on the driver's (and helper's) trip card once the
// cargo is picked up -- tells them whether the client's payment allows
// unloading (#13). Crew can't read bookings or payments (on purpose), so
// this asks the get_trip_payment_status() database function, which only
// answers active crew of that trip and only with a status word:
//   'paid'   -- booking fully paid                     -> OK to unload
//   'terms'  -- 7/14/30-day terms, downpayment settled -> OK to unload
//   'unpaid' -- Cash terms with money still owed       -> call dispatch
// No amounts are shown to the crew.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type PaymentState = 'paid' | 'terms' | 'unpaid'

const BANNERS: Record<PaymentState, { text: string; className: string }> = {
  paid: { text: '🟢 Fully paid: OK to unload', className: 'border-green-300 bg-green-50 text-green-800' },
  terms: { text: '🟢 On credit terms: OK to unload', className: 'border-green-300 bg-green-50 text-green-800' },
  unpaid: {
    text: '🔴 Not fully paid: call dispatch before unloading',
    className: 'border-red-300 bg-red-50 text-red-800',
  },
}

function TripPaymentBanner({ itineraryId }: { itineraryId: number }) {
  const [state, setState] = useState<PaymentState | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_trip_payment_status', { p_itinerary_id: itineraryId }).then(({ data, error }) => {
      if (cancelled) return
      if (error || !data) setFailed(true)
      else setState(data as PaymentState)
    })
    return () => {
      cancelled = true
    }
  }, [itineraryId])

  if (failed) {
    return <p className="mt-3 text-xs text-slate-500">Payment status unavailable -- check with dispatch before unloading.</p>
  }
  if (!state || !BANNERS[state]) return null
  return <p className={`mt-3 border px-3 py-2 text-sm font-semibold ${BANNERS[state].className}`}>{BANNERS[state].text}</p>
}

export default TripPaymentBanner
