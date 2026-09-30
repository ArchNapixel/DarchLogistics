// CashAdvanceSection (Admin, Human Resource -> Cash Advance): one page for
// everything cash-advance related that used to sit on the Payroll page --
// issue an advance directly, review employees' pending requests, and the
// full ledger. Just composes the existing components; no new logic.
import { useState } from 'react'
import IssueCashAdvanceModal from './IssueCashAdvanceModal'
import CashAdvanceRequestsSection from './CashAdvanceRequestsSection'
import CashAdvanceLedgerSection from './CashAdvanceLedgerSection'

function CashAdvanceSection() {
  const [showIssueAdvance, setShowIssueAdvance] = useState(false)
  // Bumped after issuing so the ledger remounts and reloads
  const [ledgerKey, setLedgerKey] = useState(0)

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">Cash Advance</h2>
        <button
          onClick={() => setShowIssueAdvance(true)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Issue Cash Advance
        </button>
      </div>

      <div className="mt-6">
        <CashAdvanceRequestsSection />
      </div>

      <section className="mt-6 border-t border-slate-200 pt-6">
        <h3 className="text-lg font-semibold text-slate-900">Cash Advance Ledger</h3>
        <div className="mt-4">
          <CashAdvanceLedgerSection key={ledgerKey} />
        </div>
      </section>

      {showIssueAdvance && (
        <IssueCashAdvanceModal
          onClose={() => setShowIssueAdvance(false)}
          onIssued={() => {
            setShowIssueAdvance(false)
            setLedgerKey((key) => key + 1)
          }}
        />
      )}
    </div>
  )
}

export default CashAdvanceSection
