// DashboardLayout: the one shared shell used by all 3 dashboard tiers --
// logo, notification bell, user name + role badge, logout button, and an
// optional sidebar.
// The actual page content renders into <Outlet /> via React Router's
// nested routes (see DashboardRouter.tsx).
// Sidebar: on phones (< md) it is a slide-in drawer opened by a hamburger
// in the header. Categories are flat headers with their tabs listed under them.
import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import ComplianceExpiryAlerts from './ComplianceExpiryAlerts'
import TripNotifications from './TripNotifications'
import { isAdmin } from '../lib/roles'
import RoleBadge from './RoleBadge'
import { showToast } from './Toast'

type SidebarLink = {
  label: string
  // A category header (e.g. "Operations") has children but no page of
  // its own -- to is left out for those, and the label itself isn't a
  // link, just the thing that reveals the flyout.
  to?: string
  children?: { label: string; to: string }[]
  // Pinned to the bottom of the sidebar (e.g. the client's My Profile).
  bottom?: boolean
}

// Icon shown beside each sidebar tab, looked up by its label. Each value is
// an SVG path drawn on a 24x24 grid (simple outline style, no icon library).
// Same icon set as the redesign canvas on claude.ai.
const ICON = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6',
  cal: 'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M8 2v4 M16 2v4',
  calCheck:
    'M5 4h14a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M8 2v4 M16 2v4 M9 15l2 2 4-4',
  users:
    'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M21 20v-1a4 4 0 0 0-3-3.9 M16 4.1a3.5 3.5 0 0 1 0 6.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  truck:
    'M2 6h11v10H2z M13 9h5l4 4v3h-9z M6 18.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M16 18.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  list: 'M4 6h10 M8 12h12 M6 18h8',
  case: 'M3 8h18v12H3z M8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3 M3 13h18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  dollar:
    'M12 2v20 M17 6.5C16 5 14.3 4.5 12 4.5c-2.5 0-4.5 1.2-4.5 3.2 0 4.8 9.5 2.3 9.5 7 0 2-2 3.3-5 3.3-2.5 0-4.5-.8-5.5-2.5',
  cash: 'M2 6h20v12H2z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M6 12h.01 M18 12h.01',
  trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  receipt: 'M4 4h16v17l-3-2-2.5 2-2.5-2-2.5 2L7 19l-3 2z M8 9h8 M8 13h8',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4 M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2z M16 14.5h.01',
  bill: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  stmt: 'M5 3h14v18H5z M9 8h6 M9 12h6 M9 16h4',
  gauge: 'M4 18a9 9 0 1 1 16 0 M12 14l4-5',
  wrench: 'M14.5 6.5a4 4 0 0 0 4.5 5L9 21.5a2 2 0 0 1-3-3l10-10 M14.5 6.5l3-3 2 2-3 3',
  box: 'M3 8l9-5 9 5v8l-9 5-9-5z M3 8l9 5 9-5 M12 13v8',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  warning:
    'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  sliders: 'M4 6h10 M18 6h2 M4 12h2 M10 12h10 M4 18h12 M14 4v4 M8 10v4 M18 16v4',
}
const TAB_ICONS: Record<string, string> = {
  // Admin
  Dashboard: ICON.home,
  Reports: ICON.chart,
  Quotations: ICON.doc,
  'Bookings & Trips': ICON.cal,
  Clients: ICON.users,
  'Dispatch Board': ICON.truck,
  'Schedule Overview': ICON.list,
  Employees: ICON.case,
  Attendance: ICON.clock,
  Payroll: ICON.dollar,
  'Cash Advances': ICON.cash,
  'Money Summary': ICON.trend,
  'Bills Receivable': ICON.receipt,
  Collections: ICON.wallet,
  Billing: ICON.bill,
  Statements: ICON.stmt,
  'Truck Monitoring': ICON.gauge,
  Fleet: ICON.truck,
  Maintenance: ICON.wrench,
  Inventory: ICON.box,
  Settings: ICON.sliders,
  // Dispatcher / employees
  'Damage Charges': ICON.warning,
  'My Schedule': ICON.cal,
  'My History': ICON.history,
  'My Trips History': ICON.history,
  'My Attendance': ICON.clock,
  'My Leave': ICON.calCheck,
  'My Payslips': ICON.receipt,
  'My Profile': ICON.user,
  // Client portal
  Home: ICON.home,
  'My Quotes': ICON.doc,
  'My Bookings': ICON.cal,
  Payments: ICON.wallet,
  'My Requests': ICON.chat,
}

// One sidebar row. The current page is filled steel blue.
function navItemClass({ isActive }: { isActive: boolean }) {
  return `flex h-10 items-center gap-2 rounded-[2px] px-2 text-sm ${
    isActive
      ? 'bg-primary font-semibold text-white'
      : 'font-medium text-slate-200 hover:bg-white/12 hover:text-white'
  }`
}

function TabIcon({ label }: { label: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d={TAB_ICONS[label] ?? 'M12 12h.01'} />
    </svg>
  )
}

