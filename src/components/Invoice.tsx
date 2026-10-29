import React from 'react'
import { formatCurrency, formatQuantityDisplay, normalizeStructuredOrderItem, formatInvoiceNo, paymentSplitRows, schemePaidLabel } from '../lib/retail'
import { formatPhoneDisplay } from '../lib/phone'
import { amountInWords } from '../lib/amountInWords'
import { BilledTo, GrandTotal, Sheet, SheetFooter, SheetHeader, TotalRow } from './invoice/InvoiceParts'
import { LABEL, MONO, TD, TH, inr, useShopProfile } from './invoice/invoiceStyle'
import { formatWeight, metalLabel, type JewellerySnapshot } from '../lib/jewellery'
import { gstSplit } from '../lib/gst'

export interface InvoiceItem {
  id?: number | string
  product_id?: number | null
  name: string
  qty: number
  quantity?: number
  unit?: string
  unit_type?: 'unit' | 'weight' | 'volume' | 'bundle'
  base_quantity?: number
  base_price?: number
  line_total?: number
  price: number
  offerPrice?: number | null
  special_offer_note?: string | null
  special_offer_cost?: number | null
  jewellery?: JewellerySnapshot | null
}

export interface InvoiceProps {
  invoiceNo: string
  date: string
  customerName: string
  phone: string
  address: string
  items: InvoiceItem[]
  subtotal: number
  shipping: number
  total: number
  status?: string
  userId?: string
  deliveryCharge?: number
  discountAmount?: number
  couponCode?: string | null
  manualDiscountAmount?: number
  gstAmount?: number
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
  /** Customer advance adjusted on this bill */
  advanceAmountUsed?: number
  /** Value of old gold taken in exchange on this bill */
  exchangeAmount?: number
  customerGstin?: string | null
  customerPan?: string | null
  /** The bill's split_details: mixed payment amounts per method (and the payment reference) */
  splitDetails?: unknown
  /** Scheme redeemed by grams: grams used and the day's rate */
  schemeGramsUsed?: number | null
  schemeGoldRate?: number | null
  /** Kept for callers; the full-page toolbar now holds the print actions. */
  onPrintReceipt?: () => void
  /** OFFLINE / ONLINE, shown as "Channel" in the header */
  channel?: string
  /** Cash handed over and change given back (shown under the amount in words) */
  amountReceived?: number
  changeReturned?: number
}

/** Jewellery lines as printed under an item: metal/purity, weights and the charges used. */
const JewelleryLineDetails: React.FC<{ j: JewellerySnapshot }> = ({ j }) => {
  const idParts = [metalLabel(j.metal_type, j.purity), j.huid ? `HUID ${j.huid}` : '', j.serial_no ? `Sr ${j.serial_no}` : '', j.sku ? `SKU ${j.sku}` : '', j.barcode ? `Barcode ${j.barcode}` : '', j.design_number ? `Design ${j.design_number}` : ''].filter(Boolean)
  const weightParts = [
    j.gross_weight > 0 ? `Gross ${formatWeight(j.gross_weight)}` : '',
    j.stone_weight > 0 ? `Stone ${formatWeight(j.stone_weight)}` : '',
    j.other_weight ? `Other ${formatWeight(j.other_weight)}` : '',
    j.net_weight > 0 ? `Net ${formatWeight(j.net_weight)}` : '',
    j.rate_per_gram > 0 ? `Rate ${formatCurrency(j.rate_per_gram)}/g` : '',
  ].filter(Boolean)
  const chargeParts = [
    j.metal_value > 0 ? `Metal ${formatCurrency(j.metal_value)}` : '',
    j.making_amount > 0 ? `Making ${formatCurrency(j.making_amount)}${j.making_charge_type !== 'fixed' ? ` (${j.making_charge_type === 'percentage' ? `${j.making_charge}%` : `${formatCurrency(j.making_charge)}/g`})` : ''}` : '',
    j.wastage_amount > 0 ? `Wastage ${formatCurrency(j.wastage_amount)}${j.wastage_type === 'percentage' ? ` (${j.wastage}%)` : ` (${formatWeight(j.wastage)})`}` : '',
    j.stone_charge > 0 ? `Stone ${formatCurrency(j.stone_charge)}` : '',
    j.other_charge > 0 ? `Other ${formatCurrency(j.other_charge)}` : '',
  ].filter(Boolean)
  return (
    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 700, color: '#374151' }}>{idParts.join(' · ')}</div>
      {weightParts.length > 0 && <div>{weightParts.join(' · ')}</div>}
      {chargeParts.length > 0 && <div>{chargeParts.join(' · ')}</div>}
      {(j.stone_summary || j.hallmark_status === 'hallmarked') && (
        <div>{[j.stone_summary ? `Stones: ${j.stone_summary}` : '', j.hallmark_status === 'hallmarked' ? 'BIS Hallmarked' : ''].filter(Boolean).join(' · ')}</div>
      )}
    </div>
  )
}

