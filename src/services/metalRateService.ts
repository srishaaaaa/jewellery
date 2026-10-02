import { supabase } from '../lib/supabase'
import {
  mapMetalRateRow,
  pickCurrentRates,
  validateRateInput,
  type CurrentRates,
  type MetalRate,
  type RatedMetal,
} from '../lib/jewellery'
import { isMissingSchemaError } from './productService'

export const METAL_RATES_MIGRATION_HINT =
  'Metal rates are not set up in the database yet. Apply supabase/migrations/jewellery_pos.sql in Supabase.'

const toError = (error: unknown, fallback: string) => {
  if (isMissingSchemaError(error)) return new Error(METAL_RATES_MIGRATION_HINT)
  const message = (error as { message?: string } | null)?.message
  return new Error(message || fallback)
}

export type NewRateEntry = { metal: RatedMetal; purity: string; rate: string | number }

export const metalRateService = {
  /** Latest active rate for every metal/purity. */
  async fetchCurrent(): Promise<CurrentRates> {
    const view = await supabase.from('current_metal_rates').select('*')
    if (!view.error) {
      return pickCurrentRates((view.data || []).map((row) => mapMetalRateRow(row as Record<string, unknown>)))
    }
    // The view is optional; fall back to reducing recent history.
    const history = await supabase
      .from('metal_rates')
      .select('*')
      .lte('effective_from', new Date().toISOString())
      .order('effective_from', { ascending: false })
      .limit(500)
    if (history.error) throw toError(history.error, 'Unable to load metal rates')
    return pickCurrentRates((history.data || []).map((row) => mapMetalRateRow(row as Record<string, unknown>)))
  },

  /** Rate history, newest first. */
  async fetchHistory(filter: { metal?: RatedMetal | ''; purity?: string; from?: string; to?: string; limit?: number } = {}): Promise<MetalRate[]> {
    let query = supabase
      .from('metal_rates')
      .select('*')
      .order('effective_from', { ascending: false })
      .order('id', { ascending: false })
      .limit(filter.limit ?? 300)
    if (filter.metal) query = query.eq('metal_type', filter.metal)
    if (filter.purity) query = query.eq('purity', filter.purity)
    if (filter.from) query = query.gte('effective_from', `${filter.from}T00:00:00`)
    if (filter.to) query = query.lte('effective_from', `${filter.to}T23:59:59.999`)
    const { data, error } = await query
    if (error) throw toError(error, 'Unable to load rate history')
    return (data || []).map((row) => mapMetalRateRow(row as Record<string, unknown>))
  },

  /**
   * Saves new rates. Every entry becomes a new history row and immediately the
   * current rate; previous rates are kept, never overwritten.
   */
  async addRates(entries: NewRateEntry[], meta: { createdBy: string; note?: string }): Promise<MetalRate[]> {
    if (!entries.length) throw new Error('Enter at least one rate to update.')
    const effectiveFrom = new Date().toISOString()
    const rows = entries.map((entry) => {
      const checked = validateRateInput(entry.metal, entry.purity, String(entry.rate))
      if (!checked.ok) throw new Error(checked.error)
      return {
        metal_type: entry.metal,
        purity: entry.purity,
        rate_per_gram: checked.value,
        effective_from: effectiveFrom,
        created_by: meta.createdBy || 'Admin',
        note: (meta.note || '').trim(),
      }
    })
    const { data, error } = await supabase.from('metal_rates').insert(rows).select('*')
    if (error) throw toError(error, 'Unable to save metal rates')
    return (data || []).map((row) => mapMetalRateRow(row as Record<string, unknown>))
  },
}
