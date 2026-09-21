// inventoryReport.ts: builds the data behind the Inventory page's
// "Print Inventory Report" button -- a CSV snapshot of current stock
// levels plus everything used out of stock during one Sunday-through-
// Saturday week (same weekly-period idea as payslip.ts's
// getDefaultPayPeriod, just anchored on Sunday instead of Saturday).
//
// "Used stock" is read from work_order_parts_used (joined to
// work_order_completions for the date) rather than work_order_parts_log,
// because work_order_parts_used is the final, reconciled record of every
// part consumed on a work order -- it already includes both parts logged
// mid-job AND parts entered fresh at completion (see
// CompleteWorkOrderModal.tsx step 3), so there's no risk of double-
// counting or missing anything.
import { supabase } from './supabaseClient'

export type CurrentStockRow = {
  item_id: number
  name: string
  item_type: string
  quantity: number
}

export type UsedStockRow = {
  item_name_text: string
  quantity: number
  work_order_number: string
  completed_at: string
}

// Sunday through Saturday, the week containing `anchorDate` (a
// yyyy-mm-dd string, e.g. from an <input type="date">).
export function getReportWeek(anchorDate: string): { start: string; end: string } {
  const anchor = new Date(`${anchorDate}T00:00:00`)
  const start = new Date(anchor)
  start.setDate(anchor.getDate() - anchor.getDay())
  const end = new Date(start)
  end.setDate(start.getDate() + 6)

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

// A week can straddle a month (Aug 30 - Sep 5) or even a year
// (Dec 28 - Jan 3) -- format each side with its own month, and only
// repeat the year on both sides when they actually differ.
export function formatReportWeekLabel(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  const sameYear = startDate.getFullYear() === endDate.getFullYear()

  const startLabel = startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })
  const endLabel = endDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return `${startLabel} - ${endLabel}`
}

export type ReportWeekOption = {
  start: string
  end: string
  label: string
}

// Sunday-through-Saturday weeks for the report picker dropdown, most
// recent (current week) first. A week is included if any of these hold:
//   - it touches the current calendar month (so the whole current month
//     is always browsable, no matter how far into it today is)
//   - it's last week (a fixed floor, so there's always at least one
//     week of history to pick even in a brand-new system)
//   - it contains real usage data (its end date reaches back to
//     `earliestDataDate`, the oldest work_order_completions.completed_at
//     on record)
// Each condition is monotonic going further back in time, so once a
// week fails all three, every earlier week will too -- safe to stop.
function buildReportWeekOptions(earliestDataDate: string | null): ReportWeekOption[] {
  const today = new Date().toISOString().slice(0, 10)
  const { start: currentWeekStart } = getReportWeek(today)
  const todayDate = new Date(`${today}T00:00:00`)
  const currentMonth = todayDate.getMonth()
  const currentYear = todayDate.getFullYear()

  const weeks: ReportWeekOption[] = []
  const cursor = new Date(`${currentWeekStart}T00:00:00`)
  const MAX_WEEKS = 520 // ~10 years, just a safety cap against a runaway loop

  for (let i = 0; i < MAX_WEEKS; i++) {
    const start = cursor.toISOString().slice(0, 10)
    const weekEndDate = new Date(cursor)
    weekEndDate.setDate(cursor.getDate() + 6)
    const end = weekEndDate.toISOString().slice(0, 10)

    const touchesCurrentMonth =
      (cursor.getMonth() === currentMonth && cursor.getFullYear() === currentYear) ||
      (weekEndDate.getMonth() === currentMonth && weekEndDate.getFullYear() === currentYear)
    const isLastWeekFloor = i <= 1 // this week (i=0) and last week (i=1)
    const hasData = earliestDataDate !== null && end >= earliestDataDate

    if (i > 0 && !touchesCurrentMonth && !isLastWeekFloor && !hasData) {
      break
    }

    weeks.push({ start, end, label: formatReportWeekLabel(start, end) })
    cursor.setDate(cursor.getDate() - 7)
  }

  return weeks
}

