// ServicesGrid: the 4-card "Services" section. The navy highlight sits on
// the 3rd card (heavy-lift & oversized -- the specialty this redesign is
// built around) and follows the mouse to whichever card is hovered,
// returning to the 3rd when the mouse leaves.
import { useState } from 'react'
import Reveal from './Reveal'

const DEFAULT_ACTIVE = 2

const services = [
  {
    number: '01',
    title: 'Full truckload',
    description:
      'Dedicated trucks, one shipper per trip. No consolidation stops and no transfers between terminals.',
  },
  {
    number: '02',
    title: 'Flatbed & dry van',
    description:
      'Tarped and crated freight on flatbeds, sealed cargo in dry vans, chassis for 20ft and 40ft containers.',
  },
  {
    number: '03',
    title: 'Heavy-lift & oversized',
    description:
      'Out-of-gauge and over-dimension loads: rigging plan, route survey, escort and permits arranged per move.',
  },
  {
    number: '04',
    title: 'Nationwide coverage',
    description:
      'Port-to-plant and plant-to-site delivery across Mindanao and beyond, including RoRo legs.',
  },
]

function ServicesGrid() {
  const [active, setActive] = useState(DEFAULT_ACTIVE)

  return (
    <section id="services" className="bg-brand-paper pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-300 pt-10">
          <h2 className="font-display text-3xl font-semibold uppercase text-slate-900 sm:text-4xl">
            Services
          </h2>
          <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">
            Service Area — Mindanao Region
          </p>
        </div>
        </Reveal>

        <Reveal delay={150}>
        <div
          onMouseLeave={() => setActive(DEFAULT_ACTIVE)}
          className="mt-6 grid gap-px overflow-hidden border border-slate-300 bg-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service, index) => {
            const highlighted = index === active
            return (
            <div
              key={service.number}
              onMouseEnter={() => setActive(index)}
              className={`p-6 transition-colors duration-200 ${
                highlighted
                  ? 'bg-brand-navy text-white'
                  : 'bg-brand-paper text-slate-900'
              }`}
            >
              <p
                className={`text-xs font-semibold ${
                  highlighted ? 'text-brand-steel' : 'text-brand-steel-dark'
                }`}
              >
                {service.number}
              </p>
              <h3 className="mt-2 text-base font-semibold">{service.title}</h3>
              <p
                className={`mt-2 text-sm ${
                  highlighted ? 'text-slate-200' : 'text-slate-600'
                }`}
              >
                {service.description}
              </p>
            </div>
            )
          })}
        </div>
        </Reveal>
      </div>
    </section>
  )
}

export default ServicesGrid
