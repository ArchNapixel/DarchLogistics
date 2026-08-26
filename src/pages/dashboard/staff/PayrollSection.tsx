// PayrollSection: table of payroll entries.
//
// MOCK DATA -- replace with real Supabase query later. Nothing on this
// page reads from or writes to the database yet.
import { useState } from 'react'

type PayrollStatus = 'Paid' | 'Pending'

type PayrollEntry = {
  payroll_id: number
  employee_name: string
  period: string
  amount: number
  status: PayrollStatus
}

// MOCK DATA -- replace with real Supabase query later.
const MOCK_PAYROLL: PayrollEntry[] = [
  {
    payroll_id: 1,
    employee_name: 'Ramon Cruz',
    period: 'Aug 1 – Aug 15, 2026',
    amount: 14500,
    status: 'Paid',
  },
  {
    payroll_id: 2,
    employee_name: 'Ariel Santos',
    period: 'Aug 1 – Aug 15, 2026',
    amount: 14500,
    status: 'Paid',
  },
  {
    payroll_id: 3,
    employee_name: 'Ben Villareal',
    period: 'Aug 1 – Aug 15, 2026',
    amount: 13200,
    status: 'Paid',
  },
  {
    payroll_id: 4,
    employee_name: 'Carlo Reyes',
    period: 'Aug 16 – Aug 31, 2026',
    amount: 15800,
    status: 'Pending',
  },
  {
    payroll_id: 5,
    employee_name: 'Elena Torres',
    period: 'Aug 16 – Aug 31, 2026',
    amount: 17200,
    status: 'Pending',
  },
]

const STATUS_STYLES: Record<PayrollStatus, string> = {
  Paid: 'bg-green-100 text-green-700',
  Pending: 'bg-orange-100 text-orange-700',
}

function PayrollStatusBadge({ status }: { status: PayrollStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}

function PayrollSection() {
  const [payroll] = useState<PayrollEntry[]>(MOCK_PAYROLL)

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Payroll</h2>

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
    </div>
  )
}

export default PayrollSection
