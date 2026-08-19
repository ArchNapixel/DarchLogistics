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
