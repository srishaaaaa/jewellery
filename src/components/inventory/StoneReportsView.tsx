import { useEffect, useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, normalizeStructuredOrderItem, toNumber } from '../../lib/retail'
import { csvDate, downloadCsv } from '../../lib/csv'
import { getErrorMessage } from '../../lib/errorMessage'
import { METAL_LABELS, normalizeStoneDetails, stoneLineValue, stoneTotals, STONE_KIND_LABELS, isDiamondKind } from '../../lib/jewellery'
import { useProductStore } from '../../store/store'
import { PeriodBar } from '../filters/PageFilters'
import { periodRange, type PeriodPreset } from '../filters/filterStyles'
import {
  CATEGORY_LABELS, CERT_STATUS_LABELS, LOOSE_STATUS_LABELS, certificateService, currentRates, findStoneRate, looseStoneService,
  materialRateService, overrideService, type GemCertificate, type LooseStone, type MaterialRate, type PriceOverride,
} from '../../services/stoneRateService'

type SaleRow = { day: string; invoice: string; item: string; material: string; amount: number }
const Card = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-xs font-black uppercase tracking-wider">{title}</h3>{right}</div>
    {children}
  </div>
)
const csvBtn = 'rounded-lg border border-black/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider hover:bg-black/5 cursor-pointer'

