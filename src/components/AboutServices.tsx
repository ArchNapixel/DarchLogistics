// AboutServices: placeholder "About / Services" content.
// Swap the copy below for real company details whenever you're ready.
const services = [
  {
    title: 'Full Truckload',
    description:
      'Dedicated trailers for large shipments, direct from origin to destination.',
  },
  {
    title: 'Flatbed & Dry Van',
    description: '20ft and 40ft trailer options to match your cargo type.',
  },
  {
    title: 'Nationwide Coverage',
    description: 'A trusted network of drivers covering major freight lanes.',
  },
]

function AboutServices() {
  return (
    <section id="about" className="mx-auto max-w-6xl px-4 py-20">
      <h2 className="text-center text-3xl font-bold text-slate-900">
        About Darch Logistics
      </h2>
      <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
        Placeholder copy: Darch Logistics is a trucking services company
        committed to safe, on-time freight delivery. Replace this paragraph
        with real company info later.
      </p>

      <div className="mt-12 grid gap-8 sm:grid-cols-3">
        {services.map((service) => (
          <div
            key={service.title}
            className="rounded-xl border border-slate-200 p-6"
          >
            <h3 className="font-semibold text-slate-900">{service.title}</h3>
            <p className="mt-2 text-sm text-slate-600">
              {service.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

export default AboutServices
