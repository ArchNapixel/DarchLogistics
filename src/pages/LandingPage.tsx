// LandingPage: the public homepage at "/". It stacks the nav bar, hero,
// about/services sections, and the quote request form.
import NavBar from '../components/NavBar'
import Hero from '../components/Hero'
import AboutServices from '../components/AboutServices'
import QuoteForm from '../components/QuoteForm'

function LandingPage() {
  return (
    <div>
      <NavBar />
      <Hero />
      <AboutServices />

      <section id="quote" className="mx-auto max-w-3xl px-4 py-20">
        <h2 className="text-center text-3xl font-bold text-slate-900">
          Get a Quote
        </h2>
        <p className="mt-4 text-center text-slate-600">
          Fill out the form below and our team will follow up with pricing.
        </p>
        <div className="mt-10">
          <QuoteForm />
        </div>
      </section>
    </div>
  )
}

export default LandingPage
