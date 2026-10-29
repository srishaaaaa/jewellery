import { jsPDF } from 'jspdf'
import { BRAND_ACCENT, BRAND_EN, BRAND_PHONE_DISPLAY } from './brand'
import { getActiveLogo } from './activeLogo'
import { formatCurrency } from './retail'
import { normalizePhone } from './phone'
import { publicSiteOrigin } from './whatsappMessage'
import { isSupabaseConfigured, supabase } from './supabase'
import { useSettingsStore } from '../store/store'

export type ShareableCoupon = {
  id: number
  code: string
  percentage: number
  expiry_date: string | null
  min_order_value: number
  allowed_phones?: string[] | null
}

/** Phones are stored as 10 digits so "+91 81229 21906" and "8122921906" match. */
export const couponPhoneKey = (phone: string) => {
  const n = normalizePhone(phone)
  return n ? n.slice(2) : phone.replace(/\D/g, '').slice(-10)
}

/** A coupon with a phone list only works for those phones. An empty list means anyone. */
export const couponAllowsPhone = (allowed: unknown, phone: string) => {
  const list = Array.isArray(allowed) ? allowed.map(String).filter(Boolean) : []
  if (!list.length) return true
  const key = couponPhoneKey(phone || '')
  return Boolean(key) && list.some((p) => couponPhoneKey(p) === key)
}

export const publicCouponUrl = (code: string) => `${publicSiteOrigin()}/coupon/${encodeURIComponent(code.trim().toUpperCase())}`

const shopInfo = () => {
  const s = useSettingsStore.getState().settings
  return {
    name: s?.name || BRAND_EN,
    phone: s?.shopContactNumber || s?.phone || BRAND_PHONE_DISPLAY,
    address: s?.address || '',
    accent: s?.accentColor || BRAND_ACCENT,
  }
}

const expiryText = (c: ShareableCoupon) =>
  c.expiry_date ? new Date(c.expiry_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

/** Conditions printed on the coupon and in the message. */
export const couponTerms = (c: ShareableCoupon, onlyForCustomer: boolean) => [
  c.min_order_value > 0 ? `Valid on purchases of ${formatCurrency(c.min_order_value)} or more` : '',
  c.expiry_date ? `Valid till ${expiryText(c)}` : '',
  onlyForCustomer ? 'Only for the mobile number it was sent to' : '',
  'Show this code at billing. Discount applies to the item value only.',
].filter(Boolean)

export const buildCouponWhatsAppMessage = (c: ShareableCoupon, customerName: string, onlyForCustomer: boolean) => {
  const shop = shopInfo()
  return [
    `Hello ${customerName.trim() || 'there'},`,
    '',
    `🎁 Here is a coupon from *${shop.name}*`,
    '',
    `Code: *${c.code}*`,
    `Offer: *${c.percentage}% OFF*`,
    ...couponTerms(c, onlyForCustomer).map((t) => `• ${t}`),
    '',
    `Download your coupon: ${publicCouponUrl(c.code)}`,
    '',
    shop.phone ? `📞 ${shop.phone}` : '',
  ].filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== '')).join('\n').trim()
}

/** One-page coupon PDF (A6 landscape, card size). */
export function createCouponPdf(c: ShareableCoupon, customerName = '', onlyForCustomer = false): File {
  const shop = shopInfo()
  const doc = new jsPDF({ unit: 'mm', format: 'a6', orientation: 'landscape' })
  const W = 148
  const H = 105
  doc.setFillColor('#FFFFFF')
  doc.rect(0, 0, W, H, 'F')
  doc.setDrawColor(shop.accent)
  doc.setLineWidth(0.8)
  doc.roundedRect(5, 5, W - 10, H - 10, 4, 4)
  doc.setLineDashPattern([1.5, 1.5], 0)
  doc.setLineWidth(0.3)
  doc.roundedRect(8, 8, W - 16, H - 16, 3, 3)
  doc.setLineDashPattern([], 0)

  let y = 18
  const logo = getActiveLogo()
  if (logo) {
    try { doc.addImage(logo.base64, logo.format, 14, 12, 14, 14) } catch { /* text only */ }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor('#111111')
  doc.text(shop.name, W / 2, y, { align: 'center' })
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor('#555555')
  doc.text('GIFT COUPON', W / 2, y, { align: 'center' })

  y += 15
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(shop.accent)
  doc.text(`${c.percentage}% OFF`, W / 2, y, { align: 'center' })

  y += 10
  doc.setFillColor('#111111')
  const codeW = Math.max(50, doc.getTextWidth(c.code) * 0.5 + 24)
  doc.roundedRect(W / 2 - codeW / 2, y - 6, codeW, 10, 2, 2, 'F')
  doc.setFont('courier', 'bold')
  doc.setFontSize(14)
  doc.setTextColor('#FFFFFF')
  doc.text(c.code, W / 2, y + 1, { align: 'center' })

  y += 11
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor('#333333')
  if (customerName.trim()) {
    doc.setFont('helvetica', 'bold')
    doc.text(`For ${customerName.trim()}`, W / 2, y, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    y += 4.5
  }
  for (const t of couponTerms(c, onlyForCustomer)) {
    doc.text(t, W / 2, y, { align: 'center' })
    y += 4
  }
  doc.setFontSize(7)
  doc.setTextColor('#666666')
  doc.text([shop.address, shop.phone].filter(Boolean).join('  ·  ').slice(0, 110), W / 2, H - 12, { align: 'center' })

  const blob = doc.output('blob')
  return new File([blob], `Coupon-${c.code}.pdf`, { type: 'application/pdf' })
}

/**
 * Called once the WhatsApp chat or share sheet has been used. Saves the send
 * and, for "only for this customer", adds the phone to the coupon's phone list.
 */
export async function recordCouponSend(
  c: ShareableCoupon,
  phone: string,
  customerName: string,
  channel: 'whatsapp' | 'pdf',
  onlyForCustomer: boolean,
): Promise<string[] | null> {
  if (!isSupabaseConfigured) return null
  const key = couponPhoneKey(phone)
  let allowed: string[] | null = null
  if (onlyForCustomer && key) {
    const current = Array.isArray(c.allowed_phones) ? c.allowed_phones : []
    allowed = current.includes(key) ? current : [...current, key]
    const { error } = await supabase.from('coupons').update({ allowed_phones: allowed }).eq('id', c.id)
    if (error) throw new Error('Could not lock the coupon to this phone. Run supabase/migrations/coupon_sends.sql in Supabase first.')
  }
  // The history row is a record only: never block sending if it fails.
  await supabase.from('coupon_sends').insert({
    coupon_id: c.id,
    code: c.code,
    phone: key,
    customer_name: customerName.trim() || null,
    channel,
    only_for_customer: onlyForCustomer,
  }).then(() => undefined, () => undefined)
  return allowed
}
