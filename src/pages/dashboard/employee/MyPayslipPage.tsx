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
import PageHeader, { SectionHeader } from '../../../components/PageHeader'

function MyPayslipPage() {
  const [issueReportsRefreshKey, setIssueReportsRefreshKey] = useState(0)

  return (
    <div>
      <PageHeader title="My Payslips" subtitle="Your finalized payslips, cash advances and payslip questions." />
      <MyPayslipSection
        onIssueReported={() =>
          setIssueReportsRefreshKey((key) => key + 1)
        }
      />

      <section className="mt-8">
        <SectionHeader title="Cash Advances" />
        <MyCashAdvanceRequestsSection />
      </section>

      <section className="mt-8">
        <SectionHeader title="My Payslip Issue Reports" />
        <MyPayslipIssueReportsSection key={issueReportsRefreshKey} />
      </section>
    </div>
  )
}

export default MyPayslipPage
