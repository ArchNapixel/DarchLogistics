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
    // h-screen caps the shell at the window height: only <main> scrolls, so
    // the sidebar (and Settings at its bottom) always fits on screen.
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
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
          <Link to={homePath} className="text-lg font-bold text-slate-900">
            Darch Logistics
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <ComplianceExpiryAlerts />
          <RoleBadge role={role} />
          <button
            onClick={handleLogout}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
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
              className={`fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-y-auto border-r border-slate-200 bg-white md:overflow-visible p-4 transition-transform md:static md:translate-x-0 ${
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
                          `px-3 py-2 text-sm font-medium ${
                            isActive
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                          }`
                        }
                      >
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
                            `px-3 py-2 text-sm font-medium ${
                              isActive
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                            }`
                          }
                        >
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
                    `mt-4 border-t border-slate-200 px-3 pt-4 text-sm font-medium ${
                      isActive ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                    }`
                  }
                >
                  ⚙ Settings
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
