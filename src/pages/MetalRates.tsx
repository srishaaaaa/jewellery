import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Download, Gem, History, RefreshCw, X } from 'lucide-react'
import { getErrorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/retail'
import { csvDate, downloadCsv } from '../lib/csv'
import { ModalPortal } from '../components/ModalPortal'
import { useAdminAuthStore } from '../store/store'
import { useMetalRateStore } from '../store/metalRateStore'
import { metalRateService, type NewRateEntry } from '../services/metalRateService'
import {
  GOLD_PURITIES,
  METAL_LABELS,
  RATE_SLOTS,
  STANDARD_PURITY,
  localIsoDate,
  metalLabel,
  rateKey,
  validateRateInput,
  type MetalRate,
  type RatedMetal,
} from '../lib/jewellery'

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-[#6B7280]">{label}</span>{children}</label> }
const inputClass = 'w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-sm text-[#273126] outline-none transition focus:border-[var(--accent-dark)] focus:ring-2 focus:ring-emerald-100'

const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}

type PendingChange = { metal: RatedMetal; purity: string; from: number | null; to: number }

export default function MetalRates() {
  const role = useAdminAuthStore((s) => s.role)
  const adminId = useAdminAuthStore((s) => s.adminId)
  const { rates, fetchRates, error: rateError, loading: ratesLoading } = useMetalRateStore()
  const [history, setHistory] = useState<MetalRate[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filterMetal, setFilterMetal] = useState<RatedMetal | ''>('')
  const [filterPurity, setFilterPurity] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const [updateOpen, setUpdateOpen] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState<PendingChange[] | null>(null)
  const [saving, setSaving] = useState(false)
  const today = localIsoDate()

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      setHistory(await metalRateService.fetchHistory({ metal: filterMetal, purity: filterPurity, from: filterFrom, to: filterTo }))
      setError('')
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load rate history'))
    } finally {
      setHistoryLoading(false)
    }
  }, [filterMetal, filterPurity, filterFrom, filterTo])

  useEffect(() => { void loadHistory() }, [loadHistory])
  useEffect(() => { void fetchRates() }, [fetchRates])

  const refresh = () => { void fetchRates(); void loadHistory() }

  const openUpdate = () => {
    const initial: Record<string, string> = {}
    for (const slot of RATE_SLOTS) {
      const current = rates[rateKey(slot.metal, slot.purity)]
      initial[rateKey(slot.metal, slot.purity)] = current ? String(current.ratePerGram) : ''
    }
    setForm(initial)
    setNote('')
    setConfirming(null)
    setError('')
    setUpdateOpen(true)
  }

  // Step 1: validate and list what will change, for confirmation.
  const reviewChanges = (event: FormEvent) => {
    event.preventDefault()
    const changes: PendingChange[] = []
    for (const slot of RATE_SLOTS) {
      const key = rateKey(slot.metal, slot.purity)
      const raw = (form[key] || '').trim()
      const current = rates[key]
      if (!raw && !current) continue // never set and left blank: nothing to do
      const checked = validateRateInput(slot.metal, slot.purity, raw)
      if (!checked.ok) { setError(checked.error); return }
      if (current && current.ratePerGram === checked.value) continue
      changes.push({ metal: slot.metal, purity: slot.purity, from: current ? current.ratePerGram : null, to: checked.value })
    }
    if (!changes.length) { setError('No rate was changed.'); return }
    setError('')
    setConfirming(changes)
  }

  // Step 2: save — each change becomes a new history row and the current rate.
  const saveChanges = async () => {
    if (!confirming) return
    setSaving(true)
    setError('')
    try {
      const entries: NewRateEntry[] = confirming.map((c) => ({ metal: c.metal, purity: c.purity, rate: c.to }))
      const createdBy = `${role === 'admin' ? 'Admin' : 'Staff'}${adminId ? ` (${adminId})` : ''}`
      await metalRateService.addRates(entries, { createdBy, note })
      await fetchRates()
      await loadHistory()
      setUpdateOpen(false)
      setConfirming(null)
      setNotice(`${confirming.length} rate${confirming.length > 1 ? 's' : ''} updated. New bills now use the new rate; existing invoices keep their original rate.`)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to save rates'))
    } finally {
      setSaving(false)
    }
  }

  // Change vs the previous entry for the same metal/purity (history is newest first).
  const historyWithChange = useMemo(() => {
    const seen = new Map<string, MetalRate[]>()
    for (const row of history) {
      const key = rateKey(row.metalType, row.purity)
      const list = seen.get(key) || []
      list.push(row)
      seen.set(key, list)
    }
    return history.map((row) => {
      const list = seen.get(rateKey(row.metalType, row.purity)) || []
      const previous = list[list.indexOf(row) + 1]
      return { row, change: previous ? Math.round((row.ratePerGram - previous.ratePerGram) * 100) / 100 : null }
    })
  }, [history])

  const exportHistory = () => {
    downloadCsv(`metal_rates_${today}.csv`, [
      ['Date & Time', 'Metal', 'Purity', 'Rate per gram (INR)', 'Updated By', 'Note'],
      ...history.map((r) => [csvDate(r.effectiveFrom, true), METAL_LABELS[r.metalType], r.purity === STANDARD_PURITY ? 'Standard' : r.purity, r.ratePerGram.toFixed(2), r.createdBy, r.note]),
    ])
  }

  const renderRateRow = (metal: RatedMetal, purity: string) => {
    const current = rates[rateKey(metal, purity)]
    const updatedToday = current && localIsoDate(new Date(current.effectiveFrom)) === today
    return (
      <div key={purity} className="flex items-center justify-between gap-3 py-2 border-b border-[#F0EEE9] last:border-b-0">
        <div className="min-w-0">
          <p className="text-sm font-black text-[#273126]">{purity === STANDARD_PURITY ? METAL_LABELS[metal] : purity}</p>
          <p className={`text-[10px] font-bold ${updatedToday ? 'text-emerald-600' : 'text-amber-700'}`}>
            {current ? (updatedToday ? `Today, ${new Date(current.effectiveFrom).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : `Last updated ${fmtDateTime(current.effectiveFrom)}`) : 'Not set'}
          </p>
        </div>
        <p className="text-lg sm:text-xl font-black text-[#273126] whitespace-nowrap">
          {current ? <>{formatCurrency(current.ratePerGram)}<span className="text-xs font-bold text-[#879086]"> / g</span></> : <span className="text-sm text-[#9CA3AF]">—</span>}
        </p>
      </div>
    )
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[.18em] text-emerald-600">Daily rates</p>
        <h2 className="text-2xl font-black text-[#273126]">Metal Rates</h2>
        <p className="mt-1 text-sm text-[#6B7280]">New bills use the latest rate automatically. Old invoices always keep the rate they were billed at.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={openUpdate} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-black text-white hover:opacity-90 cursor-pointer">
          <Gem size={16} /> Update Rates
        </button>
        <button onClick={refresh} className="rounded-xl border bg-white p-3 text-[#647064] cursor-pointer" title="Refresh">
          <RefreshCw size={18} className={ratesLoading || historyLoading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>

    {(error || rateError) && !updateOpen && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error || rateError}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

    {/* Current rates */}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm md:row-span-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-black uppercase tracking-wide text-[#879086]">Gold</p>
          <div className="rounded-xl p-2 text-amber-700 bg-amber-50"><Gem size={18} /></div>
        </div>
        {GOLD_PURITIES.map((purity) => renderRateRow('gold', purity))}
      </div>
      <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-black uppercase tracking-wide text-[#879086]">Silver</p>
          <div className="rounded-xl p-2 text-slate-600 bg-slate-100"><Gem size={18} /></div>
        </div>
        {renderRateRow('silver', STANDARD_PURITY)}
      </div>
      <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[11px] font-black uppercase tracking-wide text-[#879086]">Platinum</p>
          <div className="rounded-xl p-2 text-sky-700 bg-sky-50"><Gem size={18} /></div>
        </div>
        {renderRateRow('platinum', STANDARD_PURITY)}
      </div>
    </div>

    {/* Rate history */}
    <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="flex items-center gap-2 text-sm font-black text-[#273126]"><History size={16} className="text-[var(--accent)]" /> Rate History</h3>
        <button onClick={exportHistory} disabled={!history.length} className="flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 cursor-pointer">
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select className={inputClass} value={filterMetal} onChange={(e) => { setFilterMetal(e.target.value as RatedMetal | ''); setFilterPurity('') }} aria-label="Metal">
          <option value="">All Metals</option>
          {(['gold', 'silver', 'platinum'] as const).map((m) => <option key={m} value={m}>{METAL_LABELS[m]}</option>)}
        </select>
        <select className={inputClass} value={filterPurity} onChange={(e) => setFilterPurity(e.target.value)} disabled={filterMetal !== 'gold'} aria-label="Purity">
          <option value="">All Purities</option>
          {GOLD_PURITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="date" className={inputClass} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={inputClass} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} aria-label="To date" />
      </div>
    </div>

    <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm flex flex-col">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
            <tr>
              {['Date & Time', 'Metal', 'Purity', 'Rate / g', 'Change', 'Updated By', 'Note'].map((h) => (
                <th key={h} className="px-4 py-3.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EEE9]">
            {historyLoading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#6B7280]">Loading rate history...</td></tr>
            ) : historyWithChange.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#6B7280]">No rates recorded yet. Click "Update Rates" to enter today's rates.</td></tr>
            ) : historyWithChange.map(({ row, change }) => (
              <tr key={row.id} className="hover:bg-emerald-50/30 transition-colors">
                <td className="px-4 py-3.5 font-semibold text-[#273126]">{fmtDateTime(row.effectiveFrom)}</td>
                <td className="px-4 py-3.5 font-bold text-[#273126]">{METAL_LABELS[row.metalType]}</td>
                <td className="px-4 py-3.5 text-[#6B7280]">{row.purity === STANDARD_PURITY ? 'Standard' : row.purity}</td>
                <td className="px-4 py-3.5 font-black text-[#273126]">{formatCurrency(row.ratePerGram)}</td>
                <td className={`px-4 py-3.5 text-xs font-black ${change == null || change === 0 ? 'text-[#9CA3AF]' : change > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {change == null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${formatCurrency(Math.abs(change))}`}
                </td>
                <td className="px-4 py-3.5 text-xs text-[#6B7280]">{row.createdBy || '—'}</td>
                <td className="px-4 py-3.5 text-xs text-[#6B7280] max-w-[240px] truncate" title={row.note}>{row.note || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {updateOpen && <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={reviewChanges} className="flex w-full max-w-lg max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-emerald-600">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            <h3 className="text-xl font-black text-[#273126]">{confirming ? 'Confirm Rate Update' : "Update Today's Rates"}</h3>
          </div>
          <button type="button" onClick={() => setUpdateOpen(false)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</div>}
          {confirming ? (
            <div className="space-y-2">
              {confirming.map((c) => (
                <p key={rateKey(c.metal, c.purity)} className="rounded-xl bg-[#F8F7F4] px-3 py-2.5 text-sm font-bold text-[#273126]">
                  {c.from == null
                    ? `Set ${metalLabel(c.metal, c.purity)} rate to ${formatCurrency(c.to)}/g?`
                    : `Update ${metalLabel(c.metal, c.purity)} rate from ${formatCurrency(c.from)}/g to ${formatCurrency(c.to)}/g?`}
                </p>
              ))}
              <p className="rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">
                The previous rates stay in Rate History. From now on, new bills use these rates; invoices already generated are not changed.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-[#879086]">Gold (₹ per gram)</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {GOLD_PURITIES.map((purity) => (
                    <Field key={purity} label={purity}>
                      <input type="number" min="0.01" step="0.01" inputMode="decimal" className={inputClass} placeholder="0.00"
                        value={form[rateKey('gold', purity)] ?? ''}
                        onChange={(e) => setForm((f) => ({ ...f, [rateKey('gold', purity)]: e.target.value }))} />
                    </Field>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['silver', 'platinum'] as const).map((metal) => (
                  <Field key={metal} label={`${METAL_LABELS[metal]} (₹ / g)`}>
                    <input type="number" min="0.01" step="0.01" inputMode="decimal" className={inputClass} placeholder="0.00"
                      value={form[rateKey(metal, STANDARD_PURITY)] ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, [rateKey(metal, STANDARD_PURITY)]: e.target.value }))} />
                  </Field>
                ))}
              </div>
              <Field label="Note (optional)">
                <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Morning board rate" />
              </Field>
            </div>
          )}
        </div>
        <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          {confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(null)} className="flex-1 rounded-xl border py-3 text-sm font-black">Back</button>
              <button type="button" disabled={saving} onClick={() => void saveChanges()} className="flex-[1.5] rounded-xl bg-emerald-600 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Confirm & Save'}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setUpdateOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
              <button type="submit" className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white">Review Changes</button>
            </>
          )}
        </div>
      </form>
    </div></ModalPortal>}
  </div>
}
