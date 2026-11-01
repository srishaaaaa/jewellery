import React from 'react'
import type { SchemeInstallment } from '../../services/schemeService'
import { FREQUENCY_LABELS, type JewelleryScheme } from '../../lib/jewellery'
import { amountInWords } from '../../lib/amountInWords'
import { formatPhoneDisplay } from '../../lib/phone'
import { paymentMethodLabel, type ReceiptTotals } from '../../lib/schemeReceipt'
import { BilledTo, GrandTotal, Sheet, SheetFooter, SheetHeader, TotalRow } from './InvoiceParts'
import { LABEL, MONO, TD, TH, inr } from './invoiceStyle'

const longDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Savings-scheme installment receipt in the same sheet format as invoices. */
export const SchemeReceiptSheet: React.FC<{ scheme: JewelleryScheme; installment: SchemeInstallment; totals: ReceiptTotals }> = ({ scheme, installment, totals }) => {
  const paid = installment.paymentDate ? new Date(installment.paymentDate) : null
  const meta: Array<[string, React.ReactNode]> = [
    ['Date', paid ? paid.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'],
    ['Time', paid ? paid.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—'],
    ['Payment', paymentMethodLabel(installment.paymentMethod).toUpperCase()],
    ['Scheme', scheme.schemeNumber],
  ]
  return (
    <Sheet id="invoice-print-root">
      <SheetHeader title="Scheme Receipt" number={installment.receiptNumber || '—'} meta={meta} />
      <BilledTo name={scheme.customerName} phone={scheme.phone ? formatPhoneDisplay(scheme.phone) : ''} />

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
        <thead>
          <tr>
            <th style={{ ...TH, textAlign: 'left' }}>Description</th>
            <th style={{ ...TH, width: 110, textAlign: 'center' }}>Installment</th>
            <th style={{ ...TH, width: 120, textAlign: 'right' }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={TD}>
              <div style={{ fontWeight: 600 }}>{scheme.schemeName || FREQUENCY_LABELS[scheme.frequency]}</div>
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                {FREQUENCY_LABELS[scheme.frequency]} · due {longDate(installment.dueDate)}
                {installment.goldGrams != null && installment.goldRate ? ` · ${installment.goldGrams.toFixed(3)} g ${installment.goldPurity || ''} at ₹${inr(installment.goldRate)}/g` : ''}
              </div>
              {installment.notes && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{installment.notes}</div>}
            </td>
            <td style={{ ...TD, textAlign: 'center', fontWeight: 600 }}>{installment.installmentNumber} of {scheme.totalInstallments}</td>
            <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700 }}>{inr(installment.amountPaid)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap', marginTop: 12, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={LABEL}>Amount in Words</div>
          <div style={{ fontSize: 12, fontWeight: 600, fontStyle: 'italic', marginTop: 4 }}>{amountInWords(installment.amountPaid)}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 16, lineHeight: 1.8 }}>
            <div>Gold saved so far: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>{totals.totalGrams.toFixed(3)} g</span></div>
            <div>Next due: <span style={{ color: '#111111', fontWeight: 600 }}>{totals.nextDueDate ? longDate(totals.nextDueDate) : 'All installments paid'}</span></div>
            <div>Matures: <span style={{ color: '#111111', fontWeight: 600 }}>{longDate(scheme.maturityDate)}</span></div>
          </div>
        </div>
        <div style={{ flex: '0 1 280px', width: '100%', maxWidth: 300, marginLeft: 'auto' }}>
          <TotalRow label="This installment" value={`₹${inr(installment.amountPaid)}`} />
          <TotalRow label="Remaining on scheme" value={`₹${inr(totals.remaining)}`} />
          <GrandTotal label="Total Paid" value={totals.totalPaid} />
        </div>
      </div>

      <SheetFooter note="Savings scheme receipt — redeem against a jewellery purchase at maturity." />
    </Sheet>
  )
}
