// QuoteCta: full-width banner near the bottom of the landing page,
// pushing toward the quote request page one more time before the footer.
import { Link } from 'react-router-dom'

function QuoteCta() {
  return (
    <section
      className="relative bg-brand-navy bg-cover bg-center"
      style={{ backgroundImage: "url('/images/road-crates.jpg')" }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-brand-navy/95 via-brand-navy/85 to-brand-navy/50" />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="max-w-xl font-display text-3xl font-semibold uppercase leading-tight text-white sm:text-4xl">
          Send us the load, we'll send back a rate
        </h2>
        <p className="mt-4 max-w-md text-slate-200">
          Dimensions, tonnage, origin and the date it has to move. That's
          enough for a quote.
        </p>
        <Link
          to="/quote-request"
          className="mt-6 inline-block rounded-lg bg-brand-steel px-6 py-3 text-sm font-bold tracking-wide text-white uppercase hover:bg-brand-steel-dark"
        >
          Request a Quote
        </Link>
      </div>
    </section>
  )
}

export default QuoteCta
