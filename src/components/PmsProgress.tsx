// PmsProgress: a truck's PMS bar -- km since its last PMS out of the
// interval, green / amber (due soon) / red (due or past due). Used on
// Truck Monitoring and the Fleet truck panel. Math: lib/pms.ts.
import { Link } from 'react-router-dom'
import type { PmsSettings, PmsStatus } from '../lib/pms'

const km = (value: number) => `${Math.round(value).toLocaleString()} km`

const BAR = { ok: 'bg-emerald-600', soon: 'bg-amber-500', due: 'bg-red-700' } as const
const TEXT = { ok: 'text-ink-muted', soon: 'text-amber-800', due: 'text-red-700 font-semibold' } as const

function PmsProgress({
  status,
  settings,
  plate,
  className = '',
}: {
  status: PmsStatus | null
  settings: PmsSettings
  plate: string
  className?: string
}) {
  if (!status) {
    return (
      <span className={`text-[13px] text-amber-800 ${className}`}>
        PMS start not set ·{' '}
        <Link to={`/dashboard/fleet?truck=${encodeURIComponent(plate)}`} className="font-semibold text-primary underline">
          Set in Fleet
        </Link>
      </span>
    )
  }
  const label =
    status.stage === 'due'
      ? status.left < 0
        ? `Over by ${km(-status.left)}`
        : 'Due now'
      : `${km(status.left)} left`
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div
        role="progressbar"
        aria-label={`PMS for ${plate}`}
        aria-valuemin={0}
        aria-valuemax={settings.intervalKm}
        aria-valuenow={Math.min(settings.intervalKm, Math.max(0, Math.round(status.used)))}
        aria-valuetext={`${km(status.used)} of ${km(settings.intervalKm)}, ${label}`}
        className="h-2 w-full bg-slate-200"
      >
        <div className={`h-2 ${BAR[status.stage]}`} style={{ width: `${status.pct}%` }} />
      </div>
      <span className="flex flex-wrap justify-between gap-x-2 text-[12px] tabular-nums">
        <span className="text-ink-secondary">
          {km(Math.max(0, status.used))} / {km(settings.intervalKm)}
        </span>
        <span className={TEXT[status.stage]}>{label}</span>
      </span>
    </div>
  )
}

export default PmsProgress
