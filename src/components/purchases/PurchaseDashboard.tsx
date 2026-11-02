import { useMemo, useState, type ReactElement } from 'react'
import { AlertTriangle, CalendarClock, Coins, Scale, Truck, Wallet } from 'lucide-react'
import type { Purchase, Supplier } from '../../services/purchaseService'
import { formatCurrency } from '../../lib/retail'
import { formatWeight, localIsoDate, metalLabel, normalizeMetalType } from '../../lib/jewellery'
import { csvDate, downloadCsv } from '../../lib/csv'
import { PeriodBar } from '../filters/PageFilters'
import { inRange, periodRange, type PeriodPreset } from '../filters/filterStyles'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const short = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`)
const card = 'bg-white border border-black/10 rounded-xl p-5 shadow-sm'
const title = 'text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2 mb-4'

/** Purchases & Suppliers dashboard: spend, payments, money owed, supplier and metal split, dues. */
export function PurchaseDashboard({ purchases, suppliers, onOpen }: { purchases: Purchase[]; suppliers: Supplier[]; onOpen: (p: Purchase) => void }) {
  const [preset, setPreset] = useState<PeriodPreset>('year')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const range = periodRange(preset, from, to)
  const today = localIsoDate()
  const names = useMemo(() => new Map(suppliers.map(s => [s.id, s.name])), [suppliers])
  const inPeriod = useMemo(() => purchases.filter(p => inRange(p.purchaseDate, range.from, range.to)), [purchases, range.from, range.to])

  const kpi = useMemo(() => {
    const total = inPeriod.reduce((s, p) => s + p.totalAmount, 0)
    const paid = inPeriod.reduce((s, p) => s + p.amountPaid, 0)
    const owed = purchases.reduce((s, p) => s + p.due, 0)
    const grams = inPeriod.reduce((s, p) => s + p.items.reduce((g, i) => g + i.net_weight * (i.quantity || 1), 0), 0)
    const weekEnd = new Date(`${today}T00:00:00`); weekEnd.setDate(weekEnd.getDate() + 7)
    const week = localIsoDate(weekEnd)
    const dueSoon = purchases.filter(p => p.due > 0 && p.dueDate && p.dueDate >= today && p.dueDate <= week)
    const overdue = purchases.filter(p => p.due > 0 && p.dueDate && p.dueDate < today)
    return { total, paid, owed, grams, count: inPeriod.length, dueSoon, overdue }
  }, [inPeriod, purchases, today])

  const year = Number((range.to || today).slice(0, 4))
  const monthly = useMemo(() => {
    const t = Array(12).fill(0) as number[]
    for (const p of purchases) if (Number(p.purchaseDate.slice(0, 4)) === year) t[Number(p.purchaseDate.slice(5, 7)) - 1] += p.totalAmount
    return t
  }, [purchases, year])
  const monthlyMax = Math.max(1, ...monthly)

  const bySupplier = useMemo(() => {
    const m = new Map<string, { total: number; owed: number; count: number }>()
    for (const p of inPeriod) { const r = m.get(p.supplierId) || { total: 0, owed: 0, count: 0 }; r.total += p.totalAmount; r.owed += p.due; r.count++; m.set(p.supplierId, r) }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6)
  }, [inPeriod])
  const supplierMax = Math.max(1, ...bySupplier.map(([, r]) => r.total))

  const byMetal = useMemo(() => {
    const m = new Map<string, { grams: number; amount: number }>()
    for (const p of inPeriod) for (const i of p.items) {
      const metal = normalizeMetalType(i.metal_type)
      const key = metal ? metalLabel(metal, i.purity) : (i.metal_type || 'Other')
      const r = m.get(key) || { grams: 0, amount: 0 }; r.grams += i.net_weight * (i.quantity || 1); r.amount += i.amount; m.set(key, r)
    }
    return [...m.entries()].sort((a, b) => b[1].amount - a[1].amount)
  }, [inPeriod])

  const dues = useMemo(() => purchases.filter(p => p.due > 0).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))).slice(0, 8), [purchases])

  const exportCsv = () => downloadCsv(`purchases-summary-${today}.csv`, [
    ['No', 'Date', 'Supplier', 'Bill', 'Net Weight (g)', 'Total', 'Paid', 'Owed', 'Due Date'],
    ...inPeriod.map(p => [p.purchaseNumber, csvDate(p.purchaseDate), names.get(p.supplierId) || '', p.supplierInvoiceNo, p.items.reduce((g, i) => g + i.net_weight * (i.quantity || 1), 0).toFixed(3), p.totalAmount.toFixed(2), p.amountPaid.toFixed(2), p.due.toFixed(2), p.dueDate || '']),
  ])

  const kpis: Array<[string, string, string, ReactElement, string]> = [
    ['Purchased', formatCurrency(kpi.total), `${kpi.count} purchase bill${kpi.count === 1 ? '' : 's'}`, <Truck key="t" className="w-4 h-4 text-white" />, 'accent'],
    ['Paid to Suppliers', formatCurrency(kpi.paid), 'Paid against these bills', <Coins key="c" className="w-4 h-4 text-[#16A34A]" />, 'bg-[#DCFCE7]'],
    ['Still Owed', formatCurrency(kpi.owed), 'All open supplier balances', <Wallet key="w" className="w-4 h-4 text-[#DC2626]" />, 'bg-[#FEE2E2]'],
    ['Metal Bought', formatWeight(kpi.grams), 'Net weight in this period', <Scale key="s" className="w-4 h-4 text-[#B45309]" />, 'bg-[#FEF3C7]'],
    ['Due This Week', String(kpi.dueSoon.length), formatCurrency(kpi.dueSoon.reduce((s, p) => s + p.due, 0)), <CalendarClock key="d" className="w-4 h-4 text-[#2563EB]" />, 'bg-[#DBEAFE]'],
    ['Overdue', String(kpi.overdue.length), formatCurrency(kpi.overdue.reduce((s, p) => s + p.due, 0)), <AlertTriangle key="o" className="w-4 h-4 text-[#DC2626]" />, 'bg-[#FEE2E2]'],
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h3 className="text-lg font-black text-[#000000] tracking-tight">Purchase Dashboard</h3>
          <p className="text-xs font-semibold text-[#000000]/70">Supplier spend, payments, balances and metal bought.</p>
        </div>
        <PeriodBar preset={preset} from={range.from} to={range.to} onPreset={setPreset}
          onFrom={v => { setFrom(v); setTo(range.to); setPreset('custom') }} onTo={v => { setTo(v); setFrom(range.from); setPreset('custom') }}
          onExport={exportCsv} exportDisabled={inPeriod.length === 0} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map(([label, value, hint, icon, tone]) => tone === 'accent' ? (
          <div key={label} className="rounded-xl p-4 shadow-sm text-white bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_55%,#000000)]">
            <div className="flex justify-between items-start"><span className="text-[10px] font-bold uppercase tracking-wider text-white/90">{label}</span><span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">{icon}</span></div>
            <p className="mt-2 text-lg font-black whitespace-nowrap overflow-hidden text-ellipsis" title={String(value)}>{value}</p>
            <p className="mt-1 text-[10px] font-semibold text-white/80">{hint}</p>
          </div>
        ) : (
          <div key={label} className="bg-white border border-black/10 rounded-xl p-4 shadow-sm">
            <div className="flex justify-between items-start"><span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">{label}</span><span className={`w-7 h-7 rounded-full ${tone} flex items-center justify-center`}>{icon}</span></div>
            <p className="mt-2 text-lg font-black text-[#000000] whitespace-nowrap overflow-hidden text-ellipsis" title={String(value)}>{value}</p>
            <p className="mt-1 text-[10px] font-semibold text-[#000000]/60">{hint}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className={`lg:col-span-8 ${card} flex flex-col min-h-[280px]`}>
          <h3 className="font-bold text-[#000000] text-sm mb-2 flex items-center">Purchases This Year <span className="text-[var(--accent)] font-black ml-1.5">{year}</span></h3>
          <span className="text-xl font-black text-[#000000]">{formatCurrency(monthly.reduce((a, b) => a + b, 0))}</span>
          <div className="flex-1 overflow-x-auto pb-2">
            <div className="flex items-end justify-between px-2 gap-1 mt-4 min-w-[480px] h-[170px] pt-8">
              {monthly.map((v, i) => (
                <div key={MONTHS[i]} className="flex flex-col items-center gap-1.5 w-full" title={`${MONTHS[i]}: ${formatCurrency(v)}`}>
                  <span className="text-[8px] font-black text-[var(--accent)] h-3 flex items-end">{v > 0 ? short(v) : ''}</span>
                  <div className="w-full max-w-[24px] bg-[var(--accent)] rounded-t-sm min-h-[4px]" style={{ height: `${Math.max(4, (v / monthlyMax) * 100)}px` }} />
                  <span className="text-[10px] font-bold text-[#000000] uppercase">{MONTHS[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className={`lg:col-span-4 ${card}`}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />Supplier Balances</h3>
          {dues.length === 0 ? <p className="py-8 text-center text-xs font-semibold text-[#000000]/60">Nothing owed to suppliers.</p> : (
            <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
              {dues.map(p => {
                const overdue = Boolean(p.dueDate && p.dueDate < today)
                return (
                  <button key={p.id} type="button" onClick={() => onOpen(p)} className="w-full flex items-center justify-between gap-3 rounded-lg border border-black/5 px-3 py-2 text-left hover:bg-black/[0.02] cursor-pointer">
                    <div className="min-w-0"><p className="text-xs font-black text-[#000000] truncate">{names.get(p.supplierId) || 'Supplier'}</p><p className="text-[10px] font-semibold text-[#000000]/60">{p.purchaseNumber}</p></div>
                    <div className="text-right shrink-0"><p className="text-xs font-black text-[#DC2626]">{formatCurrency(p.due)}</p><p className={`text-[10px] font-bold ${overdue ? 'text-[#DC2626]' : 'text-[#000000]/60'}`}>{p.dueDate ? `${overdue ? 'Overdue · ' : 'Due '}${new Date(`${p.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : 'No due date'}</p></div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={card}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />Top Suppliers</h3>
          <div className="space-y-3">
            {bySupplier.length === 0 ? <p className="text-xs font-semibold text-[#000000]/60">No purchases in this period.</p> : bySupplier.map(([id, r]) => (
              <div key={id}>
                <div className="flex justify-between text-xs mb-1"><span className="font-bold">{names.get(id) || 'Supplier'} <span className="text-[#000000]/50">({r.count})</span></span><span className="font-black">{formatCurrency(r.total)}{r.owed > 0 && <span className="ml-1.5 text-[10px] text-[#DC2626]">owed {short(r.owed)}</span>}</span></div>
                <div className="h-2.5 bg-black/5 rounded-full overflow-hidden"><div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${(r.total / supplierMax) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className={card}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />By Metal</h3>
          <div className="space-y-2">
            {byMetal.length === 0 ? <p className="text-xs font-semibold text-[#000000]/60">No purchases in this period.</p> : byMetal.map(([metal, r]) => (
              <div key={metal} className="flex items-center justify-between rounded-lg bg-[#F9FAFB] border border-black/5 px-3 py-2 text-xs">
                <span className="font-bold">{metal}</span>
                <span className="text-right"><span className="font-black">{formatCurrency(r.amount)}</span><span className="ml-2 text-[10px] text-[#000000]/60">{formatWeight(r.grams)}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
