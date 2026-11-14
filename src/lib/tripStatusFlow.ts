// tripStatusFlow: which trip (itinerary) statuses mean what. Every screen asks
// these instead of comparing to 'Delivered' itself, so the empty-container
// return steps (Unloading -> Returning Container -> Container Returned) only
// have to be taught here.
//
// A normal trip:      Awaiting -> Dispatched -> PickedUp -> InTransit -> Delivered
// A container return: ... InTransit -> Delivered -> Unloading -> ReturningContainer -> ContainerReturned
// (only Container trips of a quote with "Return the empty container" ticked).
//
// Delivered = the client got the cargo: billing, payroll (the Delivered row in
// dispatch_status_logs) and Payments Due count from it, also on a return trip.
// A trip is FINISHED (truck, trailer and crew free) at Delivered, Container
// Returned or Cancelled.
// Self-check: node scripts/check-trip-status-flow.ts

const NORMAL_STEPS = ['Awaiting', 'Dispatched', 'PickedUp', 'InTransit', 'Delivered']
const RETURN_STEPS = [...NORMAL_STEPS, 'Unloading', 'ReturningContainer', 'ContainerReturned']

// The cargo has reached the client (billed, counts as a delivered trip).
export const DELIVERED_STATUSES = ['Delivered', 'Unloading', 'ReturningContainer', 'ContainerReturned']
// Done and not cancelled.
export const COMPLETED_STATUSES = ['Delivered', 'ContainerReturned']
// Nothing more happens on this trip.
export const FINISHED_STATUSES = [...COMPLETED_STATUSES, 'Cancelled']
// Crew, truck and trailer are out on this trip right now.
export const ON_ROAD_STATUSES = ['Dispatched', 'PickedUp', 'InTransit', 'Unloading', 'ReturningContainer']

export const isDelivered = (status: string | null | undefined) => DELIVERED_STATUSES.includes(status ?? '')
export const isCompleted = (status: string | null | undefined) => COMPLETED_STATUSES.includes(status ?? '')
export const isFinished = (status: string | null | undefined) => FINISHED_STATUSES.includes(status ?? '')
export const isOnRoad = (status: string | null | undefined) => ON_ROAD_STATUSES.includes(status ?? '')

// For Supabase filters: .not('itinerary_status', 'in', FINISHED_IN)
export const FINISHED_IN = `(${FINISHED_STATUSES.join(',')})`
// For .or(): not finished yet (a null status counts as Awaiting).
export const ACTIVE_TRIP_OR = `itinerary_status.is.null,itinerary_status.not.in.${FINISHED_IN}`

// The steps a trip goes through, in order.
export function statusSteps(returnContainer: boolean): string[] {
  return returnContainer ? RETURN_STEPS : NORMAL_STEPS
}

// The step after `status`, or null when there is none.
export function nextStatus(status: string, returnContainer: boolean): string | null {
  const steps = statusSteps(returnContainer)
  const at = steps.indexOf(status)
  return at === -1 || at === steps.length - 1 ? null : steps[at + 1]
}
