// lineRates: a quote prices EACH CARGO LINE on its own (different weights,
// trailers, ...), so a quote has one rate per line instead of one for the
// whole thing. Saved as quote_requests.line_rates / quote_rate_offers.
// line_rates (jsonb array, same order as cargo_lines); the booking then
// gives every trip its line's rate (itineraries.trip_rate) and keeps the
// average in bookings.rate_of_delivery_service -- averageRate() here is the
// same math as the database function quote_average_rate(), change both
// together. Pure functions (self-check: node scripts/check-line-rates.ts).
import { cents } from './amountInput.ts'
import { formatMoney } from './format.ts'
import { estimateTripCosts, type CostSettings, type TripCosts } from './tripCost.ts'

// The part of a cargo line the rate math needs (CargoLineRow fits).
export type RatedLine = { quantity: number }

// A saved line_rates value -> one rate per line. Old quotes (no line_rates)
// use their single proposed rate on every line. 0 = not priced.
export function parseLineRates(value: unknown, lineCount: number, fallbackRate: number | null): number[] {
  const saved = Array.isArray(value) ? value : []
  return Array.from({ length: lineCount }, (_, i) => {
    const n = Number(saved[i] ?? fallbackRate ?? 0)
    return Number.isFinite(n) && n > 0 ? n : 0
  })
}

// Total of the contract: every line's rate x its trips.
export function contractTotal(lines: RatedLine[], rates: number[]): number {
  return cents(lines.reduce((sum, line, i) => sum + (rates[i] ?? 0) * line.quantity, 0))
}

// Average rate per trip (what bookings.rate_of_delivery_service holds).
export function averageRate(lines: RatedLine[], rates: number[]): number {
  const trips = lines.reduce((sum, line) => sum + line.quantity, 0)
  return trips > 0 ? cents(contractTotal(lines, rates) / trips) : 0
}

// One rate per trip, in trip order (line 1's trips first).
export function expandLineRates(lines: RatedLine[], rates: number[]): number[] {
  return lines.flatMap((line, i) => Array.from({ length: line.quantity }, () => rates[i] ?? 0))
}

// True when the lines are not all priced the same.
export function ratesDiffer(rates: number[]): boolean {
  return rates.some((r) => r !== rates[0])
}

// "₱5,500.00" when every line has the same rate, else "₱5,000.00 – ₱6,000.00".
export function rateLabel(rates: number[]): string {
  if (rates.length === 0) return '—'
  if (!ratesDiffer(rates)) return formatMoney(rates[0])
  return `${formatMoney(Math.min(...rates))} – ${formatMoney(Math.max(...rates))}`
}

// Problem with what was typed in one line's rate box (null = fine).
// `lineNumber` is 1-based; `lineCount` decides whether to name the line.
export function lineRateError(text: string, lineNumber: number, lineCount: number): string | null {
  const where = lineCount > 1 ? `Line ${lineNumber}: ` : ''
  if (!text.trim() || !(Number(text) > 0)) return `${where}enter a rate greater than 0.`
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return `${where}the rate can have 2 decimals at most.`
  return null
}

// "₱5,500.00" / "₱5,000.00 – ₱8,000.00" for a booking from its live trips'
// rates; a booking with no live trips left shows its saved (average) rate.
export function bookingRateLabel(tripRates: number[], fallbackRate: number | null): string {
  if (tripRates.length > 0) return rateLabel(tripRates)
  return fallbackRate === null ? '—' : formatMoney(fallbackRate)
}

// Sum of rates, to centavos.
export const sumRates = (rates: number[]): number => cents(rates.reduce((sum, r) => sum + r, 0))

// A trip row as the money screens load it (itineraries.trip_rate is null
// only on a trip inserted before per-line rates and never backfilled).
export type TripRateRow = {
  booking_id: number
  itinerary_status: string | null
  trip_rate: number | string | null
}

// booking_id -> the rates of its live (not cancelled) trips and of the
// delivered ones among them. A trip with no rate uses its booking's.
// Contract = sumRates(live); billed so far = sumRates(delivered).
export function groupTripRates(
  rows: TripRateRow[],
  bookingRateById: Map<number, number | null>,
): Map<number, { live: number[]; delivered: number[] }> {
  const byBooking = new Map<number, { live: number[]; delivered: number[] }>()
  for (const row of rows) {
    if (row.itinerary_status === 'Cancelled') continue
    const entry = byBooking.get(row.booking_id) ?? { live: [], delivered: [] }
    const rate = Number(row.trip_rate ?? bookingRateById.get(row.booking_id) ?? 0)
    entry.live.push(rate)
    if (row.itinerary_status === 'Delivered') entry.delivered.push(rate)
    byBooking.set(row.booking_id, entry)
  }
  return byBooking
}

// Estimated cost of the whole contract: each line's trips cost diesel and
// the per-trip fee as before, but commission follows that line's own rate.
export function estimateLineCosts(
  settings: CostSettings,
  lines: RatedLine[],
  rates: number[],
  distanceKm: number,
): TripCosts {
  const total: TripCosts = { diesel: 0, commission: 0, perTripFee: 0, total: 0 }
  lines.forEach((line, i) => {
    const cost = estimateTripCosts(settings, rates[i] ?? 0, distanceKm, line.quantity)
    total.diesel += cost.diesel
    total.commission += cost.commission
    total.perTripFee += cost.perTripFee
    total.total += cost.total
  })
  return total
}
