// MyPayslipPage: the "My Payslips" page for Driver/Mechanic/Helper (the
// canvas's Driver Payslips board): the payslip list + selected payslip
// (MyPayslipSection), and beside them Request Cash Advance and My Requests
// (cash advance requests + payslip reports). Dispatchers have their own
// page (staff/DispatcherPayslipSection.tsx) since it lives in a different
// route tree -- it shows MyPayslipSection only.
//
// requestsKey is bumped after a new cash advance request or payslip report
// so My Requests remounts (and so reloads).
import { useState } from 'react'
import MyPayslipSection from './MyPayslipSection'
import RequestCashAdvanceForm from './RequestCashAdvanceForm'
import MyRequestsSection from './MyRequestsSection'
import PageHeader from '../../../components/PageHeader'

function MyPayslipPage() {
  const [requestsKey, setRequestsKey] = useState(0)
  const bump = () => setRequestsKey((key) => key + 1)

  return (
    <div>
      <PageHeader title="My Payslips" subtitle="Payslips, cash advance requests, and anything you've reported." />
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:items-start">
        <MyPayslipSection onIssueReported={bump} />
        <aside className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-1">
          <RequestCashAdvanceForm onRequested={bump} />
          <MyRequestsSection key={requestsKey} />
        </aside>
      </div>
    </div>
  )
}

export default MyPayslipPage
