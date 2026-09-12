// ReportsSection: "Overview" tab keeps the placeholder mock cards
// (MOCK DATA -- not wired to Supabase yet). "Payments Due" is real,
// backed by src/lib/paymentDue.ts -- the full breakdown across every
// client, versus the simplified version on the Bookings page's side
// panel (PaymentDuePanel.tsx). See paymentDue.ts for the due-date rule.
import { useEffect, useState } from 'react'
import {
  loadPaymentDueReport,
  formatDaysUntilDue,
  DUE_TONE_STYLES,
  type PaymentDueRow,
} from '../../../lib/paymentDue'

type ReportCard = {
  report_id: number
  title: string
  headline_value: string
  subtitle: string
  accent: string
  // Relative bar heights (0-100) for the mini chart, oldest to newest.
  chart_values: number[]
}

// MOCK DATA -- replace with real Supabase query later.
const MOCK_REPORTS: ReportCard[] = [
  {
    report_id: 1,
    title: 'Revenue Report',
    headline_value: '₱1,284,600',
    subtitle: 'Total revenue this month',
    accent: 'bg-blue-500',
    chart_values: [40, 55, 48, 62, 70, 58, 80],
  },
  {
    report_id: 2,
    title: 'Delivery Performance',
    headline_value: '96.4%',
    subtitle: 'On-time deliveries this month',
    accent: 'bg-green-500',
    chart_values: [85, 90, 88, 94, 91, 97, 96],
  },
  {
    report_id: 3,
    title: 'Fleet Utilization',
    headline_value: '78%',
    subtitle: 'Average truck utilization',
    accent: 'bg-orange-500',
    chart_values: [60, 65, 72, 68, 75, 80, 78],
  },
]

function MiniBarChart({
  values,
  accent,
}: {
  values: number[]
  accent: string
}) {
  return (
    <div className="mt-4 flex h-16 items-end gap-1.5">
      {values.map((value, index) => (
        <div
          key={index}
          className={`flex-1 rounded-t ${accent}`}
          style={{ height: `${value}%`, opacity: 0.3 + (index / values.length) * 0.7 }}
        />
      ))}
    </div>
  )
}

function OverviewTab() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {MOCK_REPORTS.map((report) => (
        <button
          key={report.report_id}
          className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-slate-300"
        >
          <p className="text-sm font-medium text-slate-500">{report.title}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            {report.headline_value}
          </p>
          <p className="mt-1 text-xs text-slate-400">{report.subtitle}</p>
          <MiniBarChart values={report.chart_values} accent={report.accent} />
        </button>
      ))}
    </div>
  )
}

const BASE_DATE_SOURCE_LABELS: Record<PaymentDueRow['base_date_source'], string> = {
  actual: 'Actual delivery',
  preferred: 'Estimated (preferred date)',
  unknown: 'Unknown',
}

function PaymentsDueTab() {
  const [rows, setRows] = useState<PaymentDueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)

    const { rows: loadedRows, error: loadError } = await loadPaymentDueReport()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setRows(loadedRows)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading payment due report...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (rows.length === 0) {
    return <p className="text-slate-500">No bookings to track yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Booking</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Origin → Destination</th>
            <th className="px-4 py-3 font-medium">Rate</th>
            <th className="px-4 py-3 font-medium">Payment Terms</th>
            <th className="px-4 py-3 font-medium">Base Date</th>
            <th className="px-4 py-3 font-medium">Due Date</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const due = formatDaysUntilDue(row.days_until_due)
            return (
              <tr
                key={row.booking_id}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="px-4 py-3 text-slate-900">
                  #{row.booking_id}
                </td>
                <td className="px-4 py-3 text-slate-900">
                  {row.client_name}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.pickup_place_name} → {row.delivery_place_name}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.rate_of_delivery_service != null
                    ? `₱${row.rate_of_delivery_service.toLocaleString()}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.payment_terms}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.base_date ?? '—'}
                  <span className="ml-1.5 text-xs text-slate-400">
                    ({BASE_DATE_SOURCE_LABELS[row.base_date_source]})
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.due_date ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${DUE_TONE_STYLES[due.tone]}`}
                  >
                    {due.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const TABS = ['Overview', 'Payments Due'] as const
type Tab = (typeof TABS)[number]

function ReportsSection() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview')

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Reports</h2>

      <div className="mt-4 flex gap-2 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === 'Overview' ? <OverviewTab /> : <PaymentsDueTab />}
      </div>
    </div>
  )
}

export default ReportsSection
