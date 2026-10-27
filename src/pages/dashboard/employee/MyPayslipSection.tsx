// MyPayslipSection: the logged-in employee's own payslip history (the
// canvas's Driver Payslips board) -- a list of pay periods with net pay on
// the left, the selected payslip on the right: earnings lines (for a Driver
// one per trip delivered that period, for everyone else their salary vs
// attendance), then the deductions (SSS, PhilHealth, Pag-IBIG, withholding
// tax, cash advance) and net pay. Each line has "Report an Issue". Shown to
// Driver, Mechanic, Helper (MyPayslipPage.tsx) and Dispatcher (their own
// route). Read-only; issuing and marking payslips Paid only happens from
// the admin side (PayrollSection.tsx). Employees only ever see finalized
// payslips (drafts are hidden by RLS).
import { useEffect, useEffectEvent, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import {
  loadPayslipsForEmployee,
  loadPayslipLineItems,
  type Payslip,
  type PayslipLineItem,
} from '../../../lib/payslip'
import { usePaged } from '../../../lib/usePaged'
import ReportPayslipIssueModal from './ReportPayslipIssueModal'
import StatusBadge from '../../../components/StatusBadge'
import { formatMoney, formatDate } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'
import { showToast } from '../../../components/Toast'

function formatPeriod(start: string, end: string) {
  return `${formatDate(start)} – ${formatDate(end)}`
}

const PAYSLIPS_PER_PAGE = 6
const GROUP = 'px-5 pt-3 pb-1 text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase'

function MyPayslipSection({ onIssueReported }: { onIssueReported?: () => void }) {
  const { employeeId } = useAuth()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lineItemsByPayroll, setLineItemsByPayroll] = useState<Record<number, PayslipLineItem[]>>({})
  const [lineItemsError, setLineItemsError] = useState<string | null>(null)
  // The payslip line being reported (null = none open).
  const [reporting, setReporting] = useState<{ payslip: Payslip; line: string } | null>(null)

  async function load(id: number) {
    setLoading(true)
    const { payslips: loadedPayslips, error: loadError } = await loadPayslipsForEmployee(id)
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    setPayslips(loadedPayslips)
    setError(null)
    setLoading(false)
    // Open the newest one straight away.
    if (loadedPayslips[0]) void select(loadedPayslips[0].payroll_id)
  }

  // Load when this opens and whenever employeeId changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    if (employeeId) {
      load(employeeId)
    } else {
      setLoading(false)
    }
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [employeeId])

  async function select(payrollId: number) {
    setSelectedId(payrollId)
    setLineItemsError(null)
    if (lineItemsByPayroll[payrollId]) return
    const { lineItems, error: itemsError } = await loadPayslipLineItems(payrollId)
    if (itemsError) {
      setLineItemsError(itemsError)
      return
    }
    setLineItemsByPayroll((prev) => ({ ...prev, [payrollId]: lineItems }))
  }

  const paged = usePaged(payslips, '', PAYSLIPS_PER_PAGE)

  if (loading) return <p className="text-ink-muted">Loading your payslips...</p>
  if (error) return <p className="text-red-700">{error}</p>
  if (payslips.length === 0) return <EmptyState message="No payslips issued yet." hint="Your payslips show here once Admin finalizes them." />

  const selected = payslips.find((p) => p.payroll_id === selectedId) ?? null
  const lines = selected ? lineItemsByPayroll[selected.payroll_id] : undefined
  const paidPerTrip = (lines ?? []).some((l) => l.itinerary_id !== null)
  const deductions = selected
    ? (
        [
          ['SSS', selected.sss_ee],
          ['PhilHealth', selected.philhealth_ee],
          ['Pag-IBIG', selected.pagibig_ee],
          ['Withholding tax', selected.withholding_tax],
          ['Cash advance', selected.cash_advance_deducted],
        ] as const
      ).filter(([, amount]) => amount !== 0)
    : []

  const reportButton = (payslip: Payslip, line: string) => (
    <button
      type="button"
      onClick={() => setReporting({ payslip, line })}
      aria-label={`Report an issue with ${line}`}
      className="btn-secondary px-3 text-[13px] font-medium"
    >
      Report an Issue
    </button>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <section aria-label="Payslips" className="card flex flex-col">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line bg-slate-100 px-5 py-2.5 text-xs font-semibold tracking-[0.04em] text-ink-secondary uppercase">
          <span>Pay Period</span>
          <span>Net Pay</span>
        </div>
        {paged.rows.map((payslip) => {
          const isSelected = payslip.payroll_id === selectedId
          return (
            <button
              key={payslip.payroll_id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => void select(payslip.payroll_id)}
              className={`grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200 px-5 py-2 text-left text-sm ${
                isSelected ? 'bg-primary-soft shadow-[inset_4px_0_0_var(--color-primary)]' : 'hover:bg-slate-50'
              }`}
            >
              <span>
                <span className="block font-semibold text-ink">{formatPeriod(payslip.payroll_period_start, payslip.payroll_period_end)}</span>
                <span className="block text-[13px] text-ink-muted">{payslip.payslip_status === 'Paid' ? 'Paid' : 'Finalized'}</span>
              </span>
              <span className="font-semibold text-ink tabular-nums">{formatMoney(payslip.net_pay)}</span>
            </button>
          )
        })}
        {paged.pager.pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 text-sm text-ink-secondary">
            <span>
              Page {paged.pager.page + 1} of {paged.pager.pageCount}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => paged.pager.onChange(paged.pager.page - 1)}
                disabled={paged.pager.page === 0}
                className="btn-secondary px-3 text-sm font-medium"
              >
                ‹ Prev
              </button>
              <button
                type="button"
                onClick={() => paged.pager.onChange(paged.pager.page + 1)}
                disabled={paged.pager.page >= paged.pager.pageCount - 1}
                className="btn-secondary px-3 text-sm font-medium"
              >
                Next ›
              </button>
            </span>
          </div>
        )}
      </section>

      {selected && (
        <section aria-labelledby="payslip-h" className="card flex flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-4">
            <h2 id="payslip-h" className="text-base font-semibold text-ink">
              Payslip · <span className="font-medium">{formatPeriod(selected.payroll_period_start, selected.payroll_period_end)}</span>
            </h2>
            <StatusBadge status={selected.payslip_status === 'Paid' ? 'Paid' : 'Approved'} label={selected.payslip_status === 'Paid' ? 'Paid' : 'Finalized'} icon />
            {lines && (
              <span className="text-[13px] text-ink-muted">{paidPerTrip ? 'Paid per delivered trip' : 'Paid weekly by attendance'}</span>
            )}
          </div>

          {lineItemsError && <p className="mx-5 mt-3 bg-red-50 px-3 py-2 text-sm text-red-700">{lineItemsError}</p>}
          {!lines && !lineItemsError ? (
            <p className="px-5 py-4 text-sm text-ink-muted">Loading breakdown...</p>
          ) : (
            <div className="pb-2 text-sm">
              <div className={GROUP}>Earnings</div>
              {(lines ?? []).map((item, index) => (
                <div key={index} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_8.5rem] items-center gap-3 border-b border-slate-200 px-5 py-2">
                  <span className="text-ink-secondary">{item.description}</span>
                  <span className="font-semibold text-ink tabular-nums">{formatMoney(item.amount)}</span>
                  {reportButton(selected, item.description.split(' — ')[0])}
                </div>
              ))}
              <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_8.5rem] items-center gap-3 border-b border-line px-5 font-semibold text-ink">
                <span>Gross pay</span>
                <span className="tabular-nums">{formatMoney(selected.gross_pay)}</span>
              </div>

              {deductions.length > 0 && <div className={GROUP}>Deductions</div>}
              {deductions.map(([label, amount]) => (
                <div key={label} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_8.5rem] items-center gap-3 border-b border-slate-200 px-5 py-2">
                  <span className="text-ink-secondary">{label}</span>
                  <span className="font-semibold text-red-700 tabular-nums">
                    {/* negative = refund of an earlier over-deduction this month */}
                    {amount > 0 ? '− ' : '+ '}
                    {formatMoney(Math.abs(amount))}
                  </span>
                  {reportButton(selected, label)}
                </div>
              ))}

              <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_8.5rem] items-center gap-3 px-5 text-base font-bold text-ink">
                <span>
                  Net pay <span className="text-[13px] font-medium text-ink-muted">earnings − deductions</span>
                </span>
                <span className="tabular-nums">{formatMoney(selected.net_pay)}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {reporting && employeeId && (
        <ReportPayslipIssueModal
          employeeId={employeeId}
          payrollId={reporting.payslip.payroll_id}
          period={formatPeriod(reporting.payslip.payroll_period_start, reporting.payslip.payroll_period_end)}
          line={reporting.line}
          onClose={() => setReporting(null)}
          onReported={() => {
            setReporting(null)
            showToast('Your report was sent to Admin.')
            onIssueReported?.()
          }}
        />
      )}
    </div>
  )
}

export default MyPayslipSection
