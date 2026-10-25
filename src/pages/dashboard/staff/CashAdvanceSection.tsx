// CashAdvanceSection (Admin, Human Resource -> Cash Advance): one page for
// everything cash-advance related that used to sit on the Payroll page --
// issue an advance directly, review employees' pending requests, and the
// full ledger. Just composes the existing components; no new logic. Laid
// out like the canvas board: totals on top, the ledger table, and the
// Issue Cash Advance form as a panel on the right.
import { useState } from 'react'
import IssueCashAdvanceModal from './IssueCashAdvanceModal'
import CashAdvanceRequestsSection from './CashAdvanceRequestsSection'
import CashAdvanceLedgerSection from './CashAdvanceLedgerSection'
import PageHeader from '../../../components/PageHeader'
import { showToast } from '../../../components/Toast'

function CashAdvanceSection() {
  // Bumped after issuing so the ledger remounts and reloads
  const [ledgerKey, setLedgerKey] = useState(0)

  return (
    <div>
      <PageHeader
        title="Cash Advances"
        subtitle="Money released to employees ahead of payday, recovered through payroll deductions."
      />

      {/* Employees' own requests waiting for a decision (shows nothing when none). */}
      <div className="mb-4">
        <CashAdvanceRequestsSection />
      </div>

      <CashAdvanceLedgerSection
        key={ledgerKey}
        side={
          <IssueCashAdvanceModal
            inline
            onIssued={() => {
              showToast('Cash advance issued.')
              setLedgerKey((key) => key + 1)
            }}
          />
        }
      />
    </div>
  )
}

export default CashAdvanceSection
