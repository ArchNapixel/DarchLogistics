// cashAdvanceLedgerTotals: one employee's cash advance log with a running
// balance. Pure (self-check: node scripts/check-cash-advance-ledger.ts).
// Loading is in lib/cashAdvanceLedger.ts.
//   issued   = an Approved cash advance (adds to the balance)
//   deducted = a FINALIZED payslip's cash_advance_deducted (dated by its week end)
//   repaid   = money paid back outside payroll (cash_advance_repayments);
//              a voided one stays in the log but doesn't move the balance
// Same rounding as lib/amountInput.ts (not imported: node runs this file
// on its own for the self-check).
const cents = (n: number) => Math.round(n * 100) / 100

export type LedgerEntryKind = 'issued' | 'deducted' | 'repaid'

export type LedgerEntry = {
  kind: LedgerEntryKind
  id: number // cash_advance_id / payroll_id / repayment_id
  date: string // YYYY-MM-DD
  amount: number // always positive
  label: string
  voided?: boolean
}

export type LedgerLine = LedgerEntry & { balance: number }

export type EmployeeLedger = {
  lines: LedgerLine[] // oldest first
  issued: number
  deducted: number
  repaid: number
  outstanding: number
  lastDate: string | null
}

// Same day: the advance first, so the balance never dips below zero mid-day.
const KIND_ORDER: Record<LedgerEntryKind, number> = { issued: 0, deducted: 1, repaid: 2 }

export function buildEmployeeLedger(entries: LedgerEntry[]): EmployeeLedger {
  const sorted = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id,
  )
  let balance = 0
  let issued = 0
  let deducted = 0
  let repaid = 0
  const lines = sorted.map((entry) => {
    if (!entry.voided) {
      if (entry.kind === 'issued') {
        issued += entry.amount
        balance += entry.amount
      } else {
        if (entry.kind === 'deducted') deducted += entry.amount
        else repaid += entry.amount
        balance -= entry.amount
      }
    }
    return { ...entry, balance: cents(balance) }
  })
  return {
    lines,
    issued: cents(issued),
    deducted: cents(deducted),
    repaid: cents(repaid),
    outstanding: cents(balance),
    lastDate: sorted.length > 0 ? sorted[sorted.length - 1].date : null,
  }
}

// Most that can be recorded as paid back now: deductions already sitting on
// DRAFT payslips count as taken (payroll does the same), so they come off.
export function maxRepayment(outstanding: number, draftDeducted: number): number {
  return cents(Math.max(outstanding - draftDeducted, 0))
}
