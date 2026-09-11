// NewQuoteRequestModal: lets staff log a quote request on a client's
// behalf (e.g. a phone-in booking) -- same fields as the public
// QuoteForm.tsx, inserting into quote_requests with request_status
// 'Pending'. It then goes through the exact same Review/Approve flow
// as any other quote (QuoteReviewModal), instead of a separate
// manual-booking path -- keeps one tested path for turning a quote into
// a booking + itineraries, no matter who submitted it.
import { useState, type ChangeEvent } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type FormData = {
  clientName: string
  contactNumber: string
  contactEmail: string
  pickupLocationText: string
  deliveryLocationText: string
  cargoType: 'Container' | 'Loose'
  cargoDescription: string
  weight: string
  containerType: '20ft' | '40ft'
  preferredPickupDate: string
  paymentTerms: 'Cash' | '7Days' | '14Days' | '30Days'
  proposedRate: string
  isLastDayOfPortStorage: 'No' | 'Yes'
  preferredDeliveryDate: string
  deliveryOrderCount: string
}

const emptyForm: FormData = {
  clientName: '',
  contactNumber: '',
  contactEmail: '',
  pickupLocationText: '',
  deliveryLocationText: '',
  cargoType: 'Container',
  cargoDescription: '',
  weight: '',
  containerType: '20ft',
  preferredPickupDate: '',
  paymentTerms: 'Cash',
  proposedRate: '',
  isLastDayOfPortStorage: 'No',
  preferredDeliveryDate: '',
  deliveryOrderCount: '',
}

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function NewQuoteRequestModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<FormData>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit() {
    setError(null)

    if (!form.clientName.trim() || !form.contactNumber.trim()) {
      setError('Enter a client name and contact number.')
      return
    }
    if (!form.pickupLocationText.trim() || !form.deliveryLocationText.trim()) {
      setError('Enter both an origin and a destination.')
      return
    }
    if (!form.cargoDescription.trim()) {
      setError('Enter a cargo description.')
      return
    }
    if (!form.preferredPickupDate) {
      setError('Enter a preferred pickup date.')
      return
    }
    if (form.isLastDayOfPortStorage === 'No' && !form.preferredDeliveryDate) {
      setError('Enter a preferred delivery date.')
      return
    }

    // Number(...) on an empty/invalid string gives NaN, which would
    // otherwise be sent to Supabase and silently saved as null -- catch
    // that here instead of letting a quote go in with missing numbers.
    const weightValue = Number(form.weight)
    const proposedRateValue = Number(form.proposedRate)
    const deliveryOrderCountValue = Number(form.deliveryOrderCount)

    if (!form.weight || Number.isNaN(weightValue) || weightValue <= 0) {
      setError('Enter a valid weight.')
      return
    }
    if (!form.proposedRate || Number.isNaN(proposedRateValue) || proposedRateValue <= 0) {
      setError('Enter a valid proposed rate.')
      return
    }
    if (
      !form.deliveryOrderCount ||
      Number.isNaN(deliveryOrderCountValue) ||
      deliveryOrderCountValue <= 0
    ) {
      setError('Enter a valid number of deliveries.')
      return
    }

    setSubmitting(true)

    const { error: insertError } = await supabase.from('quote_requests').insert({
      client_name: form.clientName,
      contact_number: form.contactNumber || null,
      contact_email: form.contactEmail || null,
      pickup_location_text: form.pickupLocationText,
      delivery_location_text: form.deliveryLocationText,
      cargo_type: form.cargoType,
      cargo_description: form.cargoDescription,
      weight: weightValue,
      container_type: form.containerType,
      preferred_pickup_date: form.preferredPickupDate,
      payment_terms: form.paymentTerms,
      proposed_rate: proposedRateValue,
      is_last_day_of_port_storage: form.isLastDayOfPortStorage === 'Yes',
      preferred_delivery_date:
        form.isLastDayOfPortStorage === 'Yes' ? null : form.preferredDeliveryDate,
      delivery_order_count: deliveryOrderCountValue,
      request_status: 'Pending',
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">New Quote Request</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className={labelClasses}>
            Client name
            <input
              type="text"
              name="clientName"
              value={form.clientName}
              onChange={handleChange}
              required
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Contact number
            <input
              type="tel"
              name="contactNumber"
              value={form.contactNumber}
              onChange={handleChange}
              required
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Contact email (optional)
            <input
              type="email"
              name="contactEmail"
              value={form.contactEmail}
              onChange={handleChange}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Preferred pickup date
            <input
              type="date"
              name="preferredPickupDate"
              value={form.preferredPickupDate}
              onChange={handleChange}
              required
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Is this the last day of free port storage?
            <select
              name="isLastDayOfPortStorage"
              value={form.isLastDayOfPortStorage}
              onChange={handleChange}
              className={fieldClasses}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </label>

          {form.isLastDayOfPortStorage === 'No' && (
            <label className={labelClasses}>
              Preferred delivery date
              <input
                type="date"
                name="preferredDeliveryDate"
                value={form.preferredDeliveryDate}
                onChange={handleChange}
                required
                className={fieldClasses}
              />
            </label>
          )}

          <label className={labelClasses}>
            Origin
            <input
              type="text"
              name="pickupLocationText"
              value={form.pickupLocationText}
              onChange={handleChange}
              required
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Destination
            <input
              type="text"
              name="deliveryLocationText"
              value={form.deliveryLocationText}
              onChange={handleChange}
              required
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Cargo type
            <select
              name="cargoType"
              value={form.cargoType}
              onChange={handleChange}
              className={fieldClasses}
            >
              <option value="Container">Container</option>
              <option value="Loose">Loose</option>
            </select>
          </label>

          <label className={labelClasses}>
            Weight (tons)
            <input
              type="number"
              name="weight"
              value={form.weight}
              onChange={handleChange}
              required
              min="0"
              step="0.01"
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Number of deliveries
            <input
              type="number"
              name="deliveryOrderCount"
              value={form.deliveryOrderCount}
              onChange={handleChange}
              required
              min="1"
              step="1"
              className={fieldClasses}
            />
          </label>

          <label className={`${labelClasses} sm:col-span-2`}>
            Cargo description
            <textarea
              name="cargoDescription"
              value={form.cargoDescription}
              onChange={handleChange}
              required
              rows={3}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Trailer type
            <select
              name="containerType"
              value={form.containerType}
              onChange={handleChange}
              className={fieldClasses}
            >
              <option value="20ft">20ft</option>
              <option value="40ft">40ft</option>
            </select>
          </label>

          <label className={labelClasses}>
            Payment terms
            <select
              name="paymentTerms"
              value={form.paymentTerms}
              onChange={handleChange}
              className={fieldClasses}
            >
              <option value="Cash">Cash</option>
              <option value="7Days">7 days</option>
              <option value="14Days">14 days</option>
              <option value="30Days">30 days</option>
            </select>
          </label>

          <label className={labelClasses}>
            Proposed rate in pesos
            <input
              type="number"
              name="proposedRate"
              value={form.proposedRate}
              onChange={handleChange}
              required
              min="0"
              step="0.01"
              className={fieldClasses}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Quote Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewQuoteRequestModal
