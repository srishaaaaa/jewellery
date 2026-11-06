import type { InvoiceProps } from '../components/Invoice'
import { formatInvoiceNo, formatPaymentMode, normalizeStructuredOrderItem } from './retail'

/**
 * A saved bill (orders row) as Invoice props: the same values the POS printed, never recalculated
 * with today's rates. Used by the customer portal so the customer sees the shop's exact invoice.
 */
export function orderToInvoiceProps(o: Record<string, unknown>): InvoiceProps {
  const num = (v: unknown) => Number(v) || 0
  const items = (Array.isArray(o.items) ? o.items : []).map((it) => normalizeStructuredOrderItem(it as Record<string, unknown>))
  const subtotal = items.reduce((s, it) => s + it.line_total, 0)
  const total = num(o.total) > 0 ? num(o.total)
    : subtotal + num(o.delivery_charge) + num(o.total_gst || o.gst_amount) - num(o.discount_amount) - num(o.manual_discount_amount)
  const creditStatus = (o.credit_status as string | null) || (o.is_credit ? (o.credit_paid_at ? 'paid' : 'outstanding') : null)
  return {
    invoiceNo: formatInvoiceNo(String(o.invoice_no || o.id || '')),
    date: String(o.created_at || ''),
    customerName: String(o.customer_name || ''),
    phone: String(o.phone || ''),
    address: String(o.address || ''),
    items: items as unknown as InvoiceProps['items'],
    subtotal,
    shipping: num(o.delivery_charge),
    discountAmount: num(o.discount_amount),
    manualDiscountAmount: num(o.manual_discount_amount),
    gstAmount: num(o.total_gst || o.gst_amount),
    couponCode: (o.coupon_code as string | null) || null,
    total,
    status: String(o.status || 'completed'),
    paymentMode: formatPaymentMode(o.payment_mode || o.payment_method, o.split_details),
    isCredit: creditStatus === 'outstanding' || creditStatus === 'paid',
    creditDueDate: creditStatus === 'outstanding' ? ((o.credit_due_date as string) || null) : null,
    creditPaidAt: creditStatus === 'paid' ? ((o.credit_paid_at as string) || null) : null,
    schemeNumber: o.scheme_number ? String(o.scheme_number) : null,
    schemeDiscount: num(o.scheme_discount),
    schemeAmountUsed: num(o.scheme_amount_used),
    schemeBalanceAfter: o.scheme_balance_after == null ? null : num(o.scheme_balance_after),
    advanceAmountUsed: num(o.advance_amount_used),
    exchangeAmount: num(o.exchange_amount),
    customerGstin: o.customer_gstin ? String(o.customer_gstin) : null,
    customerPan: o.customer_pan ? String(o.customer_pan) : null,
    splitDetails: o.split_details,
    schemeGramsUsed: o.scheme_grams_used == null ? null : num(o.scheme_grams_used),
    schemeGoldRate: o.scheme_gold_rate == null ? null : num(o.scheme_gold_rate),
    channel: (o.order_mode as string) || undefined,
  }
}
