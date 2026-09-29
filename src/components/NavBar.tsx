// NavBar: the sticky bar at the top of every public page (landing +
// quote request). "Get a Quote" routes to its own page now (was an
// in-page #quote anchor before the redesign); "Services"/"Heavy-Lift"
// stay as in-page anchors since they only exist on the landing page.
// The desktop row and the mobile menu share one `links` list below.
import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'

// Plain <a> for the in-page anchors on purpose: a full load from another
// page lands on the right section natively.
const anchorLinks = [
  { label: 'Services', href: '/#services' },
  { label: 'Heavy-Lift', href: '/#heavy-lift' },
]

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

function NavBar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const closeMenu = () => setMobileMenuOpen(false)

  return (
    <header className="sticky top-0 z-50 bg-brand-navy">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6"
      >
        <Link
          to="/"
          className={`font-display text-lg font-semibold tracking-wide text-white ${focusRing}`}
        >
          DARCH LOGISTICS
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {anchorLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className={`text-sm font-medium text-slate-200 hover:text-white ${focusRing}`}
            >
              {l.label}
            </a>
          ))}
          <Link
            to="/login"
            className={`text-sm font-medium text-slate-200 hover:text-white ${focusRing}`}
          >
            Staff Login
          </Link>
          {/* Main call to action -- the filled button */}
          <NavLink
            to="/quote-request"
            className={({ isActive }) =>
              `px-5 py-2 text-sm font-medium text-white ${focusRing} ${
                isActive ? 'bg-slate-700' : 'bg-black hover:bg-slate-800'
              }`
            }
          >
            Get a Quote
          </NavLink>
        </div>

        <button
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          className={`flex h-11 w-11 items-center justify-center rounded-lg border border-slate-600 text-white md:hidden ${focusRing}`}
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
        <div
          id="mobile-menu"
          className="flex flex-col gap-1 border-t border-slate-700 px-4 pb-4 md:hidden"
        >
          {anchorLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={closeMenu}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 hover:text-white"
            >
              {l.label}
            </a>
          ))}
          <Link
            to="/login"
            onClick={closeMenu}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 hover:text-white"
          >
            Staff Login
          </Link>
          <NavLink
            to="/quote-request"
            onClick={closeMenu}
            className={({ isActive }) =>
              `mt-1 px-4 py-2 text-center text-sm font-medium text-white ${
                isActive ? 'bg-slate-700' : 'bg-black'
              }`
            }
          >
            Get a Quote
          </NavLink>
        </div>
      )}
    </header>
  )
}

export default NavBar
