// routeDistance: driving km between two stops, for Review Quote and the
// booking editor (Booking Detail -> Edit). Most precise first: both map pins
// (OSRM), a cached route (route_cache), then the two barangay centres
// (Nominatim + OSRM). Null = couldn't tell -- staff type it. Moved here from
// QuoteReviewModal on 2026-11-18 so both screens use the same steps.
import { supabase } from './supabaseClient'
import { fetchDrivingDistanceKm, geocodePlace } from './geocoding'

// Looks up a place by city+barangay (trimmed, case-insensitive) -- only to
// preview whether a cached distance exists. Never creates a place; the
// database does that when the booking is created.
export async function findPlaceIdByCityBarangay(
  city: string | null,
  barangay: string | null,
): Promise<number | null> {
  if (!city || !barangay) {
    return null
  }

  const { data } = await supabase
    .from('places')
    .select('place_id')
    .ilike('city', city.trim())
    .ilike('barangay', barangay.trim())
    .maybeSingle()

  return data?.place_id ?? null
}

// route_cache stores each pair with the lower place_id first, so a
// route reads the same regardless of pickup/delivery direction.
function orderPlacePair(placeIdA: number, placeIdB: number): [number, number] {
  return placeIdA < placeIdB ? [placeIdA, placeIdB] : [placeIdB, placeIdA]
}

export async function findCachedDistance(
  placeIdA: number,
  placeIdB: number,
): Promise<number | null> {
  const [lowId, highId] = orderPlacePair(placeIdA, placeIdB)

  const { data } = await supabase
    .from('route_cache')
    .select('distance_km')
    .eq('place_id_a', lowId)
    .eq('place_id_b', highId)
    .maybeSingle()

  return data?.distance_km ?? null
}

// Best-effort auto-distance for a route with no route_cache hit yet --
// same free OSM stack LocationPicker already uses for its map picker
// (Nominatim), plus OSRM's public routing server for real driving
// distance. Never trusted blindly (same spirit as the map picker's
// reverse-geocode): a bad/no match just returns null and the caller
// leaves the field blank for manual entry, exactly like before this
// feature existed.
export async function geocodeToLatLng(
  city: string,
  barangay: string,
): Promise<{ lat: number; lon: number } | null> {
  return geocodePlace(`Barangay ${barangay}, ${city}, Philippines`)
}

export type LegStop = { city: string | null; barangay: string | null; lat: number | null; lng: number | null }

// Driving km between two stops, most precise first: both pins (OSRM), a
// cached route, then the two barangay centres. Null = couldn't tell (staff
// type it). Used for the empty-container return leg (delivery -> return place).
// ponytail: Review Quote's main distance (its loadDistance) does the same
// steps inline because it also shows where its figure came from.
export async function estimateLegKm(a: LegStop, b: LegStop): Promise<number | null> {
  const round = (km: number) => Math.round(km * 100) / 100
  try {
    if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
      const km = await fetchDrivingDistanceKm({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng })
      if (km !== null) return round(km)
    }
    const [idA, idB] = await Promise.all([
      findPlaceIdByCityBarangay(a.city, a.barangay),
      findPlaceIdByCityBarangay(b.city, b.barangay),
    ])
    if (idA !== null && idB !== null) {
      const cached = await findCachedDistance(idA, idB)
      if (cached !== null) return cached
    }
    if (!a.city || !a.barangay || !b.city || !b.barangay) return null
    const [pointA, pointB] = await Promise.all([geocodeToLatLng(a.city, a.barangay), geocodeToLatLng(b.city, b.barangay)])
    if (!pointA || !pointB) return null
    const km = await fetchDrivingDistanceKm(pointA, pointB)
    return km === null ? null : round(km)
  } catch {
    return null
  }
}