function DashboardLayout({ sidebarLinks }: { sidebarLinks: SidebarLink[] }) {
  const { role } = useAuth()
  const navigate = useNavigate()
  // Phone drawer open/closed.
  const [drawerOpen, setDrawerOpen] = useState(false)

  // The logo goes to the person's own landing page: the first sidebar
  // page (Admin -> KPI page, Dispatcher -> Dispatch Board).
  const homePath = sidebarLinks.find((l) => l.to)?.to ?? '/dashboard'

  function closeNav() {
    setDrawerOpen(false)
  }

  async function handleLogout() {
    // Leave the dashboard BEFORE signing out: once the session is gone,
    // ProtectedRoute would bounce us to the staff /login page first.
    navigate('/', { replace: true })
    const { error } = await supabase.auth.signOut()

    if (error) {
      // Sign-out failed -- the session may still be valid, which matters
      // on a shared computer. Tell the person plainly instead of quietly
      // sending them to the login screen as if it worked.
      console.error('Sign out failed', error)
      showToast(
        "Logging out didn't fully complete. If you're on a shared " +
          'computer, please close the browser to be safe, then try ' +
          'logging out again.',
        'error',
      )
    }
  }

  return (
    // h-dvh (dynamic viewport height) caps the shell at the *visible* window
    // height -- unlike h-screen it shrinks with a phone's browser toolbar, so
    // nothing gets hidden behind it. Only <main> scrolls.
    // The print: classes only matter when printing a page (Statements of
    // Account): hide the header/sidebar and let the page flow past one screen.
    <div className="flex h-dvh flex-col bg-slate-50 print:block print:h-auto">
      <header className="flex min-h-[70px] items-center justify-between gap-2 border-b print:hidden border-slate-200 bg-white px-3 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {sidebarLinks.length > 0 && (
            <button
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label="Toggle navigation"
              aria-expanded={drawerOpen}
              aria-controls="dashboard-sidebar"
              className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control text-ink md:hidden"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 5h14M3 10h14M3 15h14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          {/* Logo: square navy badge with a truck + two-tone wordmark */}
          <Link to={homePath} aria-label="Darch Logistics home" className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-navy text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={ICON.truck} />
              </svg>
            </span>
            {/* Wordmark shrinks on phones; hidden on the tiniest screens so the
            header buttons always fit (the logo badge still links home). */}
            <span className="hidden truncate font-display text-xl font-bold uppercase tracking-[0.01em] text-ink min-[400px]:inline sm:text-[28px] sm:leading-8">
              Darch <span className="text-primary">Logistics</span>
            </span>
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <TripNotifications />
          <ComplianceExpiryAlerts />
          {/* Role pill is nice-to-have; drop it on phones to save room */}
          <span className="hidden sm:inline">
            <RoleBadge role={role} />
          </span>
          <button
            onClick={handleLogout}
            className="btn-secondary h-11 px-3 text-sm font-medium text-ink-secondary sm:px-4"
          >
            Log Out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 print:block">
        {sidebarLinks.length > 0 && (
          <>
            {/* Dark backdrop behind the phone drawer; tap it to close */}
            {drawerOpen && (
              <div
                onClick={closeNav}
                className="fixed inset-0 z-30 bg-slate-900/50 md:hidden"
              />
            )}

            {/* Sidebar: navy with light text; the current page is filled
            with the steel-blue accent. Colors: index.css. */}
            <aside
              id="dashboard-sidebar"
              className={`fixed inset-y-0 left-0 z-40 flex w-56 shrink-0 flex-col overflow-y-auto print:hidden bg-navy px-3 py-2 transition-transform md:static md:translate-x-0 ${
                drawerOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              <nav aria-label="Dashboard" className="flex flex-1 flex-col gap-0.5">
                {sidebarLinks.map((link) => {
                  if (!link.children) {
                    const item = (
                      <NavLink
                        key={link.to}
                        to={link.to!}
                        end
                        onClick={closeNav}
                        className={navItemClass}
                      >
                        <TabIcon label={link.label} />
                        {link.label}
                      </NavLink>
                    )
                    // Pinned to the bottom, above a thin rule.
                    return link.bottom ? (
                      <div key={link.to} className="mt-auto border-t border-white/18 pt-2">
                        {item}
                      </div>
                    ) : (
                      item
                    )
                  }

                  // Category = a small "header" label, with its tabs listed
                  // right under it (no flyout). A category with its own page
                  // gets that page as its first tab.
                  const tabs = [
                    ...(link.to ? [{ label: link.label, to: link.to }] : []),
                    ...link.children,
                  ]

                  return (
                    <div key={link.label} className="flex flex-col gap-0.5">
                      <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.06em] text-nav-ink-muted">
                        {link.label}
                      </div>
                      {tabs.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end
                          onClick={closeNav}
                          className={navItemClass}
                        >
                          <TabIcon label={child.label} />
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )
                })}
              </nav>

              {isAdmin(role) && (
                <div className="mt-2 border-t border-white/18 pt-2">
                  <NavLink to="/dashboard/settings" onClick={closeNav} className={navItemClass}>
                    <TabIcon label="Settings" />
                    Settings
                  </NavLink>
                </div>
              )}
            </aside>
          </>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5 print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DashboardLayout
