// ReportPayslipIssueModal: lets an employee flag a problem with one of
// their own payslips. Lands in the admin Reports page's "Payslip
// Issues" tab for staff to resolve.
import { useState } from 'react'
import { reportPayslipIssue } from '../../../lib/payslipIssueReports'

function ReportPayslipIssueModal({
  employeeId,
  payrollId,
  period,
  onClose,
  onReported,
}: {
  employeeId: number
  payrollId: number
  period: string
  onClose: () => void
  onReported: () => void
}) {
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!description.trim()) {
      setError('Describe the issue with this payslip.')
      return
    }

    setSubmitting(true)
    setError(null)

    const { error: reportError } = await reportPayslipIssue({
      employeeId,
      payrollId,
      description: description.trim(),
    })

    setSubmitting(false)

    if (reportError) {
      setError(reportError)
      return
    }

    onReported()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h3 className="text-lg font-bold text-slate-900">Report a Payslip Issue</h3>
        <p className="mt-1 text-sm text-slate-500">Payslip: {period}</p>

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className="mt-4 flex flex-col gap-1 text-sm font-medium text-slate-700">
          What's wrong?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="e.g. This is missing a trip I delivered on..."
            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send Report'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReportPayslipIssueModal
