// BookingDetailModal: read-only detail view for a single booking row.
import type { Booking } from './BookingsSection'
import { BookingStatusBadge } from './BookingsSection'

function formatMoney(value: number | null): string {
  return value !== null ? `₱${value.toLocaleString()}` : '—'
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-slate-900">{value}</p>
    </div>
  )
}

function BookingDetailModal({
  booking,
  onClose,
}: {
  booking: Booking
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">
            Booking #{booking.booking_id}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <BookingStatusBadge status={booking.status} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <InfoRow label="Client" value={booking.client_name} />
          <InfoRow label="Date" value={booking.date} />
          <InfoRow label="Origin" value={booking.pickup_location} />
          <InfoRow label="Destination" value={booking.delivery_location} />
          <InfoRow label="Rate" value={formatMoney(booking.rate)} />
          <InfoRow label="Amount to pay" value={formatMoney(booking.amount_to_pay)} />
          <InfoRow label="Amount paid" value={formatMoney(booking.amount_paid)} />
          <InfoRow label="Balance due" value={formatMoney(booking.balance_due)} />
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default BookingDetailModal
