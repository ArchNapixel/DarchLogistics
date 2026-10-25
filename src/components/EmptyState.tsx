import type { ReactNode } from 'react'

// EmptyState: what a list shows when there's nothing in it, so every empty
// list in the app looks the same. `message` is the main line ("No bookings
// yet."); `hint` is an optional smaller line saying why, or what to do next.
//
//   {rows.length === 0 && <EmptyState message="No bookings yet." />}
// `className` is only for outside spacing (e.g. "mt-4").
export default function EmptyState({
  message,
  hint,
  className = '',
}: {
  message: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={`border border-dashed border-line bg-white px-4 py-8 text-center ${className}`}>
      {/* Simple inbox outline, same stroke style as the sidebar icons */}
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mx-auto text-ink-muted"
      >
        <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
      <p className="mt-2 text-sm font-medium text-ink-secondary">{message}</p>
      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
    </div>
  )
}
