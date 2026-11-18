// csv: one cell of a CSV file, for every CSV download in the app (pure,
// self-check: node scripts/check-csv.ts).
//   - Quotes a cell holding a comma, quote or line break (quotes doubled).
//   - Formula injection: Excel / Sheets run a cell starting with = + - @ (or
//     a tab / carriage return) as a formula, so a client name typed as
//     "=HYPERLINK(...)" could run on the admin's computer. Such TEXT gets a
//     leading apostrophe, which spreadsheets show as plain text. Real numbers
//     (number values, or text that is just a number like "-500.25") are left
//     alone so they still add up in Excel.
export function csvField(value: string | number): string {
  let text = String(value)
  const isNumber = typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(text)
  if (!isNumber && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
