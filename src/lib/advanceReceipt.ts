import { jsPDF } from 'jspdf'
import { BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY } from './brand'
import { getActiveLogo } from './activeLogo'
import { formatCurrency } from './retail'
import type { AdvanceOrder } from '../services/advanceOrderService'
import { useSettingsStore } from '../store/store'
import { formatPhoneDisplay } from './phone'

function getShopInfo() {
  const storeSettings = useSettingsStore.getState().settings
  return {
    name: storeSettings?.name || BRAND_EN,
    address: storeSettings?.address || BRAND_ADDRESS,
    phone: storeSettings?.phone || BRAND_PHONE_DISPLAY,
    accentColor: storeSettings?.accentColor || '#2E7D32',
  }
}

const esc = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))

// jsPDF's built-in Helvetica font does not include the ₹ Unicode glyph (U+20B9).
// Using the Intl formatter directly causes the ₹ character to render as "1" or a
// replacement box in PDF viewers. This PDF-safe formatter outputs "Rs." instead.
const pdfMoney = (value: number): string => {
  const formatted = formatCurrency(value)
  // Replace leading ₹ (with optional non-breaking space) with "Rs. "
  return formatted.replace(/^[₹\u20b9]\s*/, 'Rs. ')
}

export function advanceReceiptPdf(order: AdvanceOrder) {
  const shop = getShopInfo()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const left = 16
  const right = 194
  const primaryColor = shop.accentColor
  const ink = '#18202a'
  const muted = '#68717c'
  let y = 16

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(muted)
  doc.text('ADVANCE RECEIPT', left, y)
  doc.text(order.deposit_id, right, y, { align: 'right' })
  y += 7
  doc.setDrawColor('#d8dce0')
  doc.line(left, y, right, y)
  y += 10

  let logoRendered = false
  const activeLogo = getActiveLogo()
  if (activeLogo) {
    try {
      doc.addImage(activeLogo.base64, activeLogo.format, left, y, 20, 20)
      logoRendered = true
    } catch { /* fall through to text logo */ }
  }
  if (!logoRendered) {
    doc.setTextColor(primaryColor)
    doc.setFontSize(16)
    doc.text(shop.name, left, y + 10)
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(primaryColor)
  doc.text(shop.name, left + 24, y + 5)
  doc.setFontSize(8)
  doc.setTextColor(muted)
  doc.setFont('helvetica', 'normal')
  doc.text(shop.address, left + 24, y + 10, { maxWidth: 85 })
  doc.text(`Phone: ${shop.phone}`, left + 24, y + 18)
  doc.text(`Created: ${new Date(order.created_at).toLocaleString('en-IN')}`, right, y + 2, { align: 'right' })
  doc.text('NOT A TAX INVOICE', right, y + 7, { align: 'right' })
  y += 28

  const customerName = String(order.customer_name || '-').trim()
  const customerPhone = formatPhoneDisplay(order.phone)
  const customerAddress = String(order.address || '').trim()
  const customerNameLines = doc.splitTextToSize(customerName, 165) as string[]
  const customerAddressLines = customerAddress
    ? doc.splitTextToSize(`Address: ${customerAddress}`, 165) as string[]
    : []
  const customerBoxHeight = 19 + customerNameLines.length * 4 + customerAddressLines.length * 4

  doc.setFillColor('#FBFAF6')
  doc.roundedRect(left, y, right - left, customerBoxHeight, 2, 2, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(muted)
  doc.text('BILL TO', left + 5, y + 7)
  doc.setFontSize(10)
  doc.setTextColor(ink)
  doc.text(customerNameLines, left + 5, y + 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(muted)
  const phoneY = y + 13 + customerNameLines.length * 4 + 2
  doc.text(`Mobile Number: ${customerPhone}`, left + 5, phoneY)
  if (customerAddressLines.length > 0) {
    doc.text(customerAddressLines, left + 5, phoneY + 5)
  }
  y += customerBoxHeight + 9

  doc.setFillColor(primaryColor)
  doc.rect(left, y, right - left, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor('#ffffff')
  doc.text('#', left + 4, y + 6)
  doc.text('ORDER DESCRIPTION', left + 14, y + 6)
  doc.text('DELIVERY', 166, y + 6, { align: 'right' })
  doc.text('AMOUNT', right - 4, y + 6, { align: 'right' })
  y += 14

  const productLines = doc.splitTextToSize(order.product_name, 105) as string[]
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(ink)
  doc.text('1', left + 4, y)
  doc.text(productLines, left + 14, y)
  if (order.category) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(muted)
    doc.text(order.category, left + 14, y + productLines.length * 4 + 3)
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(muted)
  doc.text(new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN'), 166, y, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(ink)
  doc.text(pdfMoney(order.total_amount), right - 4, y, { align: 'right' })
  y += Math.max(10, productLines.length * 4 + 4)
  doc.setDrawColor('#e8eaed')
  doc.line(left, y - 3, right, y - 3)

  y = Math.max(y + 6, 150)
  const rows: Array<[string, string, string]> = [
    ['Total Amount', pdfMoney(order.total_amount), ink],
    ['Deposit Paid', pdfMoney(order.deposit_amount), primaryColor],
  ]
  doc.setFontSize(9)
  rows.forEach(([label, value, color]) => { doc.setFont('helvetica', 'normal'); doc.setTextColor(color); doc.text(label, 143, y, { align: 'right' }); doc.text(value, right - 4, y, { align: 'right' }); y += 7 })
  doc.setDrawColor(primaryColor)
  doc.setLineWidth(0.7)
  doc.line(118, y - 3, right, y - 3)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(primaryColor)
  doc.text('BALANCE DUE', 143, y + 6, { align: 'right' })
  doc.text(pdfMoney(order.remaining_balance), right - 4, y + 6, { align: 'right' })

  y = 275
  doc.setDrawColor('#d8dce0')
  doc.setLineWidth(0.2)
  doc.line(left, y, right, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(primaryColor)
  doc.text('ADVANCE PAYMENT ONLY — NOT A FINAL INVOICE', pageWidth / 2, y + 8, { align: 'center' })
  return new File([doc.output('blob')], `Advance-Receipt-${order.deposit_id}.pdf`, { type: 'application/pdf' })
}

export function printAdvanceReceipt(order: AdvanceOrder) {
  const shop = getShopInfo()
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  const paymentLabel = order.final_payment_method
    ? (order.final_payment_method === 'upi' ? 'UPI / QR' : order.final_payment_method.toUpperCase())
    : ''
  const depositPayment = (() => {
    // Show payment method if available
    return paymentLabel || 'Cash'
  })()
  const html = `<!doctype html><html><head><title>Advance Receipt ${esc(order.deposit_id)}</title>
<meta charset="utf-8">
<style>
  @page { size: 80mm auto; margin: 0; }
  @media print { @page { size: 80mm auto; margin: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    font-size: 12px;
    font-weight: 600;
    width: 72mm;
    padding: 4mm;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .c { text-align: center; }
  .r { display: flex; justify-content: space-between; gap: 4px; margin: 5px 0; word-break: break-word; }
  .r span:first-child { flex-shrink: 0; max-width: 55%; }
  .r span:last-child { text-align: right; flex: 1; }
  .line { border-top: 1px dashed #555; margin: 8px 0; }
  .big { font-size: 15px; font-weight: bold; }
  .bold { font-weight: bold; }
  .warn { font-size: 9px; font-weight: bold; margin-top: 10px; text-align: center; }
  .label { font-size: 10px; color: #333; }
  .balance-row { font-size: 14px; font-weight: bold; }
</style>
</head><body>
<div class="c big">${esc(shop.name)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.address)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.phone)}</div>
<div class="line"></div>
<div class="c big">ADVANCE RECEIPT</div>
<div class="c" style="font-size:10px;">Not a final tax invoice</div>
<div class="line"></div>
<div><span class="bold">${esc(order.deposit_id)}</span></div>
<div style="font-size:10px;color:#333;">${new Date(order.created_at).toLocaleString('en-IN')}</div>
<div class="line"></div>
<div class="r"><span class="label">Customer</span><span class="bold">${esc(order.customer_name)}</span></div>
<div class="r"><span class="label">Phone</span><span>${esc(formatPhoneDisplay(order.phone))}</span></div>
${order.address ? `<div class="r"><span class="label">Address</span><span>${esc(order.address)}</span></div>` : ''}
<div class="r"><span class="label">Product</span><span>${esc(order.product_name)}</span></div>
${order.category ? `<div class="r"><span class="label">Category</span><span>${esc(order.category)}</span></div>` : ''}
<div class="r"><span class="label">Delivery</span><span>${esc(new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN'))}</span></div>
<div class="r"><span class="label">Payment</span><span>${esc(depositPayment)}</span></div>
<div class="line"></div>
<div class="r"><span>Total Amount</span><span class="bold">${esc(formatCurrency(order.total_amount))}</span></div>
<div class="r"><span>Deposit Paid</span><span class="bold">${esc(formatCurrency(order.deposit_amount))}</span></div>
<div class="r balance-row"><span>Balance Due</span><span>${esc(formatCurrency(order.remaining_balance))}</span></div>
<div class="line"></div>
<div class="warn">ADVANCE PAYMENT ONLY &mdash; NOT A FINAL INVOICE</div>
</body></html>`
  doc.open()
  doc.write(html)
  doc.close()

  const runPrint = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1500)
  }

  setTimeout(runPrint, 300)
}

export function downloadFile(file: File) { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500) }

