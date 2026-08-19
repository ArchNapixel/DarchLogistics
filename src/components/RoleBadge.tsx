// RoleBadge: a small colored pill showing the user's actual role.
// Note this is purely visual -- access level is decided separately by
// isStaff()/isEmployee() in src/lib/roles.ts, not by this component.
const ROLE_BADGE_STYLES: Record<string, string> = {
  Admin: 'bg-blue-100 text-blue-700',
  Dispatcher: 'bg-purple-100 text-purple-700',
  Driver: 'bg-green-100 text-green-700',
  Mechanic: 'bg-orange-100 text-orange-700',
  Client: 'bg-gray-100 text-gray-700',
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null

  const styles = ROLE_BADGE_STYLES[role] ?? 'bg-gray-100 text-gray-700'

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {role}
    </span>
  )
}

export default RoleBadge
