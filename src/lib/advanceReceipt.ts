import { BRAND_ACCENT, BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY } from './brand'
import { formatCurrency } from './retail'
import type { AdvanceOrder } from '../services/advanceOrderService'
import { useSettingsStore } from '../store/store'
import { formatPhoneDisplay } from './phone'

function getShopInfo() {
  const storeSettings = useSettingsStore.getState().settings
  return {
    name: storeSettings?.name || BRAND_EN,
    address: storeSettings?.address || BRAND_ADDRESS,
    phone: storeSettings?.phone || BRAND_PHONE_DISPLAY,
    accentColor: storeSettings?.accentColor || BRAND_ACCENT,
  }
}

const esc = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] || char))

export function printAdvanceReceipt(order: AdvanceOrder, paperWidth: 58 | 80 = 80) {
  const shop = getShopInfo()
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  const paymentLabel = order.final_payment_method
    ? (order.final_payment_method === 'upi' ? 'UPI / QR' : order.final_payment_method.toUpperCase())
    : ''
  const depositPayment = (() => {
    // Show payment method if available
    return paymentLabel || 'Cash'
  })()
  const html = `<!doctype html><html><head><title>Advance Receipt ${esc(order.deposit_id)}</title>
<meta charset="utf-8"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
  @page { size: ${paperWidth}mm auto; margin: 0; }
  @media print { @page { size: ${paperWidth}mm auto; margin: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Poppins', system-ui, sans-serif;
    font-size: ${paperWidth === 58 ? 10.5 : 12}px;
    font-weight: 600;
    width: ${paperWidth - 8}mm;
    padding: ${paperWidth === 58 ? 2 : 4}mm;
    color: #000;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .c { text-align: center; }
  .r { display: flex; justify-content: space-between; gap: 4px; margin: 5px 0; word-break: break-word; }
  .r span:first-child { flex-shrink: 0; max-width: 55%; }
  .r span:last-child { text-align: right; flex: 1; }
  .line { border-top: 1px dashed #555; margin: 8px 0; }
  .big { font-size: 15px; font-weight: bold; }
  .bold { font-weight: bold; }
  .warn { font-size: 9px; font-weight: bold; margin-top: 10px; text-align: center; }
  .label { font-size: 10px; color: #333; }
  .balance-row { font-size: 14px; font-weight: bold; }
</style>
</head><body>
<div class="c big">${esc(shop.name)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.address)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.phone)}</div>
<div class="line"></div>
<div class="c big">ADVANCE RECEIPT</div>
<div class="c" style="font-size:10px;">Not a final tax invoice</div>
<div class="line"></div>
<div><span class="bold">${esc(order.deposit_id)}</span></div>
<div style="font-size:10px;color:#333;">${new Date(order.created_at).toLocaleString('en-IN')}</div>
<div class="line"></div>
<div class="r"><span class="label">Customer</span><span class="bold">${esc(order.customer_name)}</span></div>
<div class="r"><span class="label">Phone</span><span>${esc(formatPhoneDisplay(order.phone))}</span></div>
${order.address ? `<div class="r"><span class="label">Address</span><span>${esc(order.address)}</span></div>` : ''}
<div class="r"><span class="label">Product</span><span>${esc(order.product_name)}</span></div>
${order.category ? `<div class="r"><span class="label">Category</span><span>${esc(order.category)}</span></div>` : ''}
<div class="r"><span class="label">Delivery</span><span>${esc(new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN'))}</span></div>
<div class="r"><span class="label">Payment</span><span>${esc(depositPayment)}</span></div>
<div class="line"></div>
<div class="r"><span>Total Amount</span><span class="bold">${esc(formatCurrency(order.total_amount))}</span></div>
<div class="r"><span>Deposit Paid</span><span class="bold">${esc(formatCurrency(order.deposit_amount))}</span></div>
<div class="r balance-row"><span>Balance Due</span><span>${esc(formatCurrency(order.remaining_balance))}</span></div>
<div class="line"></div>
<div class="warn">ADVANCE PAYMENT ONLY &mdash; NOT A FINAL INVOICE</div>
</body></html>`
  doc.open()
  doc.write(html)
  doc.close()

  const runPrint = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1500)
  }

  setTimeout(runPrint, 300)
}

export function downloadFile(file: File) { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500) }

