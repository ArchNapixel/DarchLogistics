// LandingPage: the public homepage at "/". The quote form now lives on
// its own page (/quote-request) instead of being embedded here.
import NavBar from '../components/NavBar'
import Hero from '../components/Hero'
import WhatWeHaul from '../components/WhatWeHaul'
import ServicesGrid from '../components/ServicesGrid'
import ClientTestimonials from '../components/ClientTestimonials'
import QuoteCta from '../components/QuoteCta'
import Footer from '../components/Footer'
import Reveal from '../components/Reveal'

function LandingPage() {
  return (
    <div>
      <NavBar />
      <Hero />
      <WhatWeHaul />
      <ServicesGrid />
      <Reveal>
        <ClientTestimonials />
      </Reveal>
      <QuoteCta />
      <Footer />
    </div>
  )
}

export default LandingPage
