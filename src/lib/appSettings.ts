// appSettings: read one number from the Settings page (`app_settings`).
// A missing row gives `fallback` (the value the app used before the setting
// existed); a failed read is an error, so a wrong number is never guessed.
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { cached } from './shortCache'

export async function loadSettingValue(
  key: string,
  fallback: number,
): Promise<{ value: number; error: string | null }> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('setting_value')
    .eq('setting_key', key)
    .maybeSingle()
  if (error) return { value: fallback, error: error.message }
  return { value: data ? Number(data.setting_value) : fallback, error: null }
}

// Several settings at once. `defaults` = { setting_key: value used when the
// row is missing }; a failed read also gives the defaults (these are limits
// and warnings, not money -- the database repeats the ones that matter).
export async function loadSettingValues<K extends string>(defaults: Record<K, number>): Promise<Record<K, number>> {
  const keys = Object.keys(defaults) as K[]
  // Kept a few seconds, so several boxes on one page ask once.
  const { data } = await cached(`settings:${keys.join(',')}`, async () => {
    const result = await supabase.from('app_settings').select('setting_key, setting_value').in('setting_key', keys)
    return { data: result.data, error: result.error?.message ?? null }
  })
  const values = { ...defaults }
  for (const row of data ?? []) {
    if (row.setting_key in values) values[row.setting_key as K] = Number(row.setting_value)
  }
  return values
}

// The same in a component: the defaults until the rows have loaded. Pass a
// constant object (defined outside the component), it's read once.
export function useSettingValues<K extends string>(defaults: Record<K, number>): Record<K, number> {
  const [values, setValues] = useState(defaults)
  useEffect(() => {
    let cancelled = false
    loadSettingValues(defaults).then((loaded) => {
      if (!cancelled) setValues(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [defaults])
  return values
}
