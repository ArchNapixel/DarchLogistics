// NewQuoteRequestModal: lets staff log a quote request on a client's
// behalf (e.g. a phone-in booking) -- same fields as the public
// QuoteForm.tsx, inserting into quote_requests with request_status
// 'Pending'. It then goes through the exact same Review/Approve flow
// as any other quote (QuoteReviewModal), instead of a separate
// manual-booking path -- keeps one tested path for turning a quote into
// a booking + itineraries, no matter who submitted it.
import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import LocationPicker, {
  emptyLocationValue,
  type LocationValue,
} from '../../../components/LocationPicker'
import { formatLocationDisplay } from '../../../lib/locationReference'
import NewQuoteLocationMap from './NewQuoteLocationMap'

type FormData = {
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

const emptyForm: FormData = {
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

type ExistingClient = {
  client_id: number
  client_name: string
  email: string | null
  phone_number: string | null
}

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'
const tabClasses = (active: boolean) =>
  `px-4 py-2 text-sm font-medium ${
    active
      ? 'border-b-2 border-slate-900 text-slate-900'
      : 'text-slate-500 hover:text-slate-700'
  }`

// The city box on the "From map" tab. It looks like a normal field but
// clicking it opens the map instead of a dropdown -- the map is only
// ever on screen while one of these is being answered. The colored dot
// matches that point's marker on NewQuoteLocationMap so the panel and
// the map read as the same thing.
function MapFieldButton({
  color,
  label,
  value,
  onClick,
}: {
  color: string
  label: string
  value: LocationValue
  onClick: () => void
}) {
  return (
    <div className={labelClasses}>
      {label}
      <button
        type="button"
        onClick={onClick}
        className={`${fieldClasses} flex items-center gap-2 text-left font-normal hover:border-slate-500`}
      >
        <span className={`h-3 w-3 shrink-0 rounded-full ${color}`} />
        {value.city && value.barangay ? (
          <span className="truncate">
            {formatLocationDisplay({
              city: value.city,
              barangay: value.barangay,
              detail: value.detail,
            })}
          </span>
        ) : (
          <span className="text-slate-400">Click to pick on map</span>
        )}
      </button>
    </div>
  )
}

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
  // Exact clicked point behind the current pickup/delivery, if it was
  // set from the map -- just for drawing the two pins on
  // NewQuoteLocationMap, not saved anywhere (the form's city/barangay
  // fields are the real data).
  const [pickupPin, setPickupPin] = useState<[number, number] | null>(null)
  const [deliveryPin, setDeliveryPin] = useState<[number, number] | null>(null)
  // Map is the default way in now; the City/Barangay dropdowns only
  // appear on the "Enter manually" tab. Both write the same
  // form.pickup/form.delivery, so switching tabs never loses a pick.
  const [locationTab, setLocationTab] = useState<'map' | 'manual'>('map')
  // Which city box is currently being answered, or null for no map on
  // screen at all. The map is only ever up while one of the two boxes
  // is open, and closes again as soon as a point is assigned.
  const [mapOpenFor, setMapOpenFor] = useState<'pickup' | 'delivery' | null>(null)
  // 'new' keeps the original type-it-in behaviour; 'existing' links the
  // request to a real clients row up front, so Approve doesn't have to
  // match it back by email later.
  const [clientMode, setClientMode] = useState<'existing' | 'new'>('new')
  const [clients, setClients] = useState<ExistingClient[]>([])
  const [clientsError, setClientsError] = useState<string | null>(null)
  const [selectedClientId, setSelectedClientId] = useState('')

  useEffect(() => {
    supabase
      .from('clients')
      .select('client_id, client_name, email, phone_number')
      .order('client_name', { ascending: true })
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setClientsError(loadError.message)
          return
        }
        setClients(data ?? [])
      })
  }, [])

  const selectedClient = clients.find(
    (client) => String(client.client_id) === selectedClientId,
  )

  function handleMapPick(
    role: 'pickup' | 'delivery',
    location: { city: string; barangay: string } | null,
    latlng: [number, number],
  ) {
    if (role === 'pickup') {
      setPickupPin(latlng)
      if (location) {
        setForm((prev) => ({ ...prev, pickup: { ...prev.pickup, ...location } }))
      }
    } else {
      setDeliveryPin(latlng)
      if (location) {
        setForm((prev) => ({ ...prev, delivery: { ...prev.delivery, ...location } }))
      }
    }
    setMapOpenFor(null)
  }

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  function setField<K extends keyof FormData>(name: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit() {
    setError(null)

    if (clientMode === 'existing' && !selectedClient) {
      setError('Pick an existing client, or switch to "New client".')
      return
    }
    if (clientMode === 'new' && (!form.clientName.trim() || !form.contactNumber.trim())) {
      setError('Enter a client name and contact number.')
      return
    }
    if (
      !form.pickup.city ||
      !form.pickup.barangay ||
      !form.delivery.city ||
      !form.delivery.barangay
    ) {
      setError('Select a city and barangay for both the origin and the destination.')
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

    // An existing client's own record is the source of truth for these
    // three -- they're still copied onto the quote row so every list
    // that reads quote_requests.client_name keeps working unchanged.
    const { error: insertError } = await supabase.from('quote_requests').insert({
      client_id: selectedClient ? selectedClient.client_id : null,
      client_name: selectedClient ? selectedClient.client_name : form.clientName,
      contact_number: selectedClient
        ? selectedClient.phone_number
        : form.contactNumber || null,
      contact_email: selectedClient
        ? selectedClient.email
        : form.contactEmail || null,
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
      setError(insertError.message)
      return
    }

    onCreated()
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center px-4 ${
        mapOpenFor ? 'justify-start' : 'justify-center bg-black/40'
      }`}
    >
      {mapOpenFor && (
        <div className="absolute inset-0 z-0">
          <NewQuoteLocationMap
            openedFor={mapOpenFor}
            focusPin={mapOpenFor === 'pickup' ? pickupPin : deliveryPin}
            focusCity={mapOpenFor === 'pickup' ? form.pickup.city : form.delivery.city}
            pickupPin={pickupPin}
            deliveryPin={deliveryPin}
            onPick={handleMapPick}
            onCancel={() => setMapOpenFor(null)}
          />
        </div>
      )}

      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
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
          <div className="col-span-full overflow-hidden rounded-lg border border-slate-200">
            <div className="flex border-b border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setClientMode('existing')}
                className={tabClasses(clientMode === 'existing')}
              >
                Existing client
              </button>
              <button
                type="button"
                onClick={() => setClientMode('new')}
                className={tabClasses(clientMode === 'new')}
              >
                New client
              </button>
            </div>

            {clientMode === 'existing' ? (
              <div className="flex flex-col gap-2 p-3">
                {clientsError && <p className="text-sm text-red-700">{clientsError}</p>}
                <label className={labelClasses}>
                  Client
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className={fieldClasses}
                  >
                    <option value="">Select a client</option>
                    {clients.map((client) => (
                      <option key={client.client_id} value={client.client_id}>
                        {client.client_name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedClient && (
                  <p className="text-xs text-slate-500">
                    {selectedClient.phone_number ?? 'No phone on file'}
                    {' / '}
                    {selectedClient.email ?? 'no email on file'}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid gap-3 p-3 sm:grid-cols-2">
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

                <label className={`${labelClasses} sm:col-span-2`}>
                  Contact email (optional)
                  <input
                    type="email"
                    name="contactEmail"
                    value={form.contactEmail}
                    onChange={handleChange}
                    className={fieldClasses}
                  />
                </label>
              </div>
            )}
          </div>

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

          <div className="col-span-full overflow-hidden rounded-lg border border-slate-200">
            <div className="flex border-b border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setLocationTab('map')}
                className={tabClasses(locationTab === 'map')}
              >
                From map
              </button>
              <button
                type="button"
                onClick={() => setLocationTab('manual')}
                className={tabClasses(locationTab === 'manual')}
              >
                Enter manually
              </button>
            </div>

            {locationTab === 'map' ? (
              <div className="flex flex-col gap-3 p-3">
                <MapFieldButton
                  color="bg-green-600"
                  label="Origin city"
                  value={form.pickup}
                  onClick={() => setMapOpenFor('pickup')}
                />
                <MapFieldButton
                  color="bg-orange-600"
                  label="Destination city"
                  value={form.delivery}
                  onClick={() => setMapOpenFor('delivery')}
                />
              </div>
            ) : (
              <div className="grid gap-3 p-3">
                <LocationPicker
                  label="Origin"
                  value={form.pickup}
                  onChange={(value) => setField('pickup', value)}
                  hideMapPicker
                />

                <LocationPicker
                  label="Destination"
                  value={form.delivery}
                  onChange={(value) => setField('delivery', value)}
                  hideMapPicker
                />
              </div>
            )}
          </div>

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
