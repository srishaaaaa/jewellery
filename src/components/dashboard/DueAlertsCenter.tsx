import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgeCheck, BellRing, Boxes, Cake, CalendarClock, Clock, FileText, Heart, PiggyBank, Truck, Volume2, VolumeX, Wallet, Wrench } from 'lucide-react'
import { creditService } from '../../services/creditService'
import { listAdvanceOrders } from '../../services/advanceOrderService'
import { schemeService } from '../../services/schemeService'
import { purchaseService, supplierService } from '../../services/purchaseService'
import { quotationService, repairService } from '../../services/salesDeskService'
import { certificateService } from '../../services/stoneRateService'
import { systemNotify } from '../../lib/systemNotify'
import { useAdminAuthStore, DEFAULT_STAFF_PANELS } from '../../store/store'
import { customerService } from '../../services/customerService'
import { useSettingsStore } from '../../store/store'
import { useAlarmQueueStore } from '../../store/alarmQueueStore'
import { LEAD_DAYS, normalizeAlertSettings, type AlertKind, type AlertSettings } from '../../lib/alertSettings'
import { buildCreditReminderWhatsAppMessage } from '../../lib/whatsappMessage'
import { toWhatsAppUrl } from '../../lib/phone'
import { formatCurrency } from '../../lib/retail'
import { localIsoDate } from '../../lib/jewellery'
import { ModalPortal } from '../ModalPortal'
import { WhatsAppIcon } from '../ActionIcons'

type DueItem = {
  key: string
  kind: AlertKind
  title: string
  detail: string
  date: string
  daysLeft: number
  amount: number
  phone?: string
  message?: string
  tab: string
}

const ACK_KEY = 'jewellery_due_alerts_ack'
const CHECK_EVERY_MS = 30 * 60 * 1000
const ICONS: Record<AlertKind, typeof Wallet> = { credit: Wallet, advance: Clock, scheme: PiggyBank, purchase: Truck, repair: Wrench, birthday: Cake, anniversary: Heart, quotation: FileText, certificate: BadgeCheck, stock: Boxes }
const KIND_LABEL: Record<AlertKind, string> = { credit: 'Credit', advance: 'Advance Order', scheme: 'Scheme', purchase: 'Supplier', repair: 'Repair', birthday: 'Birthday', anniversary: 'Anniversary', quotation: 'Quotation', certificate: 'Certificate', stock: 'Low stock' }
const isEvent = (k: AlertKind) => k === 'birthday' || k === 'anniversary'

