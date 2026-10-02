import { BRAND_ADDRESS, BRAND_EMAIL, BRAND_EN, BRAND_INSTAGRAM, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'
import { formatCurrency, formatInvoiceNo } from './retail'
import { formatPhoneDisplay } from './phone'
import { useSettingsStore } from '../store/store'
import { formatWeight, metalLabel, readJewellerySnapshot, type JewellerySnapshot } from './jewellery'

export interface ThermalReceiptData {
  invoiceNo: string
  date: string
  customerName?: string
  phone?: string
  items: Array<{
    name: string
    qty: number
    unit?: string
    price: number
    line_total?: number
    /** Free gift with this item: printed with its value, not added to the total */
    special_offer_note?: string | null
    special_offer_cost?: number | null
    /** Jewellery snapshot: printed as metal/purity, weights and rate */
    jewellery?: JewellerySnapshot | null
  }>
  subtotal: number
  shipping: number
  couponDiscount?: number
  manualDiscount?: number
  totalGst?: number
  total: number
  storeName?: string
  storePhone?: string
  storeAddress?: string
  storeEmail?: string
  /** e.g. "Cash" or "Split (Cash ₹100 + QR ₹180)" */
  paymentMode?: string
  isCredit?: boolean
  creditDueDate?: string | null
  creditPaidAt?: string | null
  schemeNumber?: string | null
  schemeDiscount?: number
  schemeAmountUsed?: number
  schemeBalanceAfter?: number | null
  advanceAmountUsed?: number
  exchangeAmount?: number
  customerGstin?: string | null
}

const jewelleryReceiptLines = (raw: unknown) => {
  const j = readJewellerySnapshot(raw)
  if (!j) return ''
  const lines = [
    [metalLabel(j.metal_type, j.purity), j.huid ? `HUID ${j.huid}` : ''].filter(Boolean).join(' | '),
    [j.gross_weight > 0 ? `Gr ${formatWeight(j.gross_weight)}` : '', j.stone_weight > 0 ? `St ${formatWeight(j.stone_weight)}` : '', j.net_weight > 0 ? `Net ${formatWeight(j.net_weight)}` : ''].filter(Boolean).join(' '),
    j.rate_per_gram > 0 ? `Rate ${formatCurrency(j.rate_per_gram)}/g` : '',
    [j.making_amount > 0 ? `Mk ${formatCurrency(j.making_amount)}` : '', j.wastage_amount > 0 ? `Wst ${formatCurrency(j.wastage_amount)}` : '', j.stone_charge > 0 ? `Stn ${formatCurrency(j.stone_charge)}` : ''].filter(Boolean).join(' '),
  ].filter(Boolean)
  return lines.map((line) => `<br/><span style="font-size: 9px; color: #000;">${line}</span>`).join('')
}

export function printThermalReceipt(data: ThermalReceiptData) {
  // Create an iframe to hold the print document
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) return

  const liveSettings = useSettingsStore.getState().settings
  const storeName = data.storeName || liveSettings?.name || BRAND_EN
  const storeAddress = data.storeAddress || liveSettings?.address || BRAND_ADDRESS
  const storePhone = data.storePhone || liveSettings?.phone || BRAND_PRIMARY_PHONE_DISPLAY
  const storeEmail = data.storeEmail || liveSettings?.email || BRAND_EMAIL
  const storeInstagram = liveSettings?.instagramHandle || BRAND_INSTAGRAM

  const dateStr = (() => {
    try { return new Date(data.date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return new Date().toLocaleString('en-IN') }
  })()

  const dueDateStr = data.creditDueDate
    ? (() => {
        try { return new Date(`${data.creditDueDate}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
        catch { return data.creditDueDate as string }
      })()
    : ''
  const paidDateStr = data.creditPaidAt
    ? (() => {
        try { return new Date(data.creditPaidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
        catch { return data.creditPaidAt as string }
      })()
    : ''
  const isSettledCredit = Boolean(data.isCredit && data.creditPaidAt)
  const isUnpaidCredit = Boolean(data.isCredit && !data.creditPaidAt)

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Receipt - ${formatInvoiceNo(data.invoiceNo)}</title>
        <style>
          @page {
            margin: 0;
            size: 80mm auto;
          }
          body {
            font-family: 'Courier New', Courier, monospace, sans-serif;
            font-size: 12px;
            font-weight: 600;
            color: #000;
            margin: 0;
            padding: 4mm;
            width: 80mm;
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .font-bold { font-weight: bold; }
          .mb-1 { margin-bottom: 4px; }
          .mb-2 { margin-bottom: 8px; }
          .mt-1 { margin-top: 4px; }
          .mt-2 { margin-top: 8px; }
          .border-bottom { border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 4px; }
          .border-top { border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 2px 0; vertical-align: top; }
          .item-name { font-size: 11px; padding-right: 4px; }
        </style>
      </head>
      <body>
        <div class="text-center mb-2">
          <div class="font-bold" style="font-size: 16px; letter-spacing: 2px;">${storeName}</div>
          <div style="font-size: 10px; margin-top: 2px;">${storeAddress}</div>
          <div class="mt-1" style="font-size: 10px;">Ph: ${storePhone}</div>
          ${liveSettings?.gstin ? `<div style="font-size: 10px;">GSTIN: ${liveSettings.gstin}${liveSettings.stateCode ? ` | State Code: ${liveSettings.stateCode}` : ''}</div>` : ''}
          ${storeEmail || storeInstagram ? `<div style="font-size: 9px; color: #000;">${[storeEmail, storeInstagram ? `Insta: @${storeInstagram}` : ''].filter(Boolean).join(' | ')}</div>` : ''}
        </div>

        <div class="border-bottom border-top" style="font-size: 11px;">
          <div>Inv: #${formatInvoiceNo(data.invoiceNo)}</div>
          <div>Date: ${dateStr}</div>
          ${data.paymentMode ? `<div>Payment: ${data.paymentMode}</div>` : ''}
          ${data.customerName ? `<div>Name: ${data.customerName}</div>` : ''}
          ${data.phone ? `<div>Tel: ${formatPhoneDisplay(data.phone)}</div>` : ''}
          ${data.customerGstin ? `<div>GSTIN: ${data.customerGstin}</div>` : ''}
        </div>

        ${data.isCredit ? `
          <div class="text-center border-bottom" style="font-size: 12px; font-weight: bold; padding: 3px 0; border: 1px dashed #000; margin-bottom: 4px;">
            ${isSettledCredit
              ? `*** CREDIT BILL — PAID (COMPLETED) ***<br/>${paidDateStr ? `PAID ON: ${paidDateStr}` : ''}`
              : `*** CREDIT BILL ***<br/>${dueDateStr ? `PAY BY: ${dueDateStr}` : 'PAYMENT PENDING'}`}
          </div>
        ` : ''}

        <table class="border-bottom">
          <thead>
            <tr style="font-size: 10px; border-bottom: 1px dashed #000;">
              <th class="text-left">Item</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map(item => {
              const lineTotal = item.line_total ?? (item.qty * item.price)
              const unit = item.unit && item.unit !== 'unit' && item.unit !== 'piece' ? item.unit : ''
              return `
                <tr>
                  <td class="text-left item-name">
                    ${item.name} <br/>
                    <span style="font-size: 9px; color: #000;">@ ${formatCurrency(item.price)}${unit ? ` / ${unit}` : ' each'}</span>${jewelleryReceiptLines(item.jewellery)}
                  </td>
                  <td class="text-right">${item.qty}</td>
                  <td class="text-right">${formatCurrency(lineTotal)}</td>
                </tr>
                ${item.special_offer_note ? `
                <tr>
                  <td class="text-left" style="font-size: 10px;">🎁 FREE GIFT: ${item.special_offer_note}${Number(item.special_offer_cost) > 0 ? ` <s>${formatCurrency(Number(item.special_offer_cost))}</s>` : ''}</td>
                  <td class="text-right">1</td>
                  <td class="text-right" style="font-weight: bold;">FREE</td>
                </tr>` : ''}
              `
            }).join('')}
          </tbody>
        </table>

        <div class="border-bottom" style="font-size: 12px;">
          <table style="width: 100%;">
            ${data.subtotal !== data.total ? `
              <tr>
                <td class="text-left">Subtotal</td>
                <td class="text-right">${formatCurrency(data.subtotal)}</td>
              </tr>
            ` : ''}
            ${(data.couponDiscount || 0) > 0 ? `
              <tr>
                <td class="text-left">Coupon</td>
                <td class="text-right">-${formatCurrency(data.couponDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.manualDiscount || 0) > 0 ? `
              <tr>
                <td class="text-left">Manual Disc.</td>
                <td class="text-right">-${formatCurrency(data.manualDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.schemeDiscount || 0) > 0 ? `
              <tr>
                <td class="text-left">Scheme Benefit${data.schemeNumber ? ` (${data.schemeNumber})` : ''}</td>
                <td class="text-right">-${formatCurrency(data.schemeDiscount || 0)}</td>
              </tr>
            ` : ''}
            ${(data.totalGst || 0) > 0 ? `
              <tr>
                <td class="text-left">GST</td>
                <td class="text-right">+${formatCurrency(data.totalGst || 0)}</td>
              </tr>
            ` : ''}
            ${data.shipping > 0 ? `
              <tr>
                <td class="text-left">Delivery</td>
                <td class="text-right">${formatCurrency(data.shipping)}</td>
              </tr>
            ` : ''}
            <tr class="font-bold" style="font-size: 14px;">
              <td class="text-left">${isUnpaidCredit ? 'Amount Due' : 'Total'}</td>
              <td class="text-right">${formatCurrency(data.total)}</td>
            </tr>
            ${(data.schemeAmountUsed || 0) > 0 ? `
              <tr>
                <td class="text-left">Paid from Scheme${data.schemeNumber ? ` (${data.schemeNumber})` : ''}</td>
                <td class="text-right">-${formatCurrency(data.schemeAmountUsed || 0)}</td>
              </tr>` : ''}
            ${(data.advanceAmountUsed || 0) > 0 ? `
              <tr>
                <td class="text-left">Advance Adjusted</td>
                <td class="text-right">-${formatCurrency(data.advanceAmountUsed || 0)}</td>
              </tr>` : ''}
            ${(data.exchangeAmount || 0) > 0 ? `
              <tr>
                <td class="text-left">Old Gold Exchange</td>
                <td class="text-right">-${formatCurrency(data.exchangeAmount || 0)}</td>
              </tr>` : ''}
            ${(data.schemeAmountUsed || 0) + (data.advanceAmountUsed || 0) + (data.exchangeAmount || 0) > 0 ? `
              <tr class="font-bold">
                <td class="text-left">Amount Paid</td>
                <td class="text-right">${formatCurrency(Math.max(0, data.total - (data.schemeAmountUsed || 0) - (data.advanceAmountUsed || 0) - (data.exchangeAmount || 0)))}</td>
              </tr>
            ` : ''}
            ${data.schemeNumber && data.schemeBalanceAfter != null ? `
              <tr>
                <td class="text-left" style="font-size: 10px;">Scheme balance left</td>
                <td class="text-right" style="font-size: 10px;">${formatCurrency(data.schemeBalanceAfter)}</td>
              </tr>
            ` : ''}
          </table>
        </div>

        <div class="text-center mt-2" style="font-size: 11px;">
          ${isUnpaidCredit
            ? `<div class="font-bold">Credit sale — kindly settle${dueDateStr ? ` by ${dueDateStr}` : ''}. Thank you!</div>`
            : isSettledCredit
              ? `<div class="font-bold">Credit bill — paid in full${paidDateStr ? ` on ${paidDateStr}` : ''}. Thank you!</div>`
              : `<div class="font-bold">Thank you for shopping at ${storeName}!</div>`}
          ${storeInstagram ? `<div>Follow us on Instagram: @${storeInstagram}</div>` : ''}
        </div>
      </body>
    </html>
  `

  doc.open()
  doc.write(html)
  doc.close()

  const runPrint = () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(iframe)
    }, 1000)
  }

  setTimeout(runPrint, 250)
}
