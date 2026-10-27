// useClientProfile: loads the logged-in client's own `clients` row (name,
// email, phone, address). Used by the Home page (welcome line) and My
// Profile (the Contact details card, ClientProfileSection). In its own file
// so the component files only export components (fast refresh).
//
// `loading` is worked out from what's loaded (is it this client's row
// yet?) rather than set at the start of the effect -- React's lint rule
// forbids setting state synchronously inside an effect.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

export type ClientProfile = {
  client_name: string
  email: string | null
  phone_number: string | null
  address: string | null
}

export function useClientProfile(clientId: number | null) {
  // What was loaded, and for which client.
  const [result, setResult] = useState<{ forId: number; profile: ClientProfile | null; error: string | null } | null>(null)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    supabase
      .from('clients')
      .select('client_name, email, phone_number, address')
      .eq('client_id', clientId)
      .maybeSingle()
      .then(({ data, error: loadError }) => {
        if (cancelled) return
        setResult({ forId: clientId, profile: data, error: loadError?.message ?? null })
      })
    return () => {
      cancelled = true
    }
  }, [clientId])

  const current = clientId !== null && result?.forId === clientId ? result : null
  return {
    profile: current?.profile ?? null,
    loading: clientId !== null && !current,
    error: current?.error ?? null,
    // After a save: show the saved row straight away.
    setProfile: (profile: ClientProfile) => clientId !== null && setResult({ forId: clientId, profile, error: null }),
  }
}
