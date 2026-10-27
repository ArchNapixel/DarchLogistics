// QuoteWizard: the step-by-step quote form customers see --
// ClientQuoteForm (the /quote-request page and the portal). Route -> Cargo ->
// Schedule & terms -> Review, with a live summary beside the steps on
// wide screens. Each "Continue" only checks the current step's fields
// (errors show under each field); Submit re-checks everything and jumps
// back to the first step with a problem. Staff don't use this -- they
// log phone-in quotes on one page (NewQuoteRequestModal) with the same
// field sections.
//
// Look (2026-10-27, the canvas's Client "New Quote Request" boards): a
// step bar (done steps ticked "Done"), the step inside a card, a "Fix N
// things before you continue" box listing that step's problems, and a
// footer with Cancel (when onCancel is given), ‹ Back and "Next: <step> ›".
//
// The wizard owns only which step is showing. Form state/errors come
// from the parent (useShipmentForm in lib/quoteRequest.ts), and the
// parent does the actual insert in onSubmit, since each channel adds
// different client/contact columns.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CargoFields, RouteFields, ScheduleFields, type SectionProps } from './QuoteShipmentFields'
import { QuoteSummary } from './QuoteSummary'
import QuoteAvailabilityNote from './QuoteAvailabilityNote'
import {
  validateShipment,
  type FieldErrors,
  type RecentLocation,
  type ShipmentField,
} from '../lib/quoteRequest'

const STEPS = [
  { id: 'route', title: 'Route', fields: ['pickup', 'delivery'] },
  {
    id: 'cargo',
    title: 'Cargo',
    fields: ['cargoLines'],
  },
  {
    id: 'schedule',
    title: 'Schedule',
    fields: [
      'preferredPickupDate',
      'isLastDayOfPortStorage',
      'preferredDeliveryDate',
      'paymentTerms',
    ],
  },
  { id: 'review', title: 'Review', fields: [] },
] as const satisfies readonly { id: string; title: string; fields: readonly ShipmentField[] }[]

type StepId = (typeof STEPS)[number]['id']

// Field names as the client reads them, for the "Fix N things" box.
const FIELD_LABELS: Partial<Record<ShipmentField, string>> = {
  pickup: 'Pickup',
  delivery: 'Delivery',
  cargoLines: 'Cargo',
  preferredPickupDate: 'Pickup date',
  isLastDayOfPortStorage: 'Last free storage day',
  preferredDeliveryDate: 'Deadline',
  paymentTerms: 'Payment terms',
}

// The heading inside each step's card.
const STEP_HEADINGS: Record<StepId, string> = {
  route: 'Where from, where to?',
  cargo: 'What are we carrying?',
  schedule: 'When?',
  review: 'Check your request',
}

