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

const TONES = {
  neutral: 'bg-slate-100 text-slate-700', // not started yet
  info: 'bg-blue-100 text-blue-700', // confirmed / scheduled / on its way
  progress: 'bg-purple-100 text-purple-700', // picked up
  active: 'bg-orange-100 text-orange-700', // waiting on someone / under way
  hold: 'bg-yellow-100 text-yellow-800', // paused / minor
  good: 'bg-green-100 text-green-700', // done / approved / paid
  bad: 'bg-red-100 text-red-700', // rejected / cancelled / problem
  muted: 'bg-slate-100 text-slate-500', // voided / no longer counts
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
  Voided: 'muted',
}

// Database values that aren't nice to read as-is.
const STATUS_LABEL: Record<string, string> = {
  InProgress: 'In Progress',
  InTransit: 'In Transit',
  PickedUp: 'Picked Up',
  OnHold: 'On Hold',
}

export default function StatusBadge({ status, label }: { status: string; label?: ReactNode }) {
  const tone = TONES[STATUS_TONE[status] ?? 'neutral']
  return (
    <span className={`inline-block whitespace-nowrap px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  )
}
