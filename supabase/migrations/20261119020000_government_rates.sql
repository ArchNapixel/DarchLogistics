-- government_rates: SSS / PhilHealth / Pag-IBIG rates and the BIR weekly tax
-- table, moved out of src/lib/governmentContributions.ts so a law change is
-- a new row, not a code change.
--
-- One row = the full set of rules from `effective_from` on. A payslip uses
-- the latest row whose effective_from is on or before its period END (the
-- month it belongs to). Add a NEW row when a rate changes -- don't edit the
-- old one, or regenerating an older week would use the new numbers.
--
-- Rates are PERCENT (5 = 5%), like app_settings.driver_commission_rate.
-- weekly_tax_brackets: [{"over": 4808, "fixed": 0, "rate": 15}, ...] --
-- tax = fixed + (taxable pay - over) x rate%, for the highest "over" that the
-- pay is above; pay at or below every "over" = no tax.

create table if not exists public.government_rates (
  rate_set_id bigint generated always as identity primary key,
  effective_from date not null unique,
  -- SSS: monthly salary credit (MSC) = pay rounded to the nearest step,
  -- kept between min and max. EC is employer-only: low below the
  -- threshold MSC, high from it.
  sss_msc_min numeric(12,2) not null,
  sss_msc_max numeric(12,2) not null,
  sss_msc_step numeric(12,2) not null,
  sss_ee_rate numeric(6,3) not null,
  sss_er_rate numeric(6,3) not null,
  sss_ec_threshold numeric(12,2) not null,
  sss_ec_low numeric(12,2) not null,
  sss_ec_high numeric(12,2) not null,
  -- PhilHealth: rate x monthly pay kept between floor and ceiling.
  philhealth_floor numeric(12,2) not null,
  philhealth_ceiling numeric(12,2) not null,
  philhealth_ee_rate numeric(6,3) not null,
  philhealth_er_rate numeric(6,3) not null,
  -- Pag-IBIG: rate x pay capped at salary_cap; employee pays the low rate
  -- when monthly pay is at or below low_salary.
  pagibig_salary_cap numeric(12,2) not null,
  pagibig_low_salary numeric(12,2) not null,
  pagibig_ee_rate_low numeric(6,3) not null,
  pagibig_ee_rate numeric(6,3) not null,
  pagibig_er_rate numeric(6,3) not null,
  weekly_tax_brackets jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  constraint government_rates_sane check (
    sss_msc_min > 0 and sss_msc_min <= sss_msc_max and sss_msc_step > 0
    and philhealth_floor >= 0 and philhealth_floor <= philhealth_ceiling
    and pagibig_salary_cap > 0 and pagibig_low_salary >= 0
    and sss_ec_threshold >= 0 and sss_ec_low >= 0 and sss_ec_high >= 0
    and sss_ee_rate between 0 and 100 and sss_er_rate between 0 and 100
    and philhealth_ee_rate between 0 and 100 and philhealth_er_rate between 0 and 100
    and pagibig_ee_rate_low between 0 and 100 and pagibig_ee_rate between 0 and 100
    and pagibig_er_rate between 0 and 100
    and jsonb_typeof(weekly_tax_brackets) = 'array'
  )
);

alter table public.government_rates enable row level security;

-- Payroll is Admin-only, so are its rates. No delete: add a newer row instead.
drop policy if exists government_rates_select_admin on public.government_rates;
create policy government_rates_select_admin on public.government_rates
  for select to authenticated using (public.is_admin());
drop policy if exists government_rates_insert_admin on public.government_rates;
create policy government_rates_insert_admin on public.government_rates
  for insert to authenticated with check (public.is_admin());
drop policy if exists government_rates_update_admin on public.government_rates;
create policy government_rates_update_admin on public.government_rates
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- The rates the app used until now (the 2026 rules: SSS 15% since Jan 2025,
-- PhilHealth 5% since 2024, Pag-IBIG HDMF Circular 460, TRAIN tax table 2023+).
insert into public.government_rates (
  effective_from,
  sss_msc_min, sss_msc_max, sss_msc_step, sss_ee_rate, sss_er_rate,
  sss_ec_threshold, sss_ec_low, sss_ec_high,
  philhealth_floor, philhealth_ceiling, philhealth_ee_rate, philhealth_er_rate,
  pagibig_salary_cap, pagibig_low_salary, pagibig_ee_rate_low, pagibig_ee_rate, pagibig_er_rate,
  weekly_tax_brackets, note
) values (
  '2025-01-01',
  5000, 35000, 500, 5, 10,
  15000, 10, 30,
  10000, 100000, 2.5, 2.5,
  10000, 1500, 1, 2, 2,
  '[{"over": 4808, "fixed": 0, "rate": 15},
    {"over": 7692, "fixed": 432.6, "rate": 20},
    {"over": 15385, "fixed": 1971.2, "rate": 25},
    {"over": 38462, "fixed": 7740.45, "rate": 30},
    {"over": 153846, "fixed": 42355.65, "rate": 35}]'::jsonb,
  'Rates the app used before this table existed.'
) on conflict (effective_from) do nothing;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261119020000', 'government_rates') on conflict (version) do nothing;
