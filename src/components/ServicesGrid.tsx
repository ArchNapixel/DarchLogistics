// ServicesGrid: the 4-card "Services" section. The 3rd card (heavy-lift
// & oversized) is visually highlighted since it's the specialty this
// whole redesign is built around.
const services = [
  {
    number: '01',
    title: 'Full truckload',
    description:
      'Dedicated trucks, one shipper per trip. No consolidation stops and no transfers between terminals.',
    highlighted: false,
  },
  {
    number: '02',
    title: 'Flatbed & dry van',
    description:
      'Tarped and crated freight on flatbeds, sealed cargo in dry vans, chassis for 20ft and 40ft containers.',
    highlighted: false,
  },
  {
    number: '03',
    title: 'Heavy-lift & oversized',
    description:
      'Out-of-gauge and over-dimension loads: rigging plan, route survey, escort and permits arranged per move.',
    highlighted: true,
  },
  {
    number: '04',
    title: 'Nationwide coverage',
    description:
      'Port-to-plant and plant-to-site delivery across Mindanao and beyond, including RoRo legs.',
    highlighted: false,
  },
]

function ServicesGrid() {
  return (
    <section id="services" className="bg-brand-paper pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-300 pt-10">
          <h2 className="font-display text-3xl font-semibold uppercase text-slate-900 sm:text-4xl">
            Services
          </h2>
          <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">
            Service Area — Mindanao Region
          </p>
        </div>

        <div className="mt-6 grid gap-px overflow-hidden border border-slate-300 bg-slate-300 sm:grid-cols-2 lg:grid-cols-4">
          {services.map((service) => (
            <div
              key={service.number}
              className={`p-6 ${
                service.highlighted
                  ? 'bg-brand-navy text-white'
                  : 'bg-brand-paper text-slate-900'
              }`}
            >
              <p
                className={`text-xs font-semibold ${
                  service.highlighted ? 'text-brand-steel' : 'text-brand-steel-dark'
                }`}
              >
                {service.number}
              </p>
              <h3 className="mt-2 text-base font-semibold">{service.title}</h3>
              <p
                className={`mt-2 text-sm ${
                  service.highlighted ? 'text-slate-200' : 'text-slate-600'
                }`}
              >
                {service.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default ServicesGrid
