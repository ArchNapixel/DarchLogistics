// NewQuoteRequestModal: lets staff log a quote request on a client's
// behalf (e.g. a phone-in booking). Everything on one page (staff are
// usually on the phone, so no wizard steps), using the same field
// sections, validation, and quote_requests column mapping as the public
// and client channels (components/QuoteShipmentFields.tsx +
// lib/quoteRequest.ts), inserting with request_status 'Pending'. It then
// goes through the exact same Review/Approve flow as any other quote
// (QuoteReviewModal), instead of a separate manual-booking path -- keeps
// one tested path for turning a quote into a booking + itineraries, no
// matter who submitted it.
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  CargoFields,
  Field,
  RouteFields,
  ScheduleFields,
  TextInput,
} from '../../../components/QuoteShipmentFields'
import { buildQuoteRow, emailError, phoneError, useShipmentForm } from '../../../lib/quoteRequest'

type ClientFields = {
  clientName: string
  contactNumber: string
  contactEmail: string
}

type ClientErrors = Partial<Record<keyof ClientFields | 'existingClient', string>>

const emptyClientFields: ClientFields = {
  clientName: '',
  contactNumber: '',
  contactEmail: '',
}

type ExistingClient = {
  client_id: number
  client_name: string
  email: string | null
  phone_number: string | null
}

const tabClasses = (active: boolean) =>
  `px-4 py-2 text-sm font-medium ${
    active
      ? 'border-b-2 border-slate-900 text-slate-900'
      : 'text-slate-500 hover:text-slate-700'
  }`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function NewQuoteRequestModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const { form, setField, errors, setErrors } = useShipmentForm()
  const [clientFields, setClientFields] = useState<ClientFields>(emptyClientFields)
  const [clientErrors, setClientErrors] = useState<ClientErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  function setClientField(name: keyof ClientFields, value: string) {
    setClientFields((prev) => ({ ...prev, [name]: value }))
    setClientErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  // Brings the first highlighted field into view -- on one long page
  // it may be well above or below where staff clicked Create.
  function scrollToFirstError() {
    requestAnimationFrame(() => {
      document
        .querySelector('[aria-invalid="true"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  async function handleSubmit() {
    setError(null)

    const foundClientErrors: ClientErrors = {}
    if (clientMode === 'existing' && !selectedClient) {
      foundClientErrors.existingClient = 'Choose a client, or switch to "New client".'
    }
    if (clientMode === 'new') {
      if (!clientFields.clientName.trim()) foundClientErrors.clientName = 'Enter the client name.'
      const phone = phoneError(clientFields.contactNumber)
      if (phone) foundClientErrors.contactNumber = phone
      const email = emailError(clientFields.contactEmail)
      if (email) foundClientErrors.contactEmail = email
    }
    setClientErrors(foundClientErrors)

    const result = buildQuoteRow(form)
    if (result.errors) setErrors(result.errors)

    if (result.errors || Object.keys(foundClientErrors).length > 0) {
      setError('Some details are missing or need fixing. They are highlighted below.')
      scrollToFirstError()
      return
    }

    setSubmitting(true)

    // An existing client's own record is the source of truth for these
    // three -- they're still copied onto the quote row so every list
    // that reads quote_requests.client_name keeps working unchanged.
    // Only used when the "Existing client" tab is actually the active
    // one, so a client picked and then abandoned for "New client" can't
    // leak into the insert.
    const linkedClient = clientMode === 'existing' ? selectedClient : undefined
    const { error: insertError } = await supabase.from('quote_requests').insert({
      ...result.row,
      client_id: linkedClient ? linkedClient.client_id : null,
      client_name: linkedClient ? linkedClient.client_name : clientFields.clientName.trim(),
      contact_number: linkedClient
        ? linkedClient.phone_number
        : clientFields.contactNumber.trim() || null,
      contact_email: linkedClient
        ? linkedClient.email
        : clientFields.contactEmail.trim() || null,
    })

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onCreated()
  }

  const sectionProps = { form, setField, errors }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">New quote request</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-6">
          <Section title="Client">
            <div className="col-span-full border border-slate-200">
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
                  <Field label="Client" error={clientErrors.existingClient}>
                    <select
                      value={selectedClientId}
                      onChange={(e) => {
                        setSelectedClientId(e.target.value)
                        setClientErrors((prev) => ({ ...prev, existingClient: undefined }))
                      }}
                      aria-invalid={clientErrors.existingClient ? true : undefined}
                      className={`border bg-white px-3 py-2 text-slate-900 focus:outline-none ${
                        clientErrors.existingClient ? 'border-red-400' : 'border-slate-300 focus:border-slate-500'
                      }`}
                    >
                      <option value="">Choose a client</option>
                      {clients.map((client) => (
                        <option key={client.client_id} value={client.client_id}>
                          {client.client_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {selectedClient && (
                    <p className="text-xs text-slate-500">
                      {selectedClient.phone_number ?? 'No phone on file'}
                      {' · '}
                      {selectedClient.email ?? 'No email on file'}
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 p-3 sm:grid-cols-2">
                  <Field label="Client name" error={clientErrors.clientName}>
                    <TextInput
                      type="text"
                      value={clientFields.clientName}
                      onChange={(e) => setClientField('clientName', e.target.value)}
                      invalid={!!clientErrors.clientName}
                    />
                  </Field>
                  <Field label="Contact number" error={clientErrors.contactNumber}>
                    <TextInput
                      type="tel"
                      value={clientFields.contactNumber}
                      onChange={(e) => setClientField('contactNumber', e.target.value)}
                      invalid={!!clientErrors.contactNumber}
                    />
                  </Field>
                  <Field label="Email" hint="(optional)" error={clientErrors.contactEmail} wide>
                    <TextInput
                      type="email"
                      value={clientFields.contactEmail}
                      onChange={(e) => setClientField('contactEmail', e.target.value)}
                      invalid={!!clientErrors.contactEmail}
                    />
                  </Field>
                </div>
              )}
            </div>
          </Section>

          <Section title="Route">
            <RouteFields {...sectionProps} />
          </Section>

          <Section title="Cargo">
            <CargoFields {...sectionProps} />
          </Section>

          <Section title="Schedule & terms">
            <ScheduleFields {...sectionProps} />
          </Section>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create quote request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewQuoteRequestModal
