import React from 'react'
import { ExternalLink, Printer, X } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { LABEL, MONO, SHEET_FONT, inr, useShopProfile } from './invoiceStyle'

/** Shared pieces of the IGMOLS-style invoice / receipt sheet. */



/** The white A4 sheet. */
export const Sheet: React.FC<{ children: React.ReactNode; id?: string }> = ({ children, id }) => (
  <div
    id={id}
    className="w-full max-w-[760px] mx-auto bg-white text-[#111111] p-6 sm:p-12 print:p-0 print:max-w-full print:border-none print:shadow-none"
    style={{ fontFamily: SHEET_FONT }}
  >
    {children}
  </div>
)

/** Shop block on the left, document title + meta lines on the right, accent rule below. */
export const SheetHeader: React.FC<{ title: string; number: string; meta: Array<[string, React.ReactNode]> }> = ({ title, number, meta }) => {
  const shop = useShopProfile()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24, flexWrap: 'wrap', paddingBottom: 24, borderBottom: '2px solid var(--accent)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0 }}>
        <div style={{ width: 60, height: 60, flexShrink: 0, border: '1px solid var(--accent-a30)', borderRadius: 2, padding: 3, background: '#fff' }}>
          <img src={shop.logo} alt={shop.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.2, color: 'var(--accent)' }}>{shop.name}</div>
          {shop.address && <div style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.7, marginTop: 4, maxWidth: 300 }}>{shop.address}</div>}
          {(shop.phone || shop.email) && (
            <div style={{ fontSize: 11.5, color: '#52525b', marginTop: 6, lineHeight: 1.6 }}>
              {shop.phone && <div>Phone: {shop.phone}</div>}
              {shop.email && <div>Email: {shop.email}</div>}
            </div>
          )}
          {shop.gstin && <div style={{ fontSize: 11.5, color: '#374151', marginTop: 2, fontWeight: 500 }}>GSTIN: <span style={{ fontFamily: MONO }}>{shop.gstin}</span></div>}
        </div>
      </div>
      <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.2, textTransform: 'uppercase', color: 'var(--accent)' }}>{title}</div>
        <div style={{ fontSize: 10.5, color: '#6b7280', fontFamily: MONO, marginTop: 2 }}>#{number}</div>
        <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.75 }}>
          {meta.map(([label, value]) => (
            <div key={label}><span style={{ color: '#9ca3af' }}>{label}: </span><span style={{ fontWeight: 500 }}>{value}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** "Billed to" on the left, "Place of supply" on the right. */
export const BilledTo: React.FC<{ name: string; phone?: string; extra?: React.ReactNode }> = ({ name, phone, extra }) => {
  const shop = useShopProfile()
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', padding: '20px 0', borderBottom: '1px solid #e5e7eb' }}>
      <div style={{ minWidth: 0 }}>
        <div style={LABEL}>Billed To</div>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6, wordBreak: 'break-word' }}>{name || 'Walk-in Customer'}</div>
        {phone && <div style={{ fontSize: 11, color: '#4b5563', fontFamily: MONO, marginTop: 4 }}>{phone}</div>}
        {extra}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={LABEL}>Place of Supply</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6 }}>{shop.placeOfSupply}</div>
      </div>
    </div>
  )
}


/** One label / value line in the totals column. */
export const TotalRow: React.FC<{ label: React.ReactNode; value: React.ReactNode; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: color || '#4b5563', marginBottom: 8 }}>
    <span>{label}</span>
    <span style={{ fontFamily: MONO, color: color || '#111111' }}>{value}</span>
  </div>
)

/** The big TOTAL line with the black rule above it. */
export const GrandTotal: React.FC<{ label: string; value: number; color?: string }> = ({ label, value, color = 'var(--accent)' }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: `2px solid ${color}`, paddingTop: 12, marginTop: 6, color }}>
    <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}>{label}</span>
    <span style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO }}>₹{inr(value)}</span>
  </div>
)

/** Thank-you line on the left, authorised signatory on the right. */
export const SheetFooter: React.FC<{ note?: string }> = ({ note }) => {
  const shop = useShopProfile()
  return (
    <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--accent-a30)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ fontSize: 11, color: '#9ca3af' }}>{note || `Thank you for your visit! • ${shop.name} POS`}</div>
      <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
        <div style={{ borderTop: '1px solid #6b7280', width: 150, marginLeft: 'auto', marginBottom: 6 }} />
        <div style={{ fontSize: 11.5, fontWeight: 600 }}>Authorised Signatory</div>
        <div style={{ fontSize: 9.5, color: '#9ca3af' }}>For {shop.name}</div>
      </div>
    </div>
  )
}

/** Dark-bar preview window: "INVOICE PREVIEW • #NO", Open Full Page, close. */
export const DocumentPreviewModal: React.FC<{ title: string; onClose: () => void; onOpenFull: () => void; children: React.ReactNode }> = ({ title, onClose, onOpenFull, children }) => (
  <ModalPortal>
    <div
      className="fixed inset-0 z-[998] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-6 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex max-h-[94vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex shrink-0 items-center justify-between gap-3 bg-[#1C1C1C] px-4 py-3 sm:px-6">
          <h2 className="flex items-center gap-2 text-xs sm:text-sm font-black uppercase tracking-wider text-white min-w-0">
            <Printer className="w-4 h-4 shrink-0" />
            <span className="truncate">{title}</span>
          </h2>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={onOpenFull} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-bold text-white transition-colors cursor-pointer">
              Open Full Page <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={onClose} aria-label="Close preview" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#F3F4F6] p-3 sm:p-6">
          <div className="mx-auto max-w-[710px] bg-white shadow-sm">{children}</div>
        </div>
      </div>
    </div>
  </ModalPortal>
)

