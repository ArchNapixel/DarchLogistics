// SettingsSection: central place to edit business constants (diesel
// price per liter, driver commission rate, and anything else added to
// `app_settings` later) -- one row per setting, edited as a plain form
// instead of the usual Add/Edit modal pattern, since these rows aren't
// created or deleted here, only their values change. New constants get
// added by inserting a row into `app_settings` directly (SQL), and they
// show up here automatically since the form just maps over whatever
// rows exist.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type Setting = {
  setting_key: string
  label: string
  setting_value: number
  unit: string | null
}

function SettingsSection() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    setLoading(true)

    const { data, error: loadError } = await supabase
      .from('app_settings')
      .select('setting_key, label, setting_value, unit')
      .order('label', { ascending: true })

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setSettings(data)
    setValues(
      Object.fromEntries(
        data.map((setting) => [setting.setting_key, String(setting.setting_value)]),
      ),
    )
    setError(null)
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSavedMessage(null)

    for (const setting of settings) {
      const rawValue = values[setting.setting_key]
      const numericValue = Number(rawValue)

      if (rawValue === '' || Number.isNaN(numericValue)) {
        setSaveError(`Enter a valid number for "${setting.label}".`)
        setSaving(false)
        return
      }

      const { error: updateError } = await supabase
        .from('app_settings')
        .update({ setting_value: numericValue, updated_at: new Date().toISOString() })
        .eq('setting_key', setting.setting_key)

      if (updateError) {
        setSaveError(updateError.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    setSavedMessage('Settings saved.')
    loadSettings()
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Settings</h2>
      <p className="mt-1 text-sm text-slate-500">
        Business constants used across the app -- diesel price, commission
        rates, and similar values that change from time to time.
      </p>

      {loading && <p className="mt-4 text-slate-500">Loading settings...</p>}
      {!loading && error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && settings.length === 0 && (
        <p className="mt-4 text-slate-500">No settings configured yet.</p>
      )}

      {!loading && !error && settings.length > 0 && (
        <div className="mt-6 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4">
            {settings.map((setting) => (
              <label
                key={setting.setting_key}
                className="flex flex-col gap-1 text-sm font-medium text-slate-700"
              >
                {setting.label}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={values[setting.setting_key] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [setting.setting_key]: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
                  />
                  {setting.unit && (
                    <span className="text-sm text-slate-400">{setting.unit}</span>
                  )}
                </div>
              </label>
            ))}
          </div>

          {saveError && (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </p>
          )}
          {savedMessage && (
            <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
              {savedMessage}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}

export default SettingsSection
