// tripProfit: loads the delivered trips of a month for Accounting -> Trip
// Profitability and works out each trip's margin. The per-trip math is in
// tripProfitTotals.ts (self-checked); this file only fetches and wires.
//
// A trip belongs to the month of its LATEST Delivered row in
// dispatch_status_logs (Manila time) -- the same delivery date payroll and
// Payments Due use -- and only counts while it's still Delivered now (a
// trip corrected back isn't).
// ponytail: driver pay uses TODAY's commission rate / per-trip fee, not
// what each payslip actually paid -- if the rates change, old months drift.
// Read payslip_line_items per itinerary if exact driver pay matters.
// ponytail: client damage charges aren't added to revenue (they're stored
// per booking, not per trip) -- only the trip rate counts as revenue.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'
import { csvField } from './inventoryReport'
import { fetchAll, fetchIn } from './dashboardExpenses'
import { nextMonthStart } from './remittanceTotals'
import { tripProfit, type TripProfit } from './tripProfitTotals'

export function currentTripProfitMonth(): string {
  return toManilaDate(new Date()).slice(0, 7)
}

export type TripProfitRow = TripProfit & {
  itinerary_id: number
  booking_id: number
  client_id: number
  client_name: string
  plate_number: string | null
  delivered_on: string // YYYY-MM-DD, Manila
  distance_missing: boolean // diesel estimated from 0 km
}

type LogRow = { itinerary_id: number; status_changed_at: string }
type TripRow = { itinerary_id: number; booking_id: number; plate_number: string | null; itinerary_status: string | null }
type BookingRow = {
  booking_id: number
  client_id: number
  rate_of_delivery_service: number | string | null
  estimated_distance_km: number | string | null
}
type ExpenseRow = { itinerary_id: number; amount: number | string; category: string }
type DamageRow = { itinerary_id: number; estimated_damage_cost: number | string | null }

