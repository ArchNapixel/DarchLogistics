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
import { isAdmin } from '../lib/roles'
import RoleBadge from './RoleBadge'

type SidebarLink = {
  label: string
  // A category header (e.g. "Operations") has children but no page of
  // its own -- to is left out for those, and the label itself isn't a
  // link, just the thing that reveals the flyout.
  to?: string
  children?: { label: string; to: string }[]
}

// Icon shown beside each sidebar tab, looked up by its label. Each value is
// an SVG path drawn on a 24x24 grid (simple outline style, no icon library).
const HOME = 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z'
const CLOCK = 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2'
const FILE =
  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8'
const TAB_ICONS: Record<string, string> = {
  Dashboard: HOME,
  Reports: 'M18 20V10M12 20V4M6 20v-6',
  'Payment Tracking': 'M2 5h20v14H2zM2 10h20',
  Quotations: FILE,
  Bookings: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  Clients:
    'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  'Dispatch Board':
    'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  Employees: 'M2 7h20v14H2zM16 7V3H8v4',
  Attendance: CLOCK,
  'My Attendance': CLOCK,
  Payroll: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  'Cash Advance': 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'Truck Monitoring':
    'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  Fleet:
    'M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  Maintenance:
    'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z',
  Inventory: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  'Damage Charges':
    'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  'My Payslips': 'M4 2v20l3-2 3 2 3-2 3 2 3-2 2 2V2zM8 8h8M8 12h8',
  Settings:
    'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  'My History': 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  'My Trips History': 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
}

function TabIcon({ label }: { label: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mr-2.5 inline-block shrink-0"
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
    const { error } = await supabase.auth.signOut()

    if (error) {
      // Sign-out failed -- the session may still be valid, which matters
      // on a shared computer. Tell the person plainly instead of quietly
      // sending them to the login screen as if it worked.
      console.error('Sign out failed', error)
      window.alert(
        "Logging out didn't fully complete. If you're on a shared " +
          'computer, please close the browser to be safe, then try ' +
          'logging out again.',
      )
    }

    navigate('/')
  }

  return (
    // h-dvh (dynamic viewport height) caps the shell at the *visible* window
    // height -- unlike h-screen it shrinks with a phone's browser toolbar, so
    // nothing gets hidden behind it. Only <main> scrolls.
    <div className="flex h-dvh flex-col bg-slate-50">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {sidebarLinks.length > 0 && (
            <button
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label="Toggle navigation"
              aria-expanded={drawerOpen}
              aria-controls="dashboard-sidebar"
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 text-slate-900 md:hidden"
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
          {/* Logo: dark rounded badge with a truck + two-tone wordmark */}
          <Link to={homePath} className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={TAB_ICONS.Fleet} />
              </svg>
            </span>
            {/* Wordmark shrinks on phones; hidden on the tiniest screens so the
            header buttons always fit (the logo badge still links home). */}
            <span className="hidden truncate font-display text-lg font-semibold uppercase tracking-wide text-slate-900 min-[400px]:inline sm:text-2xl">
              Darch <span className="font-medium text-brand-steel">Logistics</span>
            </span>
          </Link>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <ComplianceExpiryAlerts />
          {/* Role pill is nice-to-have; drop it on phones to save room */}
          <span className="hidden sm:inline">
            <RoleBadge role={role} />
          </span>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 sm:px-4"
          >
            Log Out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {sidebarLinks.length > 0 && (
          <>
            {/* Dark backdrop behind the phone drawer; tap it to close */}
            {drawerOpen && (
              <div
                onClick={closeNav}
                className="fixed inset-0 z-30 bg-black/40 md:hidden"
              />
            )}

            {/* Sidebar = the 30% secondary color (brand-steel). Active/
            current-page links use slate-900 (the 10% accent, same
            color as every primary action button in the app) so the
            current page stays visually distinct against the blue. */}
            <aside
              id="dashboard-sidebar"
              className={`fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 transition-transform md:static md:translate-x-0 ${
                drawerOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            >
              <nav aria-label="Dashboard" className="flex flex-1 flex-col gap-1">
                {sidebarLinks.map((link) => {
                  if (!link.children) {
                    return (
                      <NavLink
                        key={link.to}
                        to={link.to!}
                        end
                        onClick={closeNav}
                        className={({ isActive }) =>
                          `flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
                            isActive
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                          }`
                        }
                      >
                        <TabIcon label={link.label} />
                        {link.label}
                      </NavLink>
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
                    <div key={link.label} className="mt-3 flex flex-col gap-1">
                      <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        {link.label}
                      </div>
                      {tabs.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end
                          onClick={closeNav}
                          className={({ isActive }) =>
                            `flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
                              isActive
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                            }`
                          }
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
                <NavLink
                  to="/dashboard/settings"
                  onClick={closeNav}
                  className={({ isActive }) =>
                    `mt-4 flex items-center border-t border-slate-200 px-3 pt-4 text-sm font-medium ${
                      isActive ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                    }`
                  }
                >
                  <TabIcon label="Settings" />
                  Settings
                </NavLink>
              )}
            </aside>
          </>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DashboardLayout
