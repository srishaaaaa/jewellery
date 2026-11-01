import React from 'react'
import { Download, Search } from 'lucide-react'
import { PERIODS, filterLabel, type PeriodPreset } from './filterStyles'

/**
 * Period buttons + From / To dates + Export CSV, as on Order History.
 * Picking a period fills the dates; typing a date switches the period to custom.
 */
export function PeriodBar({ preset, from, to, onPreset, onFrom, onTo, onExport, exportDisabled, children }: {
  preset: PeriodPreset
  from: string
  to: string
  onPreset: (preset: Exclude<PeriodPreset, 'custom'>) => void
  onFrom: (value: string) => void
  onTo: (value: string) => void
  onExport?: () => void
  exportDisabled?: boolean
  /** Extra buttons placed after Export CSV (e.g. New Advance Order). */
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
      <div className="flex flex-wrap items-center bg-white border border-black/10 rounded-xl p-1 gap-1 max-w-full">
        <span className="text-[9px] font-bold text-[#000000] uppercase tracking-wider px-2">Period:</span>
        {PERIODS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => onPreset(value)}
            className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${preset === value ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000] hover:bg-black/5'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center border rounded-xl px-3 py-1.5 gap-2 shadow-sm bg-white border-black/10 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">From:</span>
          <input type="date" value={from} onChange={e => onFrom(e.target.value)}
            className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[118px]" />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">To:</span>
          <input type="date" value={to} onChange={e => onTo(e.target.value)}
            className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[118px]" />
        </div>
      </div>
      {onExport && (
        <button type="button" onClick={onExport} disabled={exportDisabled}
          className="flex items-center gap-1.5 px-4 py-2 border-2 border-[var(--accent)] bg-transparent text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--accent)]">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      )}
      {children}
    </div>
  )
}

/**
 * The white filter card: optional tab pills on top, then labelled fields and a Search button.
 * Pressing Enter in any field also runs the search.
 */
export function FilterCard<T extends string>({ tabs, activeTab, onTab, onSearch, children }: {
  tabs?: Array<{ id: T; label: string; count?: number }>
  activeTab?: T
  onTab?: (id: T) => void
  onSearch: () => void
  children: React.ReactNode
}) {
  return (
    <form
      onSubmit={e => { e.preventDefault(); onSearch() }}
      className="bg-white border border-black/10 rounded-xl p-5 shadow-sm mb-6"
    >
      {tabs && tabs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-5">
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => onTab?.(t.id)}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${activeTab === t.id ? 'bg-[#111111] text-white shadow-sm' : 'bg-[#F4F4F5] text-black hover:bg-black/10'}`}>
              {t.label}{t.count != null ? ` (${t.count})` : ''}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col lg:flex-row lg:items-end gap-4">
        <div className="grid flex-1 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 min-w-0">{children}</div>
        <button type="submit"
          className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-[#111111] hover:bg-black px-5 py-2.5 text-[11px] font-black uppercase tracking-wider text-white shadow-sm transition-colors cursor-pointer">
          <Search className="w-3.5 h-3.5" /> Search
        </button>
      </div>
    </form>
  )
}

/** One labelled field inside FilterCard; pass `search` to show the magnifier inside the input. */
export function FilterField({ label, search, children }: { label: string; search?: boolean; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className={filterLabel}>{label}</span>
      {search ? (
        <span className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#000000] pointer-events-none" />
          {children}
        </span>
      ) : children}
    </label>
  )
}
