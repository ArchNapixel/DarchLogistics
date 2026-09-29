// ReportsSection: one page, four groups.
//   Overview      -- counts of what needs attention, click to jump
//   Needs action  -- the approve/reject queues, one chip each
//   Clients       -- payments due, reviews, delinquency
//   Logs          -- read-only history
// Each chip just renders the existing section component, so nothing
// those sections do was changed. "Payments Due" is view-only, backed by
// src/lib/paymentDue.ts (payments are recorded in Financial Records --
// FinancialSection.tsx). See paymentDue.ts for the due-date rule.
import { Fragment, useState } from 'react'
import { useCachedLoad } from '../../../lib/useCachedLoad'
import { SkeletonCards, SkeletonTable } from '../../../components/Skeleton'
import {
  loadPaymentDueReport,
  formatDaysUntilDue,
  DUE_TONE_STYLES,
  type PaymentDueRow,
} from '../../../lib/paymentDue'
import { supabase } from '../../../lib/supabaseClient'
import { loadPendingStatusRequests } from '../../../lib/clientStatusRequests'
import { loadPendingPayslipIssues } from '../../../lib/payslipIssueReports'
import { loadPendingMaintenanceSchedules } from '../../../lib/maintenanceSchedules'
import { loadPendingMaintenanceRequests } from '../../../lib/maintenanceRequests'
import { loadCurrentlyDelinquentClients } from '../../../lib/clientDelinquency'
import { loadPendingRelogRequests } from '../../../lib/statusRelogRequests'
import IssueReportsSection from './IssueReportsSection'
import ClientStatusRequestsSection from './ClientStatusRequestsSection'
import PayslipIssueReportsSection from './PayslipIssueReportsSection'
import WorkOrderAcceptanceLogSection from './WorkOrderAcceptanceLogSection'
import WorkOrderCompletionsSection from './WorkOrderCompletionsSection'
import MaintenanceSchedulesSection from './MaintenanceSchedulesSection'
import MaintenanceRequestsSection from './MaintenanceRequestsSection'
import ClientReviewsSection from './ClientReviewsSection'
import ClientDelinquencySection from './ClientDelinquencySection'
import StatusRelogRequestsSection from './StatusRelogRequestsSection'
import DispatchStatusLogSection from './DispatchStatusLogSection'
import WorkOrderStatusLogSection from './WorkOrderStatusLogSection'

// ---------- Layout: groups and their chips ----------

const BASE_DATE_SOURCE_LABELS: Record<PaymentDueRow['base_date_source'], string> = {
  actual: 'Actual delivery',
  preferred: 'Estimated (preferred date)',
  unknown: 'Unknown',
}

