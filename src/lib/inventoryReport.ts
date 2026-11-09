// inventoryReport.ts: the data behind the Inventory page's "Inventory
// Report" -- one Sunday-through-Saturday week (same weekly-period idea as
// payslip.ts's getDefaultPayPeriod, anchored on Sunday), built from the
// stock history (inventory_movements): per item opening / in / used /
// returned / adjusted / written off / closing, which always add up (math
// + self-check in inventoryReportTotals.ts), plus every movement of the
// week. Parts used on jobs that are still open count in the week they
// were taken off the shelf -- this is a STOCK report (what left the
// shelf), not the cost report (which counts by completion date).
// csvField is also used by other reports' CSVs.
import { supabase } from './supabaseClient'
import { toManilaDate } from './payslip'
import { fetchAll } from './dashboardExpenses'
import { MOVEMENT_LABELS } from './inventoryMovements'
import { buildItemWeeks, type ItemWeek, type ReportMove } from './inventoryReportTotals'

// Sunday through Saturday, the week containing `anchorDate` (a
// yyyy-mm-dd string, e.g. from an <input type="date">). The date math
// runs on UTC midnight so toISOString() can't shift it a day -- with a
// local midnight, Manila (UTC+8) got Saturday-to-Friday weeks. Same
// approach as payslip.ts's getCurrentPayPeriod.
export function getReportWeek(anchorDate: string): { start: string; end: string } {
  const start = new Date(`${anchorDate}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)

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
  const today = toManilaDate(new Date())
  const { start: currentWeekStart } = getReportWeek(today)
  const currentMonth = today.slice(0, 7) // 'yyyy-mm'

  const weeks: ReportWeekOption[] = []
  const cursor = new Date(`${currentWeekStart}T00:00:00Z`)
  const MAX_WEEKS = 520 // ~10 years, just a safety cap against a runaway loop

  for (let i = 0; i < MAX_WEEKS; i++) {
    const start = cursor.toISOString().slice(0, 10)
    const weekEndDate = new Date(cursor)
    weekEndDate.setUTCDate(cursor.getUTCDate() + 6)
    const end = weekEndDate.toISOString().slice(0, 10)

    const touchesCurrentMonth =
      start.slice(0, 7) === currentMonth || end.slice(0, 7) === currentMonth
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

// The week picker starts at the first week with stock history.
export async function loadReportWeekOptions(): Promise<{
  weeks: ReportWeekOption[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('inventory_movements')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) {
    return { weeks: [], error: error.message }
  }

  const earliestDataDate = data.length > 0 ? toManilaDate(data[0].created_at) : null
  return { weeks: buildReportWeekOptions(earliestDataDate), error: null }
}

export type ReportRow = ItemWeek & {
  name: string
  item_type: string
  unit: string
  archived: boolean
}

export type ReportLine = {
  created_at: string
  item_name: string
  unit: string
  reason: string
  qty_change: number
  unit_cost: number | null
  work_order_number: string | null
  note: string | null
}

type MoveRow = ReportMove & { work_order_id: number | null; note: string | null }

// One week's report: per item opening / in / used / returned / adjusted /
// written off / closing (math in inventoryReportTotals.ts), plus every
// movement in the week. `historyStart` = the first day anything was
// recorded (stock before it wasn't tracked, so earlier weeks start at 0).
export async function loadInventoryReport(
  weekStart: string,
  weekEnd: string,
): Promise<{ rows: ReportRow[]; lines: ReportLine[]; historyStart: string | null; error: string | null }> {
  const startTs = `${weekStart}T00:00:00+08:00`
  const dayAfter = new Date(`${weekEnd}T00:00:00Z`)
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
  const endTs = `${dayAfter.toISOString().slice(0, 10)}T00:00:00+08:00`

  const [items, moves, first] = await Promise.all([
    fetchAll<{ item_id: number; name: string; item_type: string; unit: string; quantity: number; archived_at: string | null }>(
      (from, to) =>
        supabase
          .from('inventory_items')
          .select('item_id, name, item_type, unit, quantity, archived_at')
          .order('name', { ascending: true })
          .range(from, to),
    ),
    // ponytail: reads every movement from the week until today -- fine for
    // recent weeks; a year-old week on a busy shop would want an SQL sum.
    fetchAll<MoveRow>((from, to) =>
      supabase
        .from('inventory_movements')
        .select('item_id, reason, qty_change, unit_cost, created_at, work_order_id, note')
        .gte('created_at', startTs)
        .order('created_at', { ascending: true })
        .order('movement_id', { ascending: true })
        .range(from, to),
    ),
    supabase.from('inventory_movements').select('created_at').order('created_at', { ascending: true }).limit(1),
  ])
  const firstError = items.error ?? moves.error ?? first.error?.message ?? null
  if (firstError) return { rows: [], lines: [], historyStart: null, error: firstError }

  const sinceStart = moves.rows.map((m) => ({
    ...m,
    qty_change: Number(m.qty_change),
    unit_cost: m.unit_cost === null ? null : Number(m.unit_cost),
  }))
  const weeks = buildItemWeeks(new Map(items.rows.map((i) => [i.item_id, Number(i.quantity)])), sinceStart, endTs)

  const rows: ReportRow[] = items.rows.flatMap((item) => {
    const w = weeks.get(item.item_id)
    if (!w) return []
    const active = w.in || w.used || w.returned || w.adjusted || w.written_off
    // archived items only when they had stock or activity that week
    if (item.archived_at && !active && !w.opening && !w.closing) return []
    return [{ ...w, name: item.name, item_type: item.item_type, unit: item.unit, archived: !!item.archived_at }]
  })

  const endMs = new Date(endTs).getTime()
  const inWeek = sinceStart.filter((m) => new Date(m.created_at).getTime() < endMs)
  const orderIds = [...new Set(inWeek.map((m) => m.work_order_id).filter((id): id is number => id !== null))]
  const orders = orderIds.length
    ? await supabase.from('work_orders').select('work_order_id, work_order_number').in('work_order_id', orderIds)
    : { data: [] as { work_order_id: number; work_order_number: string }[], error: null }
  if (orders.error) return { rows: [], lines: [], historyStart: null, error: orders.error.message }
  const numberById = new Map((orders.data ?? []).map((o) => [o.work_order_id, o.work_order_number]))
  const itemById = new Map(items.rows.map((i) => [i.item_id, i]))

  return {
    rows,
    lines: inWeek.map((m) => ({
      created_at: m.created_at,
      item_name: itemById.get(m.item_id)?.name ?? `Item #${m.item_id}`,
      unit: itemById.get(m.item_id)?.unit ?? '',
      reason: m.reason,
      qty_change: m.qty_change,
      unit_cost: m.unit_cost,
      work_order_number: m.work_order_id !== null ? (numberById.get(m.work_order_id) ?? `#${m.work_order_id}`) : null,
      note: m.note,
    })),
    historyStart: first.data && first.data.length > 0 ? toManilaDate(first.data[0].created_at) : null,
    error: null,
  }
}

