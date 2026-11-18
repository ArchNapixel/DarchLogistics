// dashboardExpenses.ts: loads the numbers for the Admin dashboard's
// Operational Expenses and Maintenance Expenses cards. The math itself is
// in expenseTotals.ts (self-checked); this file only fetches and wires.
// Since 2026-11-18 the cards count by the SAME dates as Financial Summary
// (profitLoss.ts), so a month reads the same on both:
//
// OPERATIONAL = payroll (gross + employer shares, DRAFT payslips included
// so this week's run shows live) + trip expenses the crew logged +
// diesel + the company's share of damage (charged to the Company, or the
// part an insurer didn't cover -- insuranceRules.ts companyDamageShare),
// counted in the period it was DECIDED (loadCompanyDamageCost, approved_at).
//   - Payslips count by payroll_period_END (the month the government
//     contributions belong to). A rolling "last N days" range also counts
//     the current week, whose end is still ahead (payslipInPeriod).
//   - Trip expenses and diesel belong to DELIVERED trips, by the trip's
//     delivery date (latest Delivered row in dispatch_status_logs, Manila
//     time, the date payroll uses), whenever they were logged. Expenses on
//     a trip still on the road count once it's delivered.
//   - Diesel per delivered trip = the calculator's estimate (tripCost.ts)
//     PLUS any Fuel the crew logged on top.
//   - Commission and the per-trip fee are NOT added again: they're already
//     inside drivers' gross_pay.
// MAINTENANCE = parts used (quantity x unit_cost copied at time of use) on
//   work orders completed in the period, by completion date (same rule as
//   the Maintenance Cost Report and P&L).
//
// Every row is counted once; every query is paged past Supabase's
// 1000-row default so a long range can't silently cap.
import { supabase } from './supabaseClient'
import { dieselForTrip, dieselPerKm, tripDistanceKm } from './tripCost'
import { companyDamageShare, type DamageCostRow } from './insuranceRules'
import {
  payslipCost,
  rangeEndManila,
  rangeStartManila,
  type Period,
  summarizeParts,
  type PartLine,
  type PayslipCostRow,
} from './expenseTotals'
import { isDelivered } from './tripStatusFlow'

type Page<T> = { data: T[] | null; error: { message: string } | null }

const PAGE = 1000
const CHUNK = 200

