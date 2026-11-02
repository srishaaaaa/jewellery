import { useEffect, useState } from 'react'
import { BadgeCheck, Boxes, Briefcase, Gem, Tag, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../lib/retail'
import { useProductStore } from '../../store/store'
import { advanceService, quotationService, repairService, returnService, type CustomerAdvance, type Quotation, type Repair, type SalesReturn } from '../../services/salesDeskService'
import { customerService, type CustomerRecord } from '../../services/customerService'
import { certificateService, looseStoneService, type GemCertificate, type LooseStone } from '../../services/stoneRateService'

type Box = { label: string; value: string; hint: string; tone?: 'red' | 'green' }
type Section = { id: string; title: string; icon: typeof Boxes; tab: string; boxes: Box[] }
type Coupon = { is_active: boolean; expiry_date: string | null }

/**
 * Analytics: one row of boxes per section (Sales Desk, Inventory, Loose Stones & Certificates,
 * Customers, Coupons). Schemes have their own dashboard. Uses the Analytics date range where it applies.
 */
export function SectionAnalytics({ from, to, onOpen }: { from: string; to: string; onOpen: (tab: string) => void }) {
  const products = useProductStore((s) => s.products)
  const [data, setData] = useState<{
    quotations: Quotation[]; returns: SalesReturn[]; repairs: Repair[]; advances: CustomerAdvance[]
    stones: LooseStone[]; certs: GemCertificate[]; customers: CustomerRecord[]; coupons: Coupon[]
  } | null>(null)

  useEffect(() => {
    let live = true
    const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
    Promise.all([
      safe(quotationService.list()), safe(returnService.list()), safe(repairService.list()), safe(advanceService.list()),
      safe(looseStoneService.list()), safe(certificateService.list()), safe(customerService.fetchAll()),
      safe(Promise.resolve(supabase.from('coupons').select('is_active, expiry_date')).then(({ data: rows }) => (rows || []) as Coupon[])),
    ]).then(([quotations, returns, repairs, advances, stones, certs, customers, coupons]) => {
      if (live) setData({ quotations, returns, repairs, advances, stones, certs, customers, coupons })
    })
    return () => { live = false }
  }, [])

  if (!data) return <div className="rounded-xl border border-black/10 bg-white p-4 text-xs font-semibold text-[#000000]/60">Loading section analytics…</div>

  const inRange = (iso: string | null | undefined) => {
    const d = String(iso || '').slice(0, 10)
    return Boolean(d) && (!from || d >= from) && (!to || d <= to)
  }
  const sum = (n: number[]) => n.reduce((a, b) => a + b, 0)
  const today = new Date().toISOString().slice(0, 10)
  const month = today.slice(5, 7)

  const q = data.quotations.filter((x) => inRange(x.createdAt))
  const openQ = data.quotations.filter((x) => x.status === 'open')
  const ret = data.returns.filter((x) => inRange(x.createdAt) && x.status === 'approved')
  const openRepairs = data.repairs.filter((x) => x.status !== 'delivered' && x.status !== 'cancelled')
  const activeAdv = data.advances.filter((x) => x.status === 'active')

  const stockUnits = sum(products.map((p) => Math.max(0, p.stock || 0)))
  const stockValue = sum(products.map((p) => Math.max(0, p.stock || 0) * (p.price || 0)))
  const low = products.filter((p) => (p.stock || 0) > 0 && (p.stock || 0) <= 2).length
  const out = products.filter((p) => (p.stock || 0) <= 0).length

  const inStock = data.stones.filter((s) => s.status === 'available' || s.status === 'reserved')
  const certPending = data.certs.filter((c) => c.status === 'pending' || c.status === 'uploaded').length
  const certExpired = data.certs.filter((c) => c.status === 'expired' || (c.expiryDate && c.expiryDate < today && c.status !== 'rejected')).length

  const bdays = data.customers.filter((c) => c.birthday && c.birthday.slice(5, 7) === month).length
  const annivs = data.customers.filter((c) => c.anniversary && c.anniversary.slice(5, 7) === month).length
  const noDates = data.customers.filter((c) => !c.birthday && !c.anniversary).length
  const activeCoupons = data.coupons.filter((c) => c.is_active && (!c.expiry_date || c.expiry_date.slice(0, 10) >= today)).length

  const sections: Section[] = [
    { id: 'desk', title: 'Sales Desk', icon: Briefcase, tab: 'sales_desk', boxes: [
      { label: 'Quotations', value: String(q.length), hint: `${openQ.length} open · ${formatCurrency(sum(openQ.map((x) => x.total)))}` },
      { label: 'Returns refunded', value: formatCurrency(sum(ret.filter((x) => x.returnType === 'refund').map((x) => x.refundAmount))), hint: `${ret.length} approved in period`, tone: 'red' },
      { label: 'Open repairs', value: String(openRepairs.length), hint: `${openRepairs.filter((x) => x.status === 'ready').length} ready · ${formatCurrency(sum(openRepairs.map((x) => Math.max(0, x.balance))))} to collect` },
      { label: 'Customer advances held', value: formatCurrency(sum(activeAdv.map((x) => x.balance))), hint: `${activeAdv.length} active advances` },
    ] },
    { id: 'inv', title: 'Inventory', icon: Boxes, tab: 'inventory', boxes: [
      { label: 'Items in stock', value: String(stockUnits), hint: `${products.length} catalogue items` },
      { label: 'Stock value', value: formatCurrency(stockValue), hint: 'At current selling price' },
      { label: 'Low stock', value: String(low), hint: '1–2 pieces left', tone: low ? 'red' : undefined },
      { label: 'Out of stock', value: String(out), hint: 'Items with no stock', tone: out ? 'red' : undefined },
    ] },
    { id: 'stones', title: 'Loose Stones & Certificates', icon: Gem, tab: 'inventory', boxes: [
      { label: 'Loose stones in stock', value: String(inStock.length), hint: `${sum(inStock.map((s) => s.carat)).toFixed(3)} ct` },
      { label: 'Loose stock value', value: formatCurrency(sum(inStock.map((s) => s.sellingPrice))), hint: 'At selling price' },
      { label: 'Certificates to verify', value: String(certPending), hint: 'Pending or uploaded', tone: certPending ? 'red' : undefined },
      { label: 'Certificates expired', value: String(certExpired), hint: `${data.certs.filter((c) => c.status === 'verified').length} verified`, tone: certExpired ? 'red' : undefined },
    ] },
    { id: 'cust', title: 'Customers', icon: Users, tab: 'customers', boxes: [
      { label: 'Customers', value: String(data.customers.length), hint: `${data.customers.filter((c) => c.email).length} with email` },
      { label: 'Birthdays this month', value: String(bdays), hint: 'Send wishes in Special Occasions' },
      { label: 'Anniversaries this month', value: String(annivs), hint: 'Send wishes in Special Occasions' },
      { label: 'No dates saved', value: String(noDates), hint: 'Add dates to send offers' },
    ] },
    { id: 'coupons', title: 'Coupons', icon: Tag, tab: 'coupons', boxes: [
      { label: 'Active coupons', value: String(activeCoupons), hint: `${data.coupons.length} created in all` },
      { label: 'Expired / off', value: String(data.coupons.length - activeCoupons), hint: 'Not usable at checkout' },
    ] },
  ]

  return (
    <div className="space-y-4">
      {sections.map((sec) => (
        <div key={sec.id}>
          <button type="button" onClick={() => onOpen(sec.tab)} className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-[#000000] hover:text-[var(--accent)] cursor-pointer">
            <sec.icon className="w-4 h-4 text-[var(--accent)]" /> {sec.title}
            {sec.id === 'stones' && <BadgeCheck className="w-3.5 h-3.5 text-[var(--accent)]" />}
          </button>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {sec.boxes.map((b) => (
              <button key={b.label} type="button" onClick={() => onOpen(sec.tab)} className="text-left bg-white border border-black/10 rounded-xl p-4 shadow-sm hover:border-black/25 transition-colors cursor-pointer">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">{b.label}</p>
                <p className={`mt-2 text-lg font-black break-words ${b.tone === 'red' ? 'text-rose-600' : b.tone === 'green' ? 'text-emerald-600' : 'text-[#000000]'}`}>{b.value}</p>
                <p className="mt-1 text-[10px] font-semibold text-[#000000]/60">{b.hint}</p>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
