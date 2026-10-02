import React from 'react'
import { BRAND_ADDRESS, BRAND_EMAIL, BRAND_EN, BRAND_INSTAGRAM, BRAND_LOGO, BRAND_PRIMARY_PHONE_DISPLAY } from '../lib/brand'
import { formatCurrency, formatQuantityDisplay, normalizeStructuredOrderItem, formatInvoiceNo } from '../lib/retail'
import { formatPhoneDisplay } from '../lib/phone'
import { useSettingsStore } from '../store/store'
import { formatWeight, metalLabel, type JewellerySnapshot } from '../lib/jewellery'

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
  onPrintReceipt?: () => void
}

/** Jewellery lines as printed under an item: metal/purity, weights and the charges used. */
const JewelleryLineDetails: React.FC<{ j: JewellerySnapshot }> = ({ j }) => {
  const idParts = [metalLabel(j.metal_type, j.purity), j.huid ? `HUID ${j.huid}` : '', j.sku ? `SKU ${j.sku}` : '', j.barcode ? `Barcode ${j.barcode}` : '', j.design_number ? `Design ${j.design_number}` : ''].filter(Boolean)
  const weightParts = [
    j.gross_weight > 0 ? `Gross ${formatWeight(j.gross_weight)}` : '',
    j.stone_weight > 0 ? `Stone ${formatWeight(j.stone_weight)}` : '',
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
  userId,
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
  onPrintReceipt,
}) => {
  const formattedInvoiceNo = formatInvoiceNo(invoiceNo)
  const dueDateStr = creditDueDate
    ? (() => {
        try { return new Date(`${creditDueDate}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
        catch { return creditDueDate }
      })()
    : ''
  const paidDateStr = creditPaidAt
    ? (() => {
        try { return new Date(creditPaidAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
        catch { return creditPaidAt }
      })()
    : ''
  const isSettledCredit = Boolean(isCredit && creditPaidAt)
  const isUnpaidCredit = Boolean(isCredit && !creditPaidAt)
  const creditColor = isSettledCredit ? '#047857' : '#B91C1C'
  const dateStr = (() => {
    try { return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
    catch { return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  })()

  const statusColor = status === 'completed' ? 'var(--accent)' : status === 'cancelled' ? '#dc2626' : '#d97706'
  const effectiveDelivery = deliveryCharge || shipping
  const storeSettings = useSettingsStore(s => s.settings)
  const logoUrl = storeSettings?.logoUrl || BRAND_LOGO
  const shopName = storeSettings?.name || BRAND_EN
  const shopAddress = storeSettings?.address || BRAND_ADDRESS
  const shopPhone = storeSettings?.phone || BRAND_PRIMARY_PHONE_DISPLAY
  const shopEmail = storeSettings?.email || BRAND_EMAIL
  const shopInstagram = storeSettings?.instagramHandle || BRAND_INSTAGRAM

  return (
    <div
      id="invoice-print-root"
      className="w-full max-w-[794px] mx-auto bg-white text-[#111111] box-border flex flex-col p-6 sm:p-[45px] print:p-0 print:max-w-full border border-[#B7E1BE]/40 shadow-xl rounded-3xl h-auto"
      style={{
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* ── HEADER ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{isCredit ? 'Credit Invoice' : 'Tax Invoice'}</div>
        <div style={{ fontSize: 12, fontWeight: 900, color: '#0A0A0A', textTransform: 'uppercase', letterSpacing: 0.5 }}>Invoice: #{formattedInvoiceNo}</div>
      </div>
      <div style={{ borderBottom: '1px solid #B7E1BE', marginTop: 8, marginBottom: 16 }} />

      {isCredit && (
        <div style={{
          textAlign: 'center', fontWeight: 800, fontSize: 12, padding: '8px 0',
          border: `1px dashed ${creditColor}`, background: isSettledCredit ? '#D1FAE5' : '#FEE2E2', color: creditColor,
          borderRadius: 10, marginBottom: 16,
        }}>
          {isSettledCredit
            ? `CREDIT BILL — PAID${paidDateStr ? ` ON ${paidDateStr}` : ''} (COMPLETED)`
            : `CREDIT SALE — ${dueDateStr ? `PAYMENT DUE ON ${dueDateStr}` : 'PAYMENT PENDING'}`}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
          <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: '1px solid var(--accent)', overflow: 'hidden', boxShadow: '0 4px 12px rgba(46, 125, 50,0.15)' }}>
            <img src={logoUrl} alt={shopName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--accent)', letterSpacing: 1, textTransform: 'uppercase' }}>
              {shopName}
            </div>
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2, maxWidth: 280 }}>
              {shopAddress}
            </div>
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {shopPhone && <span>📞 {shopPhone}</span>}
              {shopEmail && <span>✉️ {shopEmail}</span>}
              {shopInstagram && <span>📷 @{shopInstagram}</span>}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: '#4b5563' }}>Date: {dateStr}</div>
          {paymentMode && <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>Payment: {paymentMode}</div>}
          {isUnpaidCredit && dueDateStr && <div style={{ fontSize: 11, color: '#B91C1C', fontWeight: 700, marginTop: 2 }}>Due: {dueDateStr}</div>}
          {isSettledCredit && paidDateStr && <div style={{ fontSize: 11, color: '#047857', fontWeight: 700, marginTop: 2 }}>Paid: {paidDateStr}</div>}
          {userId && <div style={{ fontSize: 9, color: '#999', marginTop: 4, wordBreak: 'break-all', maxWidth: 180 }}>{userId}</div>}
          <div
            style={{
              display: 'inline-block', marginTop: 8, padding: '3px 12px', borderRadius: 99,
              background: statusColor + '18', color: statusColor,
              fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', border: `1px solid ${statusColor}40`
            }}
          >
            {status}
          </div>
        </div>
      </div>

      {/* ── BILL TO ──────────────────────────────────────────────── */}
      <div style={{ padding: '12px 14px', borderRadius: 12, background: '#FBFAF6', border: '1px solid #B7E1BE', overflowWrap: 'anywhere', marginBottom: 20 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Bill To</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0A0A0A', lineHeight: 1.35, wordBreak: 'break-word', marginTop: 6 }}>{customerName || 'Walk-in Customer'}</div>
        <div style={{ fontSize: 9, fontWeight: 800, color: '#888', textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 6 }}>Mobile Number</div>
        <div style={{ fontSize: 12, color: '#555', lineHeight: 1.4, wordBreak: 'break-word' }}>{phone ? formatPhoneDisplay(phone) : '—'}</div>
        {address && <div style={{ fontSize: 11, color: '#777', marginTop: 4, lineHeight: 1.4, wordBreak: 'break-word' }}>Address: {address}</div>}
      </div>

      {/* ── ITEMS TABLE ──────────────────────────────────────────── */}
      <div className="w-full overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 320 }}>
          <thead>
            <tr style={{ background: '#0A0A0A', borderRadius: 8 }}>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.8, width: 28 }}>#</th>
              <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.8 }}>Item Description</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.8, width: 45 }}>Qty</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.8, width: 75 }}>Rate</th>
              <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: 10, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.8, width: 85 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const normalized = normalizeStructuredOrderItem(item as unknown as Record<string, unknown>)
              const giftNote = String(normalized.special_offer_note || item.special_offer_note || '').trim()
              const giftValue = Number(normalized.special_offer_cost ?? item.special_offer_cost) || 0
              const jewellery = normalized.jewellery
              return (
                <React.Fragment key={idx}>
                <tr style={{ borderBottom: giftNote ? 'none' : '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 8px', fontSize: 11, color: '#999', verticalAlign: 'top' }}>{idx + 1}</td>
                  <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0A0A0A' }}>{normalized.name}</div>
                    {item.offerPrice && item.price !== item.offerPrice && (
                      <div style={{ fontSize: 10, color: '#aaa', textDecoration: 'line-through', marginTop: 2 }}>MRP ₹{item.price}</div>
                    )}
                    {jewellery ? (
                      <JewelleryLineDetails j={jewellery} />
                    ) : (
                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                      {normalized.unit} · {formatCurrency(normalized.base_price)}
                    </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 8px', fontSize: 12, fontWeight: 600, textAlign: 'center', verticalAlign: 'top' }}>{formatQuantityDisplay(normalized.quantity, normalized.unit, normalized.unit_type)}</td>
                  <td style={{ padding: '10px 8px', fontSize: 12, fontWeight: 600, textAlign: 'right', verticalAlign: 'top', color: '#555' }}>{formatCurrency(normalized.base_price)}</td>
                  <td style={{ padding: '10px 8px', fontSize: 13, fontWeight: 800, textAlign: 'right', verticalAlign: 'top', color: '#0A0A0A' }}>{formatCurrency(normalized.line_total)}</td>
                </tr>
                {giftNote && (
                  <tr style={{ borderBottom: '1px solid #f0f0f0', background: '#FFFBEB' }}>
                    <td />
                    <td style={{ padding: '6px 8px', fontSize: 11, fontWeight: 800, color: '#92400E' }}>🎁 FREE GIFT: {giftNote}</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, fontWeight: 600, textAlign: 'center', color: '#92400E' }}>1</td>
                    <td style={{ padding: '6px 8px', fontSize: 11, textAlign: 'right', color: '#92400E', textDecoration: giftValue > 0 ? 'line-through' : 'none' }}>{giftValue > 0 ? formatCurrency(giftValue) : '—'}</td>
                    <td style={{ padding: '6px 8px', fontSize: 12, fontWeight: 900, textAlign: 'right', color: '#92400E' }}>FREE</td>
                  </tr>
                )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── TOTALS ───────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, borderTop: '2px solid var(--accent)', paddingTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ minWidth: 240, width: '100%', maxWidth: 300 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: '#666' }}>Subtotal</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{formatCurrency(subtotal)}</span>
            </div>
            {discountAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--accent-dark)' }}>
                  Coupon{couponCode ? ` (${couponCode})` : ''}
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dark)' }}>−{formatCurrency(discountAmount)}</span>
              </div>
            )}
            {manualDiscountAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--accent-dark)' }}>Manual Discount</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dark)' }}>−{formatCurrency(manualDiscountAmount)}</span>
              </div>
            )}
            {schemeDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--accent-dark)' }}>Scheme Benefit{schemeNumber ? ` (${schemeNumber})` : ''}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dark)' }}>−{formatCurrency(schemeDiscount)}</span>
              </div>
            )}
            {gstAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#666' }}>GST</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>+{formatCurrency(gstAmount)}</span>
              </div>
            )}
            {effectiveDelivery > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#666' }}>Delivery</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{formatCurrency(effectiveDelivery)}</span>
              </div>
            )}
            <div
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderTop: `2px solid ${isUnpaidCredit ? '#B91C1C' : 'var(--accent)'}`, paddingTop: 10, marginTop: 4,
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 900, color: isUnpaidCredit ? '#B91C1C' : '#0A0A0A', textTransform: 'uppercase', letterSpacing: 0.5 }}>{isUnpaidCredit ? 'Amount Due' : 'Total'}</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: isUnpaidCredit ? '#B91C1C' : '#0A0A0A' }}>{formatCurrency(total)}</span>
            </div>
            {schemeAmountUsed > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--accent-dark)' }}>Paid from Scheme{schemeNumber ? ` (${schemeNumber})` : ''}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-dark)' }}>−{formatCurrency(schemeAmountUsed)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#0A0A0A' }}>Balance Paid</span>
                  <span style={{ fontSize: 14, fontWeight: 900, color: '#0A0A0A' }}>{formatCurrency(Math.max(0, total - schemeAmountUsed))}</span>
                </div>
              </>
            )}
            {schemeNumber && schemeBalanceAfter != null && (
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 6, textAlign: 'right' }}>
                Scheme {schemeNumber} balance remaining: {formatCurrency(schemeBalanceAfter)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 32, paddingTop: 16, borderTop: '1px dashed #d0d0d0',
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800, color: isUnpaidCredit ? '#B91C1C' : isSettledCredit ? '#047857' : 'var(--accent)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {isUnpaidCredit
            ? `Credit Sale — Kindly Settle${dueDateStr ? ` By ${dueDateStr}` : ''}`
            : isSettledCredit
              ? `Credit Bill — Paid In Full${paidDateStr ? ` On ${paidDateStr}` : ''}`
              : 'Thank You For Shopping With Us'}
        </div>
        {shopInstagram && <div style={{ fontSize: 10, color: '#777', marginTop: 4 }}>Follow us on Instagram: @{shopInstagram}</div>}
        {onPrintReceipt && (
          <button
            type="button"
            onClick={onPrintReceipt}
            className="print:hidden"
            data-html2canvas-ignore="true"
            style={{
              marginTop: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid var(--accent)', borderRadius: 999, padding: '9px 20px',
              background: '#0A0A0A', color: 'var(--accent)', fontSize: 12, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            Print Thermal Receipt
          </button>
        )}
      </div>
    </div>
  )
}
