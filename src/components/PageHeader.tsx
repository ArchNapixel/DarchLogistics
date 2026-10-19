import type { ReactNode } from 'react'

// PageHeader: the title block every dashboard page opens with, so every
// page looks the same. `title` must match the page's sidebar label
// exactly. `subtitle` is one optional muted line. `actions` is the page's
// main button(s), shown on the right (they wrap under the title on phones).
// Bottom margin is built in -- don't add one around it.
export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 print:hidden">
      <div className="min-w-0 border-l-4 border-primary pl-3">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// SectionHeader: the same pattern one level down -- a titled block INSIDE
// a page (Client portal sections, the open Reports tab, panels stacked on
// one page). Smaller and without the accent bar, so it never competes with
// the PageHeader above it.
export function SectionHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
