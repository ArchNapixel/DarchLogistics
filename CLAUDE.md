 # Darch Logistics — Project Context

## Stack
React + Vite, Tailwind CSS, Supabase (JS client, already connected — 
don't touch env vars or the Supabase client setup file).

## User is a beginner coder
Keep code simple, well-commented. Explain briefly what each file does 
before creating it.

## What's already built (DO NOT rebuild or touch these)
- Public landing page with nav, hero, About section
- Public quote request form (inserts into `quote_requests`)
- Staff login/logout (Supabase Auth) + protected route wrapper
- 3-tier role routing: isStaff() (Admin/Dispatcher), isEmployee() (Driver/Mechanic)
- StaffDashboard (Admin + Dispatcher — full working dashboard)
- EmployeeDashboard "My Tasks" section (Section 1 — driver trips / mechanic 
  work orders list)

## Currently in progress
EmployeeDashboard — Sections 2, 3, 4 (Update Trip Status, Report Issue, 
Add Trip Expense). Building one section at a time, pausing after each 
for testing.

## Not started yet
ClientDashboard, "My History" pages, Quotation module beyond public form, 
Bookings management screens.

## Rules
- Before any Supabase query, confirm exact table/column names with me — 
  never guess schema
- Build one feature/section at a time, stop after each for testing