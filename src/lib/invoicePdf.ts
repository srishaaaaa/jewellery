import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY } from './brand'
import { formatCurrency, formatQuantityDisplay, normalizeStructuredOrderItem, formatInvoiceNo } from './retail'
import { getActiveLogo } from './activeLogo'
import { useSettingsStore } from '../store/store'
import { formatPhoneDisplay } from './phone'
import { formatWeight, metalLabel } from './jewellery'

export type InvoicePdfData = {
  invoiceNo: string
  date: string
  customerName: string
  phone: string
  address: string
  items: Array<Record<string, unknown>>
  subtotal: number
  shipping: number
  total: number
  discountAmount?: number
  manualDiscountAmount?: number
  gstAmount?: number
  couponCode?: string | null
  paymentMode?: string
  isCredit?: boolean
  creditDueDate?: string | null
  /** Set once the credit sale has been settled — switches the credit banner from "payment due" to "paid/completed". */
  creditPaidAt?: string | null
  /** Savings scheme redeemed on this bill */
  schemeNumber?: string | null
  schemeDiscount?: number
  schemeAmountUsed?: number
  schemeBalanceAfter?: number | null
}

// jsPDF's built-in Helvetica font has no ₹ (U+20B9) glyph — it renders as a
// broken superscript box/"1" in the PDF. Substitute "Rs." the same way the
// advance-receipt PDF does.
const money = (value: number) =>
  formatCurrency(Number(value || 0)).replace(/\s+/g, ' ').replace(/^[₹₹]\s*/, 'Rs. ')

