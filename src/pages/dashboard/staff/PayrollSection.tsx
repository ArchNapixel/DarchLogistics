// PayrollSection: table of payroll entries, read from the
// payroll_payslips table (joined with employees for the display name).
import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

type PayrollEntry = {
  payroll_id: number
  employee_name: string
  period: string
  amount: number
  status: string
}

const STATUS_STYLES: Record<string, string> = {
  Paid: 'bg-green-100 text-green-700',
  Pending: 'bg-orange-100 text-orange-700',
}

function PayrollStatusBadge({ status }: { status: string }) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles}`}>
      {status}
    </span>
  )
}

function formatPeriod(start: string, end: string) {
  const format = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${format(start)} – ${format(end)}`
}

function PayrollSection() {
  const [payroll, setPayroll] = useState<PayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPayroll()
  }, [])

  async function loadPayroll() {
    setLoading(true)

    const { data, error } = await supabase
      .from('payroll_payslips')
      .select(
        'payroll_id, payroll_period_start, payroll_period_end, gross_pay, payslip_status, employees(full_name)',
      )
      .order('payroll_period_start', { ascending: false })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setPayroll(
      data.map((entry) => ({
        payroll_id: entry.payroll_id,
        employee_name: entry.employees?.[0]?.full_name ?? '—',
        period: formatPeriod(entry.payroll_period_start, entry.payroll_period_end),
        amount: entry.gross_pay,
        status: entry.payslip_status,
      })),
    )
    setError(null)
    setLoading(false)
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Payroll</h2>

      {loading && <p className="mt-4 text-slate-500">Loading payroll...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && payroll.length === 0 && (
        <p className="mt-4 text-slate-500">No payroll entries yet.</p>
      )}

      {!loading && !error && payroll.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payroll.map((entry) => (
                <tr
                  key={entry.payroll_id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="px-4 py-3 text-slate-900">
                    {entry.employee_name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{entry.period}</td>
                  <td className="px-4 py-3 text-slate-600">
                    ₱{entry.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <PayrollStatusBadge status={entry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default PayrollSection
