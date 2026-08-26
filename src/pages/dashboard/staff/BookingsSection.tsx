// BookingsSection: lists bookings in a table, with a "New Booking" button
// and a click-through detail view for each row.
//
// MOCK DATA -- replace with real Supabase query later. Nothing on this
// page reads from or writes to the database yet.
import { useState } from 'react'
import NewBookingModal from './NewBookingModal'
import BookingDetailModal from './BookingDetailModal'

export type Booking = {
  booking_id: number
  client_name: string
  pickup_location: string
  delivery_location: string
  date: string
  status: 'Draft' | 'Confirmed' | 'Delivered' | 'Cancelled'
  rate: number
  payment_status: 'Unpaid' | 'Partially Paid' | 'Paid'
}

// MOCK DATA -- replace with real Supabase query later.
const MOCK_BOOKINGS: Booking[] = [
  {
    booking_id: 1042,
    client_name: 'Meralco Industrial Supply',
    pickup_location: 'Cavite Warehouse',
    delivery_location: 'Batangas Port',
    date: '2026-08-28',
    status: 'Confirmed',
    rate: 18500,
    payment_status: 'Unpaid',
  },
  {
    booking_id: 1041,
    client_name: 'Golden Harvest Foods',
    pickup_location: 'Bulacan Cold Storage',
    delivery_location: 'Manila Pier 15',
    date: '2026-08-27',
    status: 'Delivered',
    rate: 22000,
    payment_status: 'Paid',
  },
  {
    booking_id: 1040,
    client_name: 'Skyline Construction Corp',
    pickup_location: 'Rizal Aggregates Yard',
    delivery_location: 'Quezon City Site B',
    date: '2026-08-26',
    status: 'Draft',
    rate: 15750,
    payment_status: 'Unpaid',
  },
  {
    booking_id: 1039,
    client_name: 'Pacific Rim Traders',
    pickup_location: 'Manila South Harbor',
    delivery_location: 'Laguna Distribution Center',
    date: '2026-08-25',
    status: 'Cancelled',
    rate: 19200,
    payment_status: 'Unpaid',
  },
  {
    booking_id: 1038,
    client_name: 'Meralco Industrial Supply',
    pickup_location: 'Batangas Port',
    delivery_location: 'Cavite Warehouse',
    date: '2026-08-23',
    status: 'Delivered',
    rate: 18500,
    payment_status: 'Partially Paid',
  },
]

const STATUS_STYLES: Record<Booking['status'], string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Confirmed: 'bg-blue-100 text-blue-700',
  Delivered: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
}

export function BookingStatusBadge({ status }: { status: Booking['status'] }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

function BookingsSection() {
  const [bookings] = useState<Booking[]>(MOCK_BOOKINGS)
  const [showNewBooking, setShowNewBooking] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Bookings</h2>
        <button
          onClick={() => setShowNewBooking(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New Booking
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Booking ID</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Origin → Destination</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Rate</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr
                key={booking.booking_id}
                onClick={() => setSelectedBooking(booking)}
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-3 text-slate-900">
                  #{booking.booking_id}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {booking.client_name}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {booking.pickup_location} → {booking.delivery_location}
                </td>
                <td className="px-4 py-3 text-slate-600">{booking.date}</td>
                <td className="px-4 py-3">
                  <BookingStatusBadge status={booking.status} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  ₱{booking.rate.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNewBooking && (
        <NewBookingModal onClose={() => setShowNewBooking(false)} />
      )}

      {selectedBooking && (
        <BookingDetailModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </div>
  )
}

export default BookingsSection
