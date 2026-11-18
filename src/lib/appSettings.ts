// appSettings: read one number from the Settings page (`app_settings`).
// A missing row gives `fallback` (the value the app used before the setting
// existed); a failed read is an error, so a wrong number is never guessed.
import { supabase } from './supabaseClient'

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
