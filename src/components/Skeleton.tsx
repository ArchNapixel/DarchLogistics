// Skeleton: grey placeholder blocks that softly pulse while data loads,
// in one slate tone to match the dashboard. Pulse is skipped for people
// who ask their OS for reduced motion.
export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`h-4 bg-slate-200 motion-safe:animate-pulse ${className}`} />
}

// A table-shaped placeholder: a header strip plus `rows` rows of `cols` cells.
export function SkeletonTable({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex gap-6 border-b border-slate-200 px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <SkeletonBar key={i} className="h-3 flex-1 bg-slate-300" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-6 border-b border-slate-100 px-4 py-4 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonBar key={c} className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

// Card-shaped placeholders for the Overview.
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <SkeletonBar className="h-7 w-10" />
          <SkeletonBar className="mt-3 w-2/3" />
          <SkeletonBar className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}