// Reads every page of a query (rows past 1000 would otherwise vanish).
export async function fetchAll<T>(
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
export async function fetchIn<T>(
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

// Does a payslip count in this period? By its period END, like Financial
// Summary. A rolling range (days / months back from today) also counts the
// current week, which ends after today -- otherwise this week's draft run
// wouldn't show until Saturday.
function payslipInPeriod(row: { payroll_period_end: string }, period: Period, end: string): boolean {
  return row.payroll_period_end < end || !('month' in period)
}

export type OperationalExpenses = {
  payroll: number // gross pay, finalized + draft
  employerShares: number // SSS ER+EC, PhilHealth ER, Pag-IBIG ER
  draftPayroll: number // part of the two lines above that is still a draft
  tripExpenses: number // logged Toll / Parking / Other on trips delivered in the period
  dieselActual: number // logged Fuel on those trips (top-ups, on top of the estimate)
  dieselEstimated: number // calculator estimate for every delivered trip
  estimatedTrips: number // how many trips the estimate covers
  tripsMissingDistance: number // of those, trips with no distance (estimated as 0)
  damageCompany: number // company's share of damage decided in the period (Company / Insurance)
  total: number
  dieselPriceMissing: boolean
}

type PayslipRow = PayslipCostRow & { finalized_at: string | null; payroll_period_end: string }
type LogRow = { itinerary_id: number; status_changed_at: string }
type TripRow = {
  itinerary_id: number
  booking_id: number
  itinerary_status: string | null
  return_container: boolean
  costed_distance_km: number | string | null
}
type BookingRow = { booking_id: number; estimated_distance_km: number | string | null; return_distance_km: number | string | null }
type ExpenseRow = { expense_id: number; itinerary_id: number; amount: number | string; category: string }
type DamageRow = DamageCostRow

// What damage cost the COMPANY (Company in full, Insurance minus what the
// insurer covers -- companyDamageShare) for records DECIDED in
// [fromTs, toTs), by approved_at. Counted when decided, not by the trip's
// delivery date, so damage found after a month closed doesn't rewrite it.
// Re-deciding a record stamps approved_at again and moves it to that month.
// Used by the dashboard card and Profit & Loss / Money Summary.
export async function loadCompanyDamageCost(fromTs: string, toTs: string): Promise<{ total: number; error: string | null }> {
  const { rows, error } = await fetchAll<DamageRow>((from, to) =>
    supabase
      .from('delivery_damage_records')
      .select('charge_to, estimated_damage_cost, insurance_covered_amount, claim_status')
      .eq('damage_status', 'Approved')
      .in('charge_to', ['Company', 'Insurance'])
      .gte('approved_at', fromTs)
      .lt('approved_at', toTs)
      .range(from, to),
  )
  return { total: rows.reduce((s, d) => s + companyDamageShare(d), 0), error }
}

export async function loadOperationalExpenses(
  period: Period,
): Promise<{ data: OperationalExpenses | null; error: string | null }> {
  const cutoff = rangeStartManila(period)
  const cutoffTs = `${cutoff}T00:00:00+08:00`
  const end = rangeEndManila(period)
  const endTs = `${end}T00:00:00+08:00`

  // Payslips by period END (payslipInPeriod) -- drafts included, so a
  // payroll run shows as it happens.
  const [payslipRows, deliveredLogs, settings] = await Promise.all([
    fetchAll<PayslipRow>((from, to) =>
      supabase
        .from('payroll_payslips')
        .select('finalized_at, payroll_period_end, gross_pay, sss_er, sss_ec, philhealth_er, pagibig_er')
        .gte('payroll_period_end', cutoff)
        .lt('payroll_period_start', end)
        .range(from, to),
    ),
    fetchAll<LogRow>((from, to) =>
      supabase
        .from('dispatch_status_logs')
        .select('itinerary_id, status_changed_at')
        .eq('new_status', 'Delivered')
        .gte('status_changed_at', cutoffTs)
        .range(from, to),
    ),
    supabase
      .from('app_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['diesel_price_per_liter', 'diesel_km_per_liter']),
  ])

  const firstError = payslipRows.error ?? deliveredLogs.error ?? settings.error?.message
  if (firstError) return { data: null, error: firstError }
  const payslips = payslipRows.rows.filter((row) => payslipInPeriod(row, period, end))

  // A trip belongs to the period of its LATEST Delivered row (a later
  // re-delivery moves it out), and only while it's still delivered now.
  const latestByTrip = new Map<number, number>()
  for (const l of deliveredLogs.rows) {
    const at = new Date(l.status_changed_at).getTime()
    if (at > (latestByTrip.get(l.itinerary_id) ?? 0)) latestByTrip.set(l.itinerary_id, at)
  }
  const endMs = new Date(endTs).getTime()
  const loggedIds = Array.from(latestByTrip)
    .filter(([, at]) => at < endMs)
    .map(([id]) => id)
  const trips = await fetchIn<TripRow>(loggedIds, (chunk, from, to) =>
    supabase
      .from('itineraries')
      .select('itinerary_id, booking_id, itinerary_status, return_container, costed_distance_km')
      .in('itinerary_id', chunk)
      .range(from, to),
  )
  if (trips.error) return { data: null, error: trips.error }
  const deliveredTrips = trips.rows.filter((t) => isDelivered(t.itinerary_status))
  const deliveredIds = deliveredTrips.map((t) => t.itinerary_id)
  const bookingIds = Array.from(new Set(deliveredTrips.map((t) => t.booking_id)))

  const [bookings, deliveredExpenses, damage] = await Promise.all([
    fetchIn<BookingRow>(bookingIds, (chunk, from, to) =>
      supabase
        .from('bookings')
        .select('booking_id, estimated_distance_km, return_distance_km')
        .in('booking_id', chunk)
        .range(from, to),
    ),
    // Every expense on those trips, whenever it was logged.
    fetchIn<ExpenseRow>(deliveredIds, (chunk, from, to) =>
      supabase
        .from('itinerary_expenses')
        .select('expense_id, itinerary_id, amount, category')
        .in('itinerary_id', chunk)
        .range(from, to),
    ),
    loadCompanyDamageCost(cutoffTs, endTs),
  ])
  const secondError = bookings.error ?? deliveredExpenses.error ?? damage.error
  if (secondError) return { data: null, error: secondError }

  // Payroll
  let payroll = 0
  let employerShares = 0
  let draftPayroll = 0
  for (const row of payslips) {
    const cost = payslipCost(row)
    payroll += cost.gross
    employerShares += cost.employerShares
    if (!row.finalized_at) draftPayroll += cost.total
  }

  // Trip expenses + diesel (delivered trips only)
  let tripExpenses = 0
  const fuelByTrip = new Map<number, number>()
  for (const e of deliveredExpenses.rows) {
    if (e.category === 'Fuel') fuelByTrip.set(e.itinerary_id, (fuelByTrip.get(e.itinerary_id) ?? 0) + Number(e.amount))
    else tripExpenses += Number(e.amount)
  }
  const bookingById = new Map(bookings.rows.map((b) => [b.booking_id, b]))
  const setting = new Map((settings.data ?? []).map((row) => [row.setting_key, Number(row.setting_value)]))
  const dieselPrice = setting.get('diesel_price_per_liter') ?? null
  const perKm = dieselPerKm({ dieselPricePerLiter: dieselPrice ?? 0, kmPerLiter: setting.get('diesel_km_per_liter') })

  let dieselActual = 0
  let dieselEstimated = 0
  let estimatedTrips = 0
  let tripsMissingDistance = 0
  for (const trip of deliveredTrips) {
    // Plus the empty-container return leg on a trip that brings it back.
    const booking = bookingById.get(trip.booking_id)
    const km = booking ? tripDistanceKm(booking, trip.return_container, trip.costed_distance_km) : 0
    const diesel = dieselForTrip(fuelByTrip.get(trip.itinerary_id) ?? 0, perKm * km)
    // Every delivered trip gets the estimate; logged Fuel is on top of it.
    dieselEstimated += diesel.estimate
    dieselActual += diesel.logged
    estimatedTrips += 1
    if (km <= 0) tripsMissingDistance += 1
  }

  const damageCompany = damage.total

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

// PAYROLL card: payroll cost for the period (same payslip rule as above,
// drafts included) plus each employee's gross earnings, highest first.
export type PayrollEarner = { id: number; name: string; position: string; gross: number }
export type PayrollExpenses = {
  draft: number // part of total still in draft payslips
  payslips: number
  total: number // gross + employer shares
  earners: PayrollEarner[]
}

export async function loadPayrollExpenses(
  period: Period,
): Promise<{ data: PayrollExpenses | null; error: string | null }> {
  const [slips, people] = await Promise.all([
    // By period END, like loadOperationalExpenses (payslipInPeriod).
    fetchAll<PayslipRow & { employee_id: number }>((from, to) =>
      supabase
        .from('payroll_payslips')
        .select('employee_id, finalized_at, payroll_period_end, gross_pay, sss_er, sss_ec, philhealth_er, pagibig_er')
        .gte('payroll_period_end', rangeStartManila(period))
        .lt('payroll_period_start', rangeEndManila(period))
        .range(from, to),
    ),
    fetchAll<{ employee_id: number; full_name: string | null; position: string | null }>(
      (from, to) =>
        supabase.from('employees').select('employee_id, full_name, position').range(from, to),
    ),
  ])
  const error = slips.error ?? people.error
  if (error) return { data: null, error }

  const grossById = new Map<number, number>()
  let total = 0
  let draft = 0
  const end = rangeEndManila(period)
  const counted = slips.rows.filter((row) => payslipInPeriod(row, period, end))
  for (const row of counted) {
    const cost = payslipCost(row)
    total += cost.total
    if (!row.finalized_at) draft += cost.total
    grossById.set(row.employee_id, (grossById.get(row.employee_id) ?? 0) + cost.gross)
  }
  const earners = people.rows
    .filter((p) => grossById.has(p.employee_id))
    .map((p) => ({
      id: p.employee_id,
      name: p.full_name ?? `Employee #${p.employee_id}`,
      position: p.position ?? '',
      gross: grossById.get(p.employee_id)!,
    }))
    .sort((x, y) => y.gross - x.gross)
  return { data: { draft, payslips: counted.length, total, earners }, error: null }
}

export type MaintenanceExpenses = ReturnType<typeof summarizeParts>

type CompletionRow = { completion_id: number; work_order_id: number }
type UsedRow = { item_id: number | null; item_name_text: string; quantity: number; unit_cost: number | null }
type ItemTypeRow = { item_id: number; item_type: string | null }

// Parts on work orders COMPLETED in the period, by completion date -- the
// same rule as the Maintenance Cost Report and P&L, so a month never
// changes after the fact. Parts on jobs still open count once the job is
// completed.
export async function loadMaintenanceExpenses(
  period: Period,
): Promise<{ data: MaintenanceExpenses | null; error: string | null }> {
  const cutoffTs = `${rangeStartManila(period)}T00:00:00+08:00`
  const endTs = `${rangeEndManila(period)}T00:00:00+08:00`

  const completions = await fetchAll<CompletionRow>((from, to) =>
    supabase
      .from('work_order_completions')
      .select('completion_id, work_order_id')
      .gte('completed_at', cutoffTs)
      .lt('completed_at', endTs)
      .range(from, to),
  )
  if (completions.error) return { data: null, error: completions.error }

  const used = await fetchIn<UsedRow>(
    completions.rows.map((c) => c.completion_id),
    (chunk, from, to) =>
      supabase
        .from('work_order_parts_used')
        .select('item_id, item_name_text, quantity, unit_cost')
        .in('completion_id', chunk)
        .range(from, to),
  )
  if (used.error) return { data: null, error: used.error }

  const itemIds = Array.from(
    new Set(used.rows.map((p) => p.item_id).filter((id): id is number => id !== null)),
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

  return { data: summarizeParts(used.rows.map(toLine)), error: null }
}
