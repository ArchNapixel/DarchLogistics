// pms: where a truck is in its PMS cycle (preventive maintenance every
// app_settings.pms_interval_km, warning pms_due_soon_km before). Pure --
// self-check: node scripts/check-pms.ts. The DB trigger pms_auto_schedule
// uses the same numbers to create the PMS work order at "soon".

export const DEFAULT_PMS_INTERVAL_KM = 1000
export const DEFAULT_PMS_DUE_SOON_KM = 200

export type PmsSettings = { intervalKm: number; dueSoonKm: number }

export type PmsStage = 'ok' | 'soon' | 'due'

export type PmsStatus = {
  nextAt: number // odometer reading the next PMS is due at
  used: number // km since the last PMS
  left: number // km to go (negative = past due)
  pct: number // 0..100, for the bar
  stage: PmsStage
}

// Null when the truck's "Last PMS at" isn't set (no cycle to show).
export function pmsStatus(current: number | null, lastPms: number | null, settings: PmsSettings): PmsStatus | null {
  if (lastPms === null || current === null || settings.intervalKm <= 0) return null
  const round = (km: number) => Math.round(km * 100) / 100
  const nextAt = round(lastPms + settings.intervalKm)
  const used = round(current - lastPms)
  const left = round(nextAt - current)
  const pct = Math.min(100, Math.max(0, (used / settings.intervalKm) * 100))
  const stage: PmsStage = left <= 0 ? 'due' : left <= settings.dueSoonKm ? 'soon' : 'ok'
  return { nextAt, used, left, pct, stage }
}

// Trucks nearest their PMS first; trucks with no cycle last.
export function byPmsUrgency(a: PmsStatus | null, b: PmsStatus | null): number {
  if (!a || !b) return (a ? 0 : 1) - (b ? 0 : 1)
  return a.left - b.left
}
