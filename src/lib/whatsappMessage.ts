import { formatInvoiceNo } from './retail'
import { BRAND_EN, BRAND_INSTAGRAM, BRAND_PRIMARY_PHONE_DISPLAY, BRAND_PRODUCTION_DOMAIN } from './brand'
import { useSettingsStore } from '../store/store'
import { formatWeight, metalLabel, type JewellerySnapshot } from './jewellery'

function getShopInfo() {
  const storeSettings = useSettingsStore.getState().settings
  const instagramHandle = storeSettings?.instagramHandle || BRAND_INSTAGRAM
  return {
    name: storeSettings?.name || BRAND_EN,
    phone: storeSettings?.phone || BRAND_PRIMARY_PHONE_DISPLAY,
    instagramHandle,
    instagramUrl: instagramHandle ? `https://instagram.com/${instagramHandle}` : '',
  }
}

export type WhatsAppLineItem = {
  name: string
  qty: number
  unit: string
  unitType: 'unit' | 'weight' | 'volume' | 'bundle'
  rate: number
  lineTotal: number
  /** Free gift that comes with this item: shown, never added to the total */
  giftNote?: string | null
  giftValue?: number | null
  /** Jewellery snapshot: adds a metal / weight / rate line under the item */
  jewellery?: JewellerySnapshot | null
}

export type BuildWhatsAppMessageInput = {
  customerName?: string
  phone?: string
  invoiceNumber: string
  invoiceDate?: string
  invoiceUrl?: string
  paymentMode?: string
  items?: WhatsAppLineItem[]
  subtotal?: number
  couponDiscount?: number
  manualDiscountAmount?: number
  shipping?: number
  gstAmount?: number
  total?: number
  isCredit?: boolean
  creditDueDate?: string | null
  creditPaidAt?: string | null
  schemeNumber?: string | null
  schemeDiscount?: number
  schemeAmountUsed?: number
  schemeBalanceAfter?: number | null
}

export type SchemeInstallmentWhatsAppInput = {
  customerName?: string
  schemeNumber: string
  schemeName: string
  receiptNumber: string
  installmentNumber: number
  totalInstallments: number
  amount: number
  paymentMethod?: string
  paidAt: string
  totalPaid: number
  remainingAmount: number
  nextDueDate?: string | null
}

export type CreditReminderWhatsAppInput = {
  customerName?: string
  invoiceNumber: string
  amount: number
  dueDate?: string | null
  daysOverdue: number
}

export type CreditPaidWhatsAppInput = {
  customerName?: string
  invoiceNumber: string
  amount: number
  paidAt?: string | null
}

export type AdvanceDepositWhatsAppInput = {
  customerName?: string
  depositId: string
  productName: string
  totalAmount: number
  depositAmount: number
  remainingBalance: number
  expectedDeliveryDate: string
  paymentMethod?: string
}

export const publicInvoiceUrl = (invoiceNumberOrId: string) => {
  // Link with the invoice number exactly as stored (or the order id). Reformatting it
  // here (e.g. keeping only the last 8 digits) produces a number the invoice page
  // cannot find in the database.
  const identifier = String(invoiceNumberOrId || '').trim()
  const envUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '')
  const origin =
    envUrl ||
    (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.includes('localhost')
      ? window.location.origin
      : BRAND_PRODUCTION_DOMAIN || (typeof window !== 'undefined' ? window.location.origin : ''))
  return `${origin}/invoice/${encodeURIComponent(identifier)}`
}

