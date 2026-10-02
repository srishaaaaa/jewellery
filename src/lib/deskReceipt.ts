import { BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY } from './brand'
import { formatPhoneDisplay } from './phone'
import { useSettingsStore } from '../store/store'

const esc = (value: string) => value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c))

export type DeskReceipt = {
  title: string
  number: string
  date: string
  customerName?: string
  phone?: string
  rows: Array<[string, string]>
  /** Highlighted closing rows, e.g. [['Balance', '₹1,200']] */
  totals?: Array<[string, string]>
  footer?: string
}

/** Prints an 80mm thermal slip for advances, repairs, returns etc. (same layout as the advance receipt). */
export function printDeskReceipt(r: DeskReceipt) {
  const settings = useSettingsStore.getState().settings
  const shop = { name: settings?.name || BRAND_EN, address: settings?.address || BRAND_ADDRESS, phone: settings?.phone || BRAND_PHONE_DISPLAY, gstin: settings?.gstin || '' }
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc) return
  const row = ([k, v]: [string, string]) => `<div class="r"><span class="label">${esc(k)}</span><span>${esc(v)}</span></div>`
  const html = `<!doctype html><html><head><title>${esc(r.title)} ${esc(r.number)}</title>
<meta charset="utf-8">
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; font-weight: 600; width: 72mm; padding: 4mm; color: #000; }
  .c { text-align: center; }
  .r { display: flex; justify-content: space-between; gap: 4px; margin: 5px 0; word-break: break-word; }
  .r span:first-child { flex-shrink: 0; max-width: 50%; }
  .r span:last-child { text-align: right; flex: 1; }
  .line { border-top: 1px dashed #555; margin: 8px 0; }
  .big { font-size: 15px; font-weight: bold; }
  .label { font-size: 10px; color: #333; }
  .t { font-size: 13px; font-weight: bold; }
  .foot { font-size: 9px; font-weight: bold; margin-top: 10px; text-align: center; }
</style></head><body>
<div class="c big">${esc(shop.name)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.address)}</div>
<div class="c" style="font-size:10px;color:#333;">${esc(shop.phone)}</div>
${shop.gstin ? `<div class="c" style="font-size:10px;color:#333;">GSTIN: ${esc(shop.gstin)}</div>` : ''}
<div class="line"></div>
<div class="c big">${esc(r.title.toUpperCase())}</div>
<div class="line"></div>
${row(['No', r.number])}
${row(['Date', r.date])}
${r.customerName ? row(['Customer', r.customerName]) : ''}
${r.phone ? row(['Phone', formatPhoneDisplay(r.phone) || r.phone]) : ''}
<div class="line"></div>
${r.rows.map(row).join('')}
${r.totals?.length ? `<div class="line"></div>${r.totals.map(([k, v]) => `<div class="r t"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}` : ''}
<div class="line"></div>
<div class="foot">${esc(r.footer || 'Thank you!')}</div>
</body></html>`
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1500)
  }, 300)
}