// Payments Due: 8 columns; the rest of the detail opens under the row.
function PaymentsDueTab() {
  const { data } = useCachedLoad('reports:payments-due', loadPaymentDueReport)
  const [openId, setOpenId] = useState<number | null>(null)

  if (!data) return <SkeletonTable cols={8} />
  const { rows, error } = data
  if (rows.length === 0 && !error) {
    return <p className="text-slate-500">No outstanding balances right now.</p>
  }

  const money = (n: number) => `₱${n.toLocaleString()}`

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Booking</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Route</th>
              <th className="px-4 py-3 font-medium">Billable</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Due</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              // Nothing delivered yet: the due date is only an estimate, so
              // don't flag it "Overdue" -- there's nothing to pay yet.
              const notBillable = row.completed_trips === 0 && row.billable_amount <= 0
              const due = notBillable
                ? { label: 'Not billable yet', tone: 'unknown' as const }
                : formatDaysUntilDue(row.days_until_due)
              const open = openId === row.booking_id
              return (
                <Fragment key={row.booking_id}>
                  <tr
                    onClick={() => setOpenId(open ? null : row.booking_id)}
                    className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-slate-900">#{row.booking_id}</td>
                    <td className="px-4 py-3 text-slate-900">{row.client_name}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.pickup_place_name} → {row.delivery_place_name}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{money(row.billable_amount)}</td>
                    <td className="px-4 py-3 text-slate-600">{money(row.amount_paid)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {money(row.balance_due)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.due_date ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 text-xs font-semibold ${DUE_TONE_STYLES[due.tone]}`}>
                        {due.label}
                      </span>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={8} className="px-4 py-3">
                        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
                          <div>
                            <dt className="text-xs text-slate-500">Rate / trip</dt>
                            <dd className="text-slate-900">
                              {row.rate_per_trip != null ? money(row.rate_per_trip) : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Trips done</dt>
                            <dd className="text-slate-900">
                              {row.completed_trips}/{row.total_trips}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Contract value</dt>
                            <dd className="text-slate-900">{money(row.total_contract_value)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Terms</dt>
                            <dd className="text-slate-900">{row.payment_terms}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-slate-500">Base date</dt>
                            <dd className="text-slate-900">
                              {row.base_date ?? '—'} ({BASE_DATE_SOURCE_LABELS[row.base_date_source]})
                            </dd>
                          </div>
                        </dl>
                        {row.amount_to_pay_override !== null && (
                          <p className="mt-2 text-xs text-slate-500">Billable amount was overridden.</p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// onChanged: a queue tells the page "I just approved/rejected something" so the badges re-count.
type Item = { label: string; Component: (props: { onChanged?: () => void }) => React.JSX.Element }
type Group = { name: string; items: Item[] }

const GROUPS: Group[] = [
  { name: 'Overview', items: [] },
  {
    name: 'Needs action',
    items: [
      { label: 'Issue Reports', Component: IssueReportsSection },
      { label: 'Client Requests', Component: ClientStatusRequestsSection },
      { label: 'Payslip Issues', Component: PayslipIssueReportsSection },
      { label: 'Maintenance Requests', Component: MaintenanceRequestsSection },
      { label: 'Maintenance Schedules', Component: MaintenanceSchedulesSection },
      { label: 'Status Relog Requests', Component: StatusRelogRequestsSection },
    ],
  },
  {
    name: 'Clients',
    items: [
      { label: 'Payments Due', Component: PaymentsDueTab },
      { label: 'Reviews', Component: ClientReviewsSection },
      { label: 'Standing', Component: ClientDelinquencySection },
    ],
  },
  {
    name: 'Logs',
    items: [
      { label: 'Work Orders Completed', Component: WorkOrderCompletionsSection },
      { label: 'Work Orders Accepted', Component: WorkOrderAcceptanceLogSection },
      { label: 'Work Order Status', Component: WorkOrderStatusLogSection },
      { label: 'Dispatch Status', Component: DispatchStatusLogSection },
    ],
  },
]

// ---------- Counts (pending work only) ----------

// Loaded once for the page: the same numbers fill the Overview and the
// badges on the group tabs and chips. Key = chip label.
async function loadCounts(): Promise<{ counts: Record<string, number> | null; error: string | null }> {
  const [issues, clientReqs, payslips, mReqs, mScheds, relogs, delinquent] = await Promise.all([
    supabase
      .from('issue_reports')
      .select('*', { count: 'exact', head: true })
      .or('worked_on.is.null,worked_on.eq.false'),
    loadPendingStatusRequests(),
    loadPendingPayslipIssues(),
    loadPendingMaintenanceRequests(),
    loadPendingMaintenanceSchedules(),
    loadPendingRelogRequests(),
    loadCurrentlyDelinquentClients(),
  ])

  const loadError =
    issues.error?.message ??
    clientReqs.error ??
    payslips.error ??
    mReqs.error ??
    mScheds.error ??
    relogs.error ??
    delinquent.error
  if (loadError) return { counts: null, error: loadError }

  return {
    error: null,
    counts: {
      'Issue Reports': issues.count ?? 0,
      'Client Requests': clientReqs.requests.length,
      'Payslip Issues': payslips.reports.length,
      'Maintenance Requests': mReqs.requests.length,
      'Maintenance Schedules': mScheds.schedules.length,
      'Status Relog Requests': relogs.requests.length,
      Standing: delinquent.clients.length,
    },
  }
}

const OVERVIEW_SUBTITLES: Record<string, string> = {
  'Issue Reports': 'Not yet worked on',
  'Client Requests': 'Awaiting a response',
  'Payslip Issues': 'Awaiting resolution',
  'Maintenance Requests': 'Awaiting approval',
  'Maintenance Schedules': 'Upcoming',
  'Status Relog Requests': 'Awaiting approval',
  Standing: 'Delinquent clients',
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-900 px-1.5 text-[11px] font-semibold text-white">
      {n}
    </span>
  )
}

function Overview({
  counts,
  error,
  onOpen,
}: {
  counts: Record<string, number> | null
  error: string | null
  onOpen: (group: string, item: string) => void
}) {
  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
  if (!counts) return <SkeletonCards />

  // Only things with something waiting.
  const pending = GROUPS.flatMap((group) =>
    group.items
      .filter((item) => (counts[item.label] ?? 0) > 0)
      .map((item) => ({ group: group.name, label: item.label, value: counts[item.label] })),
  )

  if (pending.length === 0) return <p className="text-slate-500">Nothing needs action right now.</p>

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {pending.map((p) => (
        <button
          key={p.label}
          onClick={() => onOpen(p.group, p.label)}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-slate-400"
        >
          <p className="text-2xl font-bold text-slate-900">{p.value}</p>
          <p className="mt-1 text-sm font-medium text-slate-700">{p.label}</p>
          <p className="text-xs text-slate-500">{OVERVIEW_SUBTITLES[p.label]}</p>
        </button>
      ))}
    </div>
  )
}

function ReportsSection() {
  const [groupName, setGroupName] = useState('Overview')
  const [itemLabel, setItemLabel] = useState('')
  const { data: loaded, refresh: refreshCounts } = useCachedLoad('reports:counts', loadCounts)
  const counts = loaded?.counts ?? null
  const error = loaded?.error ?? null

  const group = GROUPS.find((g) => g.name === groupName)!
  const item = group.items.find((i) => i.label === itemLabel) ?? group.items[0]
  const count = (label: string) => counts?.[label] ?? 0
  // "Standing" is a status, not work waiting -- keep it out of the group badge.
  const groupCount = (g: Group) =>
    g.items.reduce((sum, i) => sum + (i.label === 'Standing' ? 0 : count(i.label)), 0)

  function open(group: string, item: string) {
    setGroupName(group)
    setItemLabel(item)
    // Counts may have changed since the last look (e.g. after acting on a queue).
    refreshCounts()
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Reports</h2>

      <div className="mt-4 flex gap-2 border-b border-slate-200">
        {GROUPS.map((g) => (
          <button
            key={g.name}
            onClick={() => open(g.name, '')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium ${
              groupName === g.name
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {g.name}
            <Badge n={groupCount(g)} />
          </button>
        ))}
      </div>

      {item && (
        <div className="mt-4 flex flex-wrap gap-2">
          {group.items.map((i) => (
            <button
              key={i.label}
              onClick={() => open(group.name, i.label)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                i.label === item.label
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-700 hover:border-slate-500'
              }`}
            >
              {i.label}
              {count(i.label) > 0 && (
                <span className={i.label === item.label ? 'text-slate-300' : 'text-slate-500'}>
                  {count(i.label)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5">
        {item ? <item.Component onChanged={refreshCounts} /> : <Overview counts={counts} error={error} onOpen={open} />}
      </div>
    </div>
  )
}

export default ReportsSection
