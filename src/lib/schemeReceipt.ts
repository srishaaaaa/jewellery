import { BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY } from './brand'
import { formatCurrency } from './retail'
import { formatPhoneDisplay } from './phone'
import { useSettingsStore } from '../store/store'
import { schemeRemaining, type JewelleryScheme } from './jewellery'
import type { SchemeInstallment } from '../services/schemeService'

const esc = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))

export const paymentMethodLabel = (method: string | null | undefined) => {
  const m = String(method || '').toLowerCase()
  if (m === 'qr' || m === 'upi') return 'UPI / QR'
  if (m === 'card') return 'Card'
  if (m === 'cash') return 'Cash'
  return m ? m.toUpperCase() : '—'
}

export type ReceiptTotals = { totalPaid: number; remaining: number; nextDueDate: string | null }

/** Totals as they stood right after the given installment was paid (for reprints). */
export const totalsAfterInstallment = (scheme: JewelleryScheme, installments: SchemeInstallment[], installment: SchemeInstallment): ReceiptTotals => {
  const paidUpTo = installments.filter((i) => i.status === 'paid' && i.installmentNumber <= installment.installmentNumber)
  const totalPaid = Math.round(paidUpTo.reduce((sum, i) => sum + i.amountPaid, 0) * 100) / 100
  const next = installments.find((i) => i.installmentNumber > installment.installmentNumber)
  return {
    totalPaid,
    remaining: Math.max(0, Math.round((scheme.monthlyAmount * scheme.totalInstallments - totalPaid) * 100) / 100),
    nextDueDate: next ? next.dueDate : null,
  }
}

/** Prints an 80mm thermal receipt for one scheme installment (same layout as the advance receipt). */
export function printSchemeReceipt(scheme: JewelleryScheme, installment: SchemeInstallment, totals?: ReceiptTotals) {
  const t: ReceiptTotals = totals || { totalPaid: scheme.totalPaid, remaining: schemeRemaining(scheme), nextDueDate: scheme.nextDueDate }
  const settings = useSettingsStore.getState().settings
  const shop = {
    name: settings?.name || BRAND_EN,
    address: settings?.address || BRAND_ADDRESS,
    phone: settings?.phone || BRAND_PHONE_DISPLAY,
  }
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  const paidAt = installment.paymentDate ? new Date(installment.paymentDate).toLocaleString('en-IN') : ''
  const html = `<!doctype html><html><head><title>Scheme Receipt ${esc(installment.receiptNumber || '')}</title>
<meta charset="utf-8">
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; font-weight: 600; width: 72mm; padding: 4mm; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .c { text-align: center; }
  .r { display: flex; justify-content: space-between; gap: 4px; margin: 5px 0; word-break: break-word; }
  .r span:first-child { flex-shrink: 0; max-width: 55%; }
  .r span:last-child { text-align: right; flex: 1; }
  .line { border-top: 1px dashed #555; margin: 8px 0; }
  .big { font-size: 15px; font-weight: bold; }
  .bold { font-weight: bold; }
  .label { font-size: 10px; color: #333; }
  .warn { font-size: 9px; font-weight: bold; margin-top: 10px; text-align: center; }
</style>
</head><body>
<div class="c big">${esc(shop.name)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.address)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.phone)}</div>
<div class="line"></div>
<div class="c big">SCHEME INSTALLMENT RECEIPT</div>
<div class="line"></div>
<div class="r"><span class="label">Receipt No</span><span class="bold">${esc(installment.receiptNumber || '—')}</span></div>
<div class="r"><span class="label">Date</span><span>${esc(paidAt)}</span></div>
<div class="line"></div>
<div class="r"><span class="label">Customer</span><span class="bold">${esc(scheme.customerName || '—')}</span></div>
<div class="r"><span class="label">Phone</span><span>${esc(formatPhoneDisplay(scheme.phone))}</span></div>
<div class="r"><span class="label">Scheme</span><span>${esc(scheme.schemeName)}</span></div>
<div class="r"><span class="label">Scheme ID</span><span>${esc(scheme.schemeNumber)}</span></div>
<div class="r"><span class="label">Installment</span><span>${installment.installmentNumber} of ${scheme.totalInstallments}</span></div>
<div class="r"><span class="label">Due Date</span><span>${esc(new Date(`${installment.dueDate}T00:00:00`).toLocaleDateString('en-IN'))}</span></div>
<div class="r"><span class="label">Payment</span><span>${esc(paymentMethodLabel(installment.paymentMethod))}</span></div>
${installment.createdBy ? `<div class="r"><span class="label">Received By</span><span>${esc(installment.createdBy)}</span></div>` : ''}
<div class="line"></div>
<div class="r big"><span>Amount Paid</span><span>${esc(formatCurrency(installment.amountPaid))}</span></div>
<div class="r"><span>Total Paid</span><span class="bold">${esc(formatCurrency(t.totalPaid))}</span></div>
<div class="r"><span>Remaining</span><span class="bold">${esc(formatCurrency(t.remaining))}</span></div>
${t.nextDueDate ? `<div class="r"><span>Next Due</span><span>${esc(new Date(`${t.nextDueDate}T00:00:00`).toLocaleDateString('en-IN'))}</span></div>` : ''}
<div class="line"></div>
<div class="warn">SAVINGS SCHEME RECEIPT &mdash; NOT A TAX INVOICE</div>
</body></html>`
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1500)
  }, 300)
}
