// RoleBadge: a small pill in the header showing the user's actual role --
// the same steel-blue tint for every role (redesign canvas).
// Note this is purely visual -- access level is decided separately by
// isStaff()/isEmployee() in src/lib/roles.ts, not by this component.
function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null

  return (
    <span className="rounded-[2px] bg-primary-soft px-2 py-1 text-xs font-medium text-primary">
      {role}
    </span>
  )
}

export default RoleBadge
