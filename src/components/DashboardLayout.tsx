// DashboardLayout: the one shared shell used by all 3 dashboard tiers --
// logo, notification bell, user name + role badge, logout button, and an
// optional sidebar.
// The actual page content renders into <Outlet /> via React Router's
// nested routes (see DashboardRouter.tsx).
// Sidebar: on phones (< md) it is a slide-in drawer opened by a hamburger
// in the header; category flyouts open on click/keyboard (and on hover on
// desktop) and show inline inside the drawer on phones.
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
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
  const { username, role } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Phone drawer open/closed, and which category flyout was clicked open.
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  // The logo goes to the person's own landing page: the first sidebar
  // page (Admin -> KPI page, Dispatcher -> Dispatch Board).
  const homePath = sidebarLinks.find((l) => l.to)?.to ?? '/dashboard'

  function closeNav() {
    setDrawerOpen(false)
    setOpenMenu(null)
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
    <div className="flex min-h-screen flex-col bg-slate-50">
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
          {/* Name is hidden on the smallest screens to keep the bar on one line */}
          <span className="hidden font-medium text-slate-900 sm:inline">
            {username}
          </span>
          <RoleBadge role={role} />
          <button
            onClick={handleLogout}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Log Out
          </button>
        </div>
      </header>

      <div className="flex flex-1">
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
              className={`fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-y-auto bg-brand-steel md:overflow-visible p-4 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 md:self-start ${
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
                              : 'text-white/90 hover:bg-brand-steel-dark hover:text-white'
                          }`
                        }
                      >
                        {link.label}
                      </NavLink>
                    )
                  }

                  // A category counts as "current" when its own page or
                  // any child page is showing.
                  const isCurrent =
                    pathname === link.to ||
                    link.children.some((c) => pathname === c.to)
                  const isOpen = openMenu === link.label
                  const triggerClass = `flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium ${
                    isCurrent
                      ? 'bg-slate-900 text-white'
                      : `text-white/90 hover:text-white ${
                          isOpen ? 'bg-brand-steel-dark' : 'hover:bg-brand-steel-dark'
                        }`
                  }`

                  return (
                    <div
                      key={link.label}
                      className="relative"
                      // Mouse hover opens this menu (and closes any other, since
                      // there's only one openMenu); touch uses the click below.
                      onPointerEnter={(e) =>
                        e.pointerType === 'mouse' && setOpenMenu(link.label)
                      }
                      onPointerLeave={(e) =>
                        e.pointerType === 'mouse' && setOpenMenu(null)
                      }
                    >
                      {/* Click/Enter toggles the flyout (works on touch and
                      keyboard). */}
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpenMenu(isOpen ? null : link.label)}
                        className={triggerClass}
                      >
                        {link.label}
                        <span className="text-xs text-white/60">
                          {isOpen ? '⌄' : '›'}
                        </span>
                      </button>

                      {/* On desktop: absolute flyout with no gap after the
                      trigger (left-full, no margin) -- a gap would be a dead
                      zone where moving the mouse diagonally drops the hover
                      and closes the menu. On phones: shown inline, indented,
                      inside the drawer. Kept white/slate (not blue) on
                      desktop since it's a floating menu over page content. */}
                      <div
                        className={`${
                          isOpen ? 'block' : 'hidden'
                        } ml-3 mt-1 md:absolute md:left-full md:top-0 md:z-10 md:ml-0 md:mt-0 md:min-w-40 md:border md:border-brand-steel-dark md:bg-white md:p-1 md:shadow-lg`}
                      >
                        {/* Category with its own page: first entry links to it */}
                        {[
                          ...(link.to
                            ? [{ label: link.label, to: link.to }]
                            : []),
                          ...link.children,
                        ].map((child) => (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            end
                            onClick={closeNav}
                            className={({ isActive }) =>
                              `block px-3 py-2 text-sm font-medium ${
                                isActive
                                  ? 'bg-slate-900 text-white'
                                  : 'text-white/90 hover:bg-brand-steel-dark md:text-slate-600 md:hover:bg-slate-100 md:hover:text-slate-900'
                              }`
                            }
                          >
                            {child.label}
                          </NavLink>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </nav>

              {isAdmin(role) && (
                <NavLink
                  to="/dashboard/settings"
                  onClick={closeNav}
                  className={({ isActive }) =>
                    `mt-4 border-t border-brand-steel-dark px-3 pt-4 text-sm font-medium ${
                      isActive ? 'text-white' : 'text-white/80 hover:text-white'
                    }`
                  }
                >
                  ⚙ Settings
                </NavLink>
              )}
            </aside>
          </>
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DashboardLayout
