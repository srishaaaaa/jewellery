/**
 * Shared date ranges for every "Today / This Week / This Month / This Year" filter.
 *   Week  = Monday to Sunday of the current week
 *   Month = 1st to the last day of the month (28/29/30/31)
 *   Year  = 1 January to 31 December
 * All dates are local (IST), never UTC, so "today" is right after midnight too.
 */
export type RangePreset = 'today' | 'week' | 'month' | 'year'

/** YYYY-MM-DD in local time (toISOString() would give the UTC date). */
export const toLocalDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Monday of the week containing `d` (Sunday belongs to the week that started the previous Monday). */
export const startOfWeekMonday = (d: Date): Date => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

/** First and last day (inclusive) of the preset, as local Date objects at midnight. */
export const getPresetDates = (preset: RangePreset, now: Date = new Date()): { from: Date; to: Date } => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') {
    const from = startOfWeekMonday(today)
    const to = new Date(from); to.setDate(from.getDate() + 6) // Sunday
    return { from, to }
  }
  if (preset === 'month') {
    return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0) }
  }
  return { from: new Date(today.getFullYear(), 0, 1), to: new Date(today.getFullYear(), 11, 31) }
}

/** The preset as YYYY-MM-DD strings, for date inputs and queries. */
export const getPresetRange = (preset: RangePreset, now: Date = new Date()): { from: string; to: string } => {
  const { from, to } = getPresetDates(preset, now)
  return { from: toLocalDateStr(from), to: toLocalDateStr(to) }
}

/**
 * Whether a yearly date (birthday / anniversary, stored with its original year)
 * falls between `from` and `to` (YYYY-MM-DD, inclusive) in any year of that
 * range. 29 Feb counts as 28 Feb in non-leap years.
 */
export const yearlyDateInRange = (dateStr: string | null | undefined, from: string, to: string): boolean => {
  if (!dateStr) return false
  const [, mm, dd] = dateStr.slice(0, 10).split('-').map(Number)
  if (!mm || !dd) return false
  const startYear = Number((from || to).slice(0, 4))
  const endYear = Number((to || from).slice(0, 4))
  for (let y = startYear; y <= endYear; y++) {
    const lastDay = new Date(y, mm, 0).getDate()
    const occ = toLocalDateStr(new Date(y, mm - 1, Math.min(dd, lastDay)))
    if ((!from || occ >= from) && (!to || occ <= to)) return true
  }
  return false
}

/** Whether a timestamp/date falls inside the preset (inclusive of the whole last day). */
export const isInPreset = (value: string | Date | null | undefined, preset: RangePreset, now: Date = new Date()): boolean => {
  if (!value) return false
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  if (isNaN(d.getTime())) return false
  const { from, to } = getPresetDates(preset, now)
  const end = new Date(to); end.setDate(to.getDate() + 1)
  return d >= from && d < end
}
