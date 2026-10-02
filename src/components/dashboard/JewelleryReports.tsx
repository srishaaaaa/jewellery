import { useEffect, useMemo, useState } from 'react'
import { Download, Gem, Package, PiggyBank, TrendingUp } from 'lucide-react'
import { PAYMENT_LABELS, formatCurrency, formatInvoiceNo, normalizeStructuredOrderItem } from '../../lib/retail'
import { useProductStore } from '../../store/store'
import { useMetalRateStore } from '../../store/metalRateStore'
import { currentProductPrice } from '../../lib/jewelleryProduct'
import { csvDate, csvPhone, downloadCsv } from '../../lib/csv'
import { metalRateService } from '../../services/metalRateService'
import { schemeService } from '../../services/schemeService'
import {
  METAL_LABELS,
  SCHEME_STATUS_LABELS,
  metalLabel,
  STANDARD_PURITY,
  deriveSchemeStatus,
  formatWeight,
  localIsoDate,
  schemeRemaining,
  schemeTarget,
  type JewelleryScheme,
  type MetalRate,
} from '../../lib/jewellery'

type ReportOrder = {
  id: string
  invoice_no: string
  created_at: string
  status: string
  items: unknown
  total?: number
  payment_mode?: string
  payment_method?: string
  split_details?: Record<string, unknown> | null
  discount_amount?: number
  manual_discount_amount?: number
  scheme_amount_used?: number
  scheme_discount?: number
  advance_amount_used?: number
  exchange_amount?: number
}

type Bucket = { key: string; label: string; count: number; amount: number; gross?: number; net?: number }

const PAYMENT_GROUP: Record<string, string> = { cash: 'Cash', qr: 'UPI', upi: 'UPI', card: 'Card', bank: 'Bank Transfer', cheque: 'Cheque', credit: 'Credit (unpaid)' }
const paymentGroup = (mode: string) => PAYMENT_GROUP[mode] || PAYMENT_LABELS[mode] || mode || 'Other'
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
const localDay = (iso: string) => localIsoDate(new Date(iso))


