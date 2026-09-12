// NewQuoteModal: lets a logged-in client submit a quote request from
// their own portal, instead of only through the public form or staff
// logging it on their behalf. Same shipment fields/validation as the
// staff version (NewQuoteRequestModal.tsx) and the public one
// (QuoteForm.tsx) -- reusing that shape keeps one tested insert path
// into quote_requests no matter who submits it, it then goes through
// the same Review/Approve flow as any other quote.
//
// Unlike those two, this version does NOT ask for client name/contact
// number/email -- the client already has these on file (`clients`,
// looked up via clientId), so re-typing them here would be redundant.
// They're loaded once on open and shown read-only; if they can't be
// loaded (missing name/phone on the account), submission is blocked
// with a message to contact support instead of silently sending a
// blank name/number. client_id is also set directly on the insert (the
// staff/public versions can't do this, since they don't know the
// client yet) so Approve doesn't have to re-match by email.
import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type ContactInfo = {
  clientName: string
  contactNumber: string
  contactEmail: string
}

type FormData = {
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

function NewQuoteModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: number
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState<FormData>(emptyForm)
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)
  const [contactInfoError, setContactInfoError] = useState<string | null>(
    null,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the client's contact info once -- required before Approve can
  // go through, so submission is blocked (not just left blank) if this
  // fails or the account is missing a name/phone.
  useEffect(() => {
    async function loadContactInfo() {
      const { data, error: loadError } = await supabase
        .from('clients')
        .select('client_name, email, phone_number')
        .eq('client_id', clientId)
        .maybeSingle()

      if (loadError) {
        setContactInfoError(loadError.message)
        return
      }

      if (!data || !data.client_name || !data.phone_number) {
        setContactInfoError(
          'Your account is missing a name or phone number. Please contact support to update it before submitting a quote.',
        )
        return
      }

      setContactInfo({
        clientName: data.client_name,
        contactNumber: data.phone_number,
        contactEmail: data.email ?? '',
      })
    }

    loadContactInfo()
  }, [clientId])

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit() {
    setError(null)

    if (!contactInfo) {
      setError(
        contactInfoError ?? 'Your contact info is still loading -- try again in a moment.',
      )
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
      client_id: clientId,
      client_name: contactInfo.clientName,
      contact_number: contactInfo.contactNumber,
      contact_email: contactInfo.contactEmail || null,
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

        {!contactInfo && !error && (
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {contactInfoError ?? 'Loading your contact info...'}
          </p>
        )}

        {contactInfo && (
          <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Submitting as{' '}
            <span className="font-medium text-slate-900">
              {contactInfo.clientName}
            </span>{' '}
            · {contactInfo.contactNumber}
            {contactInfo.contactEmail ? ` · ${contactInfo.contactEmail}` : ''}
          </p>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
              placeholder="e.g. 3"
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
            disabled={submitting || !contactInfo}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Quote Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewQuoteModal
