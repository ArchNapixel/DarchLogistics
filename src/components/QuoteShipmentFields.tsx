// QuoteShipmentFields: the quote inputs, split into the three sections
// the customer wizard steps through (RouteFields, CargoFields,
// ScheduleFields). Staff's NewQuoteRequestModal shows all three on one
// page; QuoteWizard (public form + client portal) shows one per step.
// One set of markup, so no channel can drift from the others. Each
// field shows its own error message right under it (errors come from
// validateShipment in lib/quoteRequest.ts).
import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react'
import LocationPicker from './LocationPicker'
import DateRangePicker from './DateRangePicker'
import {
  PAYMENT_TERMS_LABELS,
  todayDateString,
  type FieldErrors,
  type RecentLocation,
  type ShipmentField,
  type ShipmentForm,
} from '../lib/quoteRequest'

export type SectionProps = {
  form: ShipmentForm
  setField: <K extends ShipmentField>(name: K, value: ShipmentForm[K]) => void
  errors: FieldErrors
}

function inputClasses(hasError: boolean) {
  return `border-2 bg-white px-3 py-2 text-slate-900 transition-colors focus:outline-none ${
    hasError ? 'border-red-400 hover:bg-red-50 focus:border-red-500' : 'border-slate-300 hover:border-slate-500 hover:bg-slate-50 focus:border-slate-500'
  }`
}

// A plain <input> with the error styling applied -- also used for the
// contact fields in the three quote channels.
export function TextInput({
  invalid = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid ? true : undefined}
      className={inputClasses(invalid)}
    />
  )
}