export const buildProfessionalWhatsAppMessage = (input: BuildWhatsAppMessageInput) => {
  const shop = getShopInfo()
  const customerName = input.customerName?.trim() || 'Valued Customer'
  const invoiceUrl = input.invoiceUrl || publicInvoiceUrl(input.invoiceNumber)
  const formattedNo = formatInvoiceNo(input.invoiceNumber)
  const itemsText = input.items && input.items.length > 0
    ? input.items.map(item => `• ${item.name} (x${item.qty}) - ₹ ${Number(item.lineTotal || 0).toFixed(2)}` +
        (item.jewellery ? `\n   ${[metalLabel(item.jewellery.metal_type, item.jewellery.purity), item.jewellery.net_weight > 0 ? `Net ${formatWeight(item.jewellery.net_weight)}` : '', item.jewellery.rate_per_gram > 0 ? `@ ₹ ${item.jewellery.rate_per_gram.toFixed(2)}/g` : '', item.jewellery.huid ? `HUID ${item.jewellery.huid}` : ''].filter(Boolean).join(' · ')}` : '') +
        (item.giftNote ? `\n   🎁 FREE GIFT: ${item.giftNote}${Number(item.giftValue) > 0 ? ` (worth ₹ ${Number(item.giftValue).toFixed(2)})` : ''} - FREE` : '')).join('\n')
    : ''

  const dueDateText = input.creditDueDate
    ? new Date(`${input.creditDueDate}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const paidDateText = input.creditPaidAt
    ? new Date(input.creditPaidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''
  const isSettledCredit = Boolean(input.isCredit && input.creditPaidAt)
  const creditBlock = input.isCredit
    ? isSettledCredit
      ? `\n✅ *CREDIT BILL — PAID (COMPLETED)*\n${paidDateText ? `📅 *Paid On:* ${paidDateText}\n` : ''}\n`
      : `\n🔴 *CREDIT SALE — PAYMENT PENDING*\n${dueDateText ? `📅 *Due Date:* ${dueDateText}\n` : ''}Kindly settle this amount by the due date. Thank you!\n`
    : ''
  const schemeBlock = input.schemeNumber && ((input.schemeAmountUsed || 0) > 0 || (input.schemeDiscount || 0) > 0)
    ? `\n💎 *Savings Scheme:* ${input.schemeNumber}\n` +
      ((input.schemeDiscount || 0) > 0 ? `🎁 *Scheme Benefit:* - ₹ ${Number(input.schemeDiscount).toFixed(2)}\n` : '') +
      ((input.schemeAmountUsed || 0) > 0 ? `💰 *Paid from Scheme:* ₹ ${Number(input.schemeAmountUsed).toFixed(2)}\n` : '') +
      (input.schemeBalanceAfter != null ? `📊 *Scheme Balance Left:* ₹ ${Number(input.schemeBalanceAfter).toFixed(2)}\n` : '')
    : ''

  return `✨ *${shop.name}* ✨
🛍️ *Official Purchase Invoice & Receipt* 🛍️

Dear ${customerName},

Thank you for shopping at ${shop.name}! We truly appreciate your patronage.

🧾 *INVOICE DETAILS*
📌 *Invoice No:* #${formattedNo}
${input.invoiceDate ? `📅 *Date:* ${new Date(input.invoiceDate).toLocaleDateString('en-IN')}\n` : ''}${input.paymentMode ? `💳 *Payment Mode:* ${input.paymentMode}\n` : ''}${input.total !== undefined ? `💰 *Total Amount:* ₹ ${Number(input.total || 0).toFixed(2)}\n` : ''}${creditBlock}${schemeBlock}
${itemsText ? `📦 *ITEMS ORDERED:*\n${itemsText}\n\n` : ''}📄 *View & Download Digital Invoice / PDF:*
👉 ${invoiceUrl}

${shop.phone ? `📞 *Shop Contact:* ${shop.phone}\n` : ''}${shop.instagramUrl ? `📷 *Follow us on Instagram:* ${shop.instagramUrl}\n` : ''}
Thank you, and visit us again! ✨`
}

export const buildCreditReminderWhatsAppMessage = (input: CreditReminderWhatsAppInput) => {
  const shop = getShopInfo()
  const customerName = input.customerName?.trim() || 'Valued Customer'
  const formattedNo = formatInvoiceNo(input.invoiceNumber)
  const dueDateText = input.dueDate
    ? new Date(`${input.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '-'
  const statusLine = input.daysOverdue > 0
    ? `⚠️ This payment is *${input.daysOverdue} day${input.daysOverdue > 1 ? 's' : ''} overdue*.`
    : input.daysOverdue === 0
      ? '⏰ This payment is *due today*.'
      : `📅 This payment is due on *${dueDateText}*.`

  return `🔔 *Payment Reminder — ${shop.name}* 🔔

Dear ${customerName},

This is a friendly reminder about your pending credit purchase.

🧾 *Invoice No:* #${formattedNo}
💰 *Amount Due:* ₹ ${Number(input.amount || 0).toFixed(2)}
📅 *Due Date:* ${dueDateText}
${statusLine}

Kindly clear the payment at your earliest convenience. Thank you for your continued support!

${shop.phone ? `📞 *Shop Contact:* ${shop.phone}` : ''}`
}

/** Sent from Credit Bills History: the pending amount has been cleared. */
export const buildCreditPaidWhatsAppMessage = (input: CreditPaidWhatsAppInput) => {
  const shop = getShopInfo()
  const customerName = input.customerName?.trim() || 'Valued Customer'
  const formattedNo = formatInvoiceNo(input.invoiceNumber)
  const paidDateText = input.paidAt
    ? new Date(input.paidAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''

  return `✅ *Payment Received — ${shop.name}* ✅

Dear ${customerName},

We have received your payment and your credit bill is now fully cleared. Thank you for settling it!

🧾 *Invoice No:* #${formattedNo}
💰 *Amount Paid:* ₹ ${Number(input.amount || 0).toFixed(2)}
${paidDateText ? `📅 *Paid On:* ${paidDateText}\n` : ''}✔️ *Balance Due:* ₹ 0.00

📄 *View & Download Your Invoice:*
👉 ${publicInvoiceUrl(input.invoiceNumber)}

Thank you for shopping with us — we look forward to seeing you again! 🙏

${shop.phone ? `📞 *Shop Contact:* ${shop.phone}` : ''}${shop.instagramUrl ? `\n📷 *Follow us on Instagram:* ${shop.instagramUrl}` : ''}`
}

export const buildAdvanceDepositWhatsAppMessage = (input: AdvanceDepositWhatsAppInput) => {
  const shop = getShopInfo()
  const customerName = input.customerName?.trim() || 'Valued Customer'
  const deliveryDateFormatted = input.expectedDeliveryDate
    ? (() => {
        try {
          return new Date(`${input.expectedDeliveryDate}T00:00:00`).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        } catch {
          return input.expectedDeliveryDate
        }
      })()
    : '-'

  return `✨ *Thank You for Your Advance Order with ${shop.name}!* ✨

Dear ${customerName},

We have successfully received your initial advance payment!

🧾 *Advance Order Details* 👇
📦 Deposit ID: #${input.depositId}
💍 Item: ${input.productName}
💵 Total Order Amount: ₹${input.totalAmount}
💰 Advance Paid: ₹${input.depositAmount}${input.paymentMethod ? ` (${input.paymentMethod.toLowerCase() === 'upi' ? 'QR' : input.paymentMethod.toUpperCase()})` : ''}
🔴 Balance to Pay on Delivery: ₹${input.remainingBalance}
📅 Expected Delivery Date: ${deliveryDateFormatted}

Your jewellery is being prepared with utmost care. We will have everything ready on or before ${deliveryDateFormatted}!

${shop.phone ? `📞 *Shop Contact:* ${shop.phone}` : ''}${shop.instagramHandle ? `\n📷 *Instagram:* @${shop.instagramHandle}` : ''}`
}

/** Receipt for a savings-scheme installment. */
export const buildSchemeInstallmentWhatsAppMessage = (input: SchemeInstallmentWhatsAppInput) => {
  const shop = getShopInfo()
  const customerName = input.customerName?.trim() || 'Valued Customer'
  const fmtDate = (value: string) => {
    try { return new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) }
    catch { return value }
  }
  const method = input.paymentMethod
    ? (input.paymentMethod.toLowerCase() === 'qr' || input.paymentMethod.toLowerCase() === 'upi' ? 'UPI / QR' : input.paymentMethod.toUpperCase())
    : ''

  return `💎 *Scheme Installment Received — ${shop.name}* 💎

Dear ${customerName},

Thank you! We have received your savings scheme installment.

🧾 *Receipt No:* ${input.receiptNumber}
📌 *Scheme:* ${input.schemeName} (${input.schemeNumber})
🔢 *Installment:* ${input.installmentNumber} of ${input.totalInstallments}
💰 *Amount Paid:* ₹ ${Number(input.amount || 0).toFixed(2)}${method ? ` (${method})` : ''}
📅 *Paid On:* ${fmtDate(input.paidAt)}

📊 *Total Paid So Far:* ₹ ${Number(input.totalPaid || 0).toFixed(2)}
⏳ *Remaining:* ₹ ${Number(input.remainingAmount || 0).toFixed(2)}
${input.nextDueDate ? `📅 *Next Due Date:* ${fmtDate(input.nextDueDate)}\n` : '🎉 *All installments completed!*\n'}
${shop.phone ? `📞 *Shop Contact:* ${shop.phone}` : ''}`
}
