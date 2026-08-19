// Hero: the large banner right under the nav bar. It has the "id=top"
// anchor so the logo link can scroll back up to it.
function Hero() {
  return (
    <section
      id="top"
      className="bg-gradient-to-b from-slate-900 to-slate-800 text-white"
    >
      <div className="mx-auto max-w-4xl px-4 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Darch Logistics
        </h1>
        <p className="mt-4 text-lg text-slate-300">
          Reliable trucking, delivered on time — every time.
        </p>
        <a
          href="#quote"
          className="mt-8 inline-block rounded-lg bg-white px-6 py-3 font-semibold text-slate-900 hover:bg-slate-200"
        >
          Get a Quote
        </a>
      </div>
    </section>
  )
}

export default Hero
