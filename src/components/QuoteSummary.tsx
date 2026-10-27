// QuoteSummary: a read-only recap of a quote's shipment fields -- used
// as the live side panel while the customer steps through QuoteWizard,
// as the Review step itself (with "Edit" links back to each step), and
// on the confirmation screen after submitting (QuoteSubmitted).
import type { ReactNode } from 'react'
import { formatLocationDisplay } from '../lib/locationReference'
import {
  PAYMENT_TERMS_LABELS,
  totalTrips,
  type LocationValue,
  type ShipmentForm,
} from '../lib/quoteRequest'
import { formatDate } from '../lib/format'

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
  // With an Edit button (the Review step) each part is its own box, as on
  // the canvas; otherwise a compact list (side summary, sent screen).
  if (onEdit) {
    return (
      <section aria-label={title} className="mb-3 border border-line last:mb-0">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-slate-50 px-4 py-2">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <button type="button" onClick={onEdit} aria-label={`Edit ${title}`} className="btn-secondary px-3.5 text-sm font-medium">
            Edit
          </button>
        </div>
        <div className="flex flex-col gap-1 px-4 py-3 text-sm text-ink-metric">{children}</div>
      </section>
    )
  }
  return (
    <div className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
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
          <Muted>—</Muted>
        )}
        {chosen && location.landmark.trim() && (
          <span className="block text-xs text-slate-500">Landmark: {location.landmark.trim()}</span>
        )}
        {chosen && location.lat !== null && (
          <span className="block text-xs text-green-700">Pinned</span>
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
  const count = totalTrips(form.cargoLines)
  const hasCount = Number.isInteger(count) && count > 0

  return (
    <div>
      <Section title="Route" onEdit={onEditStep && (() => onEditStep('route'))}>
        <Stop letter="A" location={form.pickup} />
        <Stop letter="B" location={form.delivery} />
      </Section>

      <Section title="Cargo" onEdit={onEditStep && (() => onEditStep('cargo'))}>
        {form.cargoLines.map((line, index) => (
          <span key={index}>
            {Number(line.quantity) > 0 ? `${line.quantity} × ` : ''}
            {line.cargoType === 'Loose' ? 'Loose cargo' : 'Container'} · {line.containerType}
            {line.trailerType && ` ${line.trailerType.toLowerCase()}`} trailer
            {Number(line.weight) > 0 && ` · ${line.weight} t`}
            {line.descriptions.some((d) => d.trim()) && (
              <span className="block text-slate-600">
                {Array.from(new Set(line.descriptions.map((d) => d.trim()).filter(Boolean))).join(' · ')}
              </span>
            )}
          </span>
        ))}
        {hasCount ? (
          <span className="font-medium">
            {count} {count === 1 ? 'trip' : 'trips'} in total
          </span>
        ) : (
          <Muted>—</Muted>
        )}
      </Section>

      <Section title="Schedule" onEdit={onEditStep && (() => onEditStep('schedule'))}>
        <span>
          Pickup:{' '}
          {form.preferredPickupDate ? formatDate(form.preferredPickupDate) : <Muted>—</Muted>}
          {form.isLastDayOfPortStorage === 'Yes' && (
            <span className="font-medium text-amber-700"> · Urgent, last free storage day</span>
          )}
        </span>
        <span>
          Deadline:{' '}
          {form.preferredDeliveryDate ? (
            formatDate(form.preferredDeliveryDate)
          ) : (
            <Muted>—</Muted>
          )}
        </span>
        <span>Payment: {PAYMENT_TERMS_LABELS[form.paymentTerms]}</span>
        {/* No price here: Darch Logistics sends the rate as an offer. */}
        <span className="mt-1 border-t border-dashed border-slate-200 pt-2 text-slate-600">
          Rate: we'll send you our offer
        </span>
      </Section>
    </div>
  )
}

// The screen shown in place of the form once a quote is in (the canvas's
// "Quote request sent" board): the reference code, "Waiting for our
// price", the route and trips, what happens next, and one or two buttons.
export function QuoteSubmitted({
  referenceCode,
  form,
  contactLine,
  nextSteps,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
}: {
  referenceCode: string
  form: ShipmentForm
  // e.g. "Juan Dela Cruz · 0917 123 4567", shown so they can spot a typo.
  contactLine: string
  nextSteps: string[]
  actionLabel: string
  onAction: () => void
  // Optional second (outlined) button, e.g. "Back to Home".
  secondaryLabel?: string
  onSecondary?: () => void
}) {
  const trips = totalTrips(form.cargoLines)
  return (
    <section aria-labelledby="sent-h" className="card mx-auto max-w-[760px]" role="status">
      <div className="flex items-start gap-3 border-b border-line px-6 py-5">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center bg-green-700 text-white">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        </span>
        <div>
          <h3 id="sent-h" className="text-xl leading-7 font-bold text-ink">
            Quote request sent
          </h3>
          <p className="mt-0.5 text-sm text-ink-secondary">We'll send our price to My Quotes. Keep the reference code if you call us.</p>
        </div>
      </div>

      <div className="flex flex-col gap-5 px-6 py-5">
        <div className="border border-line bg-slate-50 px-4 py-3">
          <p className="text-[13px] font-medium text-ink-muted">Your reference</p>
          <p className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-2xl font-bold tracking-wider text-ink">{referenceCode}</span>
            <span className="rounded-[2px] bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Waiting for our price</span>
          </p>
          <p className="mt-2 text-sm text-ink-metric">
            {formatLocationDisplay(form.pickup)} → {formatLocationDisplay(form.delivery)}
          </p>
          <p className="text-[13px] text-ink-muted">
            {trips} {trips === 1 ? 'trip' : 'trips'}
            {form.preferredPickupDate ? ` · Pickup ${formatDate(form.preferredPickupDate)}` : ''}
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-ink">What happens next</p>
          <ol className="mt-2 flex flex-col gap-2 text-sm text-ink-secondary">
            {nextSteps.map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="font-semibold text-ink">{index + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-ink-secondary">
            We'll contact you at <span className="font-medium text-ink">{contactLine}</span>.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">
        {secondaryLabel && onSecondary && (
          <button type="button" onClick={onSecondary} className="btn-secondary px-5 text-sm font-medium">
            {secondaryLabel}
          </button>
        )}
        <button type="button" onClick={onAction} className="btn-primary px-5 text-sm">
          {actionLabel}
        </button>
      </div>
    </section>
  )
}
