import type { Purchase, Supplier } from '../services/purchaseService'
import { printThermalReceipt } from './thermalPrint'
import { toWhatsAppUrl } from './phone'
import { formatCurrency } from './retail'

/** Thermal slip for a supplier purchase (same printer layout as sales receipts). */
export function printPurchaseThermal(purchase: Purchase, supplier: Supplier | null | undefined, paperWidth: 58 | 80 = 80) {
  printThermalReceipt({
    paperWidth,
    invoiceNo: purchase.purchaseNumber,
    date: purchase.createdAt || purchase.purchaseDate,
    customerName: supplier?.name ? `Supplier: ${supplier.name}` : 'Supplier purchase',
    phone: supplier?.phone || '',
    paymentMode: purchase.due > 0 ? `Paid ${formatCurrency(purchase.amountPaid)} · Owed ${formatCurrency(purchase.due)}` : 'Paid in full',
    items: purchase.items.map(it => ({
      name: [it.description || 'Item', it.net_weight > 0 ? `${it.net_weight.toFixed(3)} g` : ''].filter(Boolean).join(' · '),
      qty: it.quantity || 1,
      price: it.rate || it.amount,
      line_total: it.amount,
    })),
    subtotal: purchase.totalAmount,
    shipping: 0,
    total: purchase.totalAmount,
  })
}

/** Opens WhatsApp to the supplier with the purchase summary filled in. */
export function sharePurchaseWhatsApp(purchase: Purchase, supplier: Supplier | null | undefined, shopName: string, link?: string) {
  const lines = [
    `*${shopName}* — Purchase ${purchase.purchaseNumber}`,
    supplier?.name ? `Supplier: ${supplier.name}` : '',
    purchase.supplierInvoiceNo ? `Your bill: ${purchase.supplierInvoiceNo}` : '',
    `Date: ${purchase.purchaseDate}`,
    '',
    ...purchase.items.map(it => `• ${it.description || 'Item'}${it.net_weight > 0 ? ` (${it.net_weight.toFixed(3)} g)` : ''} — ${formatCurrency(it.amount)}`),
    '',
    `Total: ${formatCurrency(purchase.totalAmount)}`,
    `Paid: ${formatCurrency(purchase.amountPaid)}`,
    purchase.due > 0 ? `Balance: ${formatCurrency(purchase.due)}` : 'Paid in full',
    link ? `\n${link}` : '',
  ].filter(l => l !== '')
  const text = lines.join('\n')
  const url = supplier?.phone ? toWhatsAppUrl(supplier.phone, text) : `https://wa.me/?text=${encodeURIComponent(text)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
