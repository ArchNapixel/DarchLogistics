// DashboardLayout: the one shared shell used by all 3 dashboard tiers --
// logo, user name + role badge, logout button, and an optional sidebar.
// The actual page content renders into <Outlet /> via React Router's
// nested routes (see DashboardRouter.tsx).
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
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

      <div className="flex flex-1">
        {sidebarLinks.length > 0 && (
          <aside className="flex w-56 flex-col border-r border-slate-200 bg-white p-4">
            <nav className="flex flex-1 flex-col gap-1">
              {sidebarLinks.map((link) =>
                link.children ? (
                  <div key={link.label} className="group relative">
                    {link.to ? (
                      <Link
                        to={link.to}
                        className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      >
                        {link.label}
                        <span className="text-xs text-slate-400">›</span>
                      </Link>
                    ) : (
                      <span className="flex cursor-default items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-600 group-hover:bg-slate-100 group-hover:text-slate-900">
                        {link.label}
                        <span className="text-xs text-slate-400">›</span>
                      </span>
                    )}

                    {/* No gap between the trigger and this panel (left-full,
                    no margin) -- a gap here would be a dead zone where
                    moving the mouse diagonally toward a lower item drops
                    the hover state and closes the menu before it can be
                    clicked. */}
                    <div className="absolute left-full top-0 z-10 hidden min-w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg group-hover:block">
                      {link.children.map((child) => (
                        <Link
                          key={child.to}
                          to={child.to}
                          className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        >
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Link
                    key={link.to}
                    to={link.to!}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </nav>

            {isAdmin(role) && (
              <Link
                to="/dashboard/settings"
                className="mt-4 rounded-lg border-t border-slate-200 px-3 pt-4 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                ⚙ Settings
              </Link>
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
