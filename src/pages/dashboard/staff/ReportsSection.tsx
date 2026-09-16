// ReportsSection: "Overview" shows real activity counts across the
// other report tabs (issue reports, client requests, payslip issues,
// work order completions/acceptances) as clickable cards that jump
// straight to that tab. "Payments Due" is real, backed by
// src/lib/paymentDue.ts -- the full breakdown across every client,
// versus the simplified version on the Bookings page's side panel
// (PaymentDuePanel.tsx). View-only: payments are recorded (and the
// billable amount overridden, if needed) in Financial Records
// (FinancialSection.tsx) instead. See paymentDue.ts for the due-date
// rule and the override behavior.
import { useEffect, useState } from 'react'
import {
  loadPaymentDueReport,
  formatDaysUntilDue,
  DUE_TONE_STYLES,
  type PaymentDueRow,
} from '../../../lib/paymentDue'
import { supabase } from '../../../lib/supabaseClient'
import { loadPendingStatusRequests } from '../../../lib/clientStatusRequests'
import { loadPendingPayslipIssues } from '../../../lib/payslipIssueReports'
import { loadWorkOrderAcceptanceLog } from '../../../lib/workOrderAcceptanceLog'
import { loadWorkOrderCompletions } from '../../../lib/workOrderCompletions'
import { loadPendingMaintenanceSchedules } from '../../../lib/maintenanceSchedules'
import { loadAllReviews, averageRating } from '../../../lib/clientReviews'
import { loadCurrentlyDelinquentClients } from '../../../lib/clientDelinquency'
import IssueReportsSection from './IssueReportsSection'
import ClientStatusRequestsSection from './ClientStatusRequestsSection'
import PayslipIssueReportsSection from './PayslipIssueReportsSection'
import WorkOrderAcceptanceLogSection from './WorkOrderAcceptanceLogSection'
import WorkOrderCompletionsSection from './WorkOrderCompletionsSection'
import MaintenanceSchedulesSection from './MaintenanceSchedulesSection'
import ClientReviewsSection from './ClientReviewsSection'
import ClientDelinquencySection from './ClientDelinquencySection'

const TABS = [
  'Overview',
  'Payments Due',
  'Issue Reports',
  'Client Requests',
  'Work Order Completions',
  'Work Order Acceptance',
  'Payslip Issues',
  'Maintenance Schedules',
  'Client Reviews',
  'Client Standing',
] as const
type Tab = (typeof TABS)[number]

type ReportActivityCard = {
  tab: Tab
  label: string
  value: number
  subtitle: string
  // Mono accent ramp only -- no arbitrary per-card colors. Varying the
  // step (not the hue) is what gives each card its own weight.
  accent: 'bg-accent-100' | 'bg-accent-300' | 'bg-accent-500' | 'bg-accent-700' | 'bg-accent-900'
}

