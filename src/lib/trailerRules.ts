// trailerRules: which trailer may carry a trip. One place for the rule so the
// Capacity Check, Fleet Match, the Dispatch Board and Edit Cargo agree
// (self-check: node scripts/check-trailer-rules.ts).
//
//   - Loose cargo: the type the trip asked for (always Flatbed).
//   - Container: Flatbed OR Skeletal, whichever the client asked for -- a
//     skeletal carries containers only, a flatbed carries both.
// Lowbed (and any other type) is not part of the rule: exact match only.

const CONTAINER_TYPES = ['Flatbed', 'Skeletal']

// Can `vehicleType` take a trip that asked for `askedType`? Unknown on either
// side = no requirement (very old trips).
export function trailerAllowed(
  cargoType: string | null | undefined,
  askedType: string | null | undefined,
  vehicleType: string | null | undefined,
): boolean {
  if (!askedType || !vehicleType || vehicleType === askedType) return true
  return cargoType === 'Container' && CONTAINER_TYPES.includes(askedType) && CONTAINER_TYPES.includes(vehicleType)
}

// Which allowed trailer to use first (lower = first). A container goes on a
// Skeletal first so the Flatbeds stay free for loose cargo, which only they
// can carry; everything else keeps the order it came in.
export function trailerRank(cargoType: string | null | undefined, vehicleType: string | null | undefined): number {
  return cargoType === 'Container' && vehicleType === 'Skeletal' ? 0 : 1
}

// "Using a Skeletal instead of the Flatbed asked for" -- null when it's what was asked.
export function substituteNote(askedType: string | null | undefined, vehicleType: string | null | undefined): string | null {
  return askedType && vehicleType && askedType !== vehicleType ? `${vehicleType} instead of the ${askedType} asked for` : null
}
