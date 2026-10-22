// ClientQuoteForm: the quote form for a logged-in client -- the shared
// step-by-step QuoteWizard (fields/validation/column mapping in
// lib/quoteRequest.ts) plus the confirmation screen. Used in three places:
// the /quote-request page, the portal's NewQuoteModal, and "Edit &
// resubmit" on a rejected quote (also via NewQuoteModal).
//
// It does NOT ask for client name/contact number/email -- the client
// already has these on file (`clients`, looked up via clientId). They're
// loaded once and shown read-only on the Review step; if they can't be
// loaded (missing name/phone on the account), submission is blocked with
// a message instead of silently sending a blank name/number. client_id is
// set directly on the insert so Approve doesn't have to re-match by
// email. The client's own past pickup/delivery spots are offered as
// one-click picks on the Route step.
//
// Resubmit mode (`resubmit` set): the form starts filled with the
// rejected quote, and Send calls the resubmit_quote_request database
// function instead of inserting -- same row, same reference code, back
// to Pending (SQL given in chat).
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import QuoteWizard from '../../../components/QuoteWizard'
import { QuoteSubmitted } from '../../../components/QuoteSummary'
import {
  buildQuoteRow,
  loadRecentLocations,
  useShipmentForm,
  type RecentLocation,
  type ShipmentForm,
} from '../../../lib/quoteRequest'

type ContactInfo = {
  clientName: string
  contactNumber: string
  contactEmail: string
}

export type ResubmitTarget = {
  quoteId: number
  referenceCode: string | null
  form: ShipmentForm
}

function ClientQuoteForm({
  clientId,
  resubmit,
  nextSteps,
  aside,
  actionLabel,
  onDone,
}: {
  clientId: number
  resubmit?: ResubmitTarget
  nextSteps: string[]
  // Side content shown under the live summary (page version only).
  aside?: ReactNode
  // Button on the confirmation screen, and what it does.
  actionLabel: string
  onDone: () => void
}) {
  const { form, setField, errors, setErrors } = useShipmentForm(resubmit?.form)
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)
  const [contactInfoError, setContactInfoError] = useState<string | null>(null)
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [referenceCode, setReferenceCode] = useState<string | null>(null)

  // Load the client's contact info once -- submission is blocked (not
  // just left blank) if this fails or the account is missing a name/phone.
  useEffect(() => {
    async function loadContactInfo() {
      const { data, error: loadError } = await supabase
        .from('clients')
        .select('client_name, email, phone_number')
        .eq('client_id', clientId)
        .maybeSingle()

      if (loadError) {
        console.error(loadError)
        setContactInfoError("We couldn't load your account details. Refresh the page and try again.")
        return
      }

      if (!data || !data.client_name || !data.phone_number) {
        setContactInfoError(
          'Your account is missing a name or phone number. Contact us to update it before requesting a quote.',
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
    loadRecentLocations(clientId).then(setRecentLocations)
  }, [clientId])

  function checkContact() {
    if (contactInfo) return true
    setSubmitError(contactInfoError ?? 'Your account details are still loading. Try again in a moment.')
    return false
  }

  async function handleSubmit() {
    setSubmitError(null)
    if (!contactInfo) return

    const result = buildQuoteRow(form)
    if (result.errors) {
      setErrors(result.errors)
      return
    }

    setSubmitting(true)

    if (resubmit) {
      // Only the shipment fields go up -- the quote keeps its reference
      // code, and the database function sets the status back to Pending.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { reference_code, request_status, ...changes } = result.row
      const { error: rpcError } = await supabase.rpc('resubmit_quote_request', {
        p_quote_id: resubmit.quoteId,
        p_changes: changes,
      })
      setSubmitting(false)
      if (rpcError) {
        console.error(rpcError)
        setSubmitError("We couldn't resubmit your request. Refresh the page and try again.")
        return
      }
      setReferenceCode(resubmit.referenceCode ?? `Quote #${resubmit.quoteId}`)
      return
    }

    const { error: insertError } = await supabase.from('quote_requests').insert({
      ...result.row,
      client_id: clientId,
      client_name: contactInfo.clientName,
      contact_number: contactInfo.contactNumber,
      contact_email: contactInfo.contactEmail || null,
    })
    setSubmitting(false)

    if (insertError) {
      // The raw database message isn't meant for clients -- log it for
      // us, show them something they can act on.
      console.error(insertError)
      setSubmitError("We couldn't send your request. Please try again, or contact us if it keeps happening.")
      return
    }

    setReferenceCode(result.row.reference_code)
  }

  if (referenceCode && contactInfo) {
    return (
      <QuoteSubmitted
        referenceCode={referenceCode}
        form={form}
        contactLine={[contactInfo.contactNumber, contactInfo.contactEmail]
          .filter(Boolean)
          .join(' or ')}
        nextSteps={nextSteps}
        actionLabel={actionLabel}
        onAction={onDone}
      />
    )
  }

  return (
    <QuoteWizard
      form={form}
      setField={setField}
      errors={errors}
      setErrors={setErrors}
      recentLocations={recentLocations}
      validateContact={checkContact}
      onSubmit={handleSubmit}
      submitting={submitting}
      submitError={submitError}
      submitLabel={resubmit ? 'Resubmit' : 'Send'}
      aside={aside}
      contactSection={
        <p className="border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {contactInfo ? (
            <>
              Sending as{' '}
              <span className="font-medium text-slate-900">{contactInfo.clientName}</span>
              {' · '}
              {contactInfo.contactNumber}
              {contactInfo.contactEmail ? ` · ${contactInfo.contactEmail}` : ''}
            </>
          ) : (
            (contactInfoError ?? 'Loading your account details…')
          )}
        </p>
      }
    />
  )
}

export default ClientQuoteForm
