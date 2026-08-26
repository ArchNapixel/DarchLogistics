// DispatchBoardSection: board of active deliveries with a per-row status
// dropdown. The dropdown is visually functional (opens, shows the full
// flow) but only updates local component state -- nothing is saved, so
// refreshing the page resets it.
//
// MOCK DATA -- replace with real Supabase query later. Nothing on this
// page reads from or writes to the database yet.
import { useState } from 'react'

type DeliveryStatus =
  | 'Awaiting'
  | 'Dispatched'
  | 'PickedUp'
  | 'InTransit'
  | 'Delivered'

type ActiveDelivery = {
  booking_id: number
  driver_name: string
  pickup_location: string
  delivery_location: string
  pickup_date: string
  delivery_date: string
  status: DeliveryStatus
}

// MOCK DATA -- replace with real Supabase query later.
const MOCK_DELIVERIES: ActiveDelivery[] = [
  {
    booking_id: 1042,
    driver_name: 'Ramon Cruz',
    pickup_location: 'Cavite Warehouse',
    delivery_location: 'Batangas Port',
    pickup_date: '2026-08-28',
    delivery_date: '2026-08-28',
    status: 'Dispatched',
  },
  {
    booking_id: 1037,
    driver_name: 'Ariel Santos',
    pickup_location: 'Manila South Harbor',
    delivery_location: 'Laguna Distribution Center',
    pickup_date: '2026-08-26',
    delivery_date: '2026-08-27',
    status: 'InTransit',
  },
  {
    booking_id: 1035,
    driver_name: 'Ben Villareal',
    pickup_location: 'Bulacan Cold Storage',
    delivery_location: 'Manila Pier 15',
    pickup_date: '2026-08-26',
    delivery_date: '2026-08-26',
    status: 'PickedUp',
  },
  {
    booking_id: 1033,
    driver_name: 'Ramon Cruz',
    pickup_location: 'Rizal Aggregates Yard',
    delivery_location: 'Quezon City Site B',
    pickup_date: '2026-08-25',
    delivery_date: '2026-08-25',
    status: 'Awaiting',
  },
]

const STATUS_FLOW: DeliveryStatus[] = [
  'Awaiting',
  'Dispatched',
  'PickedUp',
  'InTransit',
  'Delivered',
]

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  Awaiting: 'Awaiting',
  Dispatched: 'Dispatched',
  PickedUp: 'Picked Up',
  InTransit: 'In Transit',
  Delivered: 'Delivered',
}

const STATUS_STYLES: Record<DeliveryStatus, string> = {
  Awaiting: 'bg-gray-100 text-gray-700',
  Dispatched: 'bg-blue-100 text-blue-700',
  PickedUp: 'bg-purple-100 text-purple-700',
  InTransit: 'bg-orange-100 text-orange-700',
  Delivered: 'bg-green-100 text-green-700',
}

function DispatchStatusBadge({ status }: { status: DeliveryStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

function DispatchBoardSection() {
  const [deliveries, setDeliveries] = useState<ActiveDelivery[]>(
    MOCK_DELIVERIES,
  )

  // Local-only -- doesn't persist anywhere. A page refresh resets it back
  // to the mock data above.
  function handleStatusChange(bookingId: number, newStatus: DeliveryStatus) {
    setDeliveries((prev) =>
      prev.map((delivery) =>
        delivery.booking_id === bookingId
          ? { ...delivery, status: newStatus }
          : delivery,
      ),
    )
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Dispatch Board</h2>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Booking ID</th>
              <th className="px-4 py-3 font-medium">Driver</th>
              <th className="px-4 py-3 font-medium">Origin → Destination</th>
              <th className="px-4 py-3 font-medium">Pickup → Delivery Date</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Update Status</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr
                key={delivery.booking_id}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-3 text-slate-900">
                  #{delivery.booking_id}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {delivery.driver_name}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {delivery.pickup_location} → {delivery.delivery_location}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {delivery.pickup_date} → {delivery.delivery_date}
                </td>
                <td className="px-4 py-3">
                  <DispatchStatusBadge status={delivery.status} />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={delivery.status}
                    onChange={(e) =>
                      handleStatusChange(
                        delivery.booking_id,
                        e.target.value as DeliveryStatus,
                      )
                    }
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
                  >
                    {STATUS_FLOW.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default DispatchBoardSection
