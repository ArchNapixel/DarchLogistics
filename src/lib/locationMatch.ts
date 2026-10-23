// locationMatch: turns a Nominatim reverse-geocode result (from the map
// picker) into one of the known city/barangay pairs in location_reference.
// Kept separate from locationReference.ts (which talks to Supabase) so the
// self-check can run in plain Node: node scripts/check-location-match.ts

export type LocationReferenceRow = {
  city: string
  barangay: string
  province: string | null
}

// Lowercase and strip accents, so "Santo Niño" and "Santo Nino" compare equal.
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
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

// Best-effort match of a reverse-geocode result against the reference
// list. The city comes from Nominatim's structured `city` field.
//
// `areas` are the area names Nominatim gave for the point, MOST LIKELY
// BARANGAY FIRST (geocoding.ts puts `quarter` first -- in Davao OSM that's
// the barangay boundary, while `suburb` can be a neighbouring barangay or a
// district). The first area that names a known barangay decides it; later
// areas are only looked at when the earlier ones match nothing. Before
// 2026-10-23 every area was searched at once and the longest name won,
// so a pin in Pampanga could come back as Sasa (or the other way round)
// depending on name length, and equal lengths left the barangay blank.
//
// Within one area: the full name incl. brackets beats the bare name,
// longer beats shorter. If two different barangays still tie (e.g. "San
// Isidro" when there's both "San Isidro (Babak)" and "San Isidro
// (Kaputian)"), barangay comes back null -- the user picks it, it's never
// guessed. Road names are never passed in ("Babak-Samal-Kaputian Road"
// would match barangays Babak and Kaputian).
export function matchLocation(
  rows: LocationReferenceRow[],
  address: { city: string | null; areas: string[] },
): { city: string; barangay: string | null } | null {
  if (!address.city) return null
  const key = cityKey(address.city)
  const cityRows = rows.filter((r) => cityKey(r.city) === key)
  if (cityRows.length === 0) return null

  for (const rawArea of address.areas) {
    const area = normalize(rawArea)
    const scored = cityRows
      .map((r) => {
        const full = normalize(r.barangay)
        const bare = barangayKey(r.barangay)
        const score = containsWord(area, full)
          ? 1000 + full.length
          : containsWord(area, bare)
            ? bare.length
            : 0
        return { barangay: r.barangay, score }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) continue
    const tie = scored.length > 1 && scored[0].score === scored[1].score
    return { city: cityRows[0].city, barangay: tie ? null : scored[0].barangay }
  }

  return { city: cityRows[0].city, barangay: null }
}
