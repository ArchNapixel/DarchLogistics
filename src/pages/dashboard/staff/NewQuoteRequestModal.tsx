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
//
// Layout mirrors the customer wizard's look: numbered sections on the
// left, a live summary (same QuoteSummary as the landing page) on the
// right, and a confirmation with the Q-XXXXXX reference code after saving.
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import {
  CargoFields,
  Field,
  RouteFields,
  ScheduleFields,
  TextInput,
} from '../../../components/QuoteShipmentFields'
import { QuoteSummary } from '../../../components/QuoteSummary'
import QuoteSummaryDrawer from '../../../components/QuoteSummaryDrawer'
import {
  buildQuoteRow,
  emailError,
  phoneError,
  useShipmentForm,
  useSummaryDrawer,
  type ShipmentForm,
} from '../../../lib/quoteRequest'

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

// Segmented toggle, same look as the Cargo step's toggles.
const toggleClasses = (active: boolean) =>
  `flex-1 border px-3 py-2 text-sm font-medium transition-colors [&:not(:first-child)]:-ml-px ${
    active
      ? 'relative border-slate-900 bg-slate-900 text-white'
      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
  }`

function Section({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: ReactNode
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <span className="flex h-6 w-6 items-center justify-center bg-slate-900 text-xs font-semibold text-white">
          {number}
        </span>
        {title}
      </h3>
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
  const { form, setField, errors, setErrors, reset } = useShipmentForm()
  const summaryDrawer = useSummaryDrawer(form)
  // Set once saved: shows the confirmation instead of the form.
  const [created, setCreated] = useState<{
    code: string
    form: ShipmentForm
    contactLine: string
  } | null>(null)
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
      foundClientErrors.existingClient = 'Select a client.'
    }
    if (clientMode === 'new') {
      if (!clientFields.clientName.trim()) foundClientErrors.clientName = 'Enter a name.'
      const phone = phoneError(clientFields.contactNumber)
      if (phone) foundClientErrors.contactNumber = phone
      const email = emailError(clientFields.contactEmail)
      if (email) foundClientErrors.contactEmail = email
    }
    setClientErrors(foundClientErrors)

    const result = buildQuoteRow(form)
    if (result.errors) setErrors(result.errors)

    if (result.errors || Object.keys(foundClientErrors).length > 0) {
      setError('Fix the highlighted fields.')
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

    setCreated({
      code: result.row.reference_code,
      form,
      contactLine:
        [
          linkedClient ? linkedClient.client_name : clientFields.clientName.trim(),
          linkedClient ? linkedClient.phone_number : clientFields.contactNumber.trim(),
        ]
          .filter(Boolean)
          .join(' · '),
    })
  }

  // Back to a blank form for the next phone-in, without closing.
  function addAnother() {
    reset()
    setClientFields(emptyClientFields)
    setClientErrors({})
    setSelectedClientId('')
    setClientMode('new')
    setCreated(null)
  }

  const sectionProps = { form, setField, errors }

  const shell = (children: ReactNode) => (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-4 sm:items-center">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col bg-white shadow-lg">{children}</div>
    </div>
  )

  const header = (title: string, onCloseClick: () => void) => (
    <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <button
        type="button"
        onClick={onCloseClick}
        aria-label="Close"
        className="p-1 text-slate-400 hover:text-slate-700"
      >
        ✕
      </button>
    </div>
  )

  if (created) {
    return shell(
      <>
        {header('Quote created', onCreated)}
        <div className="overflow-y-auto px-6 py-6" role="status">
          <p className="text-sm text-slate-600">
            Reference{' '}
            <span className="font-mono text-base font-semibold tracking-wider text-slate-900">
              {created.code}
            </span>
            {' · '}
            {created.contactLine}
          </p>
          <div className="mt-4 max-w-md border border-slate-200 bg-slate-50 p-4">
            <QuoteSummary form={created.form} />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={addAnother}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Add another
          </button>
          <button
            type="button"
            onClick={onCreated}
            className="bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Done
          </button>
        </div>
      </>,
    )
  }

  return shell(
    <>
      {header('New quote', onClose)}

      <div className="grid min-h-0 flex-1 gap-8 overflow-y-auto px-6 py-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-8">
          {error && (
            <p className="bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <Section number={1} title="Client">
            <div className="col-span-full flex">
              <button
                type="button"
                aria-pressed={clientMode === 'existing'}
                onClick={() => setClientMode('existing')}
                className={toggleClasses(clientMode === 'existing')}
              >
                Existing
              </button>
              <button
                type="button"
                aria-pressed={clientMode === 'new'}
                onClick={() => setClientMode('new')}
                className={toggleClasses(clientMode === 'new')}
              >
                New
              </button>
            </div>

            {clientMode === 'existing' ? (
              <>
                {clientsError && (
                  <p className="col-span-full text-sm text-red-700">{clientsError}</p>
                )}
                <Field label="Client" error={clientErrors.existingClient} wide>
                  <select
                    value={selectedClientId}
                    onChange={(e) => {
                      setSelectedClientId(e.target.value)
                      setClientErrors((prev) => ({ ...prev, existingClient: undefined }))
                    }}
                    aria-invalid={clientErrors.existingClient ? true : undefined}
                    className={`border bg-white px-3 py-2 text-slate-900 focus:outline-none ${
                      clientErrors.existingClient
                        ? 'border-red-400'
                        : 'border-slate-300 focus:border-slate-500'
                    }`}
                  >
                    <option value="">Select</option>
                    {clients.map((client) => (
                      <option key={client.client_id} value={client.client_id}>
                        {client.client_name}
                      </option>
                    ))}
                  </select>
                </Field>
                {selectedClient && (
                  <p className="col-span-full text-xs text-slate-500">
                    {selectedClient.phone_number ?? 'No phone on file'}
                    {' · '}
                    {selectedClient.email ?? 'No email on file'}
                  </p>
                )}
              </>
            ) : (
              <>
                <Field label="Name or company" error={clientErrors.clientName}>
                  <TextInput
                    type="text"
                    value={clientFields.clientName}
                    onChange={(e) => setClientField('clientName', e.target.value)}
                    invalid={!!clientErrors.clientName}
                  />
                </Field>
                <Field label="Phone number" error={clientErrors.contactNumber}>
                  <TextInput
                    type="tel"
                    value={clientFields.contactNumber}
                    onChange={(e) => setClientField('contactNumber', e.target.value)}
                    placeholder="0917 123 4567"
                    invalid={!!clientErrors.contactNumber}
                  />
                </Field>
                <Field label="Email" hint="(optional)" error={clientErrors.contactEmail} wide>
                  <TextInput
                    type="email"
                    value={clientFields.contactEmail}
                    onChange={(e) => setClientField('contactEmail', e.target.value)}
                    placeholder="name@company.com"
                    invalid={!!clientErrors.contactEmail}
                  />
                </Field>
              </>
            )}
          </Section>

          <Section number={2} title="Route">
            <RouteFields {...sectionProps} />
          </Section>

          <Section number={3} title="Cargo">
            <CargoFields {...sectionProps} />
          </Section>

          <Section number={4} title="Schedule">
            <ScheduleFields {...sectionProps} />
          </Section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-0 border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-semibold text-slate-900">Summary</p>
            <QuoteSummary form={form} />
          </div>
        </aside>
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
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
          className="bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create quote'}
        </button>
      </div>

      <QuoteSummaryDrawer open={summaryDrawer.open} form={form} onClose={summaryDrawer.dismiss} />
    </>,
  )
}

export default NewQuoteRequestModal
