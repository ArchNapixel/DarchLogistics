// WhatWeHaul: "the two jobs most haulers turn down" section --
// heavy-lift/breakbulk and time-critical port drayage. The photos use
// a blue duotone treatment (grayscale + a steel-blue overlay) to match
// the design instead of plain color photos. Blocks fade up on scroll
// (Reveal) and photos zoom slightly on hover.
import Reveal from './Reveal'
const jobs = [
  {
    number: '01',
    label: 'Heavy-Lift & Breakbulk',
    title: 'Oversized equipment moves',
    description:
      'Flatbed and lowbed hauling for machinery, industrial vessels, transformers and crated project cargo. Crane and forklift loading coordinated on both ends, with escort and permit handling where the load requires it.',
  },
  {
    number: '02',
    label: 'Port Container Drayage',
    title: 'Out before demurrage starts',
    description:
      "20ft and 40ft pickups scheduled against your free storage expiry, not against our convenience. Tell us the last free day on the quote form and dispatch works backwards from it.",
  },
]

function DuotonePhoto({ src, caption }: { src: string; caption: string }) {
  return (
    <Reveal>
    <figure>
      <div className="relative overflow-hidden rounded-lg">
        <img
          src={src}
          alt={caption}
          className="h-56 w-full object-cover grayscale transition-transform duration-700 hover:scale-105 sm:h-64"
        />
        <div className="absolute inset-0 bg-brand-steel/50 mix-blend-multiply" />
      </div>
      <figcaption className="mt-2 text-xs font-semibold tracking-[0.1em] text-slate-500 uppercase">
        {caption}
      </figcaption>
    </figure>
    </Reveal>
  )
}

function WhatWeHaul() {
  return (
    <section id="heavy-lift" className="bg-brand-paper py-20">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <Reveal>
          <p className="text-xs font-semibold tracking-[0.2em] text-brand-steel-dark uppercase">
            What We Actually Haul
          </p>
          <h2 className="mt-3 font-display text-3xl font-semibold uppercase leading-tight text-slate-900 sm:text-4xl">
            Two jobs most haulers turn down
          </h2>
          <p className="mt-5 max-w-lg text-slate-600">
            Transformers, tanks, pressure vessels and crated machinery need a
            flatbed, a rigging plan and a driver who has done it before. Port
            pickups need a truck at the gate on the day the free storage
            window closes. We run both out of the same yard, with the same
            dispatch desk.
          </p>

          <div className="mt-8 flex flex-col">
            {jobs.map((job) => (
              <div
                key={job.number}
                className="border-t border-slate-300 py-6 transition-transform duration-300 hover:translate-x-2"
              >
                <p className="text-xs font-semibold tracking-[0.15em] text-brand-steel-dark uppercase">
                  {job.number} — {job.label}
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {job.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600">{job.description}</p>
              </div>
            ))}
            <div className="border-t border-slate-300" />
          </div>
        </Reveal>

        <div className="flex flex-col gap-6">
          <DuotonePhoto
            src="/images/crane-lift.jpg"
            caption="Transformer load-out — crane rigging, flatbed secure"
          />
          <DuotonePhoto
            src="/images/warehouse-loading.jpg"
            caption="Crated machinery — warehouse forklift loading"
          />
        </div>
      </div>
    </section>
  )
}

export default WhatWeHaul
