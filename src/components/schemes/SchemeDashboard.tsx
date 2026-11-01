import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AlertTriangle, CalendarClock, Coins, Gem, PiggyBank, Trophy } from 'lucide-react'
import { schemeService, type SchemeInstallment } from '../../services/schemeService'
import {
  FREQUENCY_LABELS, SCHEME_STATUS_LABELS, deriveSchemeStatus, installmentDueBreakdown, localIsoDate,
  type JewelleryScheme, type SchemeFrequency, type SchemeStatus,
} from '../../lib/jewellery'
import { formatCurrency } from '../../lib/retail'
import { paymentModeLabel } from '../../lib/paymentModes'
import { csvDate, csvPhone, downloadCsv } from '../../lib/csv'
import { PeriodBar } from '../filters/PageFilters'
import { inRange, periodRange, type PeriodPreset } from '../filters/filterStyles'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const short = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`)
const card = 'bg-white border border-black/10 rounded-xl p-5 shadow-sm'
const title = 'text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2 mb-4'

/** Schema panel dashboard: collections, gold saved, dues and plan mix, filtered by period. */
export function SchemeDashboard({ schemes, today }: { schemes: JewelleryScheme[]; today: string }) {
  const [payments, setPayments] = useState<SchemeInstallment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preset, setPreset] = useState<PeriodPreset>('year')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const range = periodRange(preset, from, to)

  useEffect(() => {
    let alive = true
    schemeService.fetchPayments({ limit: 20000 })
      .then(rows => { if (alive) setPayments(rows) })
      .catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Unable to load payments') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const schemesById = useMemo(() => new Map(schemes.map(s => [s.id, s])), [schemes])
  const inPeriod = useMemo(
    () => payments.filter(p => p.paymentDate && schemesById.get(p.schemeId)?.status !== 'cancelled' && inRange(localIsoDate(new Date(p.paymentDate)), range.from, range.to)),
    [payments, schemesById, range.from, range.to],
  )

  const kpi = useMemo(() => {
    let active = 0, dueTodayCount = 0, dueTodayAmount = 0, overdueCount = 0, overdueAmount = 0, maturedRedeemed = 0
    for (const s of schemes) {
      const st = deriveSchemeStatus(s, today)
      if (st === 'active' || st === 'payment_due') active++
      if (st === 'matured' || st === 'redeemed') maturedRedeemed++
      const due = installmentDueBreakdown(s, today)
      if (due.dueToday) { dueTodayCount++; dueTodayAmount += due.dueToday * s.monthlyAmount }
      if (due.overdue) { overdueCount++; overdueAmount += due.overdue * s.monthlyAmount }
    }
    const collected = inPeriod.reduce((sum, p) => sum + p.amountPaid, 0)
    const grams = inPeriod.reduce((sum, p) => sum + (p.goldGrams || 0), 0)
    return { active, dueTodayCount, dueTodayAmount, overdueCount, overdueAmount, maturedRedeemed, collected, grams, count: inPeriod.length }
  }, [schemes, inPeriod, today])

  const year = Number((range.to || today).slice(0, 4))
  const monthly = useMemo(() => {
    const totals = Array(12).fill(0) as number[]
    for (const p of payments) {
      if (!p.paymentDate || schemesById.get(p.schemeId)?.status === 'cancelled') continue
      const d = new Date(p.paymentDate)
      if (d.getFullYear() === year) totals[d.getMonth()] += p.amountPaid
    }
    return totals
  }, [payments, schemesById, year])
  const monthlyMax = Math.max(1, ...monthly)

  const upcoming = useMemo(() => {
    const end = new Date(`${today}T00:00:00`)
    end.setDate(end.getDate() + 7)
    const limit = localIsoDate(end)
    return schemes
      .filter(s => s.status === 'active' && s.nextDueDate && s.nextDueDate <= limit)
      .sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate)))
      .slice(0, 12)
  }, [schemes, today])

  const planMix = useMemo(() => {
    const map = new Map<SchemeFrequency, { count: number; collected: number }>()
    for (const s of schemes) {
      if (s.status === 'cancelled') continue
      const row = map.get(s.frequency) || { count: 0, collected: 0 }
      row.count++; row.collected += s.totalPaid
      map.set(s.frequency, row)
    }
    return [...map.entries()].sort((a, b) => b[1].collected - a[1].collected)
  }, [schemes])
  const planMax = Math.max(1, ...planMix.map(([, r]) => r.collected))

  const modes = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of inPeriod) {
      const key = paymentModeLabel(p.paymentMethod === 'qr' ? 'upi' : p.paymentMethod)
      map.set(key, (map.get(key) || 0) + p.amountPaid)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [inPeriod])

  const topSavers = useMemo(() => schemes.filter(s => s.status !== 'cancelled').sort((a, b) => b.totalPaid - a.totalPaid).slice(0, 5), [schemes])

  const statusCounts = useMemo(() => {
    const map = new Map<SchemeStatus, number>()
    for (const s of schemes) { const st = deriveSchemeStatus(s, today); map.set(st, (map.get(st) || 0) + 1) }
    return map
  }, [schemes, today])

  const exportCsv = () => downloadCsv(`scheme-collections-${today}.csv`, [
    ['Date', 'Receipt', 'Scheme', 'Customer', 'Phone', 'Installment', 'Amount', 'Gold Rate', 'Grams', 'Paid Via'],
    ...inPeriod.map(p => {
      const s = schemesById.get(p.schemeId)
      return [csvDate(p.paymentDate, true), p.receiptNumber, s?.schemeNumber, s?.customerName, csvPhone(s?.phone), p.installmentNumber, p.amountPaid.toFixed(2), p.goldRate?.toFixed(2) ?? '', p.goldGrams?.toFixed(3) ?? '', paymentModeLabel(p.paymentMethod)]
    }),
  ])

  const kpis: Array<[string, string, string, ReactElement, string]> = [
    ['Collected', formatCurrency(kpi.collected), `${kpi.count} installment${kpi.count === 1 ? '' : 's'} (cancelled schemes excluded)`, <Coins key="c" className="w-4 h-4 text-white" />, 'accent'],
    ['Gold Saved', `${kpi.grams.toFixed(3)} g`, 'Grams bought by these payments', <Gem key="g" className="w-4 h-4 text-[#B45309]" />, 'bg-[#FEF3C7]'],
    ['Active Schemes', String(kpi.active), 'Running savings plans', <PiggyBank key="a" className="w-4 h-4 text-[#16A34A]" />, 'bg-[#DCFCE7]'],
    ['Due Today', formatCurrency(kpi.dueTodayAmount), `${kpi.dueTodayCount} scheme${kpi.dueTodayCount === 1 ? '' : 's'} to collect today`, <CalendarClock key="d" className="w-4 h-4 text-[#2563EB]" />, 'bg-[#DBEAFE]'],
    ['Overdue', formatCurrency(kpi.overdueAmount), `${kpi.overdueCount} scheme${kpi.overdueCount === 1 ? '' : 's'} behind on payments`, <AlertTriangle key="o" className="w-4 h-4 text-[#DC2626]" />, 'bg-[#FEE2E2]'],
    ['Matured / Redeemed', String(kpi.maturedRedeemed), 'Ready to redeem or already used', <Trophy key="m" className="w-4 h-4 text-[#7C3AED]" />, 'bg-[#EDE9FE]'],
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h3 className="text-lg font-black text-[#000000] tracking-tight">Scheme Dashboard</h3>
          <p className="text-xs font-semibold text-[#000000]/70">Collections, gold saved and dues across all savings schemes.</p>
        </div>
        <PeriodBar
          preset={preset}
          from={range.from}
          to={range.to}
          onPreset={setPreset}
          onFrom={v => { setFrom(v); setTo(range.to); setPreset('custom') }}
          onTo={v => { setTo(v); setFrom(range.from); setPreset('custom') }}
          onExport={exportCsv}
          exportDisabled={inPeriod.length === 0}
        />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map(([label, value, hint, icon, tone]) => tone === 'accent' ? (
          <div key={label} className="rounded-xl p-4 shadow-sm text-white bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_55%,#000000)]">
            <div className="flex justify-between items-start"><span className="text-[10px] font-bold uppercase tracking-wider text-white/90">{label}</span><span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">{icon}</span></div>
            <p className="mt-2 text-xl font-black break-words">{loading ? '…' : value}</p>
            <p className="mt-1 text-[10px] font-semibold text-white/80">{hint}</p>
          </div>
        ) : (
          <div key={label} className="bg-white border border-black/10 rounded-xl p-4 shadow-sm">
            <div className="flex justify-between items-start"><span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">{label}</span><span className={`w-7 h-7 rounded-full ${tone} flex items-center justify-center`}>{icon}</span></div>
            <p className="mt-2 text-xl font-black text-[#000000] break-words">{loading && (label === 'Gold Saved') ? '…' : value}</p>
            <p className="mt-1 text-[10px] font-semibold text-[#000000]/60">{hint}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className={`lg:col-span-8 ${card} flex flex-col min-h-[300px]`}>
          <h3 className="font-bold text-[#000000] text-sm mb-2 flex items-center">Collections This Year <span className="text-[var(--accent)] font-black ml-1.5">{year}</span></h3>
          <div className="flex items-center gap-3">
            <span className="text-xl font-black text-[#000000]">{formatCurrency(monthly.reduce((a, b) => a + b, 0))}</span>
            <span className="bg-white border border-black/10 text-[var(--accent)] px-2 py-0.5 rounded text-[10px] font-bold">Avg {formatCurrency(Math.round(monthly.reduce((a, b) => a + b, 0) / 12))}/mo</span>
          </div>
          <div className="flex-1 overflow-x-auto pb-2">
            <div className="flex items-end justify-between px-2 gap-1 mt-4 min-w-[480px] h-[170px] pt-8">
              {monthly.map((v, i) => (
                <div key={MONTHS[i]} className="flex flex-col items-center gap-1.5 w-full group/bar relative" title={`${MONTHS[i]}: ${formatCurrency(v)}`}>
                  <span className="text-[8px] font-black text-[var(--accent)] h-3 flex items-end">{v > 0 ? short(v) : ''}</span>
                  <div className="w-full max-w-[24px] bg-[var(--accent)] rounded-t-sm min-h-[4px] transition-all duration-700 group-hover/bar:opacity-80" style={{ height: `${Math.max(4, (v / monthlyMax) * 100)}px` }} />
                  <span className="text-[10px] font-bold text-[#000000] uppercase">{MONTHS[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className={`lg:col-span-4 ${card}`}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />Upcoming Dues (7 days)</h3>
          {upcoming.length === 0 ? (
            <p className="py-8 text-center text-xs font-semibold text-[#000000]/60">Nothing due in the next 7 days.</p>
          ) : (
            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {upcoming.map(s => {
                const overdue = String(s.nextDueDate) < today
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-black/5 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-[#000000] truncate">{s.customerName || s.phone}</p>
                      <p className="text-[10px] font-semibold text-[#000000]/60">{s.schemeNumber} • {FREQUENCY_LABELS[s.frequency]}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-black text-[#000000]">{formatCurrency(s.monthlyAmount)}</p>
                      <p className={`text-[10px] font-bold ${overdue ? 'text-[#DC2626]' : String(s.nextDueDate) === today ? 'text-[#2563EB]' : 'text-[#000000]/60'}`}>
                        {overdue ? 'Overdue' : String(s.nextDueDate) === today ? 'Today' : new Date(`${s.nextDueDate}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className={card}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />Plans by Type</h3>
          <div className="space-y-3">
            {planMix.length === 0 ? <p className="text-xs font-semibold text-[#000000]/60">No schemes yet.</p> : planMix.map(([freq, r]) => (
              <div key={freq}>
                <div className="flex justify-between text-xs mb-1"><span className="font-bold">{FREQUENCY_LABELS[freq]} <span className="text-[#000000]/50">({r.count})</span></span><span className="font-black">{short(r.collected)}</span></div>
                <div className="h-2.5 bg-black/5 rounded-full overflow-hidden"><div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${(r.collected / planMax) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />Paid Via</h3>
          <div className="space-y-3">
            {modes.length === 0 ? <p className="text-xs font-semibold text-[#000000]/60">No payments in this period.</p> : modes.map(([mode, amount]) => (
              <div key={mode}>
                <div className="flex justify-between text-xs mb-1"><span className="font-bold">{mode}</span><span className="font-black">{formatCurrency(amount)} <span className="text-[10px] text-[#000000]/50">{kpi.collected ? `${Math.round((amount / kpi.collected) * 100)}%` : ''}</span></span></div>
                <div className="h-2.5 bg-black/5 rounded-full overflow-hidden"><div className="h-full bg-[#111111] rounded-full" style={{ width: `${kpi.collected ? (amount / kpi.collected) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />Top Savers</h3>
          <div className="space-y-2.5">
            {topSavers.length === 0 ? <p className="text-xs font-semibold text-[#000000]/60">No schemes yet.</p> : topSavers.map((s, i) => (
              <div key={s.id} className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5 min-w-0"><span className="font-black text-[#000000]/40 w-4">{i + 1}</span><span className="font-bold truncate">{s.customerName || s.phone}</span></div>
                <div className="text-right shrink-0"><p className="font-black">{formatCurrency(s.totalPaid)}</p><p className="text-[10px] text-[#000000]/50">{s.totalGrams.toFixed(3)} g</p></div>
              </div>
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className={title}><span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />Status</h3>
          <div className="grid grid-cols-2 gap-2">
            {(['active', 'payment_due', 'completed', 'matured', 'redeemed', 'cancelled'] as SchemeStatus[]).map(st => (
              <div key={st} className="rounded-lg bg-[#F9FAFB] border border-black/5 px-3 py-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#000000]/60">{SCHEME_STATUS_LABELS[st]}</p>
                <p className="text-lg font-black text-[#000000]">{statusCounts.get(st) || 0}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
