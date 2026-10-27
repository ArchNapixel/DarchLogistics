// NewQuoteButton: the "New Quote Request" button in the client portal's
// page headers. Opens the New Quote Request page (/dashboard/quotes/new,
// ClientNewQuotePage in ClientPages.tsx) -- the quote form is a page of
// its own now, not a pop-up (the canvas's Client quote boards).
import { Link } from 'react-router-dom'

export function NewQuoteButton() {
  return (
    <Link to="/dashboard/quotes/new" className="btn-primary inline-flex items-center gap-2 px-5 text-sm">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14 M5 12h14" />
      </svg>
      New Quote Request
    </Link>
  )
}