export async function loadTripProfitReport(month: string): Promise<{
  rows: TripProfitRow[]
  settingsMissing: string[]
  error: string | null
}> {
  const from = `${month}-01`
  const to = nextMonthStart(month)

  // Every Delivered log from the month onward: the latest per trip decides
  // its delivery date, and one later than this month moves it out.
  const [logs, settings] = await Promise.all([
    fetchAll<LogRow>((a, b) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .eq('new_status', 'Delivered')
        .gte('status_changed_at', `${from}T00:00:00+08:00`)
        .range(a, b),
    ),
    supabase
      .from('app_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['diesel_price_per_liter', 'driver_commission_rate', 'driver_per_trip_fee']),
  ])
  if (logs.error) return { rows: [], settingsMissing: [], error: logs.error }
  if (settings.error) return { rows: [], settingsMissing: [], error: settings.error.message }

  const latestByTrip = new Map<number, string>()
  logs.rows.forEach((l) => {
    const date = toManilaDate(l.status_changed_at)
    if (date > (latestByTrip.get(l.itinerary_id) ?? '')) latestByTrip.set(l.itinerary_id, date)
  })
  const inMonthIds = Array.from(latestByTrip)
    .filter(([, date]) => date >= from && date < to)
    .map(([id]) => id)

  const setting = new Map((settings.data ?? []).map((s) => [s.setting_key, Number(s.setting_value)]))
  const settingsMissing = ['diesel_price_per_liter', 'driver_commission_rate', 'driver_per_trip_fee'].filter(
    (key) => !setting.has(key),
  )
  const costSettings = {
    dieselPricePerLiter: setting.get('diesel_price_per_liter') ?? 0,
    driverCommissionRate: setting.get('driver_commission_rate') ?? 0,
    driverPerTripFee: setting.get('driver_per_trip_fee') ?? 0,
  }

  const trips = await fetchIn<TripRow>(inMonthIds, (chunk, a, b) =>
    supabase
      .from('itineraries')
      .select('itinerary_id, booking_id, plate_number, itinerary_status')
      .in('itinerary_id', chunk)
      .range(a, b),
  )
  if (trips.error) return { rows: [], settingsMissing, error: trips.error }
  const delivered = trips.rows.filter((t) => t.itinerary_status === 'Delivered')
  const tripIds = delivered.map((t) => t.itinerary_id)
  const bookingIds = Array.from(new Set(delivered.map((t) => t.booking_id)))

  const [bookings, expenses, damage] = await Promise.all([
    fetchIn<BookingRow>(bookingIds, (chunk, a, b) =>
      supabase
        .from('bookings')
        .select('booking_id, client_id, rate_of_delivery_service, estimated_distance_km')
        .in('booking_id', chunk)
        .range(a, b),
    ),
    fetchIn<ExpenseRow>(tripIds, (chunk, a, b) =>
      supabase
        .from('itinerary_expenses')
        .select('itinerary_id, amount, category')
        .in('itinerary_id', chunk)
        .range(a, b),
    ),
    fetchIn<DamageRow>(tripIds, (chunk, a, b) =>
      supabase
        .from('delivery_damage_records')
        .select('itinerary_id, estimated_damage_cost')
        .in('itinerary_id', chunk)
        .eq('damage_status', 'Approved')
        .eq('charge_to', 'Company')
        .range(a, b),
    ),
  ])
  const dataError = bookings.error ?? expenses.error ?? damage.error
  if (dataError) return { rows: [], settingsMissing, error: dataError }

  const clientIds = Array.from(new Set(bookings.rows.map((b) => b.client_id)))
  const clients = await fetchIn<{ client_id: number; client_name: string }>(clientIds, (chunk, a, b) =>
    supabase.from('clients').select('client_id, client_name').in('client_id', chunk).range(a, b),
  )
  if (clients.error) return { rows: [], settingsMissing, error: clients.error }

  const bookingById = new Map(bookings.rows.map((b) => [b.booking_id, b]))
  const clientNameById = new Map(clients.rows.map((c) => [c.client_id, c.client_name]))
  const fuelByTrip = new Map<number, number>()
  const otherByTrip = new Map<number, number>()
  expenses.rows.forEach((e) => {
    const map = e.category === 'Fuel' ? fuelByTrip : otherByTrip
    map.set(e.itinerary_id, (map.get(e.itinerary_id) ?? 0) + Number(e.amount))
  })
  const damageByTrip = new Map<number, number>()
  damage.rows.forEach((d) =>
    damageByTrip.set(d.itinerary_id, (damageByTrip.get(d.itinerary_id) ?? 0) + Number(d.estimated_damage_cost ?? 0)),
  )

  const rows: TripProfitRow[] = delivered.flatMap((trip) => {
    const booking = bookingById.get(trip.booking_id)
    if (!booking) return []
    const km = Number(booking.estimated_distance_km ?? 0)
    const fuelLogged = fuelByTrip.get(trip.itinerary_id) ?? 0
    return [
      {
        ...tripProfit(costSettings, {
          ratePerTrip: Number(booking.rate_of_delivery_service ?? 0),
          distanceKm: km,
          fuelLogged,
          otherExpenses: otherByTrip.get(trip.itinerary_id) ?? 0,
          companyDamage: damageByTrip.get(trip.itinerary_id) ?? 0,
        }),
        itinerary_id: trip.itinerary_id,
        booking_id: trip.booking_id,
        client_id: booking.client_id,
        client_name: clientNameById.get(booking.client_id) ?? '—',
        plate_number: trip.plate_number,
        delivered_on: latestByTrip.get(trip.itinerary_id) ?? from,
        distance_missing: fuelLogged <= 0 && km <= 0,
      },
    ]
  })

  // Newest delivery first.
  rows.sort((x, y) => y.delivered_on.localeCompare(x.delivered_on) || y.itinerary_id - x.itinerary_id)
  return { rows, settingsMissing, error: null }
}

// Plain numbers so the CSV opens as numbers in Excel.
export function buildTripProfitCsv(month: string, rows: TripProfitRow[]): string {
  const lines = [
    [
      'Trip #', 'Booking #', 'Client', 'Truck', 'Delivered', 'Revenue', 'Driver Pay',
      'Diesel', 'Diesel Estimated', 'Other Expenses', 'Company Damage', 'Total Cost',
      'Profit', 'Margin %',
    ],
    ...rows.map((r) => [
      r.itinerary_id, r.booking_id, r.client_name, r.plate_number ?? '', r.delivered_on,
      r.revenue, r.driverPay, r.diesel, r.dieselEstimated ? 'Yes' : 'No', r.otherExpenses,
      r.companyDamage, r.totalCost, r.profit, r.marginPct ?? '',
    ]),
  ]
  return [`Trip Profitability - ${month}`, '', ...lines.map((cells) => cells.map(csvField).join(','))].join('\n')
}
