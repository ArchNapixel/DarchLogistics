// medicalExams: a driver's three medical exams -- Physical, Drug Test and
// Psychological -- each with the date taken, its expiry and the result. One
// list so the Employees form, the employee panel and the expiry bell
// (ComplianceExpiryAlerts) all agree. The Physical exam uses the columns the
// single "medical exam" used before (medical_exam_date / _expiry_date);
// the other columns were added 2026-10-25 (SQL given in chat).

export const EXAM_RESULTS = ['Passed', 'Failed'] as const

export const MEDICAL_EXAMS = [
  { key: 'physical', label: 'Physical', date: 'medical_exam_date', expiry: 'medical_exam_expiry_date', result: 'physical_exam_result' },
  { key: 'drug', label: 'Drug Test', date: 'drug_test_date', expiry: 'drug_test_expiry_date', result: 'drug_test_result' },
  { key: 'psych', label: 'Psychological', date: 'psych_exam_date', expiry: 'psych_exam_expiry_date', result: 'psych_exam_result' },
] as const

export type MedicalExamColumn = (typeof MEDICAL_EXAMS)[number]['date' | 'expiry' | 'result']

// (Queries list these columns written out -- Supabase's typed .select()
// can't read a column list built in code.)

// The exam values as stored on an employee (null = not recorded).
export type MedicalExamValues = Record<MedicalExamColumn, string | null>

// Picks the exam columns out of an employees row.
export function examValuesOf(row: Record<string, unknown>): MedicalExamValues {
  const out = {} as MedicalExamValues
  for (const e of MEDICAL_EXAMS) {
    for (const col of [e.date, e.expiry, e.result] as const) {
      const v = row[col]
      out[col] = typeof v === 'string' && v !== '' ? v : null
    }
  }
  return out
}

// True when the error is "an exam column doesn't exist yet" (the medical
// exams SQL hasn't been run). Pages then load without the Drug Test /
// Psychological / result columns (shown as not recorded) instead of failing.
export function isMissingExamColumns(message: string): boolean {
  return /(physical_exam|drug_test|psych_exam)/.test(message) && message.includes('does not exist')
}

// What a row loaded without the new exam columns gets for them.
export const NO_NEW_EXAM_VALUES = {
  physical_exam_result: null,
  drug_test_date: null,
  drug_test_expiry_date: null,
  drug_test_result: null,
  psych_exam_date: null,
  psych_exam_expiry_date: null,
  psych_exam_result: null,
} as const
