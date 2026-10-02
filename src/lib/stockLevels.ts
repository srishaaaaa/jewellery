import { useSettingsStore } from '../store/store'

/**
 * Low-stock limits. Each product has its own "Low Stock Alert Threshold"
 * (Add / Edit Products); the one in Store Settings is the default that new
 * products start with and that applies when a product has none of its own.
 */
export const defaultLowStockThreshold = (): number => {
  const v = Number(useSettingsStore.getState().settings?.lowStockThreshold)
  return Number.isFinite(v) && v >= 0 ? v : 5
}

/** The limit for one product: its own threshold if set, else the store default. */
export const lowStockLimit = (own?: number | null): number =>
  own != null && Number(own) > 0 ? Number(own) : defaultLowStockThreshold()
