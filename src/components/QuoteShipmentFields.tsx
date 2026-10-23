// QuoteShipmentFields: the quote inputs, split into the three sections
// the customer wizard steps through (RouteFields, CargoFields,
// ScheduleFields). Staff's NewQuoteRequestModal shows all three on one
// page; QuoteWizard (client quote form) shows one per step.
// One set of markup, so no channel can drift from the others. Each
// field shows its own error message right under it (errors come from
// validateShipment in lib/quoteRequest.ts).
import { useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import LocationPicker from './LocationPicker'
import DateRangePicker from './DateRangePicker'
import {
  MAX_DELIVERY_ORDERS,
  MAX_WEIGHT_TONS,
  PAYMENT_TERMS_LABELS,
  cargoLineErrors,
  emptyCargoLine,
  resizeDescriptions,
  todayDateString,
  totalTrips,
  type CargoLine,
  type CargoLineErrors,
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

// Cargo as lines: each line is `quantity` trips carrying the same cargo
// (e.g. 8 x 40ft container + 2 x loose on a flatbed). The total trips is
// the sum of the quantities. Per-line problems (cargoLineErrors) show
// once a submit/Next has flagged the section, and stay shown while the
// user fixes them; weight over the limit shows red straight away.
export function CargoFields({ form, setField, errors }: SectionProps) {
  const [showLineErrors, setShowLineErrors] = useState(!!errors.cargoLines)
  if (errors.cargoLines && !showLineErrors) setShowLineErrors(true)

  const lines = form.cargoLines
  const trips = totalTrips(lines)

  function updateLine(index: number, change: Partial<CargoLine>) {
    setField(
      'cargoLines',
      lines.map((line, i) => (i === index ? { ...line, ...change } : line)),
    )
  }

  return (
    <>
      {errors.cargoLines && (
        <p className="col-span-full text-sm text-red-600" role="alert">
          {errors.cargoLines}
        </p>
      )}

      {lines.map((line, index) => {
        const lineErrors: CargoLineErrors = showLineErrors ? cargoLineErrors(line) : {}
        // Over the limit shows red while typing, not only on submit.
        const weightError =
          lineErrors.weight ??
          (Number(line.weight) > MAX_WEIGHT_TONS ? `Max ${MAX_WEIGHT_TONS} tons.` : undefined)
        return (
          <fieldset
            key={index}
            className="col-span-full grid gap-3 border-2 border-slate-300 bg-white p-4 sm:grid-cols-2 sm:gap-x-4"
          >
            <legend className="sr-only">Cargo line {index + 1}</legend>
            <div className="col-span-full flex items-center justify-between text-sm font-semibold text-slate-800">
              <span>
                Cargo line {index + 1}
                {lines.length > 1 && (
                  <span className="ml-2 font-normal text-slate-500">
                    {Number(line.quantity) > 0 ? `${line.quantity} trip${line.quantity === '1' ? '' : 's'}` : ''}
                  </span>
                )}
              </span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setField('cargoLines', lines.filter((_, i) => i !== index))}
                  className="text-sm font-medium text-red-700 underline hover:text-red-900"
                >
                  Remove
                </button>
              )}
            </div>

            <ToggleGroup
              label="Cargo type"
              options={[
                { value: 'Container', label: 'Container' },
                { value: 'Loose', label: 'Loose cargo' },
              ]}
              value={line.cargoType}
              // Loose cargo can't ride a skeletal trailer (that's a bare
              // frame for containers) -- it always goes on a flatbed.
              onChange={(value) =>
                updateLine(index, value === 'Loose' ? { cargoType: value, trailerType: 'Flatbed' } : { cargoType: value })
              }
            />

            <ToggleGroup
              label="Trailer size"
              options={[
                { value: '20ft', label: '20 ft' },
                { value: '40ft', label: '40 ft' },
              ]}
              value={line.containerType}
              onChange={(value) => updateLine(index, { containerType: value })}
            />

            <Field
              label="Trailer type"
              hint={line.cargoType === 'Loose' ? '(loose cargo goes on a flatbed)' : undefined}
              error={lineErrors.trailerType}
            >
              <select
                value={line.trailerType}
                onChange={(e) => updateLine(index, { trailerType: e.target.value as CargoLine['trailerType'] })}
                disabled={line.cargoType === 'Loose'}
                aria-invalid={lineErrors.trailerType ? true : undefined}
                className={`${inputClasses(!!lineErrors.trailerType)} disabled:bg-slate-100 disabled:text-slate-500`}
              >
                <option value="">Select</option>
                <option value="Flatbed">Flatbed</option>
                <option value="Skeletal">Skeletal</option>
              </select>
            </Field>

            <Field label="Weight per trip" hint="(tons)" error={weightError}>
              <input
                type="text"
                inputMode="decimal"
                value={line.weight}
                onChange={(e) => updateLine(index, { weight: e.target.value.replace(/[^\d.]/g, '') })}
                placeholder="e.g. 24.5"
                aria-invalid={weightError ? true : undefined}
                className={inputClasses(!!weightError)}
              />
            </Field>

            <Field label="Number of cargos" error={lineErrors.quantity}>
              <input
                type="text"
                inputMode="numeric"
                value={line.quantity}
                onChange={(e) => {
                  const quantity = e.target.value.replace(/\D/g, '')
                  // One details box per trip -- add/remove boxes to match.
                  updateLine(index, { quantity, descriptions: resizeDescriptions(line.descriptions, quantity) })
                }}
                placeholder="e.g. 3"
                aria-invalid={lineErrors.quantity ? true : undefined}
                className={inputClasses(!!lineErrors.quantity)}
              />
            </Field>

            {/* Cargo details: one box per trip of this line. */}
            <div className="col-span-full flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-700">
                <span>
                  Cargo details <span className="font-normal text-slate-400">(per trip)</span>
                </span>
                {line.descriptions.length > 1 && line.descriptions[0].trim() && (
                  <button
                    type="button"
                    onClick={() =>
                      updateLine(index, { descriptions: line.descriptions.map(() => line.descriptions[0]) })
                    }
                    className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
                  >
                    Copy trip 1 to all
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {line.descriptions.map((description, tripIndex) => {
                  const missing = !!lineErrors.descriptions && !description.trim()
                  return (
                    <label key={tripIndex} className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                      Trip {tripIndex + 1}
                      <input
                        type="text"
                        value={description}
                        maxLength={300}
                        onChange={(e) =>
                          updateLine(index, {
                            descriptions: line.descriptions.map((d, i) => (i === tripIndex ? e.target.value : d)),
                          })
                        }
                        placeholder="What it is, packing, handling notes"
                        aria-invalid={missing ? true : undefined}
                        className={`${inputClasses(missing)} text-sm`}
                      />
                    </label>
                  )
                })}
              </div>
              {lineErrors.descriptions && (
                <span className="text-sm text-red-600" role="alert">
                  {lineErrors.descriptions}
                </span>
              )}
            </div>
          </fieldset>
        )
      })}

      <div className="col-span-full flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setField('cargoLines', [...lines, emptyCargoLine])}
          className="border-2 border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500 hover:bg-slate-50"
        >
          + Add cargo line
        </button>
        <span className={`text-sm font-semibold ${trips > MAX_DELIVERY_ORDERS ? 'text-red-600' : 'text-slate-700'}`}>
          Total: {trips} {trips === 1 ? 'trip' : 'trips'}
          {trips > MAX_DELIVERY_ORDERS && ` (max ${MAX_DELIVERY_ORDERS})`}
        </span>
      </div>
    </>
  )
}

export function ScheduleFields({ form, setField, errors }: SectionProps) {
  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setField(e.target.name as ShipmentField, e.target.value as never)
  }


  return (
    <>
      <DateRangePicker
        which="start"
        label={form.isLastDayOfPortStorage === 'Yes' ? 'Last free storage day (pick up by)' : 'Pickup date'}
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

      {form.isLastDayOfPortStorage === 'Yes' && (
        <div className="col-span-full flex items-start gap-3 border border-amber-300 bg-amber-50 px-4 py-3">
          <span className="mt-0.5 shrink-0 border border-amber-700 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-800 uppercase">
            Urgent
          </span>
          <p className="text-sm text-slate-700">
            We pick the cargo up from the port by 11:59 PM on that day. Delivery can be any day up to your deadline.
          </p>
        </div>
      )}

      {/* "Deadline date" = preferred_delivery_date: the latest day the
          client needs the cargo (we usually deliver before it). */}
      <DateRangePicker
        which="end"
        label="Deadline date"
        start={form.preferredPickupDate}
        end={form.preferredDeliveryDate}
        min={todayDateString()}
        onChange={(start, end) => {
          setField('preferredPickupDate', start)
          setField('preferredDeliveryDate', end)
        }}
        error={errors.preferredDeliveryDate}
      />

      {/* Never invalid on its own -- only red when staff rejected the
          quote over its terms (REJECTION_TAGS). */}
      <Field label="Payment terms" error={errors.paymentTerms}>
        <select
          name="paymentTerms"
          value={form.paymentTerms}
          onChange={handleChange}
          aria-invalid={errors.paymentTerms ? true : undefined}
          className={inputClasses(!!errors.paymentTerms)}
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
