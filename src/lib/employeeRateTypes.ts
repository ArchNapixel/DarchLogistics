// employeeRateTypes: how an employee is paid -- Drivers by commission,
// everyone else a weekly salary (employees.rate_type) and which
// column holds the amount. Used by AddEmployeeModal and EmployeesSection.
// Commission Per Trip has no column of its own -- a Driver's per-trip
// pay comes entirely from the company-wide Settings (commission % +
// per-trip fee), so there's no per-employee amount to store.
export const RATE_TYPES = [
  { value: 'Weekly Salary', label: 'Weekly salary', column: 'weekly_salary' },
  { value: 'Commission Per Trip', label: 'Commission per trip', column: null },
] as const
