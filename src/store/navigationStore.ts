import { create } from 'zustand'

export type DashboardTab =
  | 'billing'
  | 'pos'
  | 'inventory'
  | 'advance_orders'
  | 'expenses'
  | 'history'
  | 'pos_analytics'
  | 'coupons'
  | 'whatsapp'
  | 'products'
  | 'categories'
  | 'users'
  | 'overview'
  | 'settings'
  | 'outstanding_credits'
  | 'customer_events'
  | 'metal_rates'
  | 'schemes'

interface NavigationState {
  currentTab: DashboardTab
  setCurrentTab: (tab: DashboardTab) => void
  pendingBarcode: string | null
  setPendingBarcode: (code: string | null) => void
  externalScannedCode: string | null
  setExternalScannedCode: (code: string | null) => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  currentTab: 'billing',
  setCurrentTab: (tab) => set({ currentTab: tab }),
  pendingBarcode: null,
  setPendingBarcode: (code) => set({ pendingBarcode: code }),
  externalScannedCode: null,
  setExternalScannedCode: (code) => set({ externalScannedCode: code }),
}))