export function Field({
  label,
  hint,
  error,
  wide = false,
  children,
}: {
  label: string
  hint?: string
  error?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm font-medium text-slate-700 ${wide ? 'sm:col-span-2' : ''}`}>
      <span>
        {label}
        {hint && <span className="font-normal text-slate-400"> {hint}</span>}
      </span>
      {children}
      {error && (
        <span className="text-sm font-normal text-red-600" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}

function ToggleGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <div role="group" aria-label={label} className="flex">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`flex-1 border-2 px-3 py-2 text-sm font-medium transition-colors [&:not(:first-child)]:-ml-px ${
              value === option.value
                ? 'relative border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:relative hover:border-slate-500 hover:bg-slate-50'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function RouteFields({
  form,
  setField,
  errors,
  recentLocations,
}: SectionProps & { recentLocations?: RecentLocation[] }) {
  return (
    <>
      <LocationPicker
        stop="pickup"
        value={form.pickup}
        onChange={(value) => setField('pickup', value)}
        error={errors.pickup}
        recentLocations={recentLocations}
      />
      <LocationPicker
        stop="delivery"
        value={form.delivery}
        onChange={(value) => setField('delivery', value)}
        error={errors.delivery}
        recentLocations={recentLocations}
      />
    </>
  )
}

export function CargoFields({ form, setField, errors }: SectionProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setField(e.target.name as ShipmentField, e.target.value as never)
  }

  return (
    <>
      <ToggleGroup
        label="Cargo type"
        options={[
          { value: 'Container', label: 'Container' },
          { value: 'Loose', label: 'Loose cargo' },
        ]}
        value={form.cargoType}
        onChange={(value) => setField('cargoType', value)}
      />

      <ToggleGroup
        label="Trailer size"
        options={[
          { value: '20ft', label: '20 ft' },
          { value: '40ft', label: '40 ft' },
        ]}
        value={form.containerType}
        onChange={(value) => setField('containerType', value)}
      />

      <Field label="Trailer type" error={errors.trailerType}>
        <select
          name="trailerType"
          value={form.trailerType}
          onChange={(e) => setField('trailerType', e.target.value as ShipmentForm['trailerType'])}
          aria-invalid={errors.trailerType ? true : undefined}
          className={inputClasses(!!errors.trailerType)}
        >
          <option value="">Select</option>
          <option value="Flatbed">Flatbed</option>
          <option value="Skeletal">Skeletal</option>
        </select>
      </Field>

      <Field label="Weight" hint="(tons)" error={errors.weight}>
        <input
          type="text"
          name="weight"
          inputMode="decimal"
          value={form.weight}
          onChange={(e) => setField('weight', e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="e.g. 24.5"
          aria-invalid={errors.weight ? true : undefined}
          className={inputClasses(!!errors.weight)}
        />
      </Field>

      <Field label="Deliveries" hint="(trips)" error={errors.deliveryOrderCount}>
        <input
          type="text"
          name="deliveryOrderCount"
          inputMode="numeric"
          value={form.deliveryOrderCount}
          onChange={(e) => setField('deliveryOrderCount', e.target.value.replace(/\D/g, ''))}
          placeholder="e.g. 3"
          aria-invalid={errors.deliveryOrderCount ? true : undefined}
          className={inputClasses(!!errors.deliveryOrderCount)}
        />
      </Field>

      <Field label="Cargo details" error={errors.cargoDescription} wide>
        <textarea
          name="cargoDescription"
          value={form.cargoDescription}
          onChange={handleChange}
          rows={3}
          placeholder="What it is, packing, handling notes"
          aria-invalid={errors.cargoDescription ? true : undefined}
          className={inputClasses(!!errors.cargoDescription)}
        />
      </Field>
    </>
  )
}

export function ScheduleFields({ form, setField, errors }: SectionProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setField(e.target.name as ShipmentField, e.target.value as never)
  }

  const deliveryCount = Number(form.deliveryOrderCount)
  const rate = Number(form.proposedRate)
  const showTotal = Number.isInteger(deliveryCount) && deliveryCount > 1 && rate > 0

  return (
    <>
      <DateRangePicker
        which="start"
        single={form.isLastDayOfPortStorage === 'Yes'}
        label="Pickup date"
        start={form.preferredPickupDate}
        end={form.preferredDeliveryDate}
        min={todayDateString()}
        onChange={(start, end) => {
          setField('preferredPickupDate', start)
          setField('preferredDeliveryDate', end)
        }}
        error={errors.preferredPickupDate}
      />

      <div className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span>Last free storage day?</span>
        <div role="radiogroup" className="flex items-center gap-6 py-2">
          {(['Yes', 'No'] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 font-normal">
              <input
                type="radio"
                name="isLastDayOfPortStorage"
                checked={form.isLastDayOfPortStorage === option}
                onChange={() => setField('isLastDayOfPortStorage', option)}
                className="accent-slate-900"
              />
              {option}
            </label>
          ))}
        </div>
      </div>

      {form.isLastDayOfPortStorage === 'Yes' ? (
        <div className="col-span-full flex items-start gap-3 border border-amber-300 bg-amber-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 border border-amber-700 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-800 uppercase">
            Urgent
          </span>
          <p className="text-sm text-slate-700">
            Same-day dispatch. We'll call.
          </p>
        </div>
      ) : (
        <DateRangePicker
          which="end"
          label="Delivery date"
          start={form.preferredPickupDate}
          end={form.preferredDeliveryDate}
          min={todayDateString()}
          onChange={(start, end) => {
            setField('preferredPickupDate', start)
            setField('preferredDeliveryDate', end)
          }}
          error={errors.preferredDeliveryDate}
        />
      )}

      <Field label="Rate per delivery" hint="(PHP)" error={errors.proposedRate}>
        <input
          type="number"
          name="proposedRate"
          inputMode="decimal"
          value={form.proposedRate}
          onChange={handleChange}
          min="0"
          step="0.01"
          placeholder="e.g. 15000"
          aria-invalid={errors.proposedRate ? true : undefined}
          className={inputClasses(!!errors.proposedRate)}
        />
        {showTotal && (
          <span className="text-xs font-normal text-slate-500">
            ₱{(rate * deliveryCount).toLocaleString('en-PH')} total
          </span>
        )}
      </Field>

      <Field label="Payment terms">
        <select
          name="paymentTerms"
          value={form.paymentTerms}
          onChange={handleChange}
          className={inputClasses(false)}
        >
          {Object.entries(PAYMENT_TERMS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
    </>
  )
}
