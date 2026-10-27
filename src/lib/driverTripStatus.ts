// driverTripStatus: trip status names as the driver / helper app shows
// them (different from staff's lib/tripList.ts wording on purpose).
// Moved out of UpdateStatusControl.tsx so that file only exports components.
// Same wording as the Dispatch Board's STATUS_LABELS, except InTransit:
// it's the driver's last step, so to the driver it means "I've arrived and
// delivered" (dispatch then confirms it as Delivered). The stored status is
// still 'InTransit', and other screens still call it In Transit.
export const DRIVER_TRIP_STATUS_LABELS: Record<string, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked Up',
  InTransit: 'Arrived / Delivered',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
}
