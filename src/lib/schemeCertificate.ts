import { BRAND_ADDRESS, BRAND_EMAIL, BRAND_EN, BRAND_PHONE_DISPLAY } from './brand'
import { formatCurrency } from './retail'
import { formatPhoneDisplay } from './phone'
import { useSettingsStore } from '../store/store'
import { getActiveLogo } from './activeLogo'
import { addMonthsIso, describeSchemeBenefit, type JewelleryScheme } from './jewellery'
import type { SchemeInstallment, SchemeVoucher } from '../services/schemeService'

const esc = (value: string) => value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c))
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * A4 one-time deposit certificate with its gift voucher underneath.
 * letterhead = true prints the shop header (logo, name, address, GSTIN); false leaves the top
 * of the page blank for the shop's pre-printed letterhead paper.
 */
export function printDepositCertificate(opts: {
  scheme: JewelleryScheme
  deposit: SchemeInstallment | null
  voucher: SchemeVoucher | null
  voucherPercent: number
  voucherValidityMonths: number
  letterhead: boolean
}) {
  const { scheme, deposit, voucher, letterhead } = opts
  const settings = useSettingsStore.getState().settings
  const shop = {
    name: settings?.name || BRAND_EN,
    address: settings?.address || BRAND_ADDRESS,
    phone: settings?.shopContactNumber || settings?.phone || BRAND_PHONE_DISPLAY,
    email: settings?.email || BRAND_EMAIL,
    gstin: settings?.gstin || '',
  }
  const logo = getActiveLogo()
  const depositDate = deposit?.paymentDate ? deposit.paymentDate.slice(0, 10) : scheme.startDate
  const validUntil = voucher ? addMonthsIso((voucher.createdAt || depositDate).slice(0, 10), Math.max(1, opts.voucherValidityMonths)) : ''
  const rows: Array<[string, string]> = [
    ['Certificate No.', scheme.schemeNumber],
    ['Customer', scheme.customerName || '—'],
    ['Mobile', formatPhoneDisplay(scheme.phone) || scheme.phone],
    ['Plan', scheme.schemeName],
    ['Deposit Amount', formatCurrency(scheme.totalPaid || scheme.monthlyAmount)],
    ['Deposit Date', fmtDate(depositDate)],
    ...(deposit?.receiptNumber ? [['Receipt No.', deposit.receiptNumber] as [string, string]] : []),
    ...(deposit?.paymentMethod ? [['Paid By', deposit.paymentMethod.toUpperCase() === 'QR' ? 'UPI' : deposit.paymentMethod.toUpperCase()] as [string, string]] : []),
    ...(deposit?.goldRate && deposit.goldGrams ? [['Gold Booked', `${deposit.goldGrams.toFixed(3)} g ${scheme.goldPurity} @ ${formatCurrency(deposit.goldRate)}/g`] as [string, string]] : []),
    ['Maturity Date', fmtDate(scheme.maturityDate)],
    ['Benefit on Redemption', describeSchemeBenefit(scheme, formatCurrency) || '—'],
  ]

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Deposit Certificate ${esc(scheme.schemeNumber)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; font-variant-numeric: lining-nums; color: #1f2937; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .head { display: flex; align-items: center; gap: 14px; border-bottom: 3px double #a16207; padding-bottom: 10px; }
  .head img { height: 64px; }
  .shop { font-size: 24px; font-weight: bold; letter-spacing: 1px; color: #713f12; }
  .shopline { font-size: 11px; color: #4b5563; font-family: Arial, sans-serif; }
  .blank { height: 42mm; }
  h1 { text-align: center; font-size: 20px; letter-spacing: 3px; margin: 22px 0 4px; color: #713f12; }
  .sub { text-align: center; font-size: 12px; color: #6b7280; font-family: Arial, sans-serif; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
  td:first-child { width: 38%; color: #6b7280; font-family: Arial, sans-serif; font-size: 12px; }
  td:last-child { font-weight: bold; }
  .note { font-size: 11px; color: #4b5563; margin-top: 12px; font-family: Arial, sans-serif; line-height: 1.5; }
  .sign { display: flex; justify-content: space-between; margin-top: 46px; font-size: 12px; font-family: Arial, sans-serif; }
  .sign div { border-top: 1px solid #9ca3af; padding-top: 4px; width: 42%; text-align: center; }
  .cut { margin: 26px 0 18px; border-top: 1px dashed #9ca3af; text-align: center; font-size: 10px; color: #9ca3af; font-family: Arial, sans-serif; }
  .voucher { border: 2px solid #a16207; border-radius: 14px; padding: 16px 20px; background: #fffbeb; display: flex; justify-content: space-between; gap: 16px; align-items: center; }
  .vtitle { font-size: 12px; letter-spacing: 3px; color: #a16207; font-family: Arial, sans-serif; font-weight: bold; }
  .vvalue { font-size: 34px; font-weight: bold; color: #713f12; }
  .vcode { font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; border: 1px dashed #a16207; padding: 6px 12px; border-radius: 8px; background: #fff; display: inline-block; }
  .vsmall { font-size: 11px; color: #4b5563; font-family: Arial, sans-serif; line-height: 1.5; }
</style></head><body>
${letterhead ? `<div class="head">
  ${logo ? `<img src="${logo.base64}" alt="">` : ''}
  <div>
    <div class="shop">${esc(shop.name)}</div>
    <div class="shopline">${esc(shop.address)}</div>
    <div class="shopline">Phone: ${esc(shop.phone)}${shop.email ? ` &nbsp;•&nbsp; ${esc(shop.email)}` : ''}${shop.gstin ? ` &nbsp;•&nbsp; GSTIN: ${esc(shop.gstin)}` : ''}</div>
  </div>
</div>` : '<div class="blank"></div>'}
<h1>ONE-TIME DEPOSIT CERTIFICATE</h1>
<div class="sub">Issued on ${esc(fmtDate(depositDate))}</div>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<div class="note">This certificate confirms the deposit above under the shop's savings scheme. The deposit is redeemed against a jewellery purchase on or after the maturity date as per the scheme terms. Please bring this certificate when redeeming.</div>
<div class="sign"><div>Customer Signature</div><div>For ${esc(shop.name)}<br>Authorised Signatory</div></div>
${voucher ? `<div class="cut">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>
<div class="voucher">
  <div>
    <div class="vtitle">GIFT VOUCHER</div>
    <div class="vvalue">${esc(formatCurrency(voucher.amount))}</div>
    <div class="vsmall">${esc(String(opts.voucherPercent))}% of your deposit of ${esc(formatCurrency(scheme.totalPaid || scheme.monthlyAmount))}</div>
  </div>
  <div style="text-align:right">
    <div class="vcode">${esc(voucher.code)}</div>
    <div class="vsmall" style="margin-top:6px">For ${esc(scheme.customerName || 'Customer')} • ${esc(formatPhoneDisplay(scheme.phone) || scheme.phone)}</div>
    <div class="vsmall">Valid until ${esc(fmtDate(validUntil))} • Adjusted on your next purchase</div>
    <div class="vsmall">${esc(shop.name)}</div>
  </div>
</div>` : ''}
</body></html>`

  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1500)
  }, 400)
}
