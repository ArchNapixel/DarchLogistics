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

// Lowercase and strip accents, so "Santo Niño" and "Santo Nino" compare equal.
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

// Whole-word match only: a plain "contains" check made "Ula" match
// inside "Mapula"/"Sibulan" and "Bato" inside "Paquibato", and since
// rows are alphabetical the wrong one often won.
function containsWord(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text)
}

// Nominatim calls these cities "Davao City", "Tagum", "Samal", "Digos"...
// while location_reference says "Tagum City", "Island Garden City of
// Samal". Comparing on the bare name ("tagum", "samal") lines them up.
function cityKey(name: string): string {
  return normalize(name).replace(/^.*\bcity of /, '').replace(/ city$/, '').trim()
}

// "Peñaplata (Poblacion)" / "Zone 2 (Pob.)" -> "penaplata" / "zone 2":
// Nominatim never includes the bracketed part.
function barangayKey(name: string): string {
  return normalize(name).replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
}

// Best-effort match of a Nominatim reverse-geocode result against the
// known reference list. The city comes from Nominatim's structured
// `city` field. The barangay is searched for only in the *area* names
// (suburb/quarter/village/...) -- never in road names, since e.g.
// "Babak-Samal-Kaputian Road" would otherwise match barangays Babak or
// Kaputian. Barangay tagging is inconsistent in OSM, so each area name
// is checked for a whole-word barangay name (a plain "contains" check
// made "Ula" match inside "Mapula"). Best match wins: the full name
// incl. brackets beats the bare name, longer beats shorter. If two
// different barangays tie (e.g. "San Isidro" when there's both "San
// Isidro (Babak)" and "San Isidro (Kaputian)"), or none match, barangay
// comes back null -- the user picks it, it's never guessed.
export function matchLocation(
  rows: LocationReferenceRow[],
  address: { city: string | null; areas: string[] },
): { city: string; barangay: string | null } | null {
  if (!address.city) return null
  const key = cityKey(address.city)
  const cityRows = rows.filter((r) => cityKey(r.city) === key)
  if (cityRows.length === 0) return null

  const areas = address.areas.map(normalize)
  const scored = cityRows
    .map((r) => {
      const full = normalize(r.barangay)
      const bare = barangayKey(r.barangay)
      const score = areas.some((a) => containsWord(a, full))
        ? 1000 + full.length
        : areas.some((a) => containsWord(a, bare))
          ? bare.length
          : 0
      return { barangay: r.barangay, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  const tie = scored.length > 1 && scored[0].score === scored[1].score
  return {
    city: cityRows[0].city,
    barangay: scored.length > 0 && !tie ? scored[0].barangay : null,
  }
}