function OverviewTab({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [cards, setCards] = useState<ReportActivityCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const [
      issueReportsResult,
      clientRequestsResult,
      payslipIssuesResult,
      completionsResult,
      acceptancesResult,
      maintenanceSchedulesResult,
      reviewsResult,
      delinquentResult,
    ] = await Promise.all([
      supabase.from('issue_reports').select('*', { count: 'exact', head: true }),
      loadPendingStatusRequests(),
      loadPendingPayslipIssues(),
      loadWorkOrderCompletions(),
      loadWorkOrderAcceptanceLog(),
      loadPendingMaintenanceSchedules(),
      loadAllReviews(),
      loadCurrentlyDelinquentClients(),
    ])

    const loadError =
      issueReportsResult.error?.message ??
      clientRequestsResult.error ??
      payslipIssuesResult.error ??
      completionsResult.error ??
      acceptancesResult.error ??
      maintenanceSchedulesResult.error ??
      reviewsResult.error ??
      delinquentResult.error

    if (loadError) {
      setError(loadError)
      return
    }

    setError(null)
    setCards([
      {
        tab: 'Issue Reports',
        label: 'Issue Reports',
        value: issueReportsResult.count ?? 0,
        subtitle: 'Total reported by drivers',
        accent: 'bg-accent-900',
      },
      {
        tab: 'Client Requests',
        label: 'Client Requests',
        value: clientRequestsResult.requests.length,
        subtitle: 'Awaiting a response',
        accent: 'bg-accent-500',
      },
      {
        tab: 'Payslip Issues',
        label: 'Payslip Issues',
        value: payslipIssuesResult.reports.length,
        subtitle: 'Awaiting resolution',
        accent: 'bg-accent-300',
      },
      {
        tab: 'Work Order Completions',
        label: 'Work Orders Completed',
        value: completionsResult.completions.length,
        subtitle: 'Total finished by mechanics',
        accent: 'bg-accent-900',
      },
      {
        tab: 'Work Order Acceptance',
        label: 'Work Orders Accepted',
        value: acceptancesResult.entries.length,
        subtitle: 'Total acceptance events logged',
        accent: 'bg-accent-500',
      },
      {
        tab: 'Maintenance Schedules',
        label: 'Maintenance Schedules',
        value: maintenanceSchedulesResult.schedules.length,
        subtitle: 'Upcoming, flagged by mechanics',
        accent: 'bg-accent-300',
      },
      {
        tab: 'Client Reviews',
        label: 'Client Reviews',
        value: reviewsResult.reviews.length,
        subtitle:
          averageRating(reviewsResult.reviews) !== null
            ? `Avg ${averageRating(reviewsResult.reviews)!.toFixed(1)} / 5`
            : 'No reviews yet',
        accent: 'bg-accent-500',
      },
      {
        tab: 'Client Standing',
        label: 'Delinquent Clients',
        value: delinquentResult.clients.length,
        subtitle: 'Currently flagged',
        accent: 'bg-accent-900',
      },
    ])
  }

  // Decorative fill, not a precise proportion: 6% floor so a 0-value
  // card still shows a sliver of track, scaled against the loudest
  // card in the current batch.
  const maxValue = cards ? Math.max(...cards.map((card) => card.value), 1) : 1

  return (
    <div>
      <h3 className="font-ui text-[11px] font-medium tracking-[0.16em] text-neutral-500 uppercase">
        Report Activity
      </h3>

      {error && (
        <p className="mt-3 border border-red-200 bg-red-50 px-4 py-3 font-ui text-sm text-red-700">
          {error}
        </p>
      )}

      {!error && !cards && (
        <p className="mt-3 font-ui text-neutral-500">Loading report activity...</p>
      )}

      {cards && (
        <div className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <button
              key={card.tab}
              onClick={() => onNavigate(card.tab)}
              className="reports-blueprint-card px-[22px] pt-[22px] pb-5 text-left hover:border-accent-500/60"
            >
              <p className="font-ui text-base text-reports-ink">{card.label}</p>
              <p className="font-condensed mt-2.5 text-[36px] leading-none font-bold text-reports-ink">
                {card.value}
              </p>
              <p className="mt-2.5 font-ui text-[13px] text-neutral-600">{card.subtitle}</p>
              <div className="mt-4 h-1.5 w-full bg-neutral-200">
                <div
                  className={`h-full ${card.accent}`}
                  style={{ width: `${Math.max(6, (card.value / maxValue) * 100)}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
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

  if (rows.length === 0 && !error) {
    return <p className="text-slate-500">No outstanding balances right now.</p>
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Booking</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Origin → Destination</th>
              <th className="px-4 py-3 font-medium">Rate/Trip</th>
              <th className="px-4 py-3 font-medium">Trips</th>
              <th className="px-4 py-3 font-medium">Contract Value</th>
              <th className="px-4 py-3 font-medium">Billable</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Terms</th>
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
                    {row.rate_per_trip != null
                      ? `₱${row.rate_per_trip.toLocaleString()}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.completed_trips}/{row.total_trips}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    ₱{row.total_contract_value.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    ₱{row.billable_amount.toLocaleString()}
                    {row.amount_to_pay_override !== null && (
                      <span className="ml-1.5 text-xs text-slate-400">
                        (overridden)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    ₱{row.amount_paid.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    ₱{row.balance_due.toLocaleString()}
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
    </div>
  )
}

const TAB_COMPONENTS: Partial<Record<Tab, () => React.JSX.Element>> = {
  'Payments Due': PaymentsDueTab,
  'Issue Reports': IssueReportsSection,
  'Client Requests': ClientStatusRequestsSection,
  'Work Order Completions': WorkOrderCompletionsSection,
  'Work Order Acceptance': WorkOrderAcceptanceLogSection,
  'Payslip Issues': PayslipIssueReportsSection,
  'Maintenance Schedules': MaintenanceSchedulesSection,
  'Client Reviews': ClientReviewsSection,
  'Client Standing': ClientDelinquencySection,
}

function ReportsSection() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview')
  const ActiveTabComponent = activeTab === 'Overview' ? null : TAB_COMPONENTS[activeTab]

  return (
    <div className="bg-reports-bg -m-6 p-6">
      <h2 className="font-condensed text-3xl font-bold tracking-[0.02em] text-reports-ink uppercase">
        Reports
      </h2>

      <div className="mt-5 flex flex-wrap gap-7 border-b border-reports-hairline">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`font-ui pb-2.5 text-[15px] ${
              activeTab === tab
                ? 'border-b-2 border-accent-700 font-semibold text-reports-ink'
                : 'text-neutral-600 hover:text-neutral-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === 'Overview' ? (
          <OverviewTab onNavigate={setActiveTab} />
        ) : (
          ActiveTabComponent && <ActiveTabComponent />
        )}
      </div>
    </div>
  )
}

export default ReportsSection
