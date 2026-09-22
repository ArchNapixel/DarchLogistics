// DashboardLayout: the one shared shell used by all 3 dashboard tiers --
// logo, user name + role badge, logout button, and an optional sidebar.
// The actual page content renders into <Outlet /> via React Router's
// nested routes (see DashboardRouter.tsx).
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import ComplianceExpiryAlerts from './ComplianceExpiryAlerts'
import { isAdmin } from '../lib/roles'
import RoleBadge from './RoleBadge'

type SidebarLink = {
  label: string
  // A category header (e.g. "Operations") has children but no page of
  // its own -- to is left out for those, and the label itself isn't a
  // link, just the thing that reveals the flyout on hover.
  to?: string
  children?: { label: string; to: string }[]
}

function DashboardLayout({ sidebarLinks }: { sidebarLinks: SidebarLink[] }) {
  const { username, role } = useAuth()
  const navigate = useNavigate()

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
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <span className="text-lg font-bold text-slate-900">
          Darch Logistics
        </span>

        <div className="flex items-center gap-4">
          <span className="font-medium text-slate-900">{username}</span>
          <RoleBadge role={role} />
          <button
            onClick={handleLogout}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Log Out
          </button>
        </div>
      </header>

      <ComplianceExpiryAlerts />

      <div className="flex flex-1">
        {sidebarLinks.length > 0 && (
          // Sidebar = the 30% secondary color (brand-steel). Active/
          // current-page links use slate-900 (the 10% accent, same
          // color as every primary action button in the app) so the
          // current page stays visually distinct against the blue.
          <aside className="flex w-56 flex-col bg-brand-steel p-4">
            <nav className="flex flex-1 flex-col gap-1">
              {sidebarLinks.map((link) =>
                link.children ? (
                  <div key={link.label} className="group relative">
                    {link.to ? (
                      <NavLink
                        to={link.to}
                        end
                        className={({ isActive }) =>
                          `flex items-center justify-between px-3 py-2 text-sm font-medium ${
                            isActive
                              ? 'bg-slate-900 text-white'
                              : 'text-white/90 hover:bg-brand-steel-dark hover:text-white'
                          }`
                        }
                      >
                        {link.label}
                        <span className="text-xs text-white/60">›</span>
                      </NavLink>
                    ) : (
                      <span className="flex cursor-default items-center justify-between px-3 py-2 text-sm font-medium text-white/90 group-hover:bg-brand-steel-dark group-hover:text-white">
                        {link.label}
                        <span className="text-xs text-white/60">›</span>
                      </span>
                    )}

                    {/* No gap between the trigger and this panel (left-full,
                    no margin) -- a gap here would be a dead zone where
                    moving the mouse diagonally toward a lower item drops
                    the hover state and closes the menu before it can be
                    clicked. Kept white/slate (not blue) since it's a
                    floating flyout menu over page content, not the
                    sidebar itself -- matches every other floating panel
                    in the app (dropdowns, modals). */}
                    <div className="absolute left-full top-0 z-10 hidden min-w-40 border border-brand-steel-dark bg-white p-1 shadow-lg group-hover:block">
                      {link.children.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          className={({ isActive }) =>
                            `block px-3 py-2 text-sm font-medium ${
                              isActive
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ) : (
                  <NavLink
                    key={link.to}
                    to={link.to!}
                    end
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
                ),
              )}
            </nav>

            {isAdmin(role) && (
              <NavLink
                to="/dashboard/settings"
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
        )}

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default DashboardLayout
