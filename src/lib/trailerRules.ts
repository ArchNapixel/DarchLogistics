// trailerRules: which trailer may carry a trip. One place for the rule so the
// Capacity Check, Fleet Match, the Dispatch Board and Edit Cargo agree
// (self-check: node scripts/check-trailer-rules.ts). The database trigger
// itinerary_trailer_fits repeats it -- change both together.
//
// Type:
//   - Loose cargo: the type the trip asked for (always Flatbed).
//   - Container: Flatbed OR Skeletal, whichever the client asked for -- a
//     skeletal carries containers only, a flatbed carries both.
//   Lowbed (and any other type) is not part of the rule: exact match only.
// Size (the quote's "Trailer size", itineraries.container_type; the trailer's
// trailers.trailer_size), since 2026-11-13:
//   - A 20ft trip may ride a 20ft or a 40ft trailer; a 40ft trip only a 40ft.
//   - A 20ft trip goes on a 20ft trailer first, so 40ft ones stay free.
// Unknown on either side = no requirement (very old trips, trailers whose size
// hasn't been set yet).

const CONTAINER_TYPES = ['Flatbed', 'Skeletal']

// Can a `vehicleSize` trailer carry an `askedSize` trip?
export function sizeAllowed(askedSize: string | null | undefined, vehicleSize: string | null | undefined): boolean {
  if (!askedSize || !vehicleSize || askedSize === vehicleSize) return true
  return askedSize === '20ft' && vehicleSize === '40ft'
}

// Can a `vehicleType` / `vehicleSize` trailer take a trip that asked for
// `askedType` / `askedSize`?
export function trailerAllowed(
  cargoType: string | null | undefined,
  askedType: string | null | undefined,
  vehicleType: string | null | undefined,
  askedSize?: string | null,
  vehicleSize?: string | null,
): boolean {
  if (!sizeAllowed(askedSize, vehicleSize)) return false
  if (!askedType || !vehicleType || vehicleType === askedType) return true
  return cargoType === 'Container' && CONTAINER_TYPES.includes(askedType) && CONTAINER_TYPES.includes(vehicleType)
}

// Which allowed trailer to use first (lower = first). The asked size before a
// bigger one (keeps 40ft trailers for 40ft trips); then a container goes on a
// Skeletal before a Flatbed (keeps Flatbeds for loose cargo, which only they
// can carry). Everything else keeps the order it came in.
export function trailerRank(
  cargoType: string | null | undefined,
  vehicleType: string | null | undefined,
  askedSize?: string | null,
  vehicleSize?: string | null,
): number {
  const biggerSize = askedSize && vehicleSize && askedSize !== vehicleSize ? 2 : 0
  return biggerSize + (cargoType === 'Container' && vehicleType === 'Skeletal' ? 0 : 1)
}

// "40ft Skeletal instead of the 20ft Flatbed asked for" -- null when it's what was asked.
export function substituteNote(
  askedType: string | null | undefined,
  vehicleType: string | null | undefined,
  askedSize?: string | null,
  vehicleSize?: string | null,
): string | null {
  const typeDiffers = !!askedType && !!vehicleType && askedType !== vehicleType
  const sizeDiffers = !!askedSize && !!vehicleSize && askedSize !== vehicleSize
  if (!typeDiffers && !sizeDiffers) return null
  const label = (size: string | null | undefined, type: string | null | undefined) =>
    [sizeDiffers ? size : null, type].filter(Boolean).join(' ')
  return `${label(vehicleSize, vehicleType)} instead of the ${label(askedSize, askedType)} asked for`
}

// "40ft Skeletal" / "Skeletal" (size not set yet).
export const trailerLabel = (type: string | null | undefined, size: string | null | undefined) =>
  [size, type].filter(Boolean).join(' ')
