// ComingSoonPage: generic placeholder reused for every sidebar link that
// doesn't have real content yet (Quotations, Bookings, My History, etc.).
function ComingSoonPage({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-slate-500">Coming soon.</p>
    </div>
  )
}

export default ComingSoonPage