// Same for free text (payment mode, names, notes): ₹ -> "Rs." and characters the
// built-in font cannot draw are dropped. One unsupported character makes jsPDF
// letter-space the whole line ("P a y m e n t : ...") and push it off the page.
const pdfText = (value: unknown) =>
  String(value ?? '')
    .replace(/₹\s*/g, 'Rs.')
    .replace(/[—–]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

/** Creates a compact A4 invoice that can be attached as a file to WhatsApp. */
export function createInvoicePdf(data: InvoicePdfData): Blob {
  const formattedNo = formatInvoiceNo(data.invoiceNo)
  const storeSettings = useSettingsStore.getState().settings
  const shopName = storeSettings?.name || BRAND_EN
  const shopAddress = storeSettings?.address || BRAND_ADDRESS
  const shopPhone = storeSettings?.phone || BRAND_PHONE_DISPLAY
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const left = 16
  const right = 194
  const primaryColor = storeSettings?.accentColor || '#2E7D32'
  const ink = '#18202a'
  const muted = '#68717c'
  let y = 16

  const dueDateLabel = data.creditDueDate
    ? new Date(`${data.creditDueDate}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const paidDateLabel = data.creditPaidAt
    ? new Date(data.creditPaidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const isSettledCredit = Boolean(data.isCredit && data.creditPaidAt)
  const isUnpaidCredit = Boolean(data.isCredit && !data.creditPaidAt)
  const creditColor = isSettledCredit ? '#047857' : '#B91C1C'

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(muted)
  doc.text(data.isCredit ? 'CREDIT INVOICE' : 'TAX INVOICE', left, y)
  doc.text(`Invoice: #${formattedNo}`, right, y, { align: 'right' })
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
    doc.text(shopName, left, y + 10)
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(primaryColor)
  doc.text(shopName, left + 24, y + 5)
  doc.setFontSize(8)
  doc.setTextColor(muted)
  doc.setFont('helvetica', 'normal')
  doc.text(shopAddress, left + 24, y + 10, { maxWidth: 85 })
  doc.text(`Phone: ${shopPhone}`, left + 24, y + 18)
  doc.text(`Date: ${new Date(data.date).toLocaleDateString('en-IN')}`, right, y + 2, { align: 'right' })
  // "Payment: Split (Card Rs.479.68 + Cash Rs.100)" wraps within the right column
  const paymentLines = doc.splitTextToSize(pdfText(`Payment: ${data.paymentMode || 'POS'}`), 62) as string[]
  doc.text(paymentLines, right, y + 7, { align: 'right' })
  const afterPayment = y + 7 + paymentLines.length * 4
  if (isUnpaidCredit && dueDateLabel) {
    doc.setTextColor('#B91C1C')
    doc.text(`Due: ${dueDateLabel}`, right, afterPayment + 1, { align: 'right' })
    doc.setTextColor(muted)
  }
  if (isSettledCredit && paidDateLabel) {
    doc.setTextColor('#047857')
    doc.text(`Paid: ${paidDateLabel}`, right, afterPayment + 1, { align: 'right' })
    doc.setTextColor(muted)
  }
  y += Math.max(28, afterPayment - y + 8)

  if (data.isCredit) {
    doc.setFillColor(isSettledCredit ? '#D1FAE5' : '#FEE2E2')
    doc.roundedRect(left, y, right - left, 10, 2, 2, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(creditColor)
    doc.text(
      isSettledCredit
        ? (paidDateLabel ? `CREDIT BILL — PAID ON ${paidDateLabel} (COMPLETED)` : 'CREDIT BILL — PAID (COMPLETED)')
        : (dueDateLabel ? `CREDIT SALE — PAYMENT DUE ON ${dueDateLabel}` : 'CREDIT SALE — PAYMENT PENDING'),
      left + (right - left) / 2,
      y + 6.5,
      { align: 'center' },
    )
    y += 16
  }

  const customerName = pdfText(data.customerName) || 'Walk-in Customer'
  const customerPhone = data.phone ? formatPhoneDisplay(String(data.phone)) : '—'
  const customerAddress = pdfText(data.address)
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
  doc.text('ITEM DESCRIPTION', left + 14, y + 6)
  doc.text('QTY', 140, y + 6, { align: 'right' })
  doc.text('RATE', 166, y + 6, { align: 'right' })
  doc.text('AMOUNT', right - 4, y + 6, { align: 'right' })
  y += 14

  data.items.forEach((raw, index) => {
    const item = normalizeStructuredOrderItem(raw)
    if (y > 260) { doc.addPage(); y = 20 }
    const name = pdfText(item.name) || 'Item'
    const nameLines = doc.splitTextToSize(name, 105) as string[]
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(ink)
    doc.text(String(index + 1), left + 4, y)
    doc.text(nameLines, left + 14, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(muted)
    doc.text(`${formatQuantityDisplay(item.quantity, item.unit, item.unit_type)}`, 140, y, { align: 'right' })
    doc.text(money(item.base_price), 166, y, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(ink)
    doc.text(money(item.line_total), right - 4, y, { align: 'right' })
    y += Math.max(10, nameLines.length * 4 + 4)
    // Jewellery: metal/purity, weights, rate and charges used for this line
    const j = item.jewellery
    if (j) {
      const detailLines = [
        [metalLabel(j.metal_type, j.purity), j.huid ? `HUID ${j.huid}` : '', j.sku ? `SKU ${j.sku}` : '', j.barcode ? `Barcode ${j.barcode}` : ''].filter(Boolean).join(' | '),
        [j.gross_weight > 0 ? `Gross ${formatWeight(j.gross_weight)}` : '', j.stone_weight > 0 ? `Stone ${formatWeight(j.stone_weight)}` : '', j.net_weight > 0 ? `Net ${formatWeight(j.net_weight)}` : '', j.rate_per_gram > 0 ? `Rate ${money(j.rate_per_gram)}/g` : ''].filter(Boolean).join(' | '),
        [j.metal_value > 0 ? `Metal ${money(j.metal_value)}` : '', j.making_amount > 0 ? `Making ${money(j.making_amount)}` : '', j.wastage_amount > 0 ? `Wastage ${money(j.wastage_amount)}` : '', j.stone_charge > 0 ? `Stone ${money(j.stone_charge)}` : '', j.other_charge > 0 ? `Other ${money(j.other_charge)}` : ''].filter(Boolean).join(' | '),
      ].filter(Boolean)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(muted)
      detailLines.forEach((line) => {
        if (y > 280) { doc.addPage(); y = 20 }
        doc.text(pdfText(line), left + 14, y - 4)
        y += 3.5
      })
      y += 2
    }
    // Free gift with this item: its own line with the value struck through, marked FREE (not in the total)
    const giftNote = pdfText(item.special_offer_note)
    if (giftNote) {
      if (y > 270) { doc.addPage(); y = 20 }
      const giftValue = Number(item.special_offer_cost) || 0
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor('#92400E')
      doc.text(doc.splitTextToSize(`FREE GIFT: ${giftNote}`, 105) as string[], left + 14, y - 3)
      doc.setFont('helvetica', 'normal')
      doc.text('1', 140, y - 3, { align: 'right' })
      if (giftValue > 0) {
        const valueText = money(giftValue)
        doc.text(valueText, 166, y - 3, { align: 'right' })
        const w = doc.getTextWidth(valueText)
        doc.setDrawColor('#92400E')
        doc.line(166 - w, y - 4, 166, y - 4)
      }
      doc.setFont('helvetica', 'bold')
      doc.text('FREE', right - 4, y - 3, { align: 'right' })
      y += 6
    }
    doc.setDrawColor('#e8eaed')
    doc.line(left, y - 3, right, y - 3)
  })

  y = Math.max(y + 6, 150)
  const rows: Array<[string, string, string]> = [['Subtotal', money(data.subtotal), ink]]
  if ((data.discountAmount || 0) > 0) rows.push([`Coupon${data.couponCode ? ` (${data.couponCode})` : ''}`, `-${money(data.discountAmount || 0)}`, primaryColor])
  if ((data.manualDiscountAmount || 0) > 0) rows.push(['Discount', `-${money(data.manualDiscountAmount || 0)}`, primaryColor])
  if ((data.schemeDiscount || 0) > 0) rows.push([`Scheme Benefit${data.schemeNumber ? ` (${data.schemeNumber})` : ''}`, `-${money(data.schemeDiscount || 0)}`, primaryColor])
  if ((data.gstAmount || 0) > 0) rows.push(['GST', money(data.gstAmount || 0), ink])
  rows.push(['Delivery', (data.shipping || 0) > 0 ? money(data.shipping) : 'FREE', ink])
  doc.setFontSize(9)
  rows.forEach(([label, value, color]) => { doc.setFont('helvetica', 'normal'); doc.setTextColor(color); doc.text(label, 143, y, { align: 'right' }); doc.text(value, right - 4, y, { align: 'right' }); y += 7 })
  const totalColor = isUnpaidCredit ? '#B91C1C' : primaryColor
  doc.setDrawColor(totalColor)
  doc.setLineWidth(0.7)
  doc.line(118, y - 3, right, y - 3)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(totalColor)
  doc.text(isUnpaidCredit ? 'AMOUNT DUE' : 'TOTAL', 143, y + 6, { align: 'right' })
  doc.text(money(data.total), right - 4, y + 6, { align: 'right' })
  if ((data.schemeAmountUsed || 0) > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(primaryColor)
    doc.text(`Paid from Scheme${data.schemeNumber ? ` (${data.schemeNumber})` : ''}`, 143, y + 13, { align: 'right' })
    doc.text(`-${money(data.schemeAmountUsed || 0)}`, right - 4, y + 13, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(ink)
    doc.text('Balance Paid', 143, y + 20, { align: 'right' })
    doc.text(money(Math.max(0, data.total - (data.schemeAmountUsed || 0))), right - 4, y + 20, { align: 'right' })
  }
  if (data.schemeNumber && data.schemeBalanceAfter != null) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(muted)
    doc.text(`Scheme ${data.schemeNumber} balance remaining: ${money(data.schemeBalanceAfter)}`, right - 4, y + 26, { align: 'right' })
  }

  y = 275
  doc.setDrawColor('#d8dce0')
  doc.setLineWidth(0.2)
  doc.line(left, y, right, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(isUnpaidCredit ? '#B91C1C' : isSettledCredit ? '#047857' : primaryColor)
  doc.text(
    isUnpaidCredit
      ? `CREDIT SALE — KINDLY SETTLE${dueDateLabel ? ` BY ${dueDateLabel}` : ''}. THANK YOU!`
      : isSettledCredit
        ? `CREDIT BILL — PAID IN FULL${paidDateLabel ? ` ON ${paidDateLabel}` : ''}. THANK YOU!`
        : 'THANK YOU FOR SHOPPING WITH US',
    pageWidth / 2,
    y + 8,
    { align: 'center' },
  )
  return doc.output('blob')
}

export function invoicePdfFile(data: InvoicePdfData): File {
  return new File([createInvoicePdf(data)], `Invoice-${formatInvoiceNo(data.invoiceNo)}.pdf`, { type: 'application/pdf' })
}

/** Captures the rendered invoice so the downloaded PDF matches the visible view. */
export async function invoicePdfFileFromElement(
  element: HTMLElement,
  invoiceNo: string,
): Promise<File> {
  const formattedNo = formatInvoiceNo(invoiceNo)
  await document.fonts?.ready
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  })

  // Size the PDF page to the actual rendered content height instead of
  // forcing a fixed A4 page — the invoice's height varies with item count,
  // and clamping it to a fixed 297mm page split the total/footer onto a
  // second sheet whenever the content ran even slightly long.
  const pageWidth = 210
  const imageHeight = (canvas.height * pageWidth) / canvas.width
  const image = canvas.toDataURL('image/png')

  const doc = new jsPDF({ unit: 'mm', format: [pageWidth, imageHeight], orientation: 'portrait' })
  doc.addImage(image, 'PNG', 0, 0, pageWidth, imageHeight, undefined, 'FAST')

  return new File([doc.output('blob')], `Invoice-${formattedNo}.pdf`, { type: 'application/pdf' })
}
