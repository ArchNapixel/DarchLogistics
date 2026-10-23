// locationReference: the curated city/barangay list (location_reference
// table) that backs the pickup/delivery dropdowns in every quote form,
// plus a best-effort matcher for turning free-text reverse-geocode
// results (from the Leaflet map picker) into one of those known
// city/barangay pairs. Barangay is the routing/cache unit (see
// places.barangay + route_cache) -- this table is just the list of
// valid values, scoped to the cities this business currently services.
import { supabase } from './supabaseClient'
import type { LocationReferenceRow } from './locationMatch'

// The map-pin matcher lives in locationMatch.ts (no Supabase import, so its
// self-check runs in plain Node); re-exported so callers import from here.
export { matchLocation, type LocationReferenceRow } from './locationMatch'

// Module-level cache: this reference list never changes during a
// session. The *promise* is cached (not just the result) so the two
// pickers on one form share a single request instead of both firing
// one while the first is still in flight.
let rowsRequest: Promise<{ rows: LocationReferenceRow[]; error: string | null }> | null = null

export function loadLocationReference() {
  if (!rowsRequest) {
    rowsRequest = Promise.resolve(
      supabase
        .from('location_reference')
        .select('city, barangay, province')
        .order('city', { ascending: true })
        .order('barangay', { ascending: true }),
    ).then(({ data, error }) => {
      // Don't keep a failed load cached -- let the next form retry.
      if (error) rowsRequest = null
      return { rows: data ?? [], error: error?.message ?? null }
    })
  }
  return rowsRequest
}

export type NamedLocation = {
  abbreviation: string
  full_name: string
  city: string
  barangay: string
  landmark_detail: string | null
}

let namedLocationsRequest: Promise<{ locations: NamedLocation[]; error: string | null }> | null =
  null

// Known shortcuts (ports/terminals staff use constantly, e.g. "DICT",
// "TEFASCO", "KTC") -- each one FK'd to a real city+barangay in
// location_reference, so picking one is equivalent to picking that city
// and barangay by hand, just faster. Never the only way in: the City/
// Barangay dropdowns stay available for anywhere not on this list.
export function loadNamedLocations() {
  if (!namedLocationsRequest) {
    namedLocationsRequest = Promise.resolve(
      supabase
        .from('named_locations')
        .select('abbreviation, full_name, city, barangay, landmark_detail')
        .order('abbreviation', { ascending: true }),
    ).then(({ data, error }) => {
      if (error) namedLocationsRequest = null
      return { locations: data ?? [], error: error?.message ?? null }
    })
  }
  return namedLocationsRequest
}

export function citiesFrom(rows: LocationReferenceRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.city)))
}

export function barangaysForCity(rows: LocationReferenceRow[], city: string): string[] {
  return rows.filter((r) => r.city === city).map((r) => r.barangay)
}

// Combines the structured city/barangay with the free-text landmark
// detail into one display string, e.g. "ABC Warehouse, Brgy. San
// Antonio, Davao City". Used anywhere a quote/booking's location was
// previously shown as a single free-text field.
export function formatLocationDisplay({
  city,
  barangay,
  detail,
}: {
  city: string | null
  barangay: string | null
  detail: string | null
}): string {
  const structured = city && barangay ? `Brgy. ${barangay}, ${city}` : null

  if (detail && structured) return `${detail}, ${structured}`
  if (structured) return structured
  if (detail) return detail
  return '—'
}
