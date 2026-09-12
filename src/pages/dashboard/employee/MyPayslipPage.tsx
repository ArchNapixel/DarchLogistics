// MyPayslipPage: nav page wrapper around MyPayslipSection, matching
// the "My History" pattern (its own sidebar link/route rather than
// embedded inline on the dashboard). Shared by Driver/Mechanic/Helper;
// Dispatcher has its own equivalent wrapper
// (staff/DispatcherPayslipSection.tsx) since it lives in a different
// route tree, but both just render the same MyPayslipSection.
import MyPayslipSection from './MyPayslipSection'

function MyPayslipPage() {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My Payslips</h2>
      <div className="mt-4">
        <MyPayslipSection />
      </div>
    </div>
  )
}

export default MyPayslipPage
