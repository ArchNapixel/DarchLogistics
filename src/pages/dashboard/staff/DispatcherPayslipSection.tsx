// DispatcherPayslipSection: thin page wrapper so Dispatcher (a staff
// role with its own restricted dashboard, not the Driver/Mechanic/
// Helper "employee" tier) still gets a "My Payslips" page -- reuses
// the same MyPayslipSection used there, since the pay rule (flat
// weekly salary + daily allowance) and viewing logic are identical.
import MyPayslipSection from '../employee/MyPayslipSection'

function DispatcherPayslipSection() {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-900">My Payslips</h2>
      <div className="mt-4">
        <MyPayslipSection />
      </div>
    </div>
  )
}

export default DispatcherPayslipSection
