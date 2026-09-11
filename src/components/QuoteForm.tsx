// QuoteForm: the public "Get a Quote" form. Anyone can submit this without
// logging in. On submit, it inserts a new row into quote_requests with
// request_status = 'Pending'. Staff will review it later from the dashboard.
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'

// The shape of the form's editable fields, as plain strings (form inputs
// always give you strings/text, even for numbers and dates).
type QuoteFormData = {
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
}

const emptyForm: QuoteFormData = {
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
}

// Shared Tailwind classes so every input/select looks the same.
const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function QuoteForm() {
  const [form, setForm] = useState<QuoteFormData>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // One handler for every text/select field: updates just the field that
  // changed, using its "name" attribute to know which one.
  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error: insertError } = await supabase.from('quote_requests').insert({
      client_name: form.clientName,
      contact_number: form.contactNumber || null,
      contact_email: form.contactEmail || null,
      pickup_location_text: form.pickupLocationText,
      delivery_location_text: form.deliveryLocationText,
      cargo_type: form.cargoType,
      cargo_description: form.cargoDescription,
      weight: Number(form.weight),
      container_type: form.containerType,
      preferred_pickup_date: form.preferredPickupDate,
      payment_terms: form.paymentTerms,
      proposed_rate: Number(form.proposedRate),
      is_last_day_of_port_storage: form.isLastDayOfPortStorage === 'Yes',
      preferred_delivery_date:
        form.isLastDayOfPortStorage === 'Yes' ? null : form.preferredDeliveryDate,
      request_status: 'Pending',
    })

    setSubmitting(false)

    if (insertError) {
      // Keep the user's input in place so they don't have to retype it.
      setError(insertError.message)
      return
    }

    setSubmitted(true)
  }

  // After a successful submit, show a confirmation instead of the form.
  if (submitted) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h3 className="text-xl font-semibold text-slate-900">
          Quote request submitted!
        </h3>
        <p className="mt-2 text-slate-600">We'll get back to you shortly.</p>
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm)
            setSubmitted(false)
          }}
          className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Submit another request
        </button>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm sm:grid-cols-2"
    >
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 sm:col-span-2">
          {error}
        </p>
      )}

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

      <label className={`${labelClasses} sm:col-span-2`}>
        Cargo description
        <textarea
          name="cargoDescription"
          value={form.cargoDescription}
          onChange={handleChange}
          required
          rows={3}
          placeholder="e.g. Electronics, machinery, palletized goods..."
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
          placeholder="e.g. 15000"
          className={fieldClasses}
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50 sm:col-span-2"
      >
        {submitting ? 'Submitting...' : 'Submit Quote Request'}
      </button>
    </form>
  )
}

export default QuoteForm
