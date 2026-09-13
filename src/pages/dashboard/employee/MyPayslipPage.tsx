// MyPayslipPage: nav page wrapper around MyPayslipSection, matching
// the "My History" pattern (its own sidebar link/route rather than
// embedded inline on the dashboard). Shared by Driver/Mechanic/Helper;
// Dispatcher has its own equivalent wrapper
// (staff/DispatcherPayslipSection.tsx) since it lives in a different
// route tree, but both just render the same MyPayslipSection.
//
// MyCashAdvanceRequestsSection is mounted here only -- Dispatcher's
// wrapper doesn't include it, since cash advance requests are a
// Driver/Mechanic/Helper ("employee" tier) feature, not a Dispatcher one.
import MyPayslipSection from './MyPayslipSection'
import MyCashAdvanceRequestsSection from './MyCashAdvanceRequestsSection'

function MyPayslipPage() {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My Payslips</h2>
      <div className="mt-4">
        <MyPayslipSection />
      </div>

      <h2 className="mt-8 text-xl font-bold text-slate-900">Cash Advances</h2>
      <div className="mt-4">
        <MyCashAdvanceRequestsSection />
      </div>
    </div>
  )
}

export default MyPayslipPage