const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000)
const fmt = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const whenText = (d: number, kind?: AlertKind) => kind && isEvent(kind)
  ? (d === 0 ? 'Today' : `In ${d} day${d === 1 ? '' : 's'}`)
  : (d < 0 ? `Overdue ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'Due today' : `Due in ${d} day${d === 1 ? '' : 's'}`)

/** Next date (today or later) a yearly event falls on, from a saved date (any year) or MM-DD. */
function nextOccurrence(saved: string, today: string): string | null {
  const m = /(\d{1,2})-(\d{1,2})$/.exec(saved.trim().slice(0, 10))
  if (!m) return null
  const mm = m[1].padStart(2, '0'), dd = m[2].padStart(2, '0')
  const year = Number(today.slice(0, 4))
  const thisYear = `${year}-${mm}-${dd}`
  return thisYear >= today ? thisYear : `${year + 1}-${mm}-${dd}`
}

function readAck(today: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ACK_KEY) || 'null') as { day: string; keys: string[] } | null
    return raw && raw.day === today ? new Set(raw.keys) : new Set()
  } catch { return new Set() }
}
function writeAck(today: string, keys: Set<string>) {
  try { localStorage.setItem(ACK_KEY, JSON.stringify({ day: today, keys: [...keys] })) } catch { /* storage blocked */ }
}

/** Everything coming due within each kind's reminder window, soonest first, minus today's acknowledged ones. */
async function loadDueItems(cfg: AlertSettings): Promise<DueItem[]> {
  if (!cfg.notifications) return []
  const today = localIsoDate()
  const within = (kind: AlertKind, date: string | null | undefined) => {
    const lead = LEAD_DAYS[cfg.leads[kind]]
    if (lead < 0 || !date) return null
    const d = daysBetween(today, date.slice(0, 10))
    return d <= lead ? d : null
  }
  const found: DueItem[] = []
  const jobs: Array<Promise<void>> = []

  if (cfg.leads.credit !== 'off') jobs.push(creditService.fetchOutstandingCredits().then(rows => {
    for (const o of rows) {
      const d = within('credit', o.credit_due_date)
      if (d === null || !o.credit_due_date) continue
      found.push({
        key: `credit:${o.id}:${o.credit_due_date}`, kind: 'credit', tab: 'outstanding_credits', title: o.customer_name || o.phone,
        detail: `Invoice ${o.invoice_no}`, date: o.credit_due_date, daysLeft: d, amount: Number(o.total) || 0, phone: o.phone,
        message: buildCreditReminderWhatsAppMessage({ customerName: o.customer_name, invoiceNumber: o.invoice_no, amount: Number(o.total) || 0, dueDate: o.credit_due_date, daysOverdue: Math.max(-1, -d) }),
      })
    }
  }))
  if (cfg.leads.advance !== 'off') jobs.push(listAdvanceOrders().then(rows => {
    for (const a of rows) {
      if (a.status === 'completed' || a.status === 'cancelled') continue
      const d = within('advance', a.expected_delivery_date)
      if (d === null) continue
      found.push({
        key: `advance:${a.id}:${a.expected_delivery_date}`, kind: 'advance', tab: 'advance_orders', title: a.customer_name || a.phone,
        detail: `${a.deposit_id} • ${a.product_name}`, date: a.expected_delivery_date, daysLeft: d, amount: a.remaining_balance, phone: a.phone,
        message: `Dear ${a.customer_name || 'Customer'},\n\nYour advance order *${a.deposit_id}* (${a.product_name}) ${d < 0 ? 'was due' : d === 0 ? 'is due today' : 'is due'} on *${fmt(a.expected_delivery_date)}*.\nBalance to pay: *${formatCurrency(a.remaining_balance)}*.\n\nPlease visit the store to collect it. Thank you!`,
      })
    }
  }))
  if (cfg.leads.scheme !== 'off') jobs.push(schemeService.list().then(rows => {
    for (const s of rows) {
      if (s.status !== 'active') continue
      const d = within('scheme', s.nextDueDate)
      if (d === null || !s.nextDueDate) continue
      found.push({
        key: `scheme:${s.id}:${s.nextDueDate}`, kind: 'scheme', tab: 'schemes', title: s.customerName || s.phone,
        detail: `${s.schemeNumber} • installment ${s.installmentsPaid + 1} of ${s.totalInstallments}`, date: s.nextDueDate, daysLeft: d, amount: s.monthlyAmount, phone: s.phone,
        message: `Dear ${s.customerName || 'Customer'},\n\nYour savings scheme *${s.schemeNumber}* installment of *${formatCurrency(s.monthlyAmount)}* ${d < 0 ? 'was due' : d === 0 ? 'is due today' : 'is due'} on *${fmt(s.nextDueDate)}*.\n\nPlease pay at the store to keep your scheme benefits. Thank you!`,
      })
    }
  }))
  if (cfg.leads.purchase !== 'off') jobs.push(Promise.all([purchaseService.list(), supplierService.list()]).then(([rows, sups]) => {
    const names = new Map(sups.map(s => [s.id, s.name]))
    for (const p of rows) {
      if (p.due <= 0) continue
      const d = within('purchase', p.dueDate)
      if (d === null || !p.dueDate) continue
      found.push({
        key: `purchase:${p.id}:${p.dueDate}`, kind: 'purchase', tab: 'purchases', title: names.get(p.supplierId) || 'Supplier',
        detail: `${p.purchaseNumber}${p.supplierInvoiceNo ? ` • bill ${p.supplierInvoiceNo}` : ''}`, date: p.dueDate, daysLeft: d, amount: p.due,
      })
    }
  }))
  if (cfg.leads.repair !== 'off') jobs.push(repairService.list().then(rows => {
    for (const r of rows) {
      if (r.status === 'delivered' || r.status === 'cancelled') continue
      const d = within('repair', r.expectedDate)
      if (d === null || !r.expectedDate) continue
      found.push({
        key: `repair:${r.id}:${r.expectedDate}`, kind: 'repair', tab: 'sales_desk', title: r.customerName || r.phone,
        detail: `${r.repairNumber} • ${r.itemName}`, date: r.expectedDate, daysLeft: d, amount: 0, phone: r.phone,
        message: `Dear ${r.customerName || 'Customer'},\n\nYour repair *${r.repairNumber}* (${r.itemName}) ${r.status === 'ready' ? 'is ready for collection' : `is expected on *${fmt(r.expectedDate)}*`}.\n\nThank you!`,
      })
    }
  }))

  if (cfg.leads.birthday !== 'off' || cfg.leads.anniversary !== 'off') jobs.push(customerService.fetchAll().then(rows => {
    for (const c of rows) {
      for (const kind of ['birthday', 'anniversary'] as const) {
        const saved = c[kind]
        if (!saved || cfg.leads[kind] === 'off') continue
        const next = nextOccurrence(saved, today)
        const d = next ? within(kind, next) : null
        if (d === null || !next) continue
        const name = c.name || 'Customer'
        found.push({
          key: `${kind}:${c.id}:${next}`, kind, tab: 'customer_events', title: name,
          detail: `${kind === 'birthday' ? 'Birthday' : 'Anniversary'} on ${fmt(next)}`, date: next, daysLeft: d, amount: 0, phone: c.phone,
          message: kind === 'birthday'
            ? `🎉 Happy Birthday, ${name}! 🎂\n\nWishing you a wonderful year ahead filled with joy and sparkle.\n\nWith warm wishes,\n${useSettingsStore.getState().settings?.name || 'Team'}`
            : `💐 Happy Anniversary, ${name}! 💍\n\nWishing you both many more beautiful years together.\n\nWith warm wishes,\n${useSettingsStore.getState().settings?.name || 'Team'}`,
        })
      }
    }
  }))

  if (cfg.leads.quotation !== 'off') jobs.push(quotationService.list().then(rows => {
    for (const q of rows) {
      if (q.status !== 'open' || !q.validUntil) continue
      const d = within('quotation', q.validUntil)
      if (d === null) continue
      found.push({
        key: `quotation:${q.id}:${q.validUntil}`, kind: 'quotation', tab: 'sales_desk', title: q.customerName || q.phone || q.quotationNumber,
        detail: `${q.quotationNumber} • valid until ${fmt(q.validUntil)}`, date: q.validUntil, daysLeft: d, amount: q.total, phone: q.phone,
        message: `Dear ${q.customerName || 'Customer'},\n\nYour quotation *${q.quotationNumber}* for *${formatCurrency(q.total)}* ${d < 0 ? 'expired' : d === 0 ? 'expires today' : 'is valid until'} *${fmt(q.validUntil)}*.\nVisit us to bill it at the quoted price before it expires.\n\nThank you!`,
      })
    }
  }))
  if (cfg.leads.certificate !== 'off') jobs.push(certificateService.list().then(rows => {
    for (const c of rows) {
      if (!c.expiryDate || c.status === 'rejected') continue
      const d = within('certificate', c.expiryDate)
      if (d === null) continue
      found.push({
        key: `certificate:${c.id}:${c.expiryDate}`, kind: 'certificate', tab: 'inventory', title: `${c.lab} ${c.certificateNo}`,
        detail: c.stoneDescription || 'Stone certificate', date: c.expiryDate, daysLeft: d, amount: 0,
      })
    }
  }))

  await Promise.allSettled(jobs)
  const acked = readAck(today)
  return found.filter(i => !acked.has(i.key)).sort((a, b) => a.daysLeft - b.daysLeft)
}

/**
 * One alert for everything coming due: credit bills, advance-order delivery dates, scheme
 * installments, supplier balances and repairs. How early each kind shows, and whether there is
 * a pop-up / sound at all, is set in Settings → Alerts & Reminders. Checks on open and every 30 min.
 */
export default function DueAlertsCenter({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const alertSettings = normalizeAlertSettings(useSettingsStore(s => s.settings?.posPermissions?.alerts))
  const [items, setItems] = useState<DueItem[]>([])
  const intervalRef = useRef<number | null>(null)
  const audioRef = useRef<AudioContext | null>(null)
  const notifiedRef = useRef<string>('')
  const queue = useAlarmQueueStore(s => s.queue)
  const enqueue = useAlarmQueueStore(s => s.enqueue)
  const dequeue = useAlarmQueueStore(s => s.dequeue)
  const isFront = queue[0] === 'dueAlerts'
  const settingsKey = JSON.stringify(alertSettings)
  // Staff only get reminders for the panels they can open
  const role = useAdminAuthStore(s => s.role)
  const staffPanels = useAdminAuthStore(s => s.panels)
  const allowedKey = role === 'staff' ? JSON.stringify(staffPanels && staffPanels.length ? staffPanels : DEFAULT_STAFF_PANELS) : ''

  useEffect(() => {
    let alive = true
    const cfg = normalizeAlertSettings(JSON.parse(settingsKey))
    const allowed: string[] | null = allowedKey ? JSON.parse(allowedKey) : null
    const run = () => loadDueItems(cfg).then(all => {
      if (!alive) return
      const list = allowed ? all.filter(i => allowed.includes(i.tab)) : all
      setItems(list)
      if (list.length) enqueue('dueAlerts')
    })
    void run()
    const t = window.setInterval(() => void run(), CHECK_EVERY_MS)
    return () => { alive = false; window.clearInterval(t) }
  }, [settingsKey, allowedKey, enqueue])

  const beep = useCallback(() => {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext
      if (!audioRef.current || audioRef.current.state === 'closed') audioRef.current = new Ctor()
      const ctx = audioRef.current
      if (ctx.state === 'suspended') void ctx.resume()
      const now = ctx.currentTime
      ;[0, 0.22].forEach((offset, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(i ? 988 : 784, now + offset)
        gain.gain.setValueAtTime(0, now + offset)
        gain.gain.linearRampToValueAtTime(0.25, now + offset + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.2)
        osc.start(now + offset); osc.stop(now + offset + 0.2)
      })
    } catch { /* audio blocked until the page is clicked */ }
  }, [])

  // Sound repeats until acknowledged; a phone / desktop notification goes out once per set of items.
  useEffect(() => {
    if (!items.length || !isFront) return
    if (alertSettings.sound) { beep(); intervalRef.current = window.setInterval(beep, 4000) }
    const sig = items.map(i => i.key).join('|')
    if (alertSettings.notifications && notifiedRef.current !== sig) {
      notifiedRef.current = sig
      void systemNotify(`${items.length} reminder${items.length === 1 ? '' : 's'} due`, items.slice(0, 4).map(i => `${KIND_LABEL[i.kind]}: ${i.title} — ${whenText(i.daysLeft, i.kind)}`).join('\n'), 'due-alerts')
    }
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current) }
  }, [items, isFront, alertSettings.sound, alertSettings.notifications, beep])

  useEffect(() => () => { if (audioRef.current && audioRef.current.state !== 'closed') void audioRef.current.close().catch(() => {}) }, [])

  const close = (acknowledge: boolean) => {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    if (acknowledge) {
      const today = localIsoDate()
      const acked = readAck(today)
      items.forEach(i => acked.add(i.key))
      writeAck(today, acked)
    }
    setItems([])
    dequeue('dueAlerts')
  }

  if (!items.length || !isFront) return null

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 bg-[#1C1C1C] px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center shrink-0"><BellRing className="w-5 h-5 text-white" /></span>
            <div className="min-w-0">
              <h2 className="text-sm font-black uppercase tracking-wider text-white">Reminders Due</h2>
              <p className="text-[11px] font-semibold text-white/75">{items.length} item{items.length === 1 ? '' : 's'} need attention</p>
            </div>
          </div>
          {alertSettings.sound && <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-black uppercase text-white"><Volume2 className="w-3 h-3" /> Sounding</span>}
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-4 space-y-2">
          {items.map(i => {
            const Icon = ICONS[i.kind]
            const tone = i.daysLeft < 0 ? 'border-[#DC2626]/30 bg-[#FEE2E2]' : i.daysLeft === 0 ? 'border-[#F59E0B]/30 bg-[#FEF3C7]' : 'border-black/10 bg-white'
            return (
              <div key={i.key} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${tone}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-white border border-black/5 flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-[#000000]" /></span>
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#000000]/60">{KIND_LABEL[i.kind]}</p>
                    <p className="text-sm font-black text-[#000000] truncate">{i.title}</p>
                    <p className="text-[11px] font-semibold text-[#000000]/70 truncate">{i.detail}{i.amount > 0 ? ` • ${formatCurrency(i.amount)}` : ''}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`flex items-center gap-1 text-[10px] font-black uppercase ${i.daysLeft < 0 ? 'text-[#DC2626]' : 'text-[#000000]'}`}><CalendarClock className="w-3 h-3" />{whenText(i.daysLeft, i.kind)}</span>
                  <div className="flex gap-1.5">
                    {i.phone && i.message && (
                      <button type="button" title="Send reminder on WhatsApp" onClick={() => window.open(toWhatsAppUrl(i.phone!, i.message!), '_blank', 'noopener,noreferrer')}
                        className="flex items-center justify-center w-8 h-8 rounded-md bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981] cursor-pointer"><WhatsAppIcon className="w-4 h-4" /></button>
                    )}
                    <button type="button" onClick={() => { close(false); onOpenTab(i.tab) }} className="rounded-md bg-black/5 hover:bg-black/10 px-2.5 text-[10px] font-black uppercase tracking-wider text-[#000000] cursor-pointer">Open</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 border-t border-black/10 bg-[#FAFAFA] px-4 py-3">
          <button type="button" onClick={() => close(false)} className="flex-1 rounded-xl border border-black/10 bg-white py-2.5 text-xs font-black uppercase tracking-wider text-[#000000] hover:bg-black/5 cursor-pointer">Remind Me Later</button>
          <button type="button" onClick={() => close(true)} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-[#111111] py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-black cursor-pointer"><VolumeX className="w-4 h-4" /> Done for Today</button>
        </div>
      </div>
    </div></ModalPortal>
  )
}
