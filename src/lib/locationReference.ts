// locationReference: the curated city/barangay list (location_reference
// table) that backs the pickup/delivery dropdowns in every quote form,
// plus a best-effort matcher for turning free-text reverse-geocode
// results (from the Leaflet map picker) into one of those known
// city/barangay pairs. Barangay is the routing/cache unit (see
// places.barangay + route_cache) -- this table is just the list of
// valid values, scoped to the cities this business currently services.
import { supabase } from './supabaseClient'

export type LocationReferenceRow = {
  city: string
  barangay: string
  province: string | null
}

// Module-level cache: this reference list never changes during a
// session, and every quote form on the page loads it independently, so
// there's no reason to re-fetch it more than once.
let cachedRows: LocationReferenceRow[] | null = null

export async function loadLocationReference(): Promise<{
  rows: LocationReferenceRow[]
  error: string | null
}> {
  if (cachedRows) {
    return { rows: cachedRows, error: null }
  }

  const { data, error } = await supabase
    .from('location_reference')
    .select('city, barangay, province')
    .order('city', { ascending: true })
    .order('barangay', { ascending: true })

  if (error) {
    return { rows: [], error: error.message }
  }

  cachedRows = data
  return { rows: data, error: null }
}

export type NamedLocation = {
  abbreviation: string
  full_name: string
  city: string
  barangay: string
  landmark_detail: string | null
}

let cachedNamedLocations: NamedLocation[] | null = null

// Known shortcuts (ports/terminals staff use constantly, e.g. "DICT",
// "TEFASCO", "KTC") -- each one FK'd to a real city+barangay in
// location_reference, so picking one is equivalent to picking that city
// and barangay by hand, just faster. Never the only way in: the City/
// Barangay dropdowns stay available for anywhere not on this list.
export async function loadNamedLocations(): Promise<{
  locations: NamedLocation[]
  error: string | null
}> {
  if (cachedNamedLocations) {
    return { locations: cachedNamedLocations, error: null }
  }

  const { data, error } = await supabase
    .from('named_locations')
    .select('abbreviation, full_name, city, barangay, landmark_detail')
    .order('abbreviation', { ascending: true })

  if (error) {
    return { locations: [], error: error.message }
  }

  cachedNamedLocations = data
  return { locations: data, error: null }
}

export function citiesFrom(rows: LocationReferenceRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.city)))
}

export function barangaysForCity(rows: LocationReferenceRow[], city: string): string[] {
  return rows.filter((r) => r.city === city).map((r) => r.barangay)
}

// Best-effort match of whatever text a Nominatim reverse-geocode call
// returned against the known reference list. Nominatim's address
// fields for Philippine barangays are inconsistent (sometimes tagged
// "suburb", "village", "quarter", or missing entirely), so this doesn't
// try to parse structure -- it just checks whether a known city/
// barangay name appears anywhere in the combined text. Never trusted
// blindly: the caller always shows this as an editable suggestion, not
// a final answer.
// Combines the structured city/barangay with the free-text landmark
// detail into one display string, e.g. "ABC Warehouse -- Brgy. San
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

  if (detail && structured) return `${detail} -- ${structured}`
  if (structured) return structured
  if (detail) return detail
  return '—'
}

export function matchLocationFromText(
  rows: LocationReferenceRow[],
  addressText: string,
): { city: string; barangay: string } | null {
  const lowerText = addressText.toLowerCase()

  const bothMatch = rows.find(
    (r) =>
      lowerText.includes(r.city.toLowerCase()) &&
      lowerText.includes(r.barangay.toLowerCase()),
  )
  if (bothMatch) {
    return { city: bothMatch.city, barangay: bothMatch.barangay }
  }

  // No barangay-level match -- fall back to just the city, so the user
  // at least doesn't have to hunt for the right city too.
  const cityMatch = rows.find((r) => lowerText.includes(r.city.toLowerCase()))
  if (cityMatch) {
    return { city: cityMatch.city, barangay: cityMatch.barangay }
  }

  return null
}
