// AddEmployeeModal: form for adding an employee. UI only -- Submit just
// closes the modal, nothing is saved anywhere.
//
// MOCK DATA -- replace with real Supabase insert later.
import { useState } from 'react'

const fieldClasses =
  'rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none'
const labelClasses = 'flex flex-col gap-1 text-sm font-medium text-slate-700'

function AddEmployeeModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [position, setPosition] = useState('Driver')
  const [hireDate, setHireDate] = useState('')

  function handleSubmit() {
    // Not wired up yet -- just closes the modal for now.
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Add Employee</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          <label className={labelClasses}>
            Full name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldClasses}
            />
          </label>

          <label className={labelClasses}>
            Position
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              className={fieldClasses}
            >
              <option value="Driver">Driver</option>
              <option value="Mechanic">Mechanic</option>
              <option value="Dispatcher">Dispatcher</option>
              <option value="Admin">Admin</option>
            </select>
          </label>

          <label className={labelClasses}>
            Hire date
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              className={fieldClasses}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Add Employee
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddEmployeeModal
