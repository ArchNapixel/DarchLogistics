// geocoding: one shared Nominatim forward-geocode call (the same free,
// no-API-key OSM service LocationPicker uses for reverse geocoding).
// Returns null on no match, a bad response, or a network/rate-limit
// failure -- every caller treats a hit as a best-effort guess to
// pre-fill or centre something, never as ground truth.
export async function geocodePlace(
  query: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`,
    )
    const data = await response.json()
    const first = data[0]
    if (!first) return null
    return { lat: Number(first.lat), lon: Number(first.lon) }
  } catch {
    return null
  }
}
