// DamageFields: the cargo-condition part of a damage report -- condition,
// then (for anything but Good) what happened, estimated cost, and who
// pays. Shared by MarkDeliveredModal (Dispatch Board) and
// ReportDamageModal (Damage Charges page). The form state and the save
// live in lib/damageCharges.ts.
import type { DamageCondition, DamageInput } from '../../../lib/damageCharges'

const fieldClasses =
  'w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex min-w-0 flex-col gap-1 text-sm font-medium text-slate-700'

const LOSS_LABELS: Record<Exclude<DamageCondition, 'Good'>, string> = {
  Damaged: 'What was damaged?',
  Partial: 'What was short / not delivered?',
  Missing: 'What went missing?',
}

function DamageFields({
  value,
  onChange,
  allowGood,
}: {
  value: DamageInput
  onChange: (next: DamageInput) => void
  // false on the Report Damage form -- there's always something to report.
  allowGood: boolean
}) {
  return (
    <>
      <label className={labelClasses}>
        Cargo condition
        <select
          value={value.condition}
          onChange={(e) => onChange({ ...value, condition: e.target.value as DamageCondition })}
          className={fieldClasses}
        >
          {allowGood && <option value="Good">Good -- no problems</option>}
          <option value="Damaged">Damaged</option>
          <option value="Partial">Partial (short)</option>
          <option value="Missing">Missing</option>
        </select>
      </label>

      {value.condition !== 'Good' && (
        <>
          <label className={labelClasses}>
            {LOSS_LABELS[value.condition]}
            <textarea
              value={value.description}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              rows={3}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Estimated cost
            <input
              type="number"
              min="0"
              step="0.01"
              value={value.cost}
              onChange={(e) => onChange({ ...value, cost: e.target.value })}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Charge to
            <select
              value={value.chargeTo}
              onChange={(e) =>
                onChange({ ...value, chargeTo: e.target.value as 'Client' | 'Company' })
              }
              className={fieldClasses}
            >
              <option value="Client">Client</option>
              <option value="Company">Company</option>
            </select>
          </label>
        </>
      )}
    </>
  )
}

export default DamageFields
