import React, { useEffect, useState } from 'react'
import { getAdvanceOrderHistory, type AdvanceOrder, type AdvancePayment } from '../../services/advanceOrderService'
import { supabase } from '../../lib/supabase'
import { paymentModeLabel, parseSplitNote, stripSplitNote } from '../../lib/paymentModes'
import { amountInWords } from '../../lib/amountInWords'
import { formatPhoneDisplay } from '../../lib/phone'
import { BilledTo, GrandTotal, Sheet, SheetFooter, SheetHeader, TotalRow } from './InvoiceParts'
import { LABEL, MONO, TD, TH, inr } from './invoiceStyle'

const STATUS: Record<string, string> = {
  pending_deposit: 'PENDING', waiting_final_payment: 'PENDING', ready_for_delivery: 'READY', completed: 'COMPLETED', cancelled: 'CANCELLED',
}

/** Advance receipt (or the advance order bill once completed) in the same sheet format as invoices. */
export const AdvanceReceiptSheet: React.FC<{ order: AdvanceOrder }> = ({ order }) => {
  const completed = order.status === 'completed'
  // Payments taken (deposit + balance, with any split) and, once billed, the bill's coupon / discount
  const [payments, setPayments] = useState<AdvancePayment[]>([])
  const [bill, setBill] = useState<{ coupon: number; couponCode: string; manual: number } | null>(null)
  useEffect(() => {
    let live = true
    getAdvanceOrderHistory(order.id).then(h => { if (live) setPayments(h.payments) }).catch(() => undefined)
    if (order.completed_order_id) {
      supabase.from('orders').select('discount_amount, coupon_code, manual_discount_amount').eq('id', order.completed_order_id).maybeSingle()
        .then(({ data }) => { if (live && data) setBill({ coupon: Number(data.discount_amount) || 0, couponCode: String(data.coupon_code || ''), manual: Number(data.manual_discount_amount) || 0 }) })
    }
    return () => { live = false }
  }, [order.id, order.completed_order_id])
  const discounts = (bill?.coupon || 0) + (bill?.manual || 0)
  const paidTotal = completed ? Math.max(0, order.total_amount - discounts) : order.deposit_amount
  const created = new Date(order.created_at)
  const rows = order.products?.length
    ? order.products
    : [{ name: order.product_name, quantity: 1, base_price: order.total_amount, line_total: order.total_amount }]
  const balance = completed ? 0 : order.remaining_balance
  const delivery = order.expected_delivery_date
    ? new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : ''

  const meta: Array<[string, React.ReactNode]> = [
    ['Date', created.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
    ['Time', created.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })],
    ['Status', STATUS[order.status] || order.status.toUpperCase()],
  ]
  if (delivery) meta.push(['Delivery', delivery])
  if (order.invoice_number) meta.push(['Invoice', order.invoice_number])

  return (
    <Sheet id="invoice-print-root">
      <SheetHeader title={completed ? 'Advance Order Bill' : 'Advance Receipt'} number={order.deposit_id} meta={meta} />

      <BilledTo
        name={order.customer_name}
        phone={order.phone ? formatPhoneDisplay(order.phone) : ''}
        extra={order.address ? <div style={{ fontSize: 11, color: '#4b5563', marginTop: 3, maxWidth: 260 }}>{order.address}</div> : undefined}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 28, textAlign: 'center' }}>#</th>
            <th style={{ ...TH, textAlign: 'left' }}>Item Description</th>
            <th style={{ ...TH, width: 56, textAlign: 'center' }}>Qty</th>
            <th style={{ ...TH, width: 96, textAlign: 'right' }}>Rate (₹)</th>
            <th style={{ ...TH, width: 108, textAlign: 'right' }}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, idx) => {
            const qty = Number(item.quantity || 1)
            const rate = Number(item.base_price || 0)
            return (
              <tr key={idx}>
                <td style={{ ...TD, textAlign: 'center', color: '#9ca3af' }}>{idx + 1}</td>
                <td style={TD}>
                  <div style={{ fontWeight: 600 }}>{String(item.name || order.product_name)}</div>
                  {idx === 0 && order.description && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{order.description}</div>}
                </td>
                <td style={{ ...TD, textAlign: 'center', fontWeight: 600 }}>{qty}</td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: '#4b5563' }}>{inr(rate)}</td>
                <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700 }}>{inr(Number(item.line_total ?? rate * qty))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap', marginTop: 12, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={LABEL}>Amount in Words</div>
          <div style={{ fontSize: 12, fontWeight: 600, fontStyle: 'italic', marginTop: 4 }}>{amountInWords(paidTotal)}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 16, lineHeight: 1.8 }}>
            {payments.length > 0 ? payments.map(p => {
              const split = parseSplitNote(p.remarks)
              const what = p.payment_type === 'deposit' ? 'Advance' : 'Balance'
              return (
                <div key={p.id}>
                  <div>{what} via {paymentModeLabel(split.length ? 'mixed' : p.payment_method)}: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(p.amount)}</span></div>
                  {split.map(([label, n]) => <div key={label} style={{ paddingLeft: 10 }}>{label}: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(n)}</span></div>)}
                </div>
              )
            }) : <>
              <div>Advance Received: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(order.deposit_amount)}</span></div>
              {completed && order.final_payment_method && <div>Balance paid via {paymentModeLabel(order.final_payment_method)}</div>}
            </>}
            {stripSplitNote(order.remarks) && <div>Notes: <span style={{ color: '#4b5563' }}>{stripSplitNote(order.remarks)}</span></div>}
          </div>
        </div>
        <div style={{ flex: '0 1 280px', width: '100%', maxWidth: 300, marginLeft: 'auto' }}>
          <TotalRow label="Order Total" value={`₹${inr(order.total_amount)}`} />
          {(bill?.coupon || 0) > 0 && <TotalRow label={`Coupon${bill?.couponCode ? ` (${bill.couponCode})` : ''}`} value={`− ₹${inr(bill!.coupon)}`} />}
          {(bill?.manual || 0) > 0 && <TotalRow label="Discount" value={`− ₹${inr(bill!.manual)}`} />}
          <TotalRow label="Advance Paid" value={`− ₹${inr(order.deposit_amount)}`} />
          {completed && <TotalRow label="Balance Paid" value={`− ₹${inr(Math.max(0, paidTotal - order.deposit_amount))}`} />}
          <GrandTotal label={completed ? 'Paid in Full' : 'Balance Due'} value={completed ? paidTotal : balance} />
        </div>
      </div>

      <SheetFooter note={completed ? undefined : 'Advance only — not a final invoice. The bill is issued when the balance is paid.'} />
    </Sheet>
  )
}
