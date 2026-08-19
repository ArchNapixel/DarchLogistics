// NavBar: the sticky bar at the top of the landing page.
// "Get a Quote" is a plain anchor link (#quote) that scrolls down the SAME
// page. "Staff Login" is a React Router <Link> that navigates to /login.
import { Link } from 'react-router-dom'

function NavBar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <a href="#top" className="text-lg font-bold text-slate-900">
          Darch Logistics
        </a>

        <div className="flex items-center gap-6">
          <a
            href="#quote"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            Get a Quote
          </a>

          <Link
            to="/login"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Staff Login
          </Link>
        </div>
      </nav>
    </header>
  )
}

export default NavBar
