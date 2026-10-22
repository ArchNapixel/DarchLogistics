// SettingsSection: central place to edit business constants (diesel
// price per liter, driver commission rate, and anything else added to
// `app_settings` later) -- one row per setting, edited as a plain form
// instead of the usual Add/Edit modal pattern, since these rows aren't
// created or deleted here, only their values change. New constants get
// added by inserting a row into `app_settings` directly (SQL), and they
// show up here automatically since the form just maps over whatever
// rows exist.
//
// A row with unit 'time' (default_trip_start_time) is a time of day
// stored as minutes after midnight (360 = 6 AM), edited with the 12-hour
// TimeInput12 picker instead of a number box.
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import PageHeader from '../../../components/PageHeader'
import { showToast } from '../../../components/Toast'
import EmptyState from '../../../components/EmptyState'
import TimeInput12 from '../../../components/TimeInput12'
import { formatMinutesOfDay } from '../../../lib/format'

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
    showToast('Settings saved.')
    loadSettings()
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Business constants used across the app -- diesel price, commission rates, trip start time, and similar values."
      />

      {loading && <p className="mt-4 text-slate-500">Loading settings...</p>}
      {!loading && error && <p className="mt-4 text-red-700">{error}</p>}

      {!loading && !error && settings.length === 0 && (
        <EmptyState message="No settings configured yet." className="mt-4" />
      )}

      {!loading && !error && settings.length > 0 && (
        <div className="mt-6 max-w-md border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4">
            {settings.map((setting) => (
              <label
                key={setting.setting_key}
                className="flex flex-col gap-1 text-sm font-medium text-slate-700"
              >
                {setting.label}
                {setting.unit === 'time' ? (
                  <div className="flex items-center gap-3">
                    <TimeInput12
                      label={setting.label}
                      value={Number(values[setting.setting_key]) || 0}
                      onChange={(minutes) =>
                        setValues((prev) => ({ ...prev, [setting.setting_key]: String(minutes) }))
                      }
                    />
                    <span className="text-sm text-slate-400">
                      {formatMinutesOfDay(Number(values[setting.setting_key]) || 0)}
                    </span>
                  </div>
                ) : (
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
                    className="w-full border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
                  />
                  {setting.unit && (
                    <span className="text-sm text-slate-400">{setting.unit}</span>
                  )}
                </div>
                )}
              </label>
            ))}
          </div>

          {saveError && (
            <p className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">
              {saveError}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary mt-6 px-4 py-2 text-sm font-medium"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}

export default SettingsSection
