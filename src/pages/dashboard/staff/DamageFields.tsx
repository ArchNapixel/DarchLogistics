// DamageFields: the cargo-condition part of a damage report -- condition
// (big radio choices), what happened and the estimated cost. Used by the
// Report Damage form on Damage Charges. The form state and the save live
// in lib/damageCharges.ts; who pays is WhoPaysFields.
import type { DamageCondition, DamageInput } from '../../../lib/damageCharges'
import { filterAmountInput } from '../../../lib/amountInput'

const fieldClasses =
  'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary'
const labelClasses = 'text-sm font-semibold text-ink'

const CONDITIONS: { value: DamageCondition; label: string }[] = [
  { value: 'Damaged', label: 'Damaged' },
  { value: 'Partial', label: 'Partial (short)' },
  { value: 'Missing', label: 'Missing' },
]

const LOSS_LABELS: Record<DamageCondition, string> = {
  Damaged: 'What was damaged?',
  Partial: 'What was short / not delivered?',
  Missing: 'What went missing?',
}

function DamageFields({
  value,
  onChange,
}: {
  value: DamageInput
  onChange: (next: DamageInput) => void
}) {

  return (
    <>
      <fieldset className="flex flex-col gap-1.5">
        <legend className={`${labelClasses} pb-1.5`}>Cargo condition</legend>
        <div className="grid grid-cols-2 gap-2">
          {CONDITIONS.map((choice) => (
            <label
              key={choice.value}
              className={`flex min-h-11 cursor-pointer items-center gap-2.5 px-3.5 text-sm font-semibold text-ink ${
                value.condition === choice.value ? 'border-2 border-primary bg-primary-soft' : 'border border-line-control'
              }`}
            >
              <input
                type="radio"
                name="cargo-condition"
                checked={value.condition === choice.value}
                onChange={() => onChange({ ...value, condition: choice.value })}
                className="h-[18px] w-[18px] accent-primary"
              />
              {choice.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3.5 border border-orange-700 bg-orange-50 px-4 py-3.5">
        <label className="flex flex-col gap-1.5">
          <span className={labelClasses}>{LOSS_LABELS[value.condition]}</span>
          <textarea
            value={value.description}
            onChange={(e) => onChange({ ...value, description: e.target.value })}
            rows={2}
            maxLength={500}
            placeholder="Describe the problem"
            className={`${fieldClasses} resize-none py-2.5`}
          />
        </label>
        <label className="flex max-w-[280px] flex-col gap-1.5">
          <span className={labelClasses}>Estimated cost (₱)</span>
          <input
            type="text"
            inputMode="decimal"
            value={value.cost}
            onChange={(e) => onChange({ ...value, cost: filterAmountInput(e.target.value) })}
            placeholder="0.00"
            className={`${fieldClasses} text-right tabular-nums`}
          />
        </label>
      </div>
    </>
  )
}

export default DamageFields
