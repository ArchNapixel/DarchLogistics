// BookingsTripsControls: the controls both tabs of Bookings & Trips share,
// so the two look the same -- the Bookings / Trips switch, the status
// filter buttons with counts, the search box, and the list box's footer
// (pager, or a one-line summary when everything fits on one page).
import type { ReactNode } from 'react'

// "Bookings" | "Trips" -- two separate buttons, the open one filled.
export function PageViewSwitch({
  view,
  onChange,
}: {
  view: 'bookings' | 'trips'
  onChange: (view: 'bookings' | 'trips') => void
}) {
  return (
    <div className="flex gap-2">
      {(['bookings', 'trips'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={`h-11 rounded-[2px] border px-5 text-sm font-semibold ${
            view === v ? 'border-primary bg-primary text-white' : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
          }`}
        >
          {v === 'trips' ? 'Trips' : 'Bookings'}
        </button>
      ))}
    </div>
  )
}

// Status filter buttons (the canvas's tabs: outlined, the chosen one filled
// steel blue), each with its count.
export function FilterButtons<T extends string>({
  options,
  value,
  onChange,
  counts,
  label,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  // Hidden while loading.
  counts: Record<string, number> | null
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`flex h-11 items-center gap-2.5 rounded-[2px] border px-5 text-sm font-semibold ${
              active
                ? 'border-primary bg-primary text-white'
                : 'border-line-control bg-white text-ink-metric hover:bg-slate-100'
            }`}
          >
            {option.label}
            {counts && (
              <span
                className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] px-1.5 text-xs font-bold ${
                  active ? 'bg-white text-primary' : 'bg-primary text-white'
                }`}
              >
                {counts[option.value] ?? 0}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// "Search [ ... ]" pushed to the right of the controls row.
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <label className="ml-auto flex w-full items-center gap-3 text-sm font-medium text-ink-secondary sm:w-auto">
      Search
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border border-line-control bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-primary sm:w-[34rem] sm:flex-none rounded-[2px] min-h-11"
      />
    </label>
  )
}

// The list box on the left: fills the screen height, scrolls inside, and
// ends in a footer -- the pager when there's more than one page, else
// `summary` ("4 cancelled bookings").
export function ListBox({
  children,
  pager,
  summary,
}: {
  children: ReactNode
  pager: { page: number; pageCount: number; onChange: (page: number) => void }
  summary: string
}) {
  const button = 'btn-secondary px-3.5 text-sm font-medium'
  return (
    <div className="card flex min-h-[calc(100dvh-14rem)] flex-col">
      <div className="flex-1">{children}</div>
      <div className="flex min-h-[60px] items-center justify-between gap-3 border-t border-line px-4 py-2 text-sm text-ink-secondary">
        {pager.pageCount > 1 ? (
          <>
            <span>
              Page {pager.page + 1} of {pager.pageCount}
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={() => pager.onChange(pager.page - 1)} disabled={pager.page === 0} className={button}>
                ‹ Previous
              </button>
              <button
                type="button"
                onClick={() => pager.onChange(pager.page + 1)}
                disabled={pager.page >= pager.pageCount - 1}
                className={button}
              >
                Next ›
              </button>
            </span>
          </>
        ) : (
          <span>{summary}</span>
        )}
      </div>
    </div>
  )
}

// The right-hand pane next to the list: sticks while the list scrolls.
export function DetailPane({ children }: { children: ReactNode }) {
  return (
    <div className="card p-5 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
      {children}
    </div>
  )
}
