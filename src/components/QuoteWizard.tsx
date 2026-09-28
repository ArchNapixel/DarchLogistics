// QuoteWizard: the step-by-step quote form customers see -- the public
// QuoteForm and the client portal's NewQuoteModal. Route -> Cargo ->
// Schedule & terms -> Review, with a live summary beside the steps on
// wide screens. Each "Continue" only checks the current step's fields
// (errors show under each field); Submit re-checks everything and jumps
// back to the first step with a problem. Staff don't use this -- they
// log phone-in quotes on one page (NewQuoteRequestModal) with the same
// field sections.
//
// The wizard owns only which step is showing. Form state/errors come
// from the parent (useShipmentForm in lib/quoteRequest.ts), and the
// parent does the actual insert in onSubmit, since each channel adds
// different client/contact columns.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CargoFields, RouteFields, ScheduleFields, type SectionProps } from './QuoteShipmentFields'
import { QuoteSummary } from './QuoteSummary'
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
    fields: ['cargoType', 'containerType', 'weight', 'deliveryOrderCount', 'cargoDescription'],
  },
  {
    id: 'schedule',
    title: 'Schedule & terms',
    fields: [
      'preferredPickupDate',
      'isLastDayOfPortStorage',
      'preferredDeliveryDate',
      'proposedRate',
      'paymentTerms',
    ],
  },
  { id: 'review', title: 'Review', fields: [] },
] as const satisfies readonly { id: string; title: string; fields: readonly ShipmentField[] }[]

type StepId = (typeof STEPS)[number]['id']

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
}: SectionProps & {
  setErrors: (errors: FieldErrors) => void
  recentLocations?: RecentLocation[]
  // Shown at the top of the Review step: editable contact fields on the
  // public form, a read-only "Submitting as" line in the client portal.
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
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [furthestStep, setFurthestStep] = useState(0)
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

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <form onSubmit={handleSubmit} noValidate className="min-w-0">
        <nav aria-label="Quote steps">
          <ol className="flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-200 pb-3">
            {STEPS.map((s, index) => {
              const current = index === stepIndex
              const reachable = index <= furthestStep && !current
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => goTo(index)}
                    disabled={!reachable}
                    aria-current={current ? 'step' : undefined}
                    className={`flex items-center gap-2 text-sm ${
                      current
                        ? 'font-semibold text-slate-900'
                        : reachable
                          ? 'text-slate-600 hover:text-slate-900'
                          : 'text-slate-400'
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center text-xs font-semibold ${
                        current
                          ? 'bg-slate-900 text-white'
                          : reachable
                            ? 'bg-slate-200 text-slate-800'
                            : 'border border-slate-300 text-slate-400'
                      }`}
                    >
                      {index + 1}
                    </span>
                    {s.title}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>

        <h3
          ref={headingRef}
          tabIndex={-1}
          className="mt-6 scroll-mt-24 text-lg font-semibold text-slate-900 focus:outline-none"
        >
          {isReview ? 'Check your details and send' : step.title}
        </h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {step.id === 'route' && (
            <RouteFields {...sectionProps} recentLocations={recentLocations} />
          )}
          {step.id === 'cargo' && <CargoFields {...sectionProps} />}
          {step.id === 'schedule' && <ScheduleFields {...sectionProps} />}
          {isReview && (
            <>
              <div className="col-span-full">{contactSection}</div>
              <div className="col-span-full border border-slate-200 bg-white p-4">
                <QuoteSummary form={form} onEditStep={editStep} />
              </div>
            </>
          )}
        </div>

        {isReview && submitError && (
          <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {submitError}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={() => goTo(stepIndex - 1)}
              disabled={submitting}
              className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={submitting}
            className="bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {isReview
              ? submitting
                ? 'Sending…'
                : submitLabel
              : `Continue to ${STEPS[stepIndex + 1].title.toLowerCase()}`}
          </button>
        </div>
      </form>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
        {!isReview && (
          <div className="hidden border border-slate-200 bg-white p-4 lg:block">
            <p className="mb-3 text-sm font-semibold text-slate-900">Your quote so far</p>
            <QuoteSummary form={form} />
          </div>
        )}
        {aside}
      </aside>
    </div>
  )
}

export default QuoteWizard