/** Material-wise sales, missing / overridden stone prices, loose stock, certificates and rate history — from the saved records. */
export default function StoneReportsView() {
  const products = useProductStore((s) => s.products)
  const [period, setPeriod] = useState<PeriodPreset>('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const range = periodRange(period, from, to)
  const [sales, setSales] = useState<SaleRow[]>([])
  const [rates, setRates] = useState<MaterialRate[]>([])
  const [overrides, setOverrides] = useState<PriceOverride[]>([])
  const [stones, setStones] = useState<LooseStone[]>([])
  const [certs, setCerts] = useState<GemCertificate[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    Promise.all([
      materialRateService.list().catch(() => [] as MaterialRate[]), overrideService.list().catch(() => [] as PriceOverride[]),
      looseStoneService.list().catch(() => [] as LooseStone[]), certificateService.list().catch(() => [] as GemCertificate[]),
    ]).then(([r, o, s, c]) => { if (live) { setRates(r); setOverrides(o); setStones(s); setCerts(c) } })
    return () => { live = false }
  }, [])

  // Sales by material, from the prices frozen on each bill line (never today's rates)
  useEffect(() => {
    let live = true
    let q = supabase.from('orders').select('created_at, invoice_no, items, status').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(5000)
    if (range.from) q = q.gte('created_at', `${range.from}T00:00:00`)
    if (range.to) q = q.lte('created_at', `${range.to}T23:59:59`)
    q.then(({ data, error: err }) => {
      if (!live) return
      if (err) { setError(getErrorMessage(err, 'Unable to load sales')); return }
      const rows: SaleRow[] = []
      for (const o of data || []) {
        const items = Array.isArray(o.items) ? o.items as Array<Record<string, unknown>> : []
        for (const raw of items) {
          const it = normalizeStructuredOrderItem(raw)
          const j = it.jewellery
          const base = { day: String(o.created_at).slice(0, 10), invoice: String(o.invoice_no || ''), item: it.name }
          if (!j) { rows.push({ ...base, material: 'Other items', amount: toNumber(it.line_total, 0) }); continue }
          const qty = Math.max(1, toNumber(it.quantity, 1))
          if (j.metal_value > 0) rows.push({ ...base, material: `${METAL_LABELS[j.metal_type] || j.metal_type} metal`, amount: j.metal_value * qty })
          const lines = normalizeStoneDetails(j.stones) || []
          if (lines.length) {
            for (const d of lines) {
              const name = isDiamondKind(d.kind) || d.kind === 'simulant' ? STONE_KIND_LABELS[d.kind] : d.kind === 'gemstone' ? (d.type || 'Gemstone') : d.kind === 'pearl' ? 'Pearls' : d.kind === 'traditional' ? (d.type || 'Traditional') : 'Other stones'
              rows.push({ ...base, material: name, amount: stoneLineValue(d) * qty })
            }
          } else if (j.stone_charge > 0) rows.push({ ...base, material: 'Stones (no details)', amount: j.stone_charge * qty })
          const labour = (j.making_amount || 0) + (j.wastage_amount || 0) + (j.other_charge || 0)
          if (labour > 0) rows.push({ ...base, material: 'Making / wastage / other', amount: labour * qty })
        }
      }
      setSales(rows)
    })
    return () => { live = false }
  }, [range.from, range.to])

  const byMaterial = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of sales) m.set(r.material, (m.get(r.material) || 0) + r.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [sales])
  const salesTotal = byMaterial.reduce((a, [, v]) => a + v, 0)

  // Items whose stones have no price, or a price that no longer matches any list rate
  const missing = useMemo(() => {
    const out: Array<{ item: string; stone: string; problem: string }> = []
    for (const p of products) {
      const lines = p.stoneDetails || []
      lines.forEach((d, i) => {
        const label = `${i + 1}. ${d.type || STONE_KIND_LABELS[d.kind]}${d.carat ? ` ${d.carat} ct` : ''}`
        if (stoneLineValue(d) <= 0) out.push({ item: p.name, stone: label, problem: 'No price' })
        else if (d.rateSource !== 'list' && d.rateSource !== 'override' && d.kind !== 'other') {
          const m = findStoneRate(d, rates)
          if (!m.ok) out.push({ item: p.name, stone: label, problem: 'No matching price-list rate (priced by hand)' })
        }
      })
    }
    return out
  }, [products, rates])

  const stockByStatus = (Object.keys(LOOSE_STATUS_LABELS) as Array<keyof typeof LOOSE_STATUS_LABELS>).map((s) => {
    const list = stones.filter((x) => x.status === s)
    return [LOOSE_STATUS_LABELS[s], list.length, list.reduce((a, x) => a + x.carat, 0)] as const
  })
  const today = new Date().toISOString().slice(0, 10)
  const certStatus = (c: GemCertificate) => (c.expiryDate && c.expiryDate < today && c.status !== 'rejected' ? 'expired' : c.status)
  const rateCount = currentRates(rates).filter((r) => r.status === 'active').length
  const stoneValueInStock = stoneTotals(products.flatMap((p) => (p.stoneDetails || []).map((d) => ({ ...d, value: stoneLineValue(d) * Math.max(0, Number(p.stock) || 0), priceBasis: 'total' as const })))).value

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3 text-[28px] font-black tracking-tight"><BarChart3 className="w-7 h-7 text-[var(--accent)]" /> Stone &amp; Material Reports</h2>
          <p className="mt-1 text-xs font-semibold">Sales use the prices saved on each bill, so they never change when rates change.</p>
        </div>
        <PeriodBar preset={period} from={range.from} to={range.to} onPreset={setPeriod}
          onFrom={(v) => { setFrom(v); setTo(range.to); setPeriod('custom') }} onTo={(v) => { setTo(v); setFrom(range.from); setPeriod('custom') }}
          onExport={() => downloadCsv(`material-sales-${today}`, [['Date', 'Invoice', 'Item', 'Material', 'Amount'], ...sales.map((r) => [r.day, r.invoice, r.item, r.material, r.amount.toFixed(2)])])} />
      </div>
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Sales in period', formatCurrency(salesTotal)], ['Active stone rates', String(rateCount)], ['Stones needing a price', String(missing.length)], ['Stone value in stock', formatCurrency(stoneValueInStock)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[0.15em]">{k}</p><p className="mt-2 text-lg font-black whitespace-nowrap">{v}</p></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sales by material">
          {byMaterial.length === 0 ? <p className="text-xs text-[#000000]/60">No sales in this period.</p> : byMaterial.map(([k, v]) => (
            <div key={k} className="mb-2">
              <div className="flex justify-between text-xs font-bold"><span>{k}</span><span>{formatCurrency(v)}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-black/5"><div className="h-1.5 rounded-full bg-[var(--accent)]" style={{ width: `${salesTotal ? Math.max(2, (v / salesTotal) * 100) : 0}%` }} /></div>
            </div>
          ))}
        </Card>

        <Card title="Missing / unmatched stone rates" right={<button type="button" className={csvBtn} onClick={() => downloadCsv(`missing-stone-rates-${today}`, [['Item', 'Stone', 'Problem'], ...missing.map((m) => [m.item, m.stone, m.problem])])}>CSV</button>}>
          {missing.length === 0 ? <p className="text-xs font-semibold text-emerald-700">Every stone on every item has a price.</p> : (
            <div className="max-h-72 overflow-y-auto divide-y divide-black/5 text-xs">
              {missing.map((m, i) => <div key={i} className="py-2"><p className="font-bold">{m.item}</p><p className="text-[#000000]/70">{m.stone} — <span className={m.problem === 'No price' ? 'text-red-600 font-bold' : 'text-amber-700 font-bold'}>{m.problem}</span></p></div>)}
            </div>
          )}
        </Card>

        <Card title="Manual price overrides" right={<button type="button" className={csvBtn} onClick={() => downloadCsv(`stone-price-overrides-${today}`, [['When', 'Item', 'Stone', 'List price', 'Price used', 'Reason', 'By'], ...overrides.map((o) => [csvDate(o.createdAt, true), o.productName, o.stoneLabel, o.listPrice ?? '', o.overridePrice, o.reason, o.overriddenBy])])}>CSV</button>}>
          {overrides.length === 0 ? <p className="text-xs text-[#000000]/60">No negotiated prices recorded.</p> : (
            <div className="max-h-72 overflow-y-auto divide-y divide-black/5 text-xs">
              {overrides.map((o) => <div key={o.id} className="py-2"><div className="flex justify-between gap-2 font-bold"><span>{o.productName}</span><span>{o.listPrice != null ? `${formatCurrency(o.listPrice)} → ` : ''}{formatCurrency(o.overridePrice)}</span></div><p className="text-[#000000]/70">{o.stoneLabel} · {o.reason} · {o.overriddenBy}, {new Date(o.createdAt).toLocaleDateString('en-IN')}</p></div>)}
            </div>
          )}
        </Card>

        <Card title="Loose stone stock">
          <div className="divide-y divide-black/5 text-xs">
            {stockByStatus.map(([label, count, carat]) => <div key={label} className="flex justify-between py-2 font-bold"><span>{label}</span><span>{count} • {carat.toFixed(3)} ct</span></div>)}
          </div>
          <p className="mt-3 text-[11px] font-semibold text-[#000000]/60">By category: {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((c) => `${CATEGORY_LABELS[c]} ${stones.filter((s) => s.category === c && (s.status === 'available' || s.status === 'reserved')).length}`).join(' · ')}</p>
        </Card>

        <Card title="Certificate status">
          <div className="divide-y divide-black/5 text-xs">
            {(Object.keys(CERT_STATUS_LABELS) as Array<keyof typeof CERT_STATUS_LABELS>).map((s) => <div key={s} className="flex justify-between py-2 font-bold"><span>{CERT_STATUS_LABELS[s]}</span><span>{certs.filter((c) => certStatus(c) === s).length}</span></div>)}
          </div>
        </Card>

        <Card title="Stone rate changes (latest 10)">
          {rates.length === 0 ? <p className="text-xs text-[#000000]/60">No stone rates yet.</p> : (
            <div className="divide-y divide-black/5 text-xs">
              {rates.slice(0, 10).map((r) => <div key={r.id} className="flex justify-between gap-2 py-2"><span className="font-bold">{r.name}{r.variety ? ` · ${r.variety}` : ''} <span className="font-semibold text-[#000000]/60">({CATEGORY_LABELS[r.category]})</span></span><span className="font-black whitespace-nowrap">{formatCurrency(r.price)}</span></div>)}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
