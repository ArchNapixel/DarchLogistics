// QuoteForm: the public "Get a Quote" form. Anyone can submit this without
// logging in. On submit, it inserts a new row into quote_requests with
// request_status = 'Pending'. Staff will review it later from the dashboard.
//
// Visual redesign only below (numbered sections, toggle buttons for
// cargo/container type, a radio pair + priority callout instead of a
// plain select for the last-free-day question) -- the field set,
// validation, and the Supabase insert are unchanged from before.
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import LocationPicker, { emptyLocationValue, type LocationValue } from './LocationPicker'

type QuoteFormData = {
  clientName: string
  contactNumber: string
  contactEmail: string
  pickup: LocationValue
  delivery: LocationValue
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

const emptyForm: QuoteFormData = {
  clientName: '',
  contactNumber: '',
  contactEmail: '',
  pickup: emptyLocationValue,
  delivery: emptyLocationValue,
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
  'rounded-md border border-slate-300 bg-slate-100 px-3 py-2.5 text-slate-900 focus:border-brand-steel focus:bg-white focus:outline-none'
const labelClasses = 'flex flex-col gap-1.5 text-sm font-medium text-slate-700'

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="col-span-full">
      <p className="text-xs font-semibold tracking-[0.15em] text-brand-steel-dark uppercase">
        {number} — {title}
      </p>
      <div className="mt-2 border-t border-slate-300" />
    </div>
  )
}

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`flex-1 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${
            value === option
              ? 'border-brand-steel bg-brand-steel text-white'
              : 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

function QuoteForm() {
  const [form, setForm] = useState<QuoteFormData>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function setField<K extends keyof QuoteFormData>(name: K, value: QuoteFormData[K]) {
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

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
      pickup_location_text: form.pickup.detail,
      pickup_city: form.pickup.city,
      pickup_barangay: form.pickup.barangay,
      delivery_location_text: form.delivery.detail,
      delivery_city: form.delivery.city,
      delivery_barangay: form.delivery.barangay,
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
          className="mt-6 rounded-lg bg-brand-steel px-4 py-2 text-sm font-medium text-white hover:bg-brand-steel-dark"
        >
          Submit another request
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 sm:grid-cols-2">
      {error && (
        <p className="col-span-full rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <SectionHeading number="01" title="Contact" />

      <label className={labelClasses}>
        Client name
        <input
          type="text"
          name="clientName"
          placeholder="Company or individual"
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
          placeholder="09XX XXX XXXX"
          value={form.contactNumber}
          onChange={handleChange}
          required
          className={fieldClasses}
        />
      </label>

      <label className={`${labelClasses} sm:col-span-2`}>
        Contact email (optional)
        <input
          type="email"
          name="contactEmail"
          placeholder="name@company.com"
          value={form.contactEmail}
          onChange={handleChange}
          className={fieldClasses}
        />
      </label>

      <SectionHeading number="02" title="Route" />

      <LocationPicker
        label="Origin"
        value={form.pickup}
        onChange={(value) => setField('pickup', value)}
      />

      <LocationPicker
        label="Destination"
        value={form.delivery}
        onChange={(value) => setField('delivery', value)}
      />

      <SectionHeading number="03" title="Cargo" />

      <label className={labelClasses}>
        Cargo type
        <ToggleGroup
          options={['Container', 'Loose'] as const}
          value={form.cargoType}
          onChange={(value) => setField('cargoType', value)}
        />
      </label>

      <label className={labelClasses}>
        Weight (tons)
        <input
          type="number"
          name="weight"
          placeholder="e.g. 24.5"
          value={form.weight}
          onChange={handleChange}
          required
          min="0"
          step="0.01"
          className={fieldClasses}
        />
      </label>

      <label className={labelClasses}>
        Container type
        <ToggleGroup
          options={['20ft', '40ft'] as const}
          value={form.containerType}
          onChange={(value) => setField('containerType', value)}
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
          placeholder="What it is, dimensions, how it is packed, lifting points"
          className={fieldClasses}
        />
      </label>

      <SectionHeading number="04" title="Schedule" />

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

      <div className={labelClasses}>
        Is this the last day of free port storage?
        <div className="flex items-center gap-6 pt-1">
          <label className="flex items-center gap-2 text-sm font-normal text-slate-700">
            <input
              type="radio"
              name="isLastDayOfPortStorage"
              checked={form.isLastDayOfPortStorage === 'Yes'}
              onChange={() => setField('isLastDayOfPortStorage', 'Yes')}
              className="accent-brand-steel"
            />
            Yes — pickup is time-critical
          </label>
          <label className="flex items-center gap-2 text-sm font-normal text-slate-700">
            <input
              type="radio"
              name="isLastDayOfPortStorage"
              checked={form.isLastDayOfPortStorage === 'No'}
              onChange={() => setField('isLastDayOfPortStorage', 'No')}
              className="accent-brand-steel"
            />
            No
          </label>
        </div>
      </div>

      {form.isLastDayOfPortStorage === 'Yes' ? (
        <div className="col-span-full flex items-start gap-3 rounded-lg border border-brand-steel/30 bg-brand-steel/10 px-4 py-3">
          <span className="mt-0.5 shrink-0 rounded border border-brand-steel-dark px-2 py-0.5 text-[10px] font-bold tracking-wide text-brand-steel-dark uppercase">
            Priority
          </span>
          <p className="text-sm text-slate-700">
            Flagged for same-day dispatch review. Delivery is scheduled off
            the gate slot, so no delivery date is collected — dispatch will
            confirm the drop window by phone.
          </p>
        </div>
      ) : (
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

      <SectionHeading number="05" title="Commercial" />

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
        Proposed rate (PHP)
        <input
          type="number"
          name="proposedRate"
          placeholder="₱ 0.00"
          value={form.proposedRate}
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
          placeholder="1"
          value={form.deliveryOrderCount}
          onChange={handleChange}
          required
          min="1"
          step="1"
          className={fieldClasses}
        />
      </label>

      <div className="col-span-full mt-2 flex flex-wrap items-center gap-4 border-t border-slate-300 pt-6">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-steel px-6 py-3 text-sm font-bold tracking-wide text-white uppercase hover:bg-brand-steel-dark disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit Request'}
        </button>
        <p className="text-sm text-slate-500">
          Or call dispatch directly —{' '}
          <a href="tel:09660475467" className="font-medium text-slate-700 underline">
            09660475467
          </a>
        </p>
      </div>
    </form>
  )
}

export default QuoteForm
