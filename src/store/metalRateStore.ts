import { create } from 'zustand'
import { isSupabaseConfigured } from '../lib/supabase'
import { getErrorMessage } from '../lib/errorMessage'
import type { CurrentRates } from '../lib/jewellery'
import { metalRateService } from '../services/metalRateService'

/** Current metal rates shared by the POS, product form, inventory and Metal Rates page. */
interface MetalRateState {
  rates: CurrentRates
  loaded: boolean
  loading: boolean
  error: string | null
  fetchRates: () => Promise<void>
}

export const useMetalRateStore = create<MetalRateState>((set) => ({
  rates: {},
  loaded: false,
  loading: false,
  error: null,
  fetchRates: async () => {
    if (!isSupabaseConfigured) {
      set({ loaded: true, error: 'Supabase is not configured' })
      return
    }
    set({ loading: true })
    try {
      const rates = await metalRateService.fetchCurrent()
      set({ rates, loaded: true, loading: false, error: null })
    } catch (err) {
      set({ loaded: true, loading: false, error: getErrorMessage(err, 'Unable to load metal rates') })
    }
  },
}))