export function csvField(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// Manila date + time for the CSV (the same on every laptop).
function manilaDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })
}

export function buildInventoryReportCsv({
  weekStart,
  weekEnd,
  rows,
  lines,
  historyStart,
}: {
  weekStart: string
  weekEnd: string
  rows: ReportRow[]
  lines: ReportLine[]
  historyStart: string | null
}): string {
  const out: string[] = []
  const row = (cells: (string | number)[]) => out.push(cells.map(csvField).join(','))

  out.push('Darch Logistics Inventory Report')
  out.push(`Week: ${formatReportWeekLabel(weekStart, weekEnd)}`)
  if (historyStart && historyStart > weekStart) {
    out.push(csvField(`Stock history starts ${historyStart} -- stock before that was not tracked, so it shows as 0.`))
  }
  out.push('')

  out.push('Stock by Item')
  row(['Item', 'Type', 'Unit', 'Opening', 'In', 'Used', 'Returned', 'Adjusted', 'Written off', 'Closing', 'Used value', 'Written-off value'])
  for (const r of rows) {
    row([
      r.archived ? `${r.name} (archived)` : r.name,
      r.item_type,
      r.unit,
      r.opening,
      r.in,
      r.used,
      r.returned,
      r.adjusted,
      r.written_off,
      r.closing,
      r.used_value.toFixed(2),
      r.written_off_value.toFixed(2),
    ])
  }
  const usedTotal = rows.reduce((s, r) => s + r.used_value, 0)
  const writtenOffTotal = rows.reduce((s, r) => s + r.written_off_value, 0)
  row(['Total', '', '', '', '', '', '', '', '', '', usedTotal.toFixed(2), writtenOffTotal.toFixed(2)])

  out.push('')
  out.push('Movements This Week')
  row(['Date', 'Item', 'What', 'Quantity', 'Unit', 'Unit cost', 'Work order', 'Note'])
  if (lines.length === 0) out.push('No stock movements this week.')
  for (const l of lines) {
    row([
      manilaDateTime(l.created_at),
      l.item_name,
      MOVEMENT_LABELS[l.reason] ?? l.reason,
      l.qty_change,
      l.unit,
      l.unit_cost === null ? '' : l.unit_cost.toFixed(2),
      l.work_order_number ?? '',
      l.note ?? '',
    ])
  }

  return out.join('\n')
}
