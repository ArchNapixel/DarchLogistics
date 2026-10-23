// fleetStatus: the two ways app code changes a truck's or trailer's
// current_status (Available / In Transit / Under Maintenance / Out of
// Service). Both only ever flip a vehicle that's at the status we expect,
// so a truck in the shop is never marked "In Transit" by a trip
// assignment, and a truck out on another trip is never marked
// "Available". (Freeing a vehicle when a trip is Delivered is done by the
// free_vehicles_on_delivery DB trigger, with the same rules.)
import { supabase } from './supabaseClient'

// Flips a truck (plateNumber) or trailer (trailerId) from `from` to `to`,
// but ONLY if it's still at `from`. Returns an error message or null.
export async function setVehicleStatus(
  plateNumber: string | null,
  trailerId: number | null,
  from: string,
  to: string,
) {
  const { error } = plateNumber
    ? await supabase
        .from('truck_profiles')
        .update({ current_status: to })
        .eq('plate_number', plateNumber)
        .eq('current_status', from)
    : await supabase
        .from('trailers')
        .update({ current_status: to })
        .eq('trailer_id', trailerId)
        .eq('current_status', from)
  return error?.message ?? null
}

// Call AFTER a work order is closed (Completed / Cancelled): sets the
// vehicle back to "Available" -- but only if it's still "Under
// Maintenance" (never touches Out of Service, or a vehicle out on a trip)
// and has no OTHER open work order still keeping it in the shop.
export async function releaseVehicleFromShop(
  plateNumber: string | null,
  trailerId: number | null,
  closedWorkOrderId: number,
) {
  let query = supabase
    .from('work_orders')
    .select('work_order_id')
    .not('work_order_status', 'in', '("Completed","Cancelled")')
    .neq('work_order_id', closedWorkOrderId)
    .limit(1)
  query = plateNumber ? query.eq('plate_number', plateNumber) : query.eq('trailer_id', trailerId)

  const { data: otherOpen, error } = await query
  if (error) return error.message
  if (otherOpen.length > 0) return null

  return setVehicleStatus(plateNumber, trailerId, 'Under Maintenance', 'Available')
}

// Call AFTER a vehicle was taken off a trip (unassigned, swapped, or the
// trip cancelled): sets it back to "Available" -- but only if it's
// "In Transit" and isn't still on some other active trip.
export async function freeVehicleIfIdle(plateNumber: string | null, trailerId: number | null) {
  let query = supabase
    .from('itineraries')
    .select('itinerary_id')
    .not('itinerary_status', 'in', '("Delivered","Cancelled")')
    .limit(1)
  query = plateNumber ? query.eq('plate_number', plateNumber) : query.eq('trailer_id', trailerId)

  const { data: stillOnTrip, error } = await query
  if (error) return error.message
  if (stillOnTrip.length > 0) return null

  return setVehicleStatus(plateNumber, trailerId, 'In Transit', 'Available')
}
