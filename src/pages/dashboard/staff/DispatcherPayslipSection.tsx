// DispatcherPayslipSection: thin page wrapper so Dispatcher (a staff
// role with its own restricted dashboard, not the Driver/Mechanic/
// Helper "employee" tier) still gets a "My Payslips" page -- reuses
// the same MyPayslipSection used there, since the viewing logic is
// identical.
import MyPayslipSection from '../employee/MyPayslipSection'
import PageHeader from '../../../components/PageHeader'

function DispatcherPayslipSection() {
  return (
    <div>
      <PageHeader title="My Payslips" subtitle="Your finalized payslips." />
      <MyPayslipSection />
    </div>
  )
}

export default DispatcherPayslipSection
