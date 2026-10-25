import type { ReactNode } from 'react'

// StatusBadge: the ONE place status colors live. Every "Pending / Paid /
// Delivered / Cancelled ..." pill in the app uses this, so the same status
// always looks the same on every page. These colors are semantic (green =
// done, orange = waiting/under way, red = rejected/cancelled/problem) and
// separate from the navy/steel brand colors in index.css. A status that
// isn't listed below shows grey -- add it to STATUS_TONE to color it.
//
//   <StatusBadge status={booking.status} />
//   <StatusBadge status="Approved" label="Approved by Admin" />

// Same chip colors as the redesign canvas (ok / warn / bad / info ...).
const TONES = {
  neutral: 'bg-slate-200 text-ink-secondary', // not started yet
  info: 'bg-primary-soft text-primary', // confirmed / scheduled / on its way
  progress: 'bg-violet-100 text-violet-800', // picked up
  active: 'bg-orange-100 text-orange-800', // waiting on someone / under way
  hold: 'bg-amber-100 text-amber-900', // paused / minor
  good: 'bg-green-100 text-green-800', // done / approved / paid
  bad: 'bg-red-100 text-red-800', // rejected / cancelled / problem
  muted: 'bg-slate-100 text-ink-muted', // voided / no longer counts
}

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  Draft: 'neutral',
  Created: 'neutral',
  Awaiting: 'neutral',
  Deactivated: 'neutral',
  'Not Set Up': 'neutral',
  Confirmed: 'info',
  Scheduled: 'info',
  Dispatched: 'info',
  Partial: 'info',
  Leave: 'info',
  PickedUp: 'progress',
  Pending: 'active',
  InProgress: 'active',
  'In Progress': 'active',
  InTransit: 'active',
  'In Transit': 'active',
  'Under Maintenance': 'active',
  'On Leave': 'active',
  'Unpaid Leave': 'hold',
  Unpaid: 'active',
  OnHold: 'hold',
  'On Hold': 'hold',
  Minor: 'hold',
  Approved: 'good',
  Paid: 'good',
  Finalized: 'good',
  Delivered: 'good',
  Completed: 'good',
  Available: 'good',
  Active: 'good',
  Resolved: 'good',
  Responded: 'good',
  Present: 'good',
  'Set Up': 'good',
  Featured: 'good',
  Rejected: 'bad',
  Cancelled: 'bad',
  Terminated: 'bad',
  'Out of Service': 'bad',
  Absent: 'bad',
  Major: 'bad',
  Delinquent: 'bad',
  Overdue: 'bad',
  Voided: 'muted',
}

// Database values that aren't nice to read as-is.
const STATUS_LABEL: Record<string, string> = {
  InProgress: 'In Progress',
  InTransit: 'In Transit',
  PickedUp: 'Picked Up',
  OnHold: 'On Hold',
}

// Small outline icon before the label (opt-in, `icon`): a check for done /
// confirmed, an x for rejected / cancelled, a clock for everything else.
const ICON_PATHS = {
  check: 'M20 6L9 17l-5-5',
  cross: 'M18 6L6 18M6 6l12 12',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
}

export default function StatusBadge({
  status,
  label,
  icon = false,
}: {
  status: string
  label?: ReactNode
  icon?: boolean
}) {
  const toneKey = STATUS_TONE[status] ?? 'neutral'
  const tone = TONES[toneKey]
  const path =
    toneKey === 'good' || toneKey === 'info'
      ? ICON_PATHS.check
      : toneKey === 'bad'
        ? ICON_PATHS.cross
        : ICON_PATHS.clock
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[2px] px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {icon && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={path} />
        </svg>
      )}
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  )
}
