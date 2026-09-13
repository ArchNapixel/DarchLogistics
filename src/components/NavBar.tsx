// NavBar: the sticky bar at the top of every public page (landing +
// quote request). "Get a Quote" routes to its own page now (was an
// in-page #quote anchor before the redesign); "Services"/"Heavy-Lift"
// stay as in-page anchors since they only exist on the landing page.
import { useState } from 'react'
import { Link } from 'react-router-dom'

function NavBar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-brand-navy">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          to="/"
          className="font-display text-lg font-semibold tracking-wide text-white"
        >
          DARCH LOGISTICS
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          <a
            href="/#services"
            className="text-sm font-medium text-slate-200 hover:text-white"
          >
            Services
          </a>
          <a
            href="/#heavy-lift"
            className="text-sm font-medium text-slate-200 hover:text-white"
          >
            Heavy-Lift
          </a>
          <Link
            to="/quote-request"
            className="text-sm font-medium text-slate-200 hover:text-white"
          >
            Get a Quote
          </Link>
          <Link
            to="/login"
            className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Staff Login
          </Link>
        </div>

        <button
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label="Toggle menu"
          className="flex items-center justify-center rounded-lg border border-slate-600 p-2 text-white md:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </nav>

      {mobileMenuOpen && (
        <div className="flex flex-col gap-1 border-t border-slate-700 px-4 pb-4 md:hidden">
          <a
            href="/#services"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 hover:text-white"
          >
            Services
          </a>
          <a
            href="/#heavy-lift"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 hover:text-white"
          >
            Heavy-Lift
          </a>
          <Link
            to="/quote-request"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 hover:text-white"
          >
            Get a Quote
          </Link>
          <Link
            to="/login"
            onClick={() => setMobileMenuOpen(false)}
            className="mt-1 rounded-full bg-black px-4 py-2 text-center text-sm font-medium text-white"
          >
            Staff Login
          </Link>
        </div>
      )}
    </header>
  )
}

export default NavBar
