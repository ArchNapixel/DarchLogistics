// CashAdvanceSection (Admin, Human Resource -> Cash Advance): one page for
// everything cash-advance related that used to sit on the Payroll page --
// issue an advance directly, review employees' pending requests, and the
// full ledger. Just composes the existing components; no new logic.
import { useState } from 'react'
import IssueCashAdvanceModal from './IssueCashAdvanceModal'
import CashAdvanceRequestsSection from './CashAdvanceRequestsSection'
import CashAdvanceLedgerSection from './CashAdvanceLedgerSection'
import PageHeader, { SectionHeader } from '../../../components/PageHeader'

function CashAdvanceSection() {
  const [showIssueAdvance, setShowIssueAdvance] = useState(false)
  // Bumped after issuing so the ledger remounts and reloads
  const [ledgerKey, setLedgerKey] = useState(0)

  return (
    <div>
      <PageHeader
        title="Cash Advances"
        subtitle="Issue advances, review employee requests and track balances."
        actions={
          <button
            onClick={() => setShowIssueAdvance(true)}
            className="btn-primary px-4 py-2 text-sm font-medium"
          >
            Issue Cash Advance
          </button>
        }
      />

      <CashAdvanceRequestsSection />

      <section className="mt-6 border-t border-slate-200 pt-6">
        <SectionHeader title="Cash Advance Ledger" />
        <CashAdvanceLedgerSection key={ledgerKey} />
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