const parseItems = (items: unknown): Record<string, unknown>[] => {
  if (Array.isArray(items)) return items.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
  if (typeof items === 'string') { try { const p = JSON.parse(items); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

const purityText = (p: string) => (p === STANDARD_PURITY ? 'Standard' : p || '—')

/** Jewellery sales, metal rate and scheme reports inside the Analytics Dashboard. */
export default function JewelleryReports({ orders, dateFrom, dateTo }: { orders: ReportOrder[]; dateFrom: string; dateTo: string }) {
  const [rates, setRates] = useState<MetalRate[]>([])
  const [schemes, setSchemes] = useState<JewelleryScheme[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      metalRateService.fetchHistory({ from: dateFrom, to: dateTo, limit: 1000 }),
      schemeService.list(),
    ])
      .then(([rateRows, schemeRows]) => { if (!cancelled) { setRates(rateRows); setSchemes(schemeRows); setError('') } })
      .catch((err) => { if (!cancelled) setError((err as Error).message) })
    return () => { cancelled = true }
  }, [dateFrom, dateTo])

  const sales = useMemo(() => {
    const rows: Array<{ date: string; invoice: string; name: string; qty: number; lineTotal: number; j: NonNullable<ReturnType<typeof normalizeStructuredOrderItem>['jewellery']> }> = []
    let schemeRedeemed = 0
    let discounts = 0
    const add = (map: Map<string, Bucket>, key: string, label: string, amount: number, count = 1, gross = 0, net = 0) => {
      const b = map.get(key) || { key, label, count: 0, amount: 0, gross: 0, net: 0 }
      b.count += count; b.amount += amount; b.gross = (b.gross || 0) + gross; b.net = (b.net || 0) + net
      map.set(key, b)
    }
    const daily = new Map<string, Bucket>()
    const monthly = new Map<string, Bucket>()
    const byCategory = new Map<string, Bucket>()
    const byMetal = new Map<string, Bucket>()
    const payments = new Map<string, Bucket>()
    for (const o of orders) {
      if (String(o.status).toLowerCase() === 'cancelled') continue
      if (dateFrom && o.created_at < `${dateFrom}T00:00:00`) continue
      if (dateTo && o.created_at > `${dateTo}T23:59:59`) continue
      const total = Number(o.total || 0)
      const day = localDay(o.created_at)
      add(daily, day, new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), total)
      add(monthly, day.slice(0, 7), monthLabel(day.slice(0, 7)), total)
      schemeRedeemed += Number(o.scheme_amount_used || 0)
      discounts += Number(o.discount_amount || 0) + Number(o.manual_discount_amount || 0) + Number(o.scheme_discount || 0)

      // Payments: scheme, advance and old gold settle part of the bill; the rest was paid at the counter.
      const scheme = Number(o.scheme_amount_used || 0)
      const advance = Number(o.advance_amount_used || 0)
      const exchange = Number(o.exchange_amount || 0)
      if (scheme > 0) add(payments, 'scheme', 'Savings Scheme', scheme)
      if (advance > 0) add(payments, 'advance', 'Advance Adjusted', advance)
      if (exchange > 0) add(payments, 'exchange', 'Old Gold Exchange', exchange)
      const counter = Math.max(0, total - scheme - advance - exchange)
      const mode = String(o.payment_mode || o.payment_method || '').trim().toLowerCase()
      const split = o.split_details && typeof o.split_details === 'object' ? Object.entries(o.split_details).filter(([, v]) => Number(v) > 0) : []
      if (mode === 'split' && split.length) {
        for (const [k, v] of split) add(payments, paymentGroup(k.toLowerCase()), paymentGroup(k.toLowerCase()), Number(v), 0)
        const first = paymentGroup(split[0][0].toLowerCase())
        payments.get(first)!.count += 1
      } else if (counter > 0 || !(scheme || advance || exchange)) {
        add(payments, paymentGroup(mode), paymentGroup(mode), counter)
      }

      for (const raw of parseItems(o.items)) {
        const item = normalizeStructuredOrderItem(raw)
        const category = item.category || (item.jewellery ? METAL_LABELS[item.jewellery.metal_type] : 'Other')
        add(byCategory, category, category, item.line_total, item.quantity)
        if (!item.jewellery) continue
        const j = item.jewellery
        add(byMetal, j.metal_type, METAL_LABELS[j.metal_type] || j.metal_type, item.line_total, item.quantity, j.gross_weight * item.quantity, j.net_weight * item.quantity)
        rows.push({ date: o.created_at, invoice: o.invoice_no, name: item.name, qty: item.quantity, lineTotal: item.line_total, j })
      }
    }
    const goldGrams = rows.filter((r) => r.j.metal_type === 'gold').reduce((s, r) => s + r.j.net_weight * r.qty, 0)
    const sorted = (m: Map<string, Bucket>) => [...m.values()].sort((a, b) => b.amount - a.amount)
    return {
      rows,
      value: rows.reduce((s, r) => s + r.lineTotal, 0),
      pieces: rows.reduce((s, r) => s + r.qty, 0),
      goldGrams,
      schemeRedeemed,
      daily: [...daily.values()].sort((a, b) => b.key.localeCompare(a.key)),
      monthly: [...monthly.values()].sort((a, b) => b.key.localeCompare(a.key)),
      byCategory: sorted(byCategory),
      byMetal: sorted(byMetal),
      payments: sorted(payments),
      charges: {
        making: rows.reduce((s, r) => s + r.j.making_amount * r.qty, 0),
        wastage: rows.reduce((s, r) => s + r.j.wastage_amount * r.qty, 0),
        stone: rows.reduce((s, r) => s + r.j.stone_charge * r.qty, 0),
        discounts,
      },
    }
  }, [orders, dateFrom, dateTo])

  const products = useProductStore((st) => st.products)
  const fetchProducts = useProductStore((st) => st.fetchProducts)
  const currentRates = useMetalRateStore((st) => st.rates)
  const ratesLoaded = useMetalRateStore((st) => st.loaded)
  const fetchRates = useMetalRateStore((st) => st.fetchRates)
  useEffect(() => {
    void fetchProducts()
    if (!ratesLoaded) void fetchRates()
  }, [fetchProducts, fetchRates, ratesLoaded])

  const inventory = useMemo(() => {
    const groups = new Map<string, { label: string; items: number; pieces: number; gross: number; net: number; value: number }>()
    for (const p of products) {
      if (!p.metalType) continue
      const pieces = Math.max(0, Number(p.stock || 0))
      const key = `${p.metalType}|${p.purity || ''}`
      const g = groups.get(key) || { label: metalLabel(p.metalType, p.purity), items: 0, pieces: 0, gross: 0, net: 0, value: 0 }
      g.items += 1
      g.pieces += pieces
      g.gross += (p.grossWeight || 0) * pieces
      g.net += (p.netWeight || 0) * pieces
      g.value += (currentProductPrice(p, currentRates) ?? p.price ?? 0) * pieces
      groups.set(key, g)
    }
    const list = [...groups.values()].sort((a, b) => b.value - a.value)
    return {
      list,
      totals: list.reduce((t, g) => ({ items: t.items + g.items, pieces: t.pieces + g.pieces, gross: t.gross + g.gross, net: t.net + g.net, value: t.value + g.value }), { items: 0, pieces: 0, gross: 0, net: 0, value: 0 }),
    }
  }, [products, currentRates])

  const period = `${dateFrom || 'start'}_to_${dateTo || localIsoDate()}`

  const exportSales = () => downloadCsv(`jewellery_sales_${period}.csv`, [
    ['Date', 'Invoice', 'Item', 'Metal', 'Purity', 'Qty', 'Gross Wt (g)', 'Stone Wt (g)', 'Net Wt (g)', 'Rate / g (INR)', 'Metal Value (INR)', 'Making (INR)', 'Wastage (INR)', 'Stone (INR)', 'Final Amount (INR)', 'HUID'],
    ...sales.rows.map((r) => [
      csvDate(r.date, true), formatInvoiceNo(r.invoice), r.name, METAL_LABELS[r.j.metal_type], purityText(r.j.purity), r.qty,
      r.j.gross_weight.toFixed(3), r.j.stone_weight.toFixed(3), r.j.net_weight.toFixed(3), r.j.rate_per_gram.toFixed(2),
      r.j.metal_value.toFixed(2), r.j.making_amount.toFixed(2), r.j.wastage_amount.toFixed(2), r.j.stone_charge.toFixed(2), r.lineTotal.toFixed(2), r.j.huid || '',
    ]),
  ])
  const exportBuckets = (name: string, title: string, list: Bucket[], weights = false) => downloadCsv(`${name}_${period}.csv`, [
    weights ? [title, 'Pieces', 'Gross Wt (g)', 'Net Wt (g)', 'Amount (INR)'] : [title, 'Count', 'Amount (INR)'],
    ...list.map((b) => weights
      ? [b.label, Math.round(b.count), (b.gross || 0).toFixed(3), (b.net || 0).toFixed(3), b.amount.toFixed(2)]
      : [b.label, Math.round(b.count), b.amount.toFixed(2)]),
  ])
  const exportInventory = () => downloadCsv(`inventory_value_${localIsoDate()}.csv`, [
    ['Metal / Purity', 'Items', 'Pieces in Stock', 'Gross Wt (g)', 'Net Wt (g)', 'Estimated Value (INR)'],
    ...inventory.list.map((g) => [g.label, g.items, g.pieces, g.gross.toFixed(3), g.net.toFixed(3), g.value.toFixed(2)]),
  ])
  const exportRates = () => downloadCsv(`metal_rate_report_${period}.csv`, [
    ['Date & Time', 'Metal', 'Purity', 'Rate / g (INR)', 'Updated By'],
    ...rates.map((r) => [csvDate(r.effectiveFrom, true), METAL_LABELS[r.metalType], purityText(r.purity), r.ratePerGram.toFixed(2), r.createdBy]),
  ])
  const exportSchemes = () => downloadCsv(`scheme_report_${localIsoDate()}.csv`, [
    ['Customer', 'Phone', 'Scheme ID', 'Scheme', 'Amount (INR)', 'Paid (INR)', 'Pending (INR)', 'Status'],
    ...schemes.map((s) => [s.customerName, csvPhone(s.phone), s.schemeNumber, s.schemeName, schemeTarget(s).toFixed(2), s.totalPaid.toFixed(2), schemeRemaining(s).toFixed(2), SCHEME_STATUS_LABELS[deriveSchemeStatus(s)]]),
  ])

  const cards = [
    { label: 'Jewellery Sales', value: formatCurrency(sales.value), icon: <TrendingUp size={18} />, from: 'from-emerald-500 to-teal-600' },
    { label: 'Pieces Sold', value: String(Math.round(sales.pieces)), icon: <Package size={18} />, from: 'from-blue-500 to-indigo-600' },
    { label: 'Gold Sold (Net)', value: formatWeight(sales.goldGrams), icon: <Gem size={18} />, from: 'from-amber-500 to-orange-600' },
    { label: 'Paid from Schemes', value: formatCurrency(sales.schemeRedeemed), icon: <PiggyBank size={18} />, from: 'from-violet-500 to-purple-600' },
  ]

  const exportButton = (onClick: () => void, disabled: boolean) => (
    <button onClick={onClick} disabled={disabled} className="flex items-center gap-1.5 self-start rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 cursor-pointer">
      <Download size={13} /> Export CSV
    </button>
  )

  const th = 'px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-[#6B7280] whitespace-nowrap'
  const td = 'px-3 py-2.5 text-[12px] text-[#111111] whitespace-nowrap'

  const bucketTable = (title: string, subtitle: string, keyHeader: string, countHeader: string, list: Bucket[], onExport: () => void) => (
    <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-[15px] font-bold text-[#111111]">{title}</h3>
          <p className="text-[12px] text-[#6B7280]">{subtitle}</p>
        </div>
        {exportButton(onExport, !list.length)}
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]/40 max-h-[340px] overflow-y-auto">
        <table className="w-full text-left">
          <thead className="bg-[#F9FAFB] sticky top-0"><tr>{[keyHeader, countHeader, 'Amount'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#E5E7EB]/40">
            {list.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-8 text-center text-[12px] text-[#6B7280]">No sales in this period.</td></tr>
            ) : list.map((b) => (
              <tr key={b.key}>
                <td className={`${td} font-bold`}>{b.label}</td>
                <td className={td}>{Math.round(b.count)}</td>
                <td className={`${td} font-black text-emerald-700`}>{formatCurrency(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className={`relative overflow-hidden rounded-2xl p-5 shadow-lg border border-white/20 bg-gradient-to-br ${card.from}`}>
            <div className="absolute inset-0 bg-gradient-to-tl from-white/30 via-white/10 to-transparent" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] uppercase font-black text-white/80 tracking-wider">{card.label}</p>
                <div className="w-9 h-9 rounded-xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white shadow-sm">{card.icon}</div>
              </div>
              <p className="text-[15px] sm:text-[22px] font-extrabold text-white drop-shadow-sm break-words">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {bucketTable('Daily Sales', 'Bill totals by day', 'Date', 'Bills', sales.daily, () => exportBuckets('daily_sales', 'Date', sales.daily))}
        {bucketTable('Monthly Sales', 'Bill totals by month', 'Month', 'Bills', sales.monthly, () => exportBuckets('monthly_sales', 'Month', sales.monthly))}
        {bucketTable('Category-wise Sales', 'Every line billed, by category', 'Category', 'Qty', sales.byCategory, () => exportBuckets('category_sales', 'Category', sales.byCategory))}
        {bucketTable('Payment Methods', 'How bills were settled', 'Method', 'Bills', sales.payments, () => exportBuckets('payment_methods', 'Method', sales.payments))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-[15px] font-bold text-[#111111]">Metal-wise Sales & Weight</h3>
              <p className="text-[12px] text-[#6B7280]">Gold, silver and platinum sold in the period</p>
            </div>
            {exportButton(() => exportBuckets('metal_sales', 'Metal', sales.byMetal, true), !sales.byMetal.length)}
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]/40">
            <table className="w-full text-left">
              <thead className="bg-[#F9FAFB]"><tr>{['Metal', 'Pieces', 'Gross Wt', 'Net Wt', 'Amount'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]/40">
                {sales.byMetal.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-[12px] text-[#6B7280]">No jewellery sales in this period.</td></tr>
                ) : sales.byMetal.map((b) => (
                  <tr key={b.key}>
                    <td className={`${td} font-bold`}>{b.label}</td>
                    <td className={td}>{Math.round(b.count)}</td>
                    <td className={td}>{formatWeight(b.gross || 0)}</td>
                    <td className={td}>{formatWeight(b.net || 0)}</td>
                    <td className={`${td} font-black text-emerald-700`}>{formatCurrency(b.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm min-w-0">
          <div className="mb-4">
            <h3 className="text-[15px] font-bold text-[#111111]">Charges & Discounts</h3>
            <p className="text-[12px] text-[#6B7280]">Making, wastage and stone charges billed, and discounts given</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {([
              ['Making Charges', sales.charges.making],
              ['Wastage', sales.charges.wastage],
              ['Stone Charges', sales.charges.stone],
              ['Discounts', sales.charges.discounts],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[#E5E7EB]/60 bg-[#F9FAFB] p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#6B7280]">{label}</p>
                <p className={`mt-1 text-[17px] font-extrabold ${label === 'Discounts' ? 'text-red-600' : 'text-[#111111]'}`}>{formatCurrency(value)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[15px] font-bold text-[#111111]">Inventory Value</h3>
            <p className="text-[12px] text-[#6B7280]">Jewellery in stock now, valued at today's metal rates</p>
          </div>
          {exportButton(exportInventory, !inventory.list.length)}
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]/40">
          <table className="w-full text-left">
            <thead className="bg-[#F9FAFB]"><tr>{['Metal / Purity', 'Items', 'Pieces', 'Gross Wt', 'Net Wt', 'Estimated Value'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#E5E7EB]/40">
              {inventory.list.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-[12px] text-[#6B7280]">No jewellery items in the catalogue.</td></tr>
              ) : <>
                {inventory.list.map((g) => (
                  <tr key={g.label}>
                    <td className={`${td} font-bold`}>{g.label}</td>
                    <td className={td}>{g.items}</td>
                    <td className={td}>{g.pieces}</td>
                    <td className={td}>{formatWeight(g.gross)}</td>
                    <td className={td}>{formatWeight(g.net)}</td>
                    <td className={`${td} font-black text-emerald-700`}>{formatCurrency(g.value)}</td>
                  </tr>
                ))}
                <tr className="bg-[#F9FAFB]">
                  <td className={`${td} font-black`}>Total</td>
                  <td className={`${td} font-black`}>{inventory.totals.items}</td>
                  <td className={`${td} font-black`}>{inventory.totals.pieces}</td>
                  <td className={`${td} font-black`}>{formatWeight(inventory.totals.gross)}</td>
                  <td className={`${td} font-black`}>{formatWeight(inventory.totals.net)}</td>
                  <td className={`${td} font-black text-emerald-700`}>{formatCurrency(inventory.totals.value)}</td>
                </tr>
              </>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[15px] font-bold text-[#111111]">Jewellery Sales</h3>
            <p className="text-[12px] text-[#6B7280]">Every jewellery line billed in the selected period, with the rate and charges used on the invoice</p>
          </div>
          {exportButton(exportSales, !sales.rows.length)}
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]/40">
          <table className="w-full text-left">
            <thead className="bg-[#F9FAFB]"><tr>{['Date', 'Invoice', 'Item', 'Metal', 'Weight', 'Rate', 'Making', 'Wastage', 'Final Amount'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-[#E5E7EB]/40">
              {sales.rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-[12px] text-[#6B7280]">No jewellery sales in this period.</td></tr>
              ) : sales.rows.slice(0, 300).map((r, idx) => (
                <tr key={`${r.invoice}-${idx}`}>
                  <td className={td}>{new Date(r.date).toLocaleDateString('en-IN')}</td>
                  <td className={`${td} font-bold`}>{formatInvoiceNo(r.invoice)}</td>
                  <td className={`${td} font-bold`}>{r.name}{r.qty > 1 ? ` × ${r.qty}` : ''}</td>
                  <td className={td}>{METAL_LABELS[r.j.metal_type]} {r.j.purity !== STANDARD_PURITY ? r.j.purity : ''}</td>
                  <td className={td}>{formatWeight(r.j.net_weight)}</td>
                  <td className={td}>{r.j.rate_per_gram > 0 ? `${formatCurrency(r.j.rate_per_gram)}/g` : '—'}</td>
                  <td className={td}>{formatCurrency(r.j.making_amount)}</td>
                  <td className={td}>{formatCurrency(r.j.wastage_amount)}</td>
                  <td className={`${td} font-black text-emerald-700`}>{formatCurrency(r.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-[15px] font-bold text-[#111111]">Metal Rate Report</h3>
              <p className="text-[12px] text-[#6B7280]">Rates entered in the selected period</p>
            </div>
            {exportButton(exportRates, !rates.length)}
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]/40 max-h-[420px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-[#F9FAFB] sticky top-0"><tr>{['Date', 'Metal', 'Purity', 'Rate / g'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]/40">
                {rates.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-8 text-center text-[12px] text-[#6B7280]">No rates in this period.</td></tr>
                ) : rates.map((r) => (
                  <tr key={r.id}>
                    <td className={td}>{new Date(r.effectiveFrom).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className={`${td} font-bold`}>{METAL_LABELS[r.metalType]}</td>
                    <td className={td}>{purityText(r.purity)}</td>
                    <td className={`${td} font-black`}>{formatCurrency(r.ratePerGram)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E7EB]/30 p-5 shadow-sm min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-[15px] font-bold text-[#111111]">Scheme Report</h3>
              <p className="text-[12px] text-[#6B7280]">All savings schemes and their collection status</p>
            </div>
            {exportButton(exportSchemes, !schemes.length)}
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]/40 max-h-[420px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="bg-[#F9FAFB] sticky top-0"><tr>{['Customer', 'Scheme', 'Amount', 'Paid', 'Pending', 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]/40">
                {schemes.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-[12px] text-[#6B7280]">No schemes yet.</td></tr>
                ) : schemes.map((s) => (
                  <tr key={s.id}>
                    <td className={`${td} font-bold`}>{s.customerName || s.phone}</td>
                    <td className={td}>{s.schemeNumber}</td>
                    <td className={td}>{formatCurrency(schemeTarget(s))}</td>
                    <td className={`${td} text-emerald-700 font-bold`}>{formatCurrency(s.totalPaid)}</td>
                    <td className={`${td} text-red-600 font-bold`}>{formatCurrency(schemeRemaining(s))}</td>
                    <td className={td}>{SCHEME_STATUS_LABELS[deriveSchemeStatus(s)]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
