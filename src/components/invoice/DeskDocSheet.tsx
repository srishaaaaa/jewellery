import React from 'react'
import type { DeskReceipt } from '../../lib/deskReceipt'
import { formatPhoneDisplay } from '../../lib/phone'
import { BilledTo, Sheet, SheetFooter, SheetHeader } from './InvoiceParts'
import { LABEL, MONO, TD, TH } from './invoiceStyle'

/** Sales Desk slips (returns, old gold, advances, repairs, quotations) in the invoice sheet format. */
export const DeskDocSheet: React.FC<{ doc: DeskReceipt }> = ({ doc }) => (
  <Sheet id="invoice-print-root">
    <SheetHeader title={doc.title} number={doc.number} meta={[['Date', doc.date]]} />
    <BilledTo name={doc.customerName || 'Walk-in Customer'} phone={doc.phone ? formatPhoneDisplay(doc.phone) : ''} />

    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
      <thead>
        <tr>
          <th style={{ ...TH, textAlign: 'left' }}>Details</th>
          <th style={{ ...TH, textAlign: 'right', width: '45%' }}>Value</th>
        </tr>
      </thead>
      <tbody>
        {doc.rows.map(([label, value], i) => (
          <tr key={i}>
            <td style={{ ...TD, fontWeight: 600 }}>{label}</td>
            <td style={{ ...TD, textAlign: 'right', fontFamily: /₹|\d/.test(value) ? MONO : undefined }}>{value || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {doc.totals && doc.totals.length > 0 && (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
        <div style={{ width: '100%', maxWidth: 320 }}>
          {doc.totals.map(([label, value], i) => {
            const last = i === doc.totals!.length - 1
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: last ? '12px 0 0' : '0 0 8px', marginTop: last ? 6 : 0, borderTop: last ? '2px solid var(--accent)' : 'none', color: last ? 'var(--accent)' : '#4b5563' }}>
                <span style={{ fontSize: last ? 13 : 12, fontWeight: last ? 700 : 400, textTransform: last ? 'uppercase' : 'none' }}>{label}</span>
                <span style={{ fontSize: last ? 18 : 12, fontWeight: last ? 700 : 600, fontFamily: MONO }}>{value}</span>
              </div>
            )
          })}
        </div>
      </div>
    )}

    {doc.footer && <div style={{ ...LABEL, marginTop: 20, textTransform: 'none', fontSize: 11, color: '#6b7280', fontWeight: 500, letterSpacing: 0 }}>{doc.footer}</div>}
    <SheetFooter />
  </Sheet>
)
