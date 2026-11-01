import { getPresetRange } from '../../lib/dateRanges'

/** Shared look for the Order-History-style filter bars. */

export type PeriodPreset = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom'

export const PERIODS: [Exclude<PeriodPreset, 'custom'>, string][] = [
  ['all', 'All Time'], ['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['year', 'This Year'],
]

export const filterLabel = 'block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2'
export const filterInput = 'w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm'

/** From / to (YYYY-MM-DD) for a period button; empty strings for "All Time". */
export function periodRange(preset: PeriodPreset, from = '', to = ''): { from: string; to: string } {
  if (preset === 'all') return { from: '', to: '' }
  if (preset === 'custom') return { from, to }
  return getPresetRange(preset)
}

/** True when a YYYY-MM-DD day falls inside the from / to range (open ends allowed). */
export function inRange(day: string, from: string, to: string) {
  if (!day) return !from && !to
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}
