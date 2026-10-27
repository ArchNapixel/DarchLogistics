// ReportPayslipIssueModal: lets an employee flag a problem with one of
// their own payslips. Lands in the admin Reports page's "Payslip
// Issues" tab for staff to resolve. Opened from a payslip line's "Report
// an Issue" (My Payslips) -- that line is named at the top of the report
// so staff know which one it's about. Still one report per payslip.
import { useState } from 'react'
import { reportPayslipIssue } from '../../../lib/payslipIssueReports'

function ReportPayslipIssueModal({
  employeeId,
  payrollId,
  period,
  line,
  onClose,
  onReported,
}: {
  employeeId: number
  payrollId: number
  period: string
  // The payslip line it's about ("Trip #92 ...", "SSS"), if picked from one.
  line?: string
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
      description: line ? `About "${line}": ${description.trim()}` : description.trim(),
    })

    setSubmitting(false)

    if (reportError) {
      setError(reportError)
      return
    }

    onReported()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="payslip-issue-title" className="card w-full max-w-[560px]">
        <header className="border-b border-line px-6 pt-5 pb-4">
          <h2 id="payslip-issue-title" className="text-xl leading-7 font-bold text-ink">
            Report a Payslip Issue
          </h2>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Payslip: {period}
            {line && (
              <>
                {' · '}
                <strong className="text-ink">{line}</strong>
              </>
            )}
          </p>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold text-ink">What's wrong?</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="e.g. This is missing a trip I delivered on..."
              className="min-h-11 w-full resize-none rounded-[2px] border border-line-control bg-white px-3 py-2.5 text-sm text-ink-metric placeholder:text-ink-muted focus:border-primary"
            />
          </label>
          <p className="text-[13px] text-ink-muted">Admin reviews it and replies under My Requests.</p>
        </div>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} disabled={submitting} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary px-6 text-sm">
            {submitting ? 'Sending...' : 'Send Report'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default ReportPayslipIssueModal
