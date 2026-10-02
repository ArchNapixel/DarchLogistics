// dashboardExpenses.ts: loads the numbers for the Admin dashboard's
// Operational Expenses and Maintenance Expenses cards. The math itself is
// in expenseTotals.ts (self-checked); this file only fetches and wires.
//
// OPERATIONAL = payroll (gross + employer shares, DRAFT payslips included
// so this week's run shows live) + trip expenses the crew logged +
// diesel + damage charged to the Company.
//   - Commission and the per-trip fee are NOT added again: they're already
//     inside drivers' gross_pay.
//   - Diesel is counted once per delivered trip: the Fuel the crew logged
//     if any, otherwise the quote calculator's estimate (tripCost.ts).
//     Fuel logged on a trip that isn't delivered yet counts as actual.
//     A delivered trip's date is its latest Delivered row in
//     dispatch_status_logs (Manila time), the same date payroll uses.
// MAINTENANCE = parts used (quantity x unit_cost copied at time of use):
//   completed work orders by completion date, plus parts logged on work
//   orders still in progress (stock is already taken off at that point).
//
// Every row is counted once; every query is paged past Supabase's
// 1000-row default so a long range can't silently cap.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'
import { dieselForTrip } from './tripCost'
import {
  payslipCost,
  rangeStartManila,
  type Period,
  summarizeParts,
  type PartLine,
  type PayslipCostRow,
} from './expenseTotals'

type Page<T> = { data: T[] | null; error: { message: string } | null }

const PAGE = 1000
const CHUNK = 200

// Reads every page of a query (rows past 1000 would otherwise vanish).
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { rows: [], error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return { rows, error: null }
  }
}

// `.in('col', ids)` with a few hundred ids at a time (long id lists make
// the request URL too big), each chunk paged.
async function fetchIn<T>(
  ids: number[],
  query: (chunk: number[], from: number, to: number) => PromiseLike<Page<T>>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const result = await fetchAll<T>((from, to) => query(chunk, from, to))
    if (result.error) return { rows: [], error: result.error }
    rows.push(...result.rows)
  }
  return { rows, error: null }
}

export type OperationalExpenses = {
  payroll: number // gross pay, finalized + draft
  employerShares: number // SSS ER+EC, PhilHealth ER, Pag-IBIG ER
  draftPayroll: number // part of the two lines above that is still a draft
  tripExpenses: number // logged Toll / Parking / Other
  dieselActual: number // logged Fuel
  dieselEstimated: number // calculator estimate for delivered trips with no Fuel logged
  estimatedTrips: number // how many trips the estimate covers
  tripsMissingDistance: number // of those, trips with no distance (estimated as 0)
  damageCompany: number // approved damage charged to the Company
  total: number
  dieselPriceMissing: boolean
}

type PayslipRow = PayslipCostRow & { finalized_at: string | null }
type LogRow = { itinerary_id: number }
type TripRow = { itinerary_id: number; booking_id: number; itinerary_status: string | null }
type BookingRow = { booking_id: number; estimated_distance_km: number | string | null }
type ExpenseRow = { expense_id: number; itinerary_id: number; amount: number | string; category: string }
type DamageRow = { estimated_damage_cost: number | string | null }

export async function loadOperationalExpenses(
  period: Period,
): Promise<{ data: OperationalExpenses | null; error: string | null }> {
  const cutoff = rangeStartManila(period)
  const cutoffTs = `${cutoff}T00:00:00+08:00`
  const today = toManilaDate(new Date())

  // Payslips by period START (the current week's end is still in the
  // future) -- drafts included, so a payroll run shows as it happens.
  const [payslips, deliveredLogs, expensesInRange, settings] = await Promise.all([
    fetchAll<PayslipRow>((from, to) =>
      supabase
        .from('payroll_payslips')
        .select('finalized_at, gross_pay, sss_er, sss_ec, philhealth_er, pagibig_er')
        .gte('payroll_period_start', cutoff)
        .lte('payroll_period_start', today)
        .range(from, to),
    ),
    fetchAll<LogRow>((from, to) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id')
        .eq('new_status', 'Delivered')
        .gte('status_changed_at', cutoffTs)
        .range(from, to),
    ),
    fetchAll<ExpenseRow>((from, to) =>
      supabase
        .from('itinerary_expenses')
        .select('expense_id, itinerary_id, amount, category')
        .gte('created_at', cutoffTs)
        .range(from, to),
    ),
    supabase
      .from('app_settings')
      .select('setting_value')
      .eq('setting_key', 'diesel_price_per_liter')
      .maybeSingle(),
  ])

  const firstError =
    payslips.error ?? deliveredLogs.error ?? expensesInRange.error ?? settings.error?.message
  if (firstError) return { data: null, error: firstError }

  // Delivered trips in range: still Delivered now (a corrected-back trip
  // isn't), with their distance for the diesel estimate.
  const loggedIds = Array.from(new Set(deliveredLogs.rows.map((r) => r.itinerary_id)))
  const trips = await fetchIn<TripRow>(loggedIds, (chunk, from, to) =>
    supabase
      .from('itineraries')
      .select('itinerary_id, booking_id, itinerary_status')
      .in('itinerary_id', chunk)
      .range(from, to),
  )
  if (trips.error) return { data: null, error: trips.error }
  const deliveredTrips = trips.rows.filter((t) => t.itinerary_status === 'Delivered')
  const deliveredIds = deliveredTrips.map((t) => t.itinerary_id)
  const bookingIds = Array.from(new Set(deliveredTrips.map((t) => t.booking_id)))

  const [bookings, deliveredExpenses, damage] = await Promise.all([
    fetchIn<BookingRow>(bookingIds, (chunk, from, to) =>
      supabase
        .from('bookings')
        .select('booking_id, estimated_distance_km')
        .in('booking_id', chunk)
        .range(from, to),
    ),
    // Fuel on delivered trips counts by trip, whenever it was logged.
    fetchIn<ExpenseRow>(deliveredIds, (chunk, from, to) =>
      supabase
        .from('itinerary_expenses')
        .select('expense_id, itinerary_id, amount, category')
        .in('itinerary_id', chunk)
        .eq('category', 'Fuel')
        .range(from, to),
    ),
    fetchIn<DamageRow>(deliveredIds, (chunk, from, to) =>
      supabase
        .from('delivery_damage_records')
        .select('estimated_damage_cost')
        .in('itinerary_id', chunk)
        .eq('damage_status', 'Approved')
        .eq('charge_to', 'Company')
        .range(from, to),
    ),
  ])
  const secondError = bookings.error ?? deliveredExpenses.error ?? damage.error
  if (secondError) return { data: null, error: secondError }

  // Payroll
  let payroll = 0
  let employerShares = 0
  let draftPayroll = 0
  for (const row of payslips.rows) {
    const cost = payslipCost(row)
    payroll += cost.gross
    employerShares += cost.employerShares
    if (!row.finalized_at) draftPayroll += cost.total
  }

  // Trip expenses + diesel
  const deliveredSet = new Set(deliveredIds)
  let tripExpenses = 0
  let dieselActual = 0
  for (const e of expensesInRange.rows) {
    if (e.category !== 'Fuel') tripExpenses += Number(e.amount)
    // Fuel on delivered trips is handled per trip below; fuel on trips
    // still on the road counts here, by the date it was logged.
    else if (!deliveredSet.has(e.itinerary_id)) dieselActual += Number(e.amount)
  }

  const fuelByTrip = new Map<number, number>()
  for (const e of deliveredExpenses.rows) {
    fuelByTrip.set(e.itinerary_id, (fuelByTrip.get(e.itinerary_id) ?? 0) + Number(e.amount))
  }
  const distanceByBooking = new Map(
    bookings.rows.map((b) => [b.booking_id, Number(b.estimated_distance_km ?? 0)]),
  )
  const dieselPrice = settings.data ? Number(settings.data.setting_value) : null

  let dieselEstimated = 0
  let estimatedTrips = 0
  let tripsMissingDistance = 0
  for (const trip of deliveredTrips) {
    const km = distanceByBooking.get(trip.booking_id) ?? 0
    const diesel = dieselForTrip(
      fuelByTrip.get(trip.itinerary_id) ?? 0,
      (dieselPrice ?? 0) * km,
    )
    if (diesel.estimated) {
      dieselEstimated += diesel.amount
      estimatedTrips += 1
      if (km <= 0) tripsMissingDistance += 1
    } else {
      dieselActual += diesel.amount
    }
  }

  const damageCompany = damage.rows.reduce((s, d) => s + Number(d.estimated_damage_cost ?? 0), 0)

  return {
    data: {
      payroll,
      employerShares,
      draftPayroll,
      tripExpenses,
      dieselActual,
      dieselEstimated,
      estimatedTrips,
      tripsMissingDistance,
      damageCompany,
      total:
        payroll + employerShares + tripExpenses + dieselActual + dieselEstimated + damageCompany,
      dieselPriceMissing: dieselPrice === null,
    },
    error: null,
  }
}

export type MaintenanceExpenses = ReturnType<typeof summarizeParts> & {
  inProgressCost: number // part of total from work orders not completed yet
}

type CompletionRow = { completion_id: number; work_order_id: number }
type UsedRow = { item_id: number | null; item_name_text: string; quantity: number; unit_cost: number | null }
type LogPartRow = UsedRow & { work_order_id: number }
type ItemTypeRow = { item_id: number; item_type: string | null }

export async function loadMaintenanceExpenses(
  period: Period,
): Promise<{ data: MaintenanceExpenses | null; error: string | null }> {
  const cutoffTs = `${rangeStartManila(period)}T00:00:00+08:00`

  const [completions, logged] = await Promise.all([
    fetchAll<CompletionRow>((from, to) =>
      supabase
        .from('work_order_completions')
        .select('completion_id, work_order_id')
        .gte('completed_at', cutoffTs)
        .range(from, to),
    ),
    fetchAll<LogPartRow>((from, to) =>
      supabase
        .from('work_order_parts_log')
        .select('work_order_id, item_id, item_name_text, quantity, unit_cost')
        .gte('used_at', cutoffTs)
        .range(from, to),
    ),
  ])
  const firstError = completions.error ?? logged.error
  if (firstError) return { data: null, error: firstError }

  // A work order that has a completion row had its logged parts copied
  // into work_order_parts_used -- so only logged parts of work orders
  // with NO completion are "in progress" (otherwise they'd count twice).
  const loggedOrderIds = Array.from(new Set(logged.rows.map((r) => r.work_order_id)))
  const [used, completedOrders] = await Promise.all([
    fetchIn<UsedRow>(
      completions.rows.map((c) => c.completion_id),
      (chunk, from, to) =>
        supabase
          .from('work_order_parts_used')
          .select('item_id, item_name_text, quantity, unit_cost')
          .in('completion_id', chunk)
          .range(from, to),
    ),
    fetchIn<{ work_order_id: number }>(loggedOrderIds, (chunk, from, to) =>
      supabase
        .from('work_order_completions')
        .select('work_order_id')
        .in('work_order_id', chunk)
        .range(from, to),
    ),
  ])
  const secondError = used.error ?? completedOrders.error
  if (secondError) return { data: null, error: secondError }

  const completedSet = new Set(completedOrders.rows.map((c) => c.work_order_id))
  const inProgress = logged.rows.filter((r) => !completedSet.has(r.work_order_id))
  const allParts = [...used.rows, ...inProgress]

  const itemIds = Array.from(
    new Set(allParts.map((p) => p.item_id).filter((id): id is number => id !== null)),
  )
  const items = await fetchIn<ItemTypeRow>(itemIds, (chunk, from, to) =>
    supabase
      .from('inventory_items')
      .select('item_id, item_type')
      .in('item_id', chunk)
      .range(from, to),
  )
  if (items.error) return { data: null, error: items.error }
  const typeById = new Map(items.rows.map((i) => [i.item_id, i.item_type ?? 'Other']))

  const toLine = (p: UsedRow): PartLine => ({
    item_name: p.item_name_text,
    item_type: (p.item_id !== null && typeById.get(p.item_id)) || 'Other',
    quantity: p.quantity,
    unit_cost: p.unit_cost,
  })

  return {
    data: {
      ...summarizeParts(allParts.map(toLine)),
      inProgressCost: summarizeParts(inProgress.map(toLine)).total,
    },
    error: null,
  }
}
