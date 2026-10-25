import type React from 'react'
import { BRAND_ADDRESS, BRAND_EN, BRAND_LOGO } from '../../lib/brand'
import { useSettingsStore } from '../../store/store'

/** Shared styles for the IGMOLS-style invoice / receipt sheet (IGMOLS: system font, accent rules, grey labels). */

export const SHEET_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif'
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
export const LABEL: React.CSSProperties = { fontSize: 9, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6 }
export const inr = (n: number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function useShopProfile() {
  const s = useSettingsStore(state => state.settings)
  return {
    name: s?.name || BRAND_EN,
    address: s?.address || BRAND_ADDRESS,
    logo: s?.logoUrl || BRAND_LOGO,
    phone: s?.phone || '',
    email: s?.email || '',
    gstin: s?.gstin || '',
    placeOfSupply: s?.stateName ? `${s.stateName}${s.stateCode ? ` (${s.stateCode})` : ''}` : 'Tamil Nadu (33)',
  }
}

export const TH: React.CSSProperties = { ...LABEL, padding: '14px 8px 12px', borderBottom: '1px solid #e5e7eb' }

export const TD: React.CSSProperties = { padding: '14px 8px', fontSize: 12, verticalAlign: 'top', borderBottom: '1px solid #f3f4f6' }

/** Toolbar button on the full-page invoice / receipt. */
export const toolbarBtn = 'inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold text-[#111111] hover:bg-[#FAFAFA] transition-colors cursor-pointer disabled:opacity-50'
export const toolbarBtnDark = 'inline-flex items-center gap-2 rounded-lg bg-[#111111] px-4 py-2 text-xs font-bold text-white hover:bg-black transition-colors cursor-pointer'
