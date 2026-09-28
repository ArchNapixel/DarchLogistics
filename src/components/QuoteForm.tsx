// QuoteForm: the public "Get a Quote" form. Anyone can submit this without
// logging in. It's the shared QuoteWizard (Route -> Cargo -> Schedule
// & terms -> Review) plus the contact fields only the public form
// needs, shown on the Review step. On submit it inserts a new row into
// quote_requests with request_status = 'Pending' and a reference code,
// then shows the confirmation screen. Staff review it later from the
// dashboard.
import { useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabaseClient'
import QuoteWizard from './QuoteWizard'
import { Field, TextInput } from './QuoteShipmentFields'
import { QuoteSubmitted } from './QuoteSummary'
import { buildQuoteRow, useShipmentForm } from '../lib/quoteRequest'

type Contact = { clientName: string; contactNumber: string; contactEmail: string }
type ContactErrors = Partial<Record<keyof Contact, string>>

const emptyContact: Contact = { clientName: '', contactNumber: '', contactEmail: '' }

function validateContact(contact: Contact): ContactErrors {
  const errors: ContactErrors = {}
  if (!contact.clientName.trim()) {
    errors.clientName = 'Enter your name or company name.'
  }
  const digits = contact.contactNumber.replace(/[\s()-]/g, '')
  if (!digits) {
    errors.contactNumber = 'Enter a number we can call you on.'
  } else if (!/^\+?\d{7,13}$/.test(digits)) {
    errors.contactNumber = 'Enter a valid phone number, e.g. 0917 123 4567.'
  }
  if (contact.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.contactEmail.trim())) {
    errors.contactEmail = 'Enter a valid email address, or leave it blank.'
  }
  return errors
}

function QuoteForm({
  aside,
  nextSteps,
}: {
  // Page-level side content shown under the live summary.
  aside?: ReactNode
  // "What happens next" list for the confirmation screen.
  nextSteps: string[]
}) {
  const { form, setField, errors, setErrors, reset } = useShipmentForm()
  const [contact, setContact] = useState<Contact>(emptyContact)
  const [contactErrors, setContactErrors] = useState<ContactErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [referenceCode, setReferenceCode] = useState<string | null>(null)

  function setContactField(name: keyof Contact, value: string) {
    setContact((prev) => ({ ...prev, [name]: value }))
    setContactErrors((prev) => ({ ...prev, [name]: undefined }))
  }

  function checkContact() {
    const found = validateContact(contact)
    setContactErrors(found)
    return Object.keys(found).length === 0
  }

  async function handleSubmit() {
    setSubmitError(null)
    const result = buildQuoteRow(form)
    if (result.errors) {
      setErrors(result.errors)
      return
    }

    setSubmitting(true)
    const { error: insertError } = await supabase.from('quote_requests').insert({
      ...result.row,
      client_name: contact.clientName.trim(),
      contact_number: contact.contactNumber.trim(),
      contact_email: contact.contactEmail.trim() || null,
    })
    setSubmitting(false)

    if (insertError) {
      // Keep the user's input in place so they don't have to retype it.
      // The raw database message isn't meant for the public -- log it,
      // show something they can act on.
      console.error(insertError)
      setSubmitError(
        "We couldn't send your request. Please try again, or call dispatch at 0966 047 5467.",
      )
      return
    }

    setReferenceCode(result.row.reference_code)
  }

  if (referenceCode) {
    return (
      <QuoteSubmitted
        referenceCode={referenceCode}
        form={form}
        contactLine={[contact.contactNumber.trim(), contact.contactEmail.trim()]
          .filter(Boolean)
          .join(' or ')}
        nextSteps={nextSteps}
        actionLabel="Request another quote"
        onAction={() => {
          reset()
          setContact(emptyContact)
          setReferenceCode(null)
        }}
      />
    )
  }

  return (
    <QuoteWizard
      form={form}
      setField={setField}
      errors={errors}
      setErrors={setErrors}
      validateContact={checkContact}
      onSubmit={handleSubmit}
      submitting={submitting}
      submitError={submitError}
      submitLabel="Send quote request"
      aside={aside}
      contactSection={
        <div className="grid gap-4 border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <p className="text-sm font-semibold text-slate-900 sm:col-span-2">
            Where should we send the quote?
          </p>
          <Field label="Name or company" error={contactErrors.clientName}>
            <TextInput
              type="text"
              autoComplete="organization"
              value={contact.clientName}
              onChange={(e) => setContactField('clientName', e.target.value)}
              invalid={!!contactErrors.clientName}
            />
          </Field>
          <Field label="Phone number" error={contactErrors.contactNumber}>
            <TextInput
              type="tel"
              autoComplete="tel"
              value={contact.contactNumber}
              onChange={(e) => setContactField('contactNumber', e.target.value)}
              placeholder="0917 123 4567"
              invalid={!!contactErrors.contactNumber}
            />
          </Field>
          <Field label="Email" hint="(optional)" error={contactErrors.contactEmail} wide>
            <TextInput
              type="email"
              autoComplete="email"
              value={contact.contactEmail}
              onChange={(e) => setContactField('contactEmail', e.target.value)}
              placeholder="name@company.com"
              invalid={!!contactErrors.contactEmail}
            />
          </Field>
        </div>
      }
    />
  )
}

export default QuoteForm
