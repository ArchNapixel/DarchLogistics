// NewQuoteModal: lets a logged-in client submit a quote request from
// their own portal, instead of only through the public form or staff
// logging it on their behalf. Uses the same step-by-step QuoteWizard as
// the public form (shared fields/validation/column mapping in
// lib/quoteRequest.ts), then goes through the same Review/Approve flow
// as any other quote.
//
// Unlike the public form, this version does NOT ask for client
// name/contact number/email -- the client already has these on file
// (`clients`, looked up via clientId), so re-typing them here would be
// redundant. They're loaded once on open and shown read-only on the
// Review step; if they can't be loaded (missing name/phone on the
// account), submission is blocked with a message to contact support
// instead of silently sending a blank name/number. client_id is also
// set directly on the insert so Approve doesn't have to re-match by
// email. The client's own past pickup/delivery spots are offered as
// one-click picks on the Route step.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import QuoteWizard from '../../../components/QuoteWizard'
import { QuoteSubmitted } from '../../../components/QuoteSummary'
import {
  buildQuoteRow,
  loadRecentLocations,
  useShipmentForm,
  type RecentLocation,
} from '../../../lib/quoteRequest'

type ContactInfo = {
  clientName: string
  contactNumber: string
  contactEmail: string
}

function NewQuoteModal({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: number
  onClose: () => void
  onCreated: () => void
}) {
  const { form, setField, errors, setErrors } = useShipmentForm()
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)
  const [contactInfoError, setContactInfoError] = useState<string | null>(null)
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [referenceCode, setReferenceCode] = useState<string | null>(null)

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto bg-slate-50 p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Request a quote</h2>
          <button
            type="button"
            onClick={referenceCode ? onCreated : onClose}
            aria-label="Close"
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {referenceCode && contactInfo ? (
          <QuoteSubmitted
            referenceCode={referenceCode}
            form={form}
            contactLine={[contactInfo.contactNumber, contactInfo.contactEmail]
              .filter(Boolean)
              .join(' or ')}
            nextSteps={[
              'We review your route, cargo and rate.',
              "We'll contact you if anything changes.",
              'Once approved, it appears in My Bookings.',
            ]}
            actionLabel="Done"
            onAction={onCreated}
          />
        ) : (
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
            submitLabel="Send"
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
        )}
      </div>
    </div>
  )
}

export default NewQuoteModal
