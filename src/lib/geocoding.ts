// geocoding: the only place the app talks to Nominatim (OpenStreetMap's
// free, no-API-key geocoder). Forward lookups (text -> point) centre the
// map and estimate distances; reverse lookups (point -> address text)
// suggest a city/barangay for a map pin. Every function returns null on
// no match, a bad response, or a network/rate-limit failure -- callers
// treat a hit as a best-effort guess, never as ground truth.
//
// Nominatim's usage policy allows at most 1 request per second, and the
// public quote form calls this for anonymous visitors, so every request
// goes through one shared queue that spaces them out.
// ponytail: per-browser-tab throttle only -- a busy public page could
// still get the site's IP range blocked; move to a paid geocoder or a
// server-side proxy with caching if that ever happens.
const NOMINATIM = 'https://nominatim.openstreetmap.org'
let nextFreeSlot = 0

async function nominatim(path: string) {
  const wait = Math.max(0, nextFreeSlot - Date.now())
  nextFreeSlot = Date.now() + wait + 1000
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }

  const response = await fetch(`${NOMINATIM}/${path}`)
  if (!response.ok) {
    throw new Error(`Nominatim returned ${response.status}`)
  }
  return response.json()
}

export async function geocodePlace(
  query: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    // countrycodes=ph so a common barangay name can't resolve to a
    // same-named place in another country.
    const data = await nominatim(
      `search?format=jsonv2&limit=1&countrycodes=ph&q=${encodeURIComponent(query)}`,
    )
    const first = data[0]
    if (!first) return null
    return { lat: Number(first.lat), lon: Number(first.lon) }
  } catch {
    return null
  }
}

// Driving distance in km between two points, from OSRM's free public
// routing server (car profile). Null if no route was found. Not
// throttled like Nominatim -- OSRM's demo server has its own limits,
// and callers treat a failure as "leave it for manual entry".
export async function fetchDrivingDistanceKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<number | null> {
  const response = await fetch(
    `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`,
  )
  const data = await response.json()
  const meters = data?.routes?.[0]?.distance
  return typeof meters === 'number' ? meters / 1000 : null
}

// Address fields OSM uses for barangay-level areas in the Philippines
// (tagging varies by place). Road/building/shop names are left out on
// purpose -- see matchLocation in locationReference.ts.
const AREA_FIELDS = [
  'quarter',
  'suburb',
  'village',
  'neighbourhood',
  'hamlet',
  'city_district',
  'residential',
]

// Returns the city plus the area names Nominatim knows for that point,
// in the shape matchLocation (locationReference.ts) expects.
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<{ city: string | null; areas: string[] } | null> {
  try {
    const data = await nominatim(
      `reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`,
    )
    const address = data.address ?? {}
    return {
      city: address.city ?? address.town ?? address.municipality ?? null,
      areas: AREA_FIELDS.map((field) => address[field]).filter(
        (part): part is string => typeof part === 'string',
      ),
    }
  } catch {
    return null
  }
}
