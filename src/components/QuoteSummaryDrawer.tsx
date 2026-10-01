// QuoteSummaryDrawer: a panel that slides in from the right over the page
// once every shipment field is filled in -- a full, highlighted recap of
// the quote (route, cargo, schedule, price) with "Keep editing" and
// "Go to review" buttons. QuoteWizard decides when `open` is true; this
// only handles the slide animation and the layout. Closing slides it back
// out before unmounting, so it never just vanishes.
import { useEffect, useState, type ReactNode } from 'react'
import { formatLocationDisplay } from '../lib/locationReference'
import {
  PAYMENT_TERMS_LABELS,
  formatDate,
  type LocationValue,
  type ShipmentForm,
} from '../lib/quoteRequest'

const SLIDE_MS = 300

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-2 border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
      <div className="mt-2 flex flex-col gap-2 text-sm text-slate-800">{children}</div>
    </section>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="border-2 border-brand-steel/40 bg-brand-steel/10 px-2.5 py-1 text-xs font-semibold text-brand-navy">
      {children}
    </span>
  )
}

function Stop({ letter, location }: { letter: 'A' | 'B'; location: LocationValue }) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold text-white ${
          letter === 'A' ? 'bg-brand-steel' : 'bg-brand-navy'
        }`}
      >
        {letter}
      </span>
      <div>
        <p className="text-xs font-medium text-slate-500">{letter === 'A' ? 'Pickup' : 'Delivery'}</p>
        <p className="font-semibold text-slate-900">{formatLocationDisplay(location)}</p>
        {location.lat !== null && <p className="text-xs text-green-700">Pinned on map</p>}
      </div>
    </div>
  )
}

export default function QuoteSummaryDrawer({
  open,
  form,
  onClose,
  onReview,
}: {
  open: boolean
  form: ShipmentForm
  onClose: () => void
  // "Go to review" -- the wizard jumps to its Review step. Without it
  // (single-page forms) the only button is "Keep editing".
  onReview?: () => void
}) {
  // `mounted` keeps the panel in the DOM during the slide-out; `shown`
  // flips on a frame after mounting so the slide-in actually animates.
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(frame)
    }
    const timer = setTimeout(() => {
      setShown(false)
      setMounted(false)
    }, SLIDE_MS)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted) return null

  const count = Number(form.deliveryOrderCount)
  const rate = Number(form.proposedRate)
  const total = rate * count
  const urgent = form.isLastDayOfPortStorage === 'Yes'

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="Quote summary">
      {/* Dim backdrop; clicking it closes the panel */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-slate-900/30 transition-opacity duration-300 ${
          open && shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <aside
        className={`absolute top-0 right-0 flex h-full w-full max-w-md flex-col border-l-2 border-slate-300 bg-slate-50 shadow-2xl transition-transform duration-300 ease-out ${
          open && shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b-2 border-slate-200 bg-white px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Quote summary</h3>
            <p className="text-xs text-slate-500">Everything's filled in. Check it over.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            className="flex h-8 w-8 items-center justify-center border-2 border-slate-300 text-slate-700 transition-colors hover:border-slate-500 hover:bg-slate-50"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <Block title="Route">
            <Stop letter="A" location={form.pickup} />
            <div aria-hidden="true" className="ml-3 h-3 border-l-2 border-dashed border-slate-300" />
            <Stop letter="B" location={form.delivery} />
          </Block>

          <Block title="Cargo">
            <div className="flex flex-wrap gap-2">
              <Chip>{form.cargoType === 'Loose' ? 'Loose cargo' : 'Container'}</Chip>
              <Chip>{form.containerType}</Chip>
              <Chip>{form.trailerType}</Chip>
              <Chip>{form.weight} t</Chip>
              <Chip>
                {count} {count === 1 ? 'delivery' : 'deliveries'}
              </Chip>
            </div>
            <p className="text-slate-600">{form.cargoDescription.trim()}</p>
          </Block>

          <Block title="Schedule">
            <div className="flex justify-between">
              <span className="text-slate-500">Pickup</span>
              <span className="font-semibold text-slate-900">
                {formatDate(form.preferredPickupDate)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Delivery</span>
              {urgent ? (
                <span className="font-semibold text-amber-700">Urgent · last free storage day</span>
              ) : (
                <span className="font-semibold text-slate-900">
                  {formatDate(form.preferredDeliveryDate)}
                </span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Payment</span>
              <span className="font-semibold text-slate-900">
                {PAYMENT_TERMS_LABELS[form.paymentTerms]}
              </span>
            </div>
          </Block>

          {/* The number people care about most */}
          <div className="bg-brand-navy p-4 text-white">
            <p className="text-xs font-semibold tracking-wide uppercase opacity-70">Proposed total</p>
            <p className="mt-1 text-3xl font-semibold">₱{total.toLocaleString('en-PH')}</p>
            <p className="mt-1 text-sm opacity-80">
              ₱{rate.toLocaleString('en-PH')} × {count} {count === 1 ? 'delivery' : 'deliveries'}
            </p>
          </div>
        </div>

        <footer className="flex gap-3 border-t-2 border-slate-200 bg-white px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border-2 border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-500 hover:bg-slate-50"
          >
            Keep editing
          </button>
          {onReview && (
            <button
              type="button"
              onClick={onReview}
              className="flex-1 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Go to review
            </button>
          )}
        </footer>
      </aside>
    </div>
  )
}
