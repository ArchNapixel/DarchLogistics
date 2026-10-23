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
          className={`border-2 px-6 py-2.5 text-sm font-semibold ${
            view === v ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-slate-900 hover:bg-slate-50'
          }`}
        >
          {v === 'trips' ? 'Trips' : 'Bookings'}
        </button>
      ))}
    </div>
  )
}

// Joined status filter buttons, each with its count.
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
    <div role="group" aria-label={label} className="flex">
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`flex items-center gap-2 border px-4 py-2.5 text-sm [&:not(:first-child)]:-ml-px ${
              active
                ? 'relative border-primary bg-primary-soft font-semibold text-slate-900'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            {option.label}
            {counts && (
              <span className={`px-1.5 text-xs ${active ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-600'}`}>
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
    <label className="ml-auto flex w-full items-center gap-3 text-sm text-slate-700 sm:w-auto">
      Search
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-primary focus:outline-none sm:w-[34rem] sm:flex-none"
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
  const button =
    'border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40'
  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col border-2 border-slate-300 bg-white">
      <div className="flex-1">{children}</div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-700">
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
    <div className="border-2 border-slate-300 bg-white p-5 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
      {children}
    </div>
  )
}
