// Footer: shared across the landing page and the quote request page.
import { Link } from 'react-router-dom'

function Footer() {
  return (
    <footer className="bg-brand-navy">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <p className="font-display text-lg font-semibold tracking-wide text-white">
            DARCH LOGISTICS
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Port container drayage, heavy-lift and breakbulk.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">
            Office
          </p>
          <p className="mt-2 text-sm text-slate-300">Panabo City</p>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">
            Dispatch
          </p>
          <p className="mt-2 text-sm text-slate-300">09660475467</p>
          <p className="mt-1 text-sm text-slate-300">colesarch48@gmail.com</p>
        </div>

        <div>
          <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">
            Pages
          </p>
          <div className="mt-2 flex flex-col gap-1">
            <Link
              to="/quote-request"
              className="text-sm text-slate-300 underline hover:text-white"
            >
              Get a Quote
            </Link>
            <Link
              to="/login"
              className="text-sm text-slate-300 underline hover:text-white"
            >
              Staff Login
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
