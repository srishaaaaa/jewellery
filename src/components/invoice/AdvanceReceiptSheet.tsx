import React from 'react'
import type { AdvanceOrder } from '../../services/advanceOrderService'
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
          <div style={{ fontSize: 12, fontWeight: 600, fontStyle: 'italic', marginTop: 4 }}>{amountInWords(completed ? order.total_amount : order.deposit_amount)}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 16, lineHeight: 1.8 }}>
            <div>Advance Received: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(order.deposit_amount)}</span></div>
            {completed && order.final_payment_method && <div>Balance paid via {order.final_payment_method.toUpperCase()}</div>}
            {order.remarks && <div>Notes: <span style={{ color: '#4b5563' }}>{order.remarks}</span></div>}
          </div>
        </div>
        <div style={{ flex: '0 1 280px', width: '100%', maxWidth: 300, marginLeft: 'auto' }}>
          <TotalRow label="Order Total" value={`₹${inr(order.total_amount)}`} />
          <TotalRow label="Advance Paid" value={`− ₹${inr(order.deposit_amount)}`} />
          <GrandTotal label={completed ? 'Paid in Full' : 'Balance Due'} value={completed ? order.total_amount : balance} />
        </div>
      </div>

      <SheetFooter note={completed ? undefined : 'Advance only — not a final invoice. The bill is issued when the balance is paid.'} />
    </Sheet>
  )
}