export async function loadReportWeekOptions(): Promise<{
  weeks: ReportWeekOption[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('work_order_completions')
    .select('completed_at')
    .order('completed_at', { ascending: true })
    .limit(1)

  if (error) {
    return { weeks: [], error: error.message }
  }

  const earliestDataDate = data.length > 0 ? data[0].completed_at.slice(0, 10) : null
  return { weeks: buildReportWeekOptions(earliestDataDate), error: null }
}

export async function loadInventoryReport(
  weekStart: string,
  weekEnd: string,
): Promise<{
  currentStock: CurrentStockRow[]
  usedStock: UsedStockRow[]
  error: string | null
}> {
  const { data: currentStock, error: stockError } = await supabase
    .from('inventory_items')
    .select('item_id, name, item_type, quantity')
    .order('name', { ascending: true })

  if (stockError) {
    return { currentStock: [], usedStock: [], error: stockError.message }
  }

  const { data: completions, error: completionsError } = await supabase
    .from('work_order_completions')
    .select('completion_id, work_order_id, completed_at')

  if (completionsError) {
    return { currentStock, usedStock: [], error: completionsError.message }
  }

  const weekCompletions = completions.filter((c) => {
    const day = c.completed_at.slice(0, 10)
    return day >= weekStart && day <= weekEnd
  })

  if (weekCompletions.length === 0) {
    return { currentStock, usedStock: [], error: null }
  }

  const completionIds = weekCompletions.map((c) => c.completion_id)
  const { data: partsUsed, error: partsError } = await supabase
    .from('work_order_parts_used')
    .select('completion_id, item_name_text, quantity')
    .in('completion_id', completionIds)

  if (partsError) {
    return { currentStock, usedStock: [], error: partsError.message }
  }

  const workOrderIds = Array.from(new Set(weekCompletions.map((c) => c.work_order_id)))
  const { data: workOrders, error: workOrdersError } = await supabase
    .from('work_orders')
    .select('work_order_id, work_order_number')
    .in('work_order_id', workOrderIds)

  if (workOrdersError) {
    return { currentStock, usedStock: [], error: workOrdersError.message }
  }

  const completedAtByCompletionId = new Map(
    weekCompletions.map((c) => [c.completion_id, c.completed_at]),
  )
  const workOrderIdByCompletionId = new Map(
    weekCompletions.map((c) => [c.completion_id, c.work_order_id]),
  )
  const workOrderNumberById = new Map(workOrders.map((w) => [w.work_order_id, w.work_order_number]))

  const usedStock: UsedStockRow[] = partsUsed.map((p) => {
    const workOrderId = workOrderIdByCompletionId.get(p.completion_id)
    return {
      item_name_text: p.item_name_text,
      quantity: p.quantity,
      work_order_number:
        workOrderId !== undefined
          ? (workOrderNumberById.get(workOrderId) ?? `#${workOrderId}`)
          : 'Unknown',
      completed_at: completedAtByCompletionId.get(p.completion_id) ?? '',
    }
  })

  return { currentStock, usedStock, error: null }
}

function csvField(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildInventoryReportCsv({
  weekStart,
  weekEnd,
  currentStock,
  usedStock,
}: {
  weekStart: string
  weekEnd: string
  currentStock: CurrentStockRow[]
  usedStock: UsedStockRow[]
}): string {
  const lines: string[] = []

  lines.push('Darch Logistics Inventory Report')
  lines.push(`Week: ${formatReportWeekLabel(weekStart, weekEnd)}`)
  lines.push('')

  lines.push('Current Stock')
  lines.push(['Item Name', 'Type', 'Quantity'].map(csvField).join(','))
  for (const item of currentStock) {
    lines.push([item.name, item.item_type, item.quantity].map(csvField).join(','))
  }

  lines.push('')
  lines.push('Stock Used This Week')
  lines.push(['Item Name', 'Quantity Used', 'Work Order', 'Completed At'].map(csvField).join(','))
  if (usedStock.length === 0) {
    lines.push('No stock used this week.')
  } else {
    for (const row of usedStock) {
      lines.push(
        [
          row.item_name_text,
          row.quantity,
          row.work_order_number,
          new Date(row.completed_at).toLocaleString(),
        ]
          .map(csvField)
          .join(','),
      )
    }
  }

  return lines.join('\n')
}
