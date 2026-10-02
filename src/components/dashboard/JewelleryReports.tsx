import { useEffect, useMemo, useState } from 'react'
import { Download, Gem, Package, PiggyBank, TrendingUp } from 'lucide-react'
import { formatCurrency, formatInvoiceNo, normalizeStructuredOrderItem } from '../../lib/retail'
import { csvDate, csvPhone, downloadCsv } from '../../lib/csv'
import { metalRateService } from '../../services/metalRateService'
import { schemeService } from '../../services/schemeService'
import {
  METAL_LABELS,
  SCHEME_STATUS_LABELS,
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
  scheme_amount_used?: number
}

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
    for (const o of orders) {
      if (String(o.status).toLowerCase() === 'cancelled') continue
      if (dateFrom && o.created_at < `${dateFrom}T00:00:00`) continue
      if (dateTo && o.created_at > `${dateTo}T23:59:59`) continue
      schemeRedeemed += Number(o.scheme_amount_used || 0)
      for (const raw of parseItems(o.items)) {
        const item = normalizeStructuredOrderItem(raw)
        if (!item.jewellery) continue
        rows.push({ date: o.created_at, invoice: o.invoice_no, name: item.name, qty: item.quantity, lineTotal: item.line_total, j: item.jewellery })
      }
    }
    const goldGrams = rows.filter((r) => r.j.metal_type === 'gold').reduce((s, r) => s + r.j.net_weight * r.qty, 0)
    return {
      rows,
      value: rows.reduce((s, r) => s + r.lineTotal, 0),
      pieces: rows.reduce((s, r) => s + r.qty, 0),
      goldGrams,
      schemeRedeemed,
    }
  }, [orders, dateFrom, dateTo])

  const period = `${dateFrom || 'start'}_to_${dateTo || localIsoDate()}`

  const exportSales = () => downloadCsv(`jewellery_sales_${period}.csv`, [
    ['Date', 'Invoice', 'Item', 'Metal', 'Purity', 'Qty', 'Gross Wt (g)', 'Stone Wt (g)', 'Net Wt (g)', 'Rate / g (INR)', 'Metal Value (INR)', 'Making (INR)', 'Wastage (INR)', 'Stone (INR)', 'Final Amount (INR)', 'HUID'],
    ...sales.rows.map((r) => [
      csvDate(r.date, true), formatInvoiceNo(r.invoice), r.name, METAL_LABELS[r.j.metal_type], purityText(r.j.purity), r.qty,
      r.j.gross_weight.toFixed(3), r.j.stone_weight.toFixed(3), r.j.net_weight.toFixed(3), r.j.rate_per_gram.toFixed(2),
      r.j.metal_value.toFixed(2), r.j.making_amount.toFixed(2), r.j.wastage_amount.toFixed(2), r.j.stone_charge.toFixed(2), r.lineTotal.toFixed(2), r.j.huid || '',
    ]),
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
