// PayrollRemittanceSection (Admin, Accounting -> Remittances):
// pick a month, see what has to be paid over to SSS / PhilHealth / Pag-IBIG /
// BIR (employee + employer shares) and what payroll cost the company.
// Read-only, built from the month's FINALIZED payslips -- all the numbers
// were already worked out when each payslip was made (lib/payslip.ts).
// Two tabs: Remittances (government money, per employee) and Payroll cost.
// Download gives one CSV with both. Totals math: lib/remittanceTotals.ts.
import { useEffect, useState } from 'react'
import {
  buildRemittanceCsv,
  currentRemittanceMonth,
  loadRemittanceReport,
} from '../../../lib/remittanceReport'
import { agencyAmounts, type EmployeeRemit, type RemitTotals } from '../../../lib/remittanceTotals'
import PageHeader from '../../../components/PageHeader'
import { formatMoney } from '../../../lib/format'
import EmptyState from '../../../components/EmptyState'

type Tab = 'remittances' | 'cost'

function PayrollRemittanceSection() {
  const [month, setMonth] = useState(currentRemittanceMonth())
  const [tab, setTab] = useState<Tab>('remittances')
  const [employees, setEmployees] = useState<EmployeeRemit[]>([])
  const [totals, setTotals] = useState<RemitTotals | null>(null)
  const [draftCount, setDraftCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  async function load() {
    // No month typed yet (the month box can be cleared) -- nothing to load.
    if (!month) return
    setLoading(true)

    const result = await loadRemittanceReport(month)

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setEmployees(result.employees)
    setTotals(result.totals)
    setDraftCount(result.draftCount)
    setError(null)
    setLoading(false)
  }

  function handleDownload() {
    if (!totals) return
    const csv = buildRemittanceCsv(month, employees, totals)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `payroll-remittances_${month}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const hasData = !loading && !error && totals !== null && totals.payslips > 0

  return (
    <div>
      <PageHeader
        title="Remittances"
        subtitle="What to remit to SSS, PhilHealth, Pag-IBIG and BIR for a month."
        actions={<>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="remit-month" className="text-sm font-medium text-slate-700">
            Month
          </label>
          <input
            id="remit-month"
            type="month"
            value={month}
            max={currentRemittanceMonth()}
            onChange={(e) => setMonth(e.target.value)}
            className="border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
          />
          <button
            onClick={handleDownload}
            disabled={!hasData}
            className="btn-primary px-3 py-1.5 text-sm font-medium"
          >
            Download CSV
          </button>
        </div>
        </>}
      />
      <p className="mt-1 text-sm text-slate-500">
        Finalized payslips whose pay period ends in this month.
      </p>

      {draftCount > 0 && (
        <p className="mt-4 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {draftCount} draft payslip{draftCount === 1 ? '' : 's'} for this month{' '}
          {draftCount === 1 ? "isn't" : "aren't"} finalized yet, so{' '}
          {draftCount === 1 ? "it isn't" : "they aren't"} counted below. Finalize{' '}
          {draftCount === 1 ? 'it' : 'them'} on the Payroll page to include{' '}
          {draftCount === 1 ? 'it' : 'them'}.
        </p>
      )}

      {loading && <p className="mt-4 text-slate-500">Loading payslips...</p>}
      {error && <p className="mt-4 text-red-700">{error}</p>}
      {!loading && !error && totals && totals.payslips === 0 && (
        <EmptyState message="No finalized payslips for this month." className="mt-4" />
      )}

      {hasData && totals && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {(
              [
                ['remittances', 'Remittances'],
                ['cost', 'Payroll cost'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-1.5 text-sm font-medium ${
                  tab === key
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'remittances' ? (
            <RemittancesTab employees={employees} totals={totals} />
          ) : (
            <CostTab employees={employees} totals={totals} />
          )}
        </>
      )}
    </div>
  )
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </div>
  )
}

const TH = 'whitespace-nowrap px-4 py-3 text-right font-medium'
const TD = 'px-4 py-3 text-right text-slate-600'

function RemittancesTab({ employees, totals }: { employees: EmployeeRemit[]; totals: RemitTotals }) {
  const agencies = agencyAmounts(totals)
  const notes: Record<string, string> = {
    SSS: 'EE + ER + EC',
    PhilHealth: 'EE + ER',
    'Pag-IBIG': 'EE + ER',
    'BIR (withholding tax)': 'withheld from pay',
  }

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries(agencies).map(([agency, amount]) => (
          <Card key={agency} label={agency} value={formatMoney(amount)} note={notes[agency]} />
        ))}
      </div>

      <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className={TH}>SSS EE</th>
              <th className={TH}>SSS ER</th>
              <th className={TH}>SSS EC</th>
              <th className={TH}>PhilHealth EE</th>
              <th className={TH}>PhilHealth ER</th>
              <th className={TH}>Pag-IBIG EE</th>
              <th className={TH}>Pag-IBIG ER</th>
              <th className={TH}>Withholding tax</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.employee_id} className="border-b border-slate-100">
                <td className="px-4 py-3 text-slate-900">{e.name}</td>
                <td className={TD}>{formatMoney(e.sss_ee)}</td>
                <td className={TD}>{formatMoney(e.sss_er)}</td>
                <td className={TD}>{formatMoney(e.sss_ec)}</td>
                <td className={TD}>{formatMoney(e.philhealth_ee)}</td>
                <td className={TD}>{formatMoney(e.philhealth_er)}</td>
                <td className={TD}>{formatMoney(e.pagibig_ee)}</td>
                <td className={TD}>{formatMoney(e.pagibig_er)}</td>
                <td className={TD}>{formatMoney(e.withholding_tax)}</td>
              </tr>
            ))}
            <tr className="font-semibold text-slate-900">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.sss_ee)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.sss_er)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.sss_ec)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.philhealth_ee)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.philhealth_er)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.pagibig_ee)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.pagibig_er)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.withholding_tax)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        EE = employee share, ER = employer share, EC = SSS employees' compensation.
      </p>
    </>
  )
}

function CostTab({ employees, totals }: { employees: EmployeeRemit[]; totals: RemitTotals }) {
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="Gross pay" value={formatMoney(totals.gross)} />
        <Card label="Employer shares" value={formatMoney(totals.employer_shares)} note="SSS, PhilHealth, Pag-IBIG" />
        <Card label="Company cost" value={formatMoney(totals.company_cost)} note="gross + employer shares" />
        <Card label="Net pay" value={formatMoney(totals.net_pay)} note="what employees take home" />
      </div>

      <div className="mt-4 overflow-x-auto border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className={TH}>Payslips</th>
              <th className={TH}>Gross pay</th>
              <th className={TH}>Cash advance deducted</th>
              <th className={TH}>Net pay</th>
              <th className={TH}>Employer shares</th>
              <th className={TH}>Company cost</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.employee_id} className="border-b border-slate-100">
                <td className="px-4 py-3 text-slate-900">{e.name}</td>
                <td className={TD}>{e.payslips}</td>
                <td className={TD}>{formatMoney(e.gross)}</td>
                <td className={TD}>{formatMoney(e.cash_advance_deducted)}</td>
                <td className={TD}>{formatMoney(e.net_pay)}</td>
                <td className={TD}>{formatMoney(e.employer_shares)}</td>
                <td className={TD}>{formatMoney(e.company_cost)}</td>
              </tr>
            ))}
            <tr className="font-semibold text-slate-900">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right">{totals.payslips}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.gross)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.cash_advance_deducted)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.net_pay)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.employer_shares)}</td>
              <td className="px-4 py-3 text-right">{formatMoney(totals.company_cost)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Cash advances are loans being paid back, not a cost, so company cost is gross + employer
        shares.
      </p>
    </>
  )
}

export default PayrollRemittanceSection
