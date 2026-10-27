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

const CHECK = 'M5 12l5 5 9-10'
const WARN = 'M12 3l10 18H2z M12 10v5 M12 18h.01'

const BANNERS: Record<PaymentState, { title: string; text: string; icon: string; className: string }> = {
  paid: { title: 'OK to unload', text: 'Payment: fully paid', icon: CHECK, className: 'border-green-700 bg-green-100 text-green-900' },
  terms: { title: 'OK to unload', text: 'Payment: on credit terms', icon: CHECK, className: 'border-green-700 bg-green-100 text-green-900' },
  unpaid: {
    title: 'Not fully paid',
    text: 'Call dispatch before unloading',
    icon: WARN,
    className: 'border-red-700 bg-red-50 text-red-900',
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
    return <p className="text-[13px] text-ink-muted">Payment status unavailable -- check with dispatch before unloading.</p>
  }
  if (!state || !BANNERS[state]) return null
  const banner = BANNERS[state]
  return (
    <p className={`flex items-center gap-2.5 border px-3.5 py-2.5 text-sm ${banner.className}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
        <path d={banner.icon} />
      </svg>
      <span>
        <strong>{banner.title}</strong> · {banner.text}
      </span>
    </p>
  )
}

export default TripPaymentBanner
