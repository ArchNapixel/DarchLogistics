// Role helpers. Keeps tier logic in one place instead of comparing
// role strings all over the app.
//
// 3 tiers, 5 roles:
//   staff    = Admin, Dispatcher   (identical dashboard/access)
//   employee = Driver, Mechanic    (identical dashboard/access)
//   client   = Client

export function isStaff(role: string | null): boolean {
  return role === 'Admin' || role === 'Dispatcher'
}

export function isEmployee(role: string | null): boolean {
  return role === 'Driver' || role === 'Mechanic'
}

// Admin and Dispatcher share the "staff" tier for route protection, but
// no longer share the same sidebar/dashboard -- Dispatcher gets a
// restricted view (Dispatch Board + context pages, no editing of
// itinerary status). These two let callers tell them apart.
export function isAdmin(role: string | null): boolean {
  return role === 'Admin'
}

export function isDispatcher(role: string | null): boolean {
  return role === 'Dispatcher'
}
