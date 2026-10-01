// DateRangePicker: ONE date field of the quote form -- render it twice,
// `which="start"` (Pickup) and `which="end"` (Delivery), each given both
// dates. It looks like a normal input; clicking it pops open a month
// calendar (closes on outside click, Escape, or once the date is chosen)
// with the pickup -> delivery range shaded. Days before `min` can't be picked. Dates are plain "YYYY-MM-DD"
// strings (same format <input type="date"> uses), built from local
// year/month/day, never via Date -> ISO, so timezones can't shift a day.
import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../lib/quoteRequest'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

const pad = (n: number) => String(n).padStart(2, '0')
const toDateString = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

type Target = 'start' | 'end'

export default function DateRangePicker({
  start,
  end,
  onChange,
  min,
  which,
  label,
  error,
  single = false,
}: {
  start: string
  end: string
  onChange: (start: string, end: string) => void
  min: string
  which: Target
  label: string
  error?: string
  // Pickup field only: no delivery date to pick, so one click is enough.
  single?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  // Pickup calendar: true after the first click, so the next click is the delivery date.
  const [awaitingEnd, setAwaitingEnd] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  // Month on screen.
  const anchor = start || min
  const [view, setView] = useState({
    year: Number(anchor.slice(0, 4)),
    month: Number(anchor.slice(5, 7)) - 1,
  })
  // Day under the cursor, to preview the range before the end is clicked.
  const [hovered, setHovered] = useState('')

  // Close on a click outside the fields/calendar, or Escape.
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setIsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen])

  function open() {
    // Jump to the month of the date being edited.
    const date = (which === 'end' && end) || start || min
    setView({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1 })
    setAwaitingEnd(false)
    setIsOpen(true)
  }

  function pick(day: string) {
    if (which === 'start' && !single && awaitingEnd && day >= start) {
      onChange(start, day) // second point = delivery date
    } else if (which === 'start') {
      // New pickup date; a delivery date before it no longer makes sense.
      onChange(day, end && end < day ? '' : end)
      if (!single) {
        setAwaitingEnd(true) // stay open for the delivery date
        return
      }
    } else if (day < start) {
      onChange(day, end) // can't deliver before pickup: move pickup instead
    } else {
      onChange(start, day)
    }
    setIsOpen(false)
  }

  const firstWeekday = (new Date(view.year, view.month, 1).getDay() + 6) % 7 // Monday = 0
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toDateString(view.year, view.month, i + 1)),
  ]

  function shiftMonth(by: number) {
    const next = new Date(view.year, view.month + by, 1)
    setView({ year: next.getFullYear(), month: next.getMonth() })
  }

  // Range shown in the grid: the real one, or start -> hovered while picking the end.
  const rangeEnd =
    (which === 'end' || awaitingEnd) && start && hovered > start ? hovered : end

  const title = new Date(view.year, view.month, 1).toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
  })
  const navButton =
    'flex h-8 w-8 items-center justify-center border-2 border-slate-300 text-slate-700 transition-colors hover:border-slate-500 hover:bg-slate-50'

  const value = which === 'start' ? start : end

  return (
    <div ref={wrapper} className="relative">
      <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span>{label}</span>
        <button
          type="button"
          onClick={open}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-invalid={error ? true : undefined}
          className={`border-2 bg-white px-3 py-2 text-left font-normal transition-colors focus:outline-none ${
            error
              ? 'border-red-400 hover:bg-red-50 focus:border-red-500'
              : isOpen
                ? 'border-slate-500 bg-slate-50'
                : 'border-slate-300 hover:border-slate-500 hover:bg-slate-50 focus:border-slate-500'
          } ${value ? 'text-slate-900' : 'text-slate-400'}`}
        >
          {value ? formatDate(value) : 'Select a date'}
        </button>
        {error && (
          <span className="text-sm font-normal text-red-600" role="alert">
            {error}
          </span>
        )}
      </div>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute top-full left-0 z-20 mt-1 w-full max-w-sm border-2 border-slate-300 bg-white p-4 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className={navButton}>
              ‹
            </button>
            <span className="text-sm font-semibold text-slate-900" aria-live="polite">
              {title}
            </span>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className={navButton}>
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-xs font-medium text-slate-500">
            {WEEKDAYS.map((d) => (
              <span key={d} className="py-1">
                {d}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7" onMouseLeave={() => setHovered('')}>
            {cells.map((day, i) => {
              if (!day) return <span key={`blank-${i}`} />
              const disabled = day < min
              const isEdge = day === start || day === end
              const inRange = !!start && !!rangeEnd && day > start && day < rangeEnd
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(day)}
                  onMouseEnter={() => setHovered(day)}
                  aria-pressed={isEdge}
                  className={`h-9 text-sm transition-colors ${
                    isEdge
                      ? 'bg-brand-navy font-semibold text-white'
                      : inRange
                        ? 'bg-slate-200 text-slate-900'
                        : disabled
                          ? 'cursor-not-allowed text-slate-300'
                          : 'text-slate-800 hover:bg-slate-100'
                  }`}
                >
                  {Number(day.slice(8))}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