function QuoteWizard({
  form,
  setField,
  errors,
  setErrors,
  recentLocations,
  contactSection,
  validateContact,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
  aside,
  onCancel,
}: SectionProps & {
  setErrors: (errors: FieldErrors) => void
  recentLocations?: RecentLocation[]
  // Shown at the top of the Review step: a read-only "Sending as" line
  // with the client's account details.
  contactSection: ReactNode
  // Parent checks its own contact fields; false blocks the submit.
  validateContact: () => boolean
  onSubmit: () => void
  submitting: boolean
  submitError: string | null
  submitLabel: string
  // Extra content under the summary on wide screens (public page's
  // "what happens next" panel).
  aside?: ReactNode
  // Shows a Cancel button in the footer (the portal's New Quote page).
  onCancel?: () => void
}) {
  // Opening with errors already set (a rejected quote sent back for
  // fixing): start on the first step with a highlighted field, and let
  // every step be clicked so the client can jump straight to Review.
  const [stepIndex, setStepIndex] = useState(() =>
    Math.max(0, STEPS.findIndex((s) => s.fields.some((f: ShipmentField) => errors[f]))),
  )
  const [furthestStep, setFurthestStep] = useState(() =>
    Object.keys(errors).length > 0 ? STEPS.length - 1 : 0,
  )
  const headingRef = useRef<HTMLHeadingElement>(null)
  const hasMoved = useRef(false)
  const step = STEPS[stepIndex]
  const isReview = step.id === 'review'

  // Move keyboard/screen-reader focus to the new step's heading (and
  // scroll it into view) whenever the step changes -- but not on first
  // load, so the page doesn't jump to the form by itself.
  useEffect(() => {
    if (!hasMoved.current) return
    headingRef.current?.focus()
    headingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [stepIndex])

  function goTo(index: number) {
    hasMoved.current = true
    setStepIndex(index)
    setFurthestStep((prev) => Math.max(prev, index))
  }

  function errorsForStep(index: number, all: FieldErrors): FieldErrors {
    const stepErrors: FieldErrors = {}
    for (const field of STEPS[index].fields) {
      if (all[field]) stepErrors[field] = all[field]
    }
    return stepErrors
  }

  function continueToNext() {
    const stepErrors = errorsForStep(stepIndex, validateShipment(form))
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors)
      return
    }
    setErrors({})
    goTo(stepIndex + 1)
  }

  // Enter in any field = Continue (or Submit on the last step).
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!isReview) {
      continueToNext()
      return
    }

    const all = validateShipment(form)
    const firstBadStep = STEPS.findIndex(
      (_, index) => Object.keys(errorsForStep(index, all)).length > 0,
    )
    if (firstBadStep !== -1) {
      setErrors(all)
      goTo(firstBadStep)
      return
    }
    if (!validateContact()) return
    onSubmit()
  }

  function editStep(id: StepId) {
    goTo(STEPS.findIndex((s) => s.id === id))
  }

  const sectionProps = { form, setField, errors }
  // This step's problems, for the box at the top of the card.
  const stepProblems = step.fields
    .map((f: ShipmentField) => (errors[f] ? { field: f, message: errors[f] } : null))
    .filter((p): p is { field: ShipmentField; message: string } => p !== null)
  const next = STEPS[stepIndex + 1]

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <form onSubmit={handleSubmit} noValidate className="min-w-0">
        <nav aria-label="Quote steps" className="mb-4">
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STEPS.map((s, index) => {
              const current = index === stepIndex
              // Done = the client already got past it (Review is never "done").
              const done = index < furthestStep && !current
              const reachable = index <= furthestStep && !current
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => goTo(index)}
                    disabled={!reachable}
                    aria-current={current ? 'step' : undefined}
                    className={`flex min-h-14 w-full items-center gap-3 border px-3 text-left text-sm ${
                      current ? 'border-2 border-primary bg-primary-soft' : 'border-line bg-white'
                    } ${reachable ? 'hover:bg-slate-50' : ''}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 shrink-0 items-center justify-center text-xs font-bold ${
                        current
                          ? 'bg-primary text-white'
                          : done
                            ? 'bg-green-700 text-white'
                            : 'border border-line-control text-ink-muted'
                      }`}
                    >
                      {done ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12l5 5 9-10" />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={`block font-semibold ${current || done ? 'text-ink' : 'text-ink-muted'}`}>{s.title}</span>
                      {done && <span className="block text-xs text-green-800">Done</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <section className="card">
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="scroll-mt-24 border-b border-line px-5 py-4 text-lg font-bold text-ink focus:outline-none"
          >
            {STEP_HEADINGS[step.id]}
          </h3>

          <div className="px-5 py-5">
            {stepProblems.length > 0 && (
              <div role="alert" className="mb-4 border-2 border-red-700 bg-red-50 px-4 py-3 text-sm text-red-900">
                <p className="font-semibold">
                  Fix {stepProblems.length === 1 ? '1 thing' : `${stepProblems.length} things`} before you continue
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {stepProblems.map((p) => (
                    <li key={p.field}>
                      <span className="font-semibold">{FIELD_LABELS[p.field] ?? p.field}</span>: {p.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {step.id === 'route' && <RouteFields {...sectionProps} recentLocations={recentLocations} />}
              {step.id === 'cargo' && <CargoFields {...sectionProps} />}
              {step.id === 'schedule' && <ScheduleFields {...sectionProps} />}
              {step.id === 'schedule' && <QuoteAvailabilityNote form={form} />}
              {isReview && (
                <>
                  <div className="col-span-full">{contactSection}</div>
                  <div className="col-span-full">
                    <QuoteSummary form={form} onEditStep={editStep} />
                  </div>
                  <p className="col-span-full border border-line bg-slate-50 px-3.5 py-3 text-[13px] leading-[18px] text-ink-secondary">
                    After you send it, the quote shows "Waiting for our price" in My Quotes. You can withdraw it until we answer.
                  </p>
                </>
              )}
            </div>

            {isReview && submitError && (
              <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {submitError}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
            {onCancel && (
              <button type="button" onClick={onCancel} disabled={submitting} className="btn-secondary px-4 text-sm font-medium">
                Cancel
              </button>
            )}
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => goTo(stepIndex - 1)}
              disabled={submitting || stepIndex === 0}
              className="btn-secondary px-4 text-sm font-medium"
            >
              ‹ Back
            </button>
            <button type="submit" disabled={submitting} className="btn-primary px-5 text-sm">
              {isReview ? (submitting ? 'Sending…' : submitLabel) : `Next: ${next?.title ?? ''} ›`}
            </button>
          </div>
        </section>
      </form>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        {!isReview && (
          <div className="card hidden p-4 lg:block">
            <p className="mb-3 text-sm font-semibold text-ink">Summary</p>
            <QuoteSummary form={form} />
          </div>
        )}
        {aside}
      </aside>
    </div>
  )
}

export default QuoteWizard
