import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import RoleBadge from '../../components/RoleBadge'
import { supabase } from '../../lib/supabaseClient'

function StaffDashboard() {
  const { username, role } = useAuth()
  const [summary, setSummary] = useState({
    pendingQuotes: 0,
    activeBookings: 0,
    todayDeliveries: 0,
    fleetSize: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadSummary() {
      try {
        const today = new Date().toISOString().slice(0, 10)

        const [quotes, bookings, deliveries, trucks, trailers] =
          await Promise.all([
            supabase
              .from('quote_requests')
              .select('quote_request_id', { count: 'exact', head: true })
              .eq('request_status', 'Pending'),
            supabase
              .from('bookings')
              .select('booking_id', { count: 'exact', head: true })
              .in('booking_status', ['Confirmed', 'Dispatched', 'InProgress']),
            supabase
              .from('bookings')
              .select('booking_id', { count: 'exact', head: true })
              .eq('booking_date', today),
            supabase
              .from('truck_profiles')
              .select('truck_code', { count: 'exact', head: true }),
            supabase
              .from('trailers')
              .select('trailer_id', { count: 'exact', head: true }),
          ])

        if (
          quotes.error ||
          bookings.error ||
          deliveries.error ||
          trucks.error ||
          trailers.error
        ) {
          console.error('Failed to load dashboard summary')
          return
        }

        setSummary({
          pendingQuotes: quotes.count ?? 0,
          activeBookings: bookings.count ?? 0,
          todayDeliveries: deliveries.count ?? 0,
          fleetSize: (trucks.count ?? 0) + (trailers.count ?? 0),
        })
      } catch (error) {
        console.error('Failed to load dashboard summary', error)
      } finally {
        setLoading(false)
      }
    }

    loadSummary()
  }, [])

  const summaryCards = [
    { label: 'Pending Quotes', value: summary.pendingQuotes },
    { label: 'Active Bookings', value: summary.activeBookings },
    { label: "Today's Deliveries", value: summary.todayDeliveries },
    { label: 'Fleet Size', value: summary.fleetSize },
  ]

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {username}
        </h1>
        <RoleBadge role={role} />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {loading ? '--' : card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default StaffDashboard
