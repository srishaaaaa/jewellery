import React from 'react'
import type { Purchase, Supplier, SupplierPayment } from '../../services/purchaseService'
import { amountInWords } from '../../lib/amountInWords'
import { formatWeight, metalLabel, normalizeMetalType } from '../../lib/jewellery'
import { paymentModeLabel } from '../../lib/paymentModes'
import { GrandTotal, Sheet, SheetFooter, SheetHeader, TotalRow } from './InvoiceParts'
import { LABEL, MONO, TD, TH, inr } from './invoiceStyle'

const longDate = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Supplier purchase bill in the same sheet format as sales invoices. */
export const PurchaseBillSheet: React.FC<{ purchase: Purchase; supplier?: Supplier | null; payments?: SupplierPayment[] }> = ({ purchase, supplier, payments = [] }) => {
  const meta: Array<[string, React.ReactNode]> = [
    ['Date', longDate(purchase.purchaseDate)],
    ['Status', purchase.due > 0 ? (purchase.amountPaid > 0 ? 'PART PAID' : 'UNPAID') : 'PAID'],
  ]
  if (purchase.supplierInvoiceNo) meta.push(['Supplier Bill', purchase.supplierInvoiceNo])
  if (purchase.createdBy) meta.push(['Recorded By', purchase.createdBy])

  return (
    <Sheet id="invoice-print-root">
      <SheetHeader title="Purchase Bill" number={purchase.purchaseNumber} meta={meta} />

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '20px 0', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ minWidth: 0 }}>
          <div style={LABEL}>Supplier</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 6 }}>{supplier?.name || 'Supplier'}</div>
          {supplier?.phone && <div style={{ fontSize: 11, color: '#4b5563', fontFamily: MONO, marginTop: 4 }}>{supplier.phone}</div>}
          {supplier?.address && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 3, maxWidth: 260 }}>{supplier.address}</div>}
        </div>
        {supplier?.gstin && (
          <div style={{ textAlign: 'right' }}>
            <div style={LABEL}>Supplier GSTIN</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 6, fontFamily: MONO }}>{supplier.gstin}</div>
          </div>
        )}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 28, textAlign: 'center' }}>#</th>
            <th style={{ ...TH, textAlign: 'left' }}>Item Description</th>
            <th style={{ ...TH, width: 50, textAlign: 'center' }}>Pcs</th>
            <th style={{ ...TH, width: 96, textAlign: 'right' }}>Rate (₹/g)</th>
            <th style={{ ...TH, width: 108, textAlign: 'right' }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {purchase.items.map((it, idx) => {
            const metal = normalizeMetalType(it.metal_type)
            return (
              <tr key={idx}>
                <td style={{ ...TD, textAlign: 'center', color: '#9ca3af' }}>{idx + 1}</td>
                <td style={TD}>
                  <div style={{ fontWeight: 600 }}>{it.description || '—'}</div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, lineHeight: 1.5 }}>
                    {[metal ? metalLabel(metal, it.purity) : it.metal_type, it.gross_weight > 0 ? `Gross ${formatWeight(it.gross_weight)}` : '', it.stone_weight > 0 ? `Stone ${formatWeight(it.stone_weight)}` : '', it.net_weight > 0 ? `Net ${formatWeight(it.net_weight)}` : ''].filter(Boolean).join(' · ')}
                    {(it.making_cost > 0 || it.other_cost > 0) && <div>{[it.making_cost > 0 ? `Making ₹${inr(it.making_cost)}` : '', it.other_cost > 0 ? `Other ₹${inr(it.other_cost)}` : ''].filter(Boolean).join(' · ')}</div>}
                    {it.stone_details && <div>Stones: {it.stone_details}</div>}
                  </div>
                </td>
                <td style={{ ...TD, textAlign: 'center', fontWeight: 600 }}>{it.quantity}</td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: '#4b5563' }}>{it.rate ? inr(it.rate) : '—'}</td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700 }}>{inr(it.amount)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap', marginTop: 12, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={LABEL}>Amount in Words</div>
          <div style={{ fontSize: 12, fontWeight: 600, fontStyle: 'italic', marginTop: 4 }}>{amountInWords(purchase.totalAmount)}</div>
          {payments.length > 0 && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 16, lineHeight: 1.8 }}>
              {payments.map(pm => (
                <div key={pm.id}>{longDate(pm.paidAt)} · {paymentModeLabel(pm.paymentMethod === 'qr' ? 'upi' : pm.paymentMethod)}{pm.reference ? ` · Ref ${pm.reference}` : ''}: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(pm.amount)}</span></div>
              ))}
            </div>
          )}
          {purchase.notes && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 10 }}>Notes: {purchase.notes}</div>}
        </div>
        <div style={{ flex: '0 1 280px', width: '100%', maxWidth: 300, marginLeft: 'auto' }}>
          <TotalRow label="Purchase Total" value={`₹${inr(purchase.totalAmount)}`} />
          <TotalRow label="Paid to Supplier" value={`− ₹${inr(purchase.amountPaid)}`} />
          <GrandTotal label={purchase.due > 0 ? 'Balance Owed' : 'Paid in Full'} value={purchase.due > 0 ? purchase.due : purchase.totalAmount} color={purchase.due > 0 ? '#B91C1C' : undefined} />
        </div>
      </div>

      <SheetFooter note="Purchase record — stock and cost price updated for linked catalogue items." />
    </Sheet>
  )
}
