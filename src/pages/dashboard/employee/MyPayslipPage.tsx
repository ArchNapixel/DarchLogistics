// MyPayslipPage: nav page wrapper around MyPayslipSection, matching
// the "My History" pattern (its own sidebar link/route rather than
// embedded inline on the dashboard). Shared by Driver/Mechanic/Helper;
// Dispatcher has its own equivalent wrapper
// (staff/DispatcherPayslipSection.tsx) since it lives in a different
// route tree, but both just render the same MyPayslipSection.
//
// MyCashAdvanceRequestsSection and MyPayslipIssueReportsSection are
// mounted here only -- Dispatcher's wrapper doesn't include either,
// since both are a Driver/Mechanic/Helper ("employee" tier) feature,
// not a Dispatcher one. issueReportsRefreshKey forces
// MyPayslipIssueReportsSection to remount (and so reload) right after
// a report is submitted from within MyPayslipSection -- same trick
// EmployeeDashboard.tsx uses for the Task Board.
import { useState } from 'react'
import MyPayslipSection from './MyPayslipSection'
import MyCashAdvanceRequestsSection from './MyCashAdvanceRequestsSection'
import MyPayslipIssueReportsSection from './MyPayslipIssueReportsSection'

function MyPayslipPage() {
  const [issueReportsRefreshKey, setIssueReportsRefreshKey] = useState(0)

  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My Payslips</h2>
      <div className="mt-4">
        <MyPayslipSection
          onIssueReported={() =>
            setIssueReportsRefreshKey((key) => key + 1)
          }
        />
      </div>

      <h2 className="mt-8 text-xl font-bold text-slate-900">Cash Advances</h2>
      <div className="mt-4">
        <MyCashAdvanceRequestsSection />
      </div>

      <h2 className="mt-8 text-xl font-bold text-slate-900">
        My Payslip Issue Reports
      </h2>
      <div className="mt-4">
        <MyPayslipIssueReportsSection key={issueReportsRefreshKey} />
      </div>
    </div>
  )
}

export default MyPayslipPage
