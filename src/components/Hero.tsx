// Hero: the large banner right under the nav bar, plus the stats strip
// beneath it. Background photo + dark navy gradient overlay so the
// white headline stays readable regardless of the photo underneath.
import { Link } from 'react-router-dom'

const stats = [
  { label: 'Max Payload', value: '25 Tons' },
  { label: 'Fleet Units', value: '9' },
  { label: 'Operating Since', value: '2018' },
  { label: 'Quote Turnaround', value: 'Same business day' },
]

function Hero() {
  return (
    <section id="top">
      <div
        className="relative bg-brand-navy bg-cover bg-center"
        style={{ backgroundImage: "url('/images/heavy-cylinder.jpg')" }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-brand-navy/95 via-brand-navy/80 to-brand-navy/40" />

        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <p className="text-xs font-semibold tracking-[0.2em] text-brand-steel uppercase">
            Port Drayage / Heavy-Lift / Breakbulk
          </p>

          <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold uppercase leading-[1.05] text-white sm:text-6xl">
            Cargo that doesn't fit a standard container
          </h1>

          <p className="mt-6 max-w-xl text-base text-slate-200 sm:text-lg">
            Darch Logistics moves oversized equipment, crated machinery and
            breakbulk freight across the Philippines — and pulls your
            containers off the port before free storage runs out.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/quote-request"
              className="rounded-lg bg-brand-steel px-6 py-3 text-center text-sm font-bold tracking-wide text-white uppercase hover:bg-brand-steel-dark"
            >
              Request a Quote
            </Link>
            <a
              href="tel:09660475467"
              className="rounded-lg border border-slate-400/60 px-6 py-3 text-center text-sm font-medium text-white hover:border-white"
            >
              Dispatch: 09660475467
            </a>
          </div>
        </div>
      </div>

      <div className="bg-brand-navy-light">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-4 py-6 sm:grid-cols-4 sm:px-6">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={index === 1 || index === 2 ? 'hidden sm:block' : undefined}
            >
              <p className="text-xs font-semibold tracking-[0.15em] text-slate-400 uppercase">
                {stat.label}
              </p>
              <p className="mt-1 font-display text-xl font-semibold text-white">
                {stat.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default Hero
