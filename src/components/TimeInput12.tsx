// TimeInput12: a 12-hour time picker -- hour, minute (5-minute steps) and
// AM/PM dropdowns. Used instead of <input type="time">, which shows a
// 24-hour clock on some computers. The value is minutes after midnight
// (360 = 6 AM), the same unit app_settings time values use.

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5)

const selectClasses =
  'border border-slate-300 bg-white px-2 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'

function TimeInput12({
  value,
  onChange,
  label,
}: {
  value: number
  onChange: (minutes: number) => void
  // Screen-reader name for the group, e.g. "Default trip start time".
  label: string
}) {
  const hour24 = Math.floor(value / 60) % 24
  const minute = value % 60
  const isPm = hour24 >= 12
  const hour12 = hour24 % 12 || 12

  function update(nextHour12: number, nextMinute: number, nextPm: boolean) {
    const nextHour24 = (nextHour12 % 12) + (nextPm ? 12 : 0)
    onChange(nextHour24 * 60 + nextMinute)
  }

  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      <select
        aria-label="Hour"
        value={hour12}
        onChange={(e) => update(Number(e.target.value), minute, isPm)}
        className={selectClasses}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-slate-500">:</span>
      <select
        aria-label="Minute"
        value={minute}
        onChange={(e) => update(hour12, Number(e.target.value), isPm)}
        className={selectClasses}
      >
        {/* Keep an odd saved minute (e.g. 7) selectable instead of blank. */}
        {(MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b)).map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, '0')}
          </option>
        ))}
      </select>
      <select
        aria-label="AM or PM"
        value={isPm ? 'PM' : 'AM'}
        onChange={(e) => update(hour12, minute, e.target.value === 'PM')}
        className={selectClasses}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}

export default TimeInput12
