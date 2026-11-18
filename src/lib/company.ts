// company: the company's details -- printed on Billing / Statements, shown
// in the public footer -- and the base barangay every truck leaves from and
// returns to (odometer km). One row in `company_profile`, edited on Settings.
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { cached } from './shortCache'

export type Company = {
  company_name: string
  address: string
  // Saved as 11 digits (09XXXXXXXXX); show it with formatPhone().
  phone_number: string
  email: string | null
  tin_number: string | null
  base_city: string
  base_barangay: string
}

// Shown until the row has loaded (and if it can't be read) -- the details the
// app had before company_profile existed.
export const DEFAULT_COMPANY: Company = {
  company_name: 'Darch Logistics',
  address: 'Brgy. J.P. Laurel, Panabo City',
  phone_number: '09660475467',
  email: 'colesarch48@gmail.com',
  tin_number: null,
  base_city: 'Panabo City',
  base_barangay: 'J.P. Laurel',
}

export const COMPANY_COLUMNS = 'company_name, address, phone_number, email, tin_number, base_city, base_barangay'

export async function loadCompany(): Promise<{ company: Company; error: string | null }> {
  return cached('company_profile', async () => {
    const { data, error } = await supabase.from('company_profile').select(COMPANY_COLUMNS).eq('id', 1).maybeSingle()
    return { company: (data as Company | null) ?? DEFAULT_COMPANY, error: error?.message ?? null }
  })
}

// "09660475467" -> "0966 047 5467" (anything else is shown as it is).
export function formatPhone(digits: string): string {
  return /^\d{11}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : digits
}

// In a component: DEFAULT_COMPANY until the row has loaded.
export function useCompany(): Company {
  const [company, setCompany] = useState(DEFAULT_COMPANY)
  useEffect(() => {
    let cancelled = false
    loadCompany().then((result) => {
      if (!cancelled) setCompany(result.company)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return company
}
