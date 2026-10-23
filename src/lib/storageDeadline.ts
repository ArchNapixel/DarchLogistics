// storageDeadline: the "last free storage day" rule (#15). A booking whose
// quote was flagged as the last free port-storage day has
// bookings.storage_deadline = that day (the pickup date). Every trip of it
// must reach Picked Up -- the container is out of the port and in our
// hands -- by 11:59 PM Manila that day. Delivery can come later, up to the
// booking's deadline date like any other booking.
// Self-check: node scripts/check-storage-deadline.ts

// Statuses where the container has already left the port.
const PICKED_UP = ['PickedUp', 'InTransit', 'Delivered']

// End of the storage day: 11:59:59.999 PM Manila (UTC+8, no DST), in ms.
export function storageDeadlineEnd(date: string): number {
  return Date.parse(`${date}T23:59:59.999+08:00`)
}

// pending = not picked up yet, still time; missed = not picked up and the
// day is over; met = picked up in time; late = picked up after the day.
export type StorageState = 'pending' | 'missed' | 'met' | 'late'

// null = nothing to show (no deadline, cancelled trip, or picked up with
// no logged pickup time to judge by).
export function storageState(args: {
  deadline: string | null // bookings.storage_deadline
  status: string // itineraries.itinerary_status
  pickedUpAt: string | null // when it was logged Picked Up, if known
  now: number
}): StorageState | null {
  if (!args.deadline || args.status === 'Cancelled') return null
  const end = storageDeadlineEnd(args.deadline)
  if (!PICKED_UP.includes(args.status)) return args.now > end ? 'missed' : 'pending'
  if (!args.pickedUpAt) return null
  return Date.parse(args.pickedUpAt) <= end ? 'met' : 'late'
}

// Badge text + classes per state, same everywhere.
export const STORAGE_BADGE: Record<StorageState, { label: string; className: string }> = {
  pending: { label: 'Pick up by 11:59 PM', className: 'bg-amber-100 text-amber-800' },
  missed: { label: 'Storage deadline missed', className: 'bg-red-100 text-red-700' },
  met: { label: 'Storage ✓ met', className: 'bg-green-100 text-green-700' },
  late: { label: 'Picked up late (storage)', className: 'bg-red-100 text-red-700' },
}
