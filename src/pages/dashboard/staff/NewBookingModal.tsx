// NewBookingModal: form for creating a booking. UI only -- Submit just
// closes the modal, nothing is saved anywhere.
//
// MOCK DATA -- replace with real Supabase insert later.
import { useState } from 'react'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function NewBookingModal({ onClose }: { onClose: () => void }) {
  const [clientName, setClientName] = useState('')
  const [pickupLocation, setPickupLocation] = useState('')
  const [deliveryLocation, setDeliveryLocation] = useState('')
  const [date, setDate] = useState('')
  const [rate, setRate] = useState('')

  function handleSubmit() {
    // Not wired up yet -- just closes the modal for now.
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">New Booking</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={`${labelClasses} sm:col-span-2`}>
            Client name
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Pickup location
            <input
              type="text"
              value={pickupLocation}
              onChange={(e) => setPickupLocation(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Delivery location
            <input
              type="text"
              value={deliveryLocation}
              onChange={(e) => setDeliveryLocation(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Rate
            <input
              type="number"
              min="0"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={fieldClasses}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Create Booking
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewBookingModal
