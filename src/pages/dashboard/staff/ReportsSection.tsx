// ReportsSection: placeholder report cards with mock summary numbers and
// a small bar chart (plain divs, no charting library). Clicking a card
// does nothing yet.
//
// MOCK DATA -- replace with real Supabase query later. Nothing on this
// page reads from or writes to the database yet.

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

function ReportsSection() {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">Reports</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MOCK_REPORTS.map((report) => (
          <button
            key={report.report_id}
            className="rounded-xl border border-slate-200 bg-white p-6 text-left shadow-sm hover:border-slate-300"
          >
            <p className="text-sm font-medium text-slate-500">
              {report.title}
            </p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {report.headline_value}
            </p>
            <p className="mt-1 text-xs text-slate-400">{report.subtitle}</p>
            <MiniBarChart
              values={report.chart_values}
              accent={report.accent}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

export default ReportsSection
