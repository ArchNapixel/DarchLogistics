// NewQuoteModal: the client portal's pop-up around ClientQuoteForm (which
// has the actual fields/submit logic). Used for "New Quote" on the
// dashboard and for "Edit & resubmit" on a rejected quote (`resubmit` set).
import { useState } from 'react'
import ClientQuoteForm, { type ResubmitTarget } from './ClientQuoteForm'

// The "New Quote Request" button + its modal, for page headers.
// `onCreated` lets the My Quotes page reload its list afterwards.
export function NewQuoteButton({
  clientId,
  onCreated,
}: {
  clientId: number
  onCreated?: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn-primary px-4 py-2 text-sm font-medium"
      >
        New Quote Request
      </button>
      {open && (
        <NewQuoteModal
          clientId={clientId}
          onCreated={() => {
            setOpen(false)
            onCreated?.()
          }}
        />
      )}
    </>
  )
}

function NewQuoteModal({
  clientId,
  resubmit,
  onCreated,
}: {
  clientId: number
  resubmit?: ResubmitTarget
  // Closes the modal and reloads the quote list (called on ✕ too --
  // a reload after a cancel is harmless, and a send is never missed).
  onCreated: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto bg-slate-50 p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            {resubmit ? 'Edit & resubmit quote' : 'Request a quote'}
          </h2>
          <button
            type="button"
            onClick={onCreated}
            aria-label="Close"
            className="p-1 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <ClientQuoteForm
          clientId={clientId}
          resubmit={resubmit}
          nextSteps={[
            'We review your route and cargo, then send you our rate per trip.',
            'You accept it, suggest your own rate or dates, or decline -- under My Quote Requests.',
            'Once you accept, it appears in My Bookings.',
          ]}
          actionLabel="Done"
          onDone={onCreated}
        />
      </div>
    </div>
  )
}

export default NewQuoteModal
