// QuoteSummary: a read-only recap of a quote's shipment fields -- used
// as the live side panel while the customer steps through QuoteWizard,
// as the Review step itself (with "Edit" links back to each step), and
// on the confirmation screen after submitting (QuoteSubmitted).
import type { ReactNode } from 'react'
import { formatLocationDisplay } from '../lib/locationReference'
import {
  PAYMENT_TERMS_LABELS,
  formatDate,
  type LocationValue,
  type ShipmentForm,
} from '../lib/quoteRequest'

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-slate-400">{children}</span>
}

function Section({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit?: () => void
  children: ReactNode
}) {
  return (
    <div className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
          >
            Edit
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-col gap-1 text-sm text-slate-800">{children}</div>
    </div>
  )
}

function Stop({ letter, location }: { letter: 'A' | 'B'; location: LocationValue }) {
  const chosen = location.city && location.barangay
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[10px] font-bold text-white ${
          letter === 'A' ? 'bg-brand-steel' : 'bg-brand-navy'
        }`}
      >
        {letter}
      </span>
      <span>
        <span className="sr-only">{letter === 'A' ? 'Pickup: ' : 'Delivery: '}</span>
        {chosen ? (
          formatLocationDisplay(location)
        ) : (
          <Muted>{letter === 'A' ? 'Pickup not set' : 'Delivery not set'}</Muted>
        )}
        {chosen && location.lat !== null && (
          <span className="block text-xs text-green-700">Exact spot pinned</span>
        )}
      </span>
    </div>
  )
}

export function QuoteSummary({
  form,
  onEditStep,
}: {
  form: ShipmentForm
  // When given, each section gets an "Edit" link back to its step.
  onEditStep?: (step: 'route' | 'cargo' | 'schedule') => void
}) {
  const count = Number(form.deliveryOrderCount)
  const rate = Number(form.proposedRate)
  const hasCount = Number.isInteger(count) && count > 0
  const hasRate = rate > 0

  return (
    <div>
      <Section title="Route" onEdit={onEditStep && (() => onEditStep('route'))}>
        <Stop letter="A" location={form.pickup} />
        <Stop letter="B" location={form.delivery} />
      </Section>

      <Section title="Cargo" onEdit={onEditStep && (() => onEditStep('cargo'))}>
        <span>
          {form.cargoType === 'Loose' ? 'Loose cargo' : 'Container'} · {form.containerType} trailer
          {Number(form.weight) > 0 && ` · ${form.weight} t`}
        </span>
        {hasCount && (
          <span>
            {count} {count === 1 ? 'delivery' : 'deliveries'}
          </span>
        )}
        {form.cargoDescription.trim() ? (
          <span className="text-slate-600">{form.cargoDescription.trim()}</span>
        ) : (
          <Muted>No description yet</Muted>
        )}
      </Section>

      <Section title="Schedule & terms" onEdit={onEditStep && (() => onEditStep('schedule'))}>
        <span>
          Pickup:{' '}
          {form.preferredPickupDate ? formatDate(form.preferredPickupDate) : <Muted>not set</Muted>}
        </span>
        <span>
          Delivery:{' '}
          {form.isLastDayOfPortStorage === 'Yes' ? (
            <span className="font-medium text-amber-700">Priority, dispatch will call</span>
          ) : form.preferredDeliveryDate ? (
            formatDate(form.preferredDeliveryDate)
          ) : (
            <Muted>not set</Muted>
          )}
        </span>
        <span>Payment: {PAYMENT_TERMS_LABELS[form.paymentTerms]}</span>
        {hasRate && (
          <span className="mt-1 flex items-baseline justify-between border-t border-dashed border-slate-200 pt-2">
            <span className="text-slate-600">
              ₱{rate.toLocaleString('en-PH')} × {hasCount ? count : 1}
            </span>
            <span className="text-base font-semibold text-slate-900">
              ₱{(rate * (hasCount ? count : 1)).toLocaleString('en-PH')}
            </span>
          </span>
        )}
      </Section>
    </div>
  )
}

// The screen shown in place of the form once a quote is in.
export function QuoteSubmitted({
  referenceCode,
  form,
  contactLine,
  nextSteps,
  actionLabel,
  onAction,
}: {
  referenceCode: string
  form: ShipmentForm
  // e.g. "Juan Dela Cruz · 0917 123 4567", shown so they can spot a typo.
  contactLine: string
  nextSteps: string[]
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="border border-slate-200 bg-white p-6 sm:p-8" role="status">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center bg-green-600 text-white"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <div>
          <h3 className="text-xl font-semibold text-slate-900">Quote request received</h3>
          <p className="mt-1 text-sm text-slate-600">
            Your reference number is{' '}
            <span className="font-mono text-base font-semibold tracking-wider text-slate-900">
              {referenceCode}
            </span>
            . Mention it if you call us about this request.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            What happens next
          </p>
          <ol className="mt-2 flex flex-col gap-2 text-sm text-slate-700">
            {nextSteps.map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="font-semibold text-slate-900">{index + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-slate-600">
            We'll reach you at <span className="font-medium text-slate-900">{contactLine}</span>.
          </p>
        </div>
        <div className="border border-slate-200 bg-slate-50 p-4">
          <QuoteSummary form={form} />
        </div>
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={onAction}
          className="bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
