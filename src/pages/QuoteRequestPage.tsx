// QuoteRequestPage: the public "Get a Quote" page at /quote-request.
// QuoteForm.tsx has the actual fields/validation/submit logic; this
// page adds the header band and the "what happens next" content (shown
// beside the form, and again on the confirmation screen), matching the
// rest of the public site's look.
import NavBar from '../components/NavBar'
import Footer from '../components/Footer'
import QuoteForm from '../components/QuoteForm'

const steps = [
  'Dispatch reviews dimensions and tonnage against available trailers.',
  'We confirm whether the load needs escort or permits.',
  'You get a rate and a pickup slot, same business day.',
]

function QuoteRequestPage() {
  return (
    <div>
      <NavBar />

      <div
        className="relative bg-brand-navy bg-cover bg-center"
        style={{ backgroundImage: "url('/images/warehouse-loading.jpg')" }}
      >
        <div className="absolute inset-0 bg-brand-navy/85" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <p className="text-xs font-semibold tracking-[0.2em] text-brand-steel uppercase">
            Quote Request
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold uppercase leading-tight text-white sm:text-5xl">
            Tell us what has to move
          </h1>
          <p className="mt-4 max-w-xl text-slate-200">
            Dispatch replies with a rate the same business day. Urgent port
            pickups are flagged first.
          </p>
        </div>
      </div>

      <div className="bg-brand-paper py-14">
        {/* QuoteForm lays out its own two columns (steps + live quote
            summary); the "what happens next" panel and photo sit under
            that summary. */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <QuoteForm
            nextSteps={steps}
            aside={
              <>
                <div className="border border-slate-300 bg-white p-5">
                  <p className="text-xs font-semibold tracking-[0.15em] text-brand-steel-dark uppercase">
                    What Happens Next
                  </p>
                  <ol className="mt-3 flex flex-col gap-3 text-sm text-slate-700">
                    {steps.map((step, index) => (
                      <li key={step} className="flex gap-2">
                        <span className="font-semibold text-brand-steel-dark">
                          {index + 1}.
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <figure className="hidden overflow-hidden border border-slate-300 lg:block">
                  <img
                    src="/images/crane-lift.jpg"
                    alt="Rigging and load-out handled on site"
                    className="h-48 w-full object-cover grayscale"
                  />
                  <figcaption className="bg-white px-3 py-2 text-xs font-semibold tracking-[0.1em] text-slate-500 uppercase">
                    Rigging and load-out handled on site
                  </figcaption>
                </figure>
              </>
            }
          />
        </div>
      </div>

      <Footer />
    </div>
  )
}

export default QuoteRequestPage
