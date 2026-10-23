// Self-check for src/lib/locationMatch.ts -- run with:
//   node scripts/check-location-match.ts
// Prints "ok" or throws on the first wrong answer. The area lists are
// real Nominatim answers (2026-10-23), in geocoding.ts's AREA_FIELDS
// order: quarter, suburb, village, neighbourhood, hamlet, residential,
// city_district.
import assert from 'node:assert/strict'
import { matchLocation, type LocationReferenceRow } from '../src/lib/locationMatch.ts'

const row = (city: string, barangay: string): LocationReferenceRow => ({ city, barangay, province: null })
const rows = [
  row('Davao City', 'Pampanga'),
  row('Davao City', 'Sasa'),
  row('Davao City', 'San Antonio'),
  row('Panabo City', 'New Visayas'),
  row('Panabo City', 'San Francisco (Poblacion)'),
  row('Tagum City', 'Magugpo Poblacion'),
  row('Island Garden City of Samal', 'San Isidro (Babak)'),
  row('Island Garden City of Samal', 'San Isidro (Kaputian)'),
  row('Island Garden City of Samal', 'Babak'),
]

// Davao: quarter Pampanga, suburb Sasa -- both are barangays. The first
// field (quarter) decides. Used to depend on which name was longer.
assert.deepEqual(
  matchLocation(rows, { city: 'Davao City', areas: ['Pampanga', 'Sasa', 'Doña Salud', 'Buhangin District'] }),
  { city: 'Davao City', barangay: 'Pampanga' },
)

// Davao: suburb is a district, not a barangay -- quarter still wins.
assert.deepEqual(
  matchLocation(rows, { city: 'Davao City', areas: ['San Antonio', 'Agdao District', 'East'] }),
  { city: 'Davao City', barangay: 'San Antonio' },
)

// Panabo: quarter is a purok (not on the list) -> suburb, bare name
// matches the bracketed "(Poblacion)" barangay.
assert.deepEqual(
  matchLocation(rows, { city: 'Panabo', areas: ['Bayabas', 'San Francisco', 'Purok 5'] }),
  { city: 'Panabo City', barangay: 'San Francisco (Poblacion)' },
)

// Tagum: quarter Bayanihan isn't a barangay -> suburb.
assert.deepEqual(
  matchLocation(rows, { city: 'Tagum', areas: ['Bayanihan', 'Magugpo Poblacion', 'Trebajo Village'] }),
  { city: 'Tagum City', barangay: 'Magugpo Poblacion' },
)

// Same bare name in two barangays: never guessed.
assert.deepEqual(
  matchLocation(rows, { city: 'Samal', areas: ['San Isidro', 'Babak'] }),
  { city: 'Island Garden City of Samal', barangay: null },
)

// Whole words only: "Sasa" must not match inside "Sasanggaan".
assert.deepEqual(
  matchLocation(rows, { city: 'Davao City', areas: ['Sasanggaan'] }),
  { city: 'Davao City', barangay: null },
)

// No city, or a city we don't serve: no match at all.
assert.equal(matchLocation(rows, { city: null, areas: ['Sasa'] }), null)
assert.equal(matchLocation(rows, { city: 'Cebu City', areas: ['Sasa'] }), null)

console.log('ok')
