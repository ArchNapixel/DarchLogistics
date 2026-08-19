// DashboardLayout: the one shared shell used by all 3 dashboard tiers --
// logo, user name + role badge, logout button, and an optional sidebar.
// The actual page content renders into <Outlet /> via React Router's
// nested routes (see DashboardRouter.tsx).
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import RoleBadge from './RoleBadge'

type SidebarLink = { label: string; to: string }

function DashboardLayout({ sidebarLinks }: { sidebarLinks: SidebarLink[] }) {
  const { username, role } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await supabase.auth.signOut()
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
          <aside className="w-56 border-r border-slate-200 bg-white p-4">
            <nav className="flex flex-col gap-1">
              {sidebarLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
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
