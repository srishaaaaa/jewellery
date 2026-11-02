import React from 'react'
import { Eye, Printer, X } from 'lucide-react'
import { ModalPortal } from './ModalPortal'
import { WhatsAppIcon } from './ActionIcons'

const actionClass = 'flex items-center justify-center gap-2 rounded-xl border border-black/15 bg-white py-3 text-[11px] font-black uppercase tracking-wider text-[#000000] hover:bg-black/5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'

export type DrawerStat = { label: string; value: string; tone?: 'red' | 'green' }

/**
 * Right-side details drawer opened by every row's eye button (same layout as the purchase details):
 * number • date, title, Print / View Bill / WhatsApp, the details, then summary boxes.
 */
export function DetailDrawer({ kicker, title, subtitle, onClose, onPrint, onView, onWhatsApp, viewLabel = 'View Bill', stats, children }: {
  kicker: string
  title: string
  subtitle?: React.ReactNode
  onClose: () => void
  onPrint?: () => void
  onView?: () => void
  onWhatsApp?: (() => void) | null
  viewLabel?: string
  stats?: DrawerStat[]
  children?: React.ReactNode
}) {
  const actions = [onPrint, onView, onWhatsApp !== undefined].filter(Boolean).length
  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[997] flex justify-end bg-black/45" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 sm:p-6 shadow-2xl animate-in slide-in-from-right duration-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black text-[var(--accent-dark)]">{kicker}</p>
              <h3 className="text-2xl font-black break-words">{title}</h3>
              {subtitle && <div className="text-xs text-[#000000]">{subtitle}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer"><X /></button>
          </div>

          {actions > 0 && (
            <div className={`mt-4 grid gap-2 ${actions === 3 ? 'grid-cols-3' : actions === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {onPrint && <button type="button" onClick={onPrint} className={actionClass}><Printer className="w-4 h-4 text-[var(--accent)]" /> Print</button>}
              {onView && <button type="button" onClick={onView} className={actionClass}><Eye className="w-4 h-4 text-[var(--accent)]" /> {viewLabel}</button>}
              {onWhatsApp !== undefined && (
                <button type="button" onClick={onWhatsApp || undefined} disabled={!onWhatsApp} title={onWhatsApp ? 'Send on WhatsApp' : 'No phone number'}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#10B981] hover:bg-[#059669] py-3 text-[11px] font-black uppercase tracking-wider text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                  <WhatsAppIcon className="w-4 h-4" /> WhatsApp
                </button>
              )}
            </div>
          )}

          {children && <div className="mt-4">{children}</div>}

          {stats && stats.length > 0 && (
            <div className={`mt-4 grid gap-3 ${stats.length >= 3 ? 'grid-cols-3' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl bg-black/[0.03] p-3">
                  <p className="text-[10px] font-bold uppercase text-[#000000]">{s.label}</p>
                  <p className={`mt-1 text-sm font-black ${s.tone === 'red' ? 'text-red-600' : s.tone === 'green' ? 'text-emerald-600' : ''}`}>{s.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

/** Two-column details table used inside the drawer. */
export function DrawerTable({ rows, head = ['Details', 'Value'] }: { rows: Array<[React.ReactNode, React.ReactNode]>; head?: [string, string] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10">
      <table className="w-full text-left text-xs">
        <thead className="bg-[#F9FAFB]"><tr>{head.map((h, i) => <th key={h} className={`p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-black/5">
          {rows.map(([k, v], i) => (
            <tr key={i}><td className="px-4 py-2.5 font-bold">{k}</td><td className="px-4 py-2.5 text-right">{v || '—'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