export const Invoice: React.FC<InvoiceProps> = ({
  invoiceNo,
  date,
  customerName,
  phone,
  address,
  items,
  subtotal,
  shipping,
  total,
  status = 'Pending',
  deliveryCharge = 0,
  discountAmount = 0,
  couponCode,
  manualDiscountAmount = 0,
  gstAmount = 0,
  paymentMode,
  isCredit = false,
  creditDueDate,
  creditPaidAt,
  schemeNumber,
  schemeDiscount = 0,
  schemeAmountUsed = 0,
  schemeBalanceAfter,
  advanceAmountUsed = 0,
  exchangeAmount = 0,
  customerGstin,
  customerPan,
  splitDetails,
  schemeGramsUsed,
  schemeGoldRate,
  channel,
  amountReceived = 0,
  changeReturned = 0,
}) => {
  const splitRows = paymentSplitRows(splitDetails)
  const shop = useShopProfile()
  const longDate = (value: string | null | undefined) => {
    if (!value) return ''
    const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  const billDate = Number.isNaN(new Date(date).getTime()) ? new Date() : new Date(date)
  const dueDateStr = longDate(creditDueDate)
  const paidDateStr = longDate(creditPaidAt)
  const isSettledCredit = Boolean(isCredit && creditPaidAt)
  const isUnpaidCredit = Boolean(isCredit && !creditPaidAt)
  const effectiveDelivery = deliveryCharge || shipping
  const reductions = schemeAmountUsed + advanceAmountUsed + exchangeAmount
  const amountPaid = Math.max(0, total - reductions)
  const gstParts = gstSplit(gstAmount, subtotal - discountAmount - manualDiscountAmount - schemeDiscount)

  const meta: Array<[string, React.ReactNode]> = [
    ['Date', billDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
    ['Time', billDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })],
    ['Payment', `${(paymentMode || (isCredit ? 'Credit' : 'Cash')).toUpperCase()} • ${String(status).toUpperCase()}`],
  ]
  if (channel) meta.push(['Channel', channel.toUpperCase()])
  if (isUnpaidCredit && dueDateStr) meta.push(['Due', dueDateStr])
  if (isSettledCredit && paidDateStr) meta.push(['Paid', paidDateStr])

  return (
    <Sheet id="invoice-print-root">
      <SheetHeader title={gstAmount > 0 ? 'Tax Invoice' : isCredit ? 'Credit Invoice' : 'Invoice'} number={formatInvoiceNo(invoiceNo)} meta={meta} />

      {isCredit && (
        <div style={{ marginTop: 16, padding: '8px 12px', fontSize: 11, fontWeight: 600, textAlign: 'center', border: `1px dashed ${isSettledCredit ? '#047857' : '#B91C1C'}`, color: isSettledCredit ? '#047857' : '#B91C1C' }}>
          {isSettledCredit
            ? `CREDIT BILL — PAID${paidDateStr ? ` ON ${paidDateStr}` : ''}`
            : `CREDIT SALE — ${dueDateStr ? `PAYMENT DUE ON ${dueDateStr}` : 'PAYMENT PENDING'}`}
        </div>
      )}

      <BilledTo
        name={customerName}
        phone={phone ? formatPhoneDisplay(phone) : ''}
        extra={(
          <>
            {address && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 3, maxWidth: 260 }}>{address}</div>}
            {customerGstin && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 3 }}>GSTIN: <span style={{ fontFamily: MONO }}>{customerGstin}</span></div>}
            {customerPan && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 3 }}>PAN: <span style={{ fontFamily: MONO }}>{customerPan}</span></div>}
          </>
        )}
      />

      {/* Items */}
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
          {items.map((item, idx) => {
            const normalized = normalizeStructuredOrderItem(item as unknown as Record<string, unknown>)
            const giftNote = String(normalized.special_offer_note || item.special_offer_note || '').trim()
            const giftValue = Number(normalized.special_offer_cost ?? item.special_offer_cost) || 0
            return (
              <React.Fragment key={idx}>
                <tr>
                  <td style={{ ...TD, textAlign: 'center', color: '#9ca3af' }}>{idx + 1}</td>
                  <td style={TD}>
                    <div style={{ fontWeight: 600 }}>{normalized.name}</div>
                    {item.offerPrice && item.price !== item.offerPrice && (
                      <div style={{ fontSize: 10, color: '#9ca3af', textDecoration: 'line-through', marginTop: 2 }}>MRP ₹{inr(item.price)}</div>
                    )}
                    {normalized.jewellery && <JewelleryLineDetails j={normalized.jewellery} />}
                  </td>
                  <td style={{ ...TD, textAlign: 'center', fontWeight: 600 }}>{formatQuantityDisplay(normalized.quantity, normalized.unit, normalized.unit_type)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, color: '#4b5563' }}>{inr(normalized.base_price)}</td>
                  <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontWeight: 700 }}>{inr(normalized.line_total)}</td>
                </tr>
                {giftNote && (
                  <tr>
                    <td style={TD} />
                    <td style={{ ...TD, fontSize: 11, fontWeight: 600, color: '#92400E' }}>Free gift: {giftNote}</td>
                    <td style={{ ...TD, textAlign: 'center', fontSize: 11, color: '#92400E' }}>1</td>
                    <td style={{ ...TD, textAlign: 'right', fontFamily: MONO, fontSize: 11, color: '#92400E', textDecoration: giftValue > 0 ? 'line-through' : 'none' }}>{giftValue > 0 ? inr(giftValue) : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: '#92400E' }}>FREE</td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>

      {/* Words + payment on the left, totals on the right */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 32, flexWrap: 'wrap', marginTop: 12, paddingTop: 16, borderTop: '1px solid #e5e7eb' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
          <div style={LABEL}>Amount in Words</div>
          <div style={{ fontSize: 12, fontWeight: 600, fontStyle: 'italic', marginTop: 4 }}>{amountInWords(isUnpaidCredit ? total : amountPaid)}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 16, lineHeight: 1.8 }}>
            {splitRows.length > 0
              ? splitRows.map(([label, amount]) => (
                <div key={label}>Paid by {label}: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(amount)}</span></div>
              ))
              : !isUnpaidCredit && (
                <div>{paymentMode && !/cash/i.test(paymentMode) ? `Paid via ${paymentMode}` : 'Cash Received'}: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(amountReceived > 0 ? amountReceived : amountPaid)}</span></div>
              )}
            {changeReturned > 0 && (
              <div>Change Returned: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(changeReturned)}</span></div>
            )}
            {schemeNumber && schemeBalanceAfter != null && (
              <div>Scheme {schemeNumber} balance: <span style={{ fontFamily: MONO, color: '#111111', fontWeight: 600 }}>₹{inr(schemeBalanceAfter)}</span></div>
            )}
          </div>
        </div>

        <div style={{ flex: '0 1 280px', width: '100%', maxWidth: 300, marginLeft: 'auto' }}>
          <TotalRow label="Subtotal" value={`₹${inr(subtotal)}`} />
          {discountAmount > 0 && <TotalRow label={`Coupon${couponCode ? ` (${couponCode})` : ''}`} value={`− ₹${inr(discountAmount)}`} />}
          {manualDiscountAmount > 0 && <TotalRow label="Discount" value={`− ₹${inr(manualDiscountAmount)}`} />}
          {schemeDiscount > 0 && <TotalRow label={`Scheme Benefit${schemeNumber ? ` (${schemeNumber})` : ''}`} value={`− ₹${inr(schemeDiscount)}`} />}
          {gstAmount > 0 && (
            <>
              <TotalRow label={gstParts.cgstLabel} value={`₹${inr(gstParts.cgst)}`} />
              <TotalRow label={gstParts.sgstLabel} value={`₹${inr(gstParts.sgst)}`} />
              <TotalRow label={gstParts.totalLabel} value={`₹${inr(gstAmount)}`} />
            </>
          )}
          {effectiveDelivery > 0 && <TotalRow label="Delivery" value={`₹${inr(effectiveDelivery)}`} />}
          <GrandTotal label={isUnpaidCredit ? 'Amount Due' : 'Total'} value={total} color={isUnpaidCredit ? '#B91C1C' : undefined} />
          {discountAmount + manualDiscountAmount + schemeDiscount > 0 && (
            <div style={{ textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#15803D', marginTop: 6 }}>
              You saved ₹{inr(discountAmount + manualDiscountAmount + schemeDiscount)} on this bill
            </div>
          )}
          {reductions > 0 && (
            <div style={{ marginTop: 12 }}>
              {schemeAmountUsed > 0 && <TotalRow label={schemePaidLabel(schemeNumber, schemeGramsUsed, schemeGoldRate)} value={`− ₹${inr(schemeAmountUsed)}`} />}
              {advanceAmountUsed > 0 && <TotalRow label="Advance Adjusted" value={`− ₹${inr(advanceAmountUsed)}`} />}
              {exchangeAmount > 0 && <TotalRow label="Old Gold Exchange" value={`− ₹${inr(exchangeAmount)}`} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                <span>Amount Paid</span>
                <span style={{ fontFamily: MONO }}>₹{inr(amountPaid)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <SheetFooter note={isUnpaidCredit ? `Credit sale — kindly settle${dueDateStr ? ` by ${dueDateStr}` : ''} • ${shop.name}` : undefined} />
    </Sheet>
  )
}
