import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Download, Gem, History, RefreshCw, Trash2, X } from 'lucide-react'
import { getErrorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/retail'
import { csvDate, downloadCsv } from '../lib/csv'
import { ModalPortal } from '../components/ModalPortal'
import { useAdminAuthStore } from '../store/store'
import { PriceListView, StoneRateHistory } from '../components/rates/RateManagement'
import { CATEGORY_LABELS, materialRateService, type MaterialCategory, type MaterialRate } from '../services/stoneRateService'
import { useMetalRateStore } from '../store/metalRateStore'
import { metalRateService, type NewRateEntry } from '../services/metalRateService'
import {
  GOLD_PURITIES,
  isCustomGoldPurity,
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

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{label}</span>{children}</label> }
const inputClass = 'w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm'

const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}

type PendingChange = { metal: RatedMetal; purity: string; from: number | null; to: number }

function MetalRatesPanel() {
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
  // Extra gold purities (e.g. 23K, 9K) next to the standard five
  const [customRows, setCustomRows] = useState<Array<{ purity: string; rate: string }>>([])
  const customPurities = useMemo(() => Object.values(rates).filter((r) => r.metalType === 'gold' && isCustomGoldPurity(r.purity)).map((r) => r.purity)
    .sort((a, b) => parseFloat(b) - parseFloat(a)), [rates])
  const [note, setNote] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
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
    setCustomRows(customPurities.map((p) => ({ purity: p, rate: String(rates[rateKey('gold', p)]?.ratePerGram ?? '') })))
    setNote('')
    setEffectiveFrom('')
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
    const seenCustom = new Set<string>()
    for (const row of customRows) {
      const purity = row.purity.trim().toUpperCase().replace(/\s+/g, '').replace(/KT?$|CT$/, 'K')
      if (!purity && !row.rate.trim()) continue
      if (!isCustomGoldPurity(purity)) {
        setError((GOLD_PURITIES as readonly string[]).includes(purity) ? `${purity} is already in the list above.` : `"${row.purity}" is not a gold purity. Use a karat like 23K, 19K or 9K (up to 24K).`)
        return
      }
      if (seenCustom.has(purity)) { setError(`${purity} is entered twice.`); return }
      seenCustom.add(purity)
      const key = rateKey('gold', purity)
      const current = rates[key]
      const checked = validateRateInput('gold', purity, row.rate)
      if (!checked.ok) { setError(checked.error); return }
      if (current && current.ratePerGram === checked.value) continue
      changes.push({ metal: 'gold', purity, from: current ? current.ratePerGram : null, to: checked.value })
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
      await metalRateService.addRates(entries, { createdBy, note, effectiveFrom: effectiveFrom || undefined })
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

  const deleteRate = async (row: MetalRate) => {
    if (!window.confirm(`Delete the ${metalLabel(row.metalType, row.purity)} rate of ${formatCurrency(row.ratePerGram)}/g from ${fmtDateTime(row.effectiveFrom)}?

Use this for a wrong entry. If it is the current rate, the previous rate becomes current. Bills already made keep their own rate.`)) return
    try {
      await metalRateService.deleteRate(row.id)
      await fetchRates()
      await loadHistory()
      setNotice('Rate entry deleted.')
    } catch (err) { setError(getErrorMessage(err, 'Unable to delete the rate')) }
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
          <p className="text-sm font-black text-[#000000]">{purity === STANDARD_PURITY ? METAL_LABELS[metal] : purity}</p>
          <p className={`text-[10px] font-bold ${updatedToday ? 'text-emerald-600' : 'text-amber-700'}`}>
            {current ? (updatedToday ? `Today, ${new Date(current.effectiveFrom).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : `Last updated ${fmtDateTime(current.effectiveFrom)}`) : 'Not set'}
          </p>
        </div>
        <p className="text-lg sm:text-xl font-black text-[#000000] whitespace-nowrap">
          {current ? <>{formatCurrency(current.ratePerGram)}<span className="text-xs font-bold text-[#000000]"> / g</span></> : <span className="text-sm text-[#9CA3AF]">—</span>}
        </p>
      </div>
    )
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-[28px] font-black text-[#000000] tracking-tight">Metal Rates</h2>
        <p className="mt-1 text-xs font-semibold text-[#000000]">New bills use the latest rate automatically. Old invoices always keep the rate they were billed at.</p>
      </div>
      <div className="flex gap-2">
        {role === 'admin' ? (
        <button onClick={openUpdate} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:opacity-90 cursor-pointer">
          <Gem size={16} /> Update Rates
        </button>
        ) : (
          <span className="rounded-xl border border-black/10 bg-white px-3 py-2.5 text-xs font-bold text-[#000000]">View only — rates are updated by the admin</span>
        )}
        <button onClick={refresh} className="rounded-xl border bg-white p-3 text-[#000000] cursor-pointer" title="Refresh">
          <RefreshCw size={18} className={ratesLoading || historyLoading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>

    {(error || rateError) && !updateOpen && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error || rateError}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

    {/* Current rates */}
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm md:row-span-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">Gold</p>
          <div className="rounded-xl p-2 text-amber-700 bg-amber-50"><Gem size={18} /></div>
        </div>
        {[...GOLD_PURITIES, ...customPurities].map((purity) => renderRateRow('gold', purity))}
      </div>
      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">Silver</p>
          <div className="rounded-xl p-2 text-slate-600 bg-slate-100"><Gem size={18} /></div>
        </div>
        {renderRateRow('silver', STANDARD_PURITY)}
      </div>
      <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">Platinum</p>
          <div className="rounded-xl p-2 text-sky-700 bg-sky-50"><Gem size={18} /></div>
        </div>
        {renderRateRow('platinum', STANDARD_PURITY)}
      </div>
    </div>

    {/* Rate history */}
    <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="flex items-center gap-2 text-sm font-black text-[#000000]"><History size={16} className="text-[var(--accent)]" /> Rate History</h3>
        <button onClick={exportHistory} disabled={!history.length} className="flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 cursor-pointer">
          <Download size={13} /> Export CSV
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select className={inputClass} value={filterMetal} onChange={(e) => { setFilterMetal(e.target.value as RatedMetal | ''); setFilterPurity('') }} aria-label="Metal">
          <option value="">All Metals</option>
          {(['gold', 'silver', 'platinum'] as const).map((m) => <option key={m} value={m}>{METAL_LABELS[m]}</option>)}
        </select>
        <select
          className={inputClass}
          value={filterPurity}
          onChange={(e) => {
            const purity = e.target.value
            setFilterPurity(purity)
            // A gold purity implies gold; "Standard" keeps silver/platinum (or all metals).
            if ((GOLD_PURITIES as readonly string[]).includes(purity)) setFilterMetal('gold')
            else if (purity === STANDARD_PURITY && filterMetal === 'gold') setFilterMetal('')
          }}
          aria-label="Purity"
        >
          <option value="">All Purities</option>
          {(filterMetal === '' || filterMetal === 'gold') && GOLD_PURITIES.map((p) => <option key={p} value={p}>Gold {p}</option>)}
          {filterMetal !== 'gold' && <option value={STANDARD_PURITY}>Standard (Silver / Platinum)</option>}
        </select>
        <input type="date" className={inputClass} value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={inputClass} value={filterTo} onChange={(e) => setFilterTo(e.target.value)} aria-label="To date" />
      </div>
    </div>

    <div className="rounded-xl border border-black/10 bg-white shadow-sm flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] font-bold uppercase tracking-widest text-[#000000] bg-[#F9FAFB]">
            <tr>
              {['Date & Time', 'Metal', 'Purity', 'Rate / g', 'Change', 'Updated By', 'Note', ...(role === 'admin' ? ['Actions'] : [])].map((h) => (
                <th key={h} className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {historyLoading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#000000]">Loading rate history...</td></tr>
            ) : historyWithChange.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#000000]">No rates recorded yet. Click "Update Rates" to enter today's rates.</td></tr>
            ) : historyWithChange.map(({ row, change }) => (
              <tr key={row.id} className="hover:bg-emerald-50/30 transition-colors">
                <td className="px-4 py-3.5 font-semibold text-[#000000]">{fmtDateTime(row.effectiveFrom)}</td>
                <td className="px-4 py-3.5 font-bold text-[#000000]">{METAL_LABELS[row.metalType]}</td>
                <td className="px-4 py-3.5 text-[#000000]">{row.purity === STANDARD_PURITY ? 'Standard' : row.purity}</td>
                <td className="px-4 py-3.5 font-black text-[#000000]">{formatCurrency(row.ratePerGram)}</td>
                <td className={`px-4 py-3.5 text-xs font-black ${change == null || change === 0 ? 'text-[#9CA3AF]' : change > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {change == null ? '—' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${formatCurrency(Math.abs(change))}`}
                </td>
                <td className="px-4 py-3.5 text-xs text-[#000000]">{row.createdBy || '—'}</td>
                <td className="px-4 py-3.5 text-xs text-[#000000] max-w-[240px] truncate" title={row.note}>{row.note || '—'}</td>
                {role === 'admin' && <td className="px-4 py-3.5"><button type="button" title="Delete this rate entry (a wrong entry)" onClick={() => void deleteRate(row)} className="flex h-8 w-8 items-center justify-center rounded-md bg-[#DC2626]/10 text-[#DC2626] hover:bg-[#DC2626]/20 cursor-pointer"><Trash2 size={16} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    {updateOpen && <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={reviewChanges} className="flex w-full max-w-lg max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-xl sm:rounded-xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-black/10 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-emerald-600">{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            <h3 className="text-xl font-black text-[#000000]">{confirming ? 'Confirm Rate Update' : "Update Today's Rates"}</h3>
          </div>
          <button type="button" onClick={() => setUpdateOpen(false)} className="shrink-0 text-[#000000] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</div>}
          {confirming ? (
            <div className="space-y-2">
              {confirming.map((c) => (
                <p key={rateKey(c.metal, c.purity)} className="rounded-xl bg-black/[0.03] px-3 py-2.5 text-sm font-bold text-[#000000]">
                  {c.from == null
                    ? `Set ${metalLabel(c.metal, c.purity)} rate to ${formatCurrency(c.to)}/g?`
                    : `Update ${metalLabel(c.metal, c.purity)} rate from ${formatCurrency(c.from)}/g to ${formatCurrency(c.to)}/g?`}
                </p>
              ))}
              <p className="rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">
                {effectiveFrom ? `Effective from ${new Date(effectiveFrom).toLocaleString('en-IN')}. ` : ''}The previous rates stay in Rate History. From now on, new bills use these rates; invoices already generated are not changed.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">Gold (₹ per gram)</p>
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
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">Other gold purities (₹ per gram)</p>
                <div className="space-y-2">
                  {customRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                      <Field label="Purity"><input className={inputClass} placeholder="e.g. 23K" value={row.purity} onChange={(e) => setCustomRows((rows) => rows.map((r, k) => (k === i ? { ...r, purity: e.target.value } : r)))} /></Field>
                      <Field label="Rate"><input type="number" min="0.01" step="0.01" inputMode="decimal" className={inputClass} placeholder="0.00" value={row.rate} onChange={(e) => setCustomRows((rows) => rows.map((r, k) => (k === i ? { ...r, rate: e.target.value } : r)))} /></Field>
                      <button type="button" title="Remove this row (the saved rate stays in history)" onClick={() => setCustomRows((rows) => rows.filter((_, k) => k !== i))} className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg bg-[#DC2626]/10 text-[#DC2626] cursor-pointer"><X size={16} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setCustomRows((rows) => [...rows, { purity: '', rate: '' }])} className="rounded-lg border border-dashed border-black/30 px-3 py-2 text-[11px] font-black uppercase tracking-wider hover:bg-black/5 cursor-pointer">+ Add purity (e.g. 23K, 9K)</button>
                  <p className="text-[10px] font-semibold text-[#000000]/60">Items in a purity without its own rate are priced from the 24K rate × karat / 24.</p>
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
              <Field label="Effective from (leave blank for now)">
                <input type="datetime-local" className={inputClass} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              </Field>
              <Field label="Note (optional)">
                <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Morning board rate" />
              </Field>
            </div>
          )}
        </div>
        <div className="shrink-0 flex gap-3 border-t border-black/10 bg-white px-4 py-3 sm:px-6">
          {confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(null)} className="flex-1 rounded-xl border py-3 text-sm font-black">Back</button>
              <button type="button" disabled={saving} onClick={() => void saveChanges()} className="flex-[1.5] rounded-xl bg-emerald-600 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Confirm & Save'}</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setUpdateOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
              <button type="submit" className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-xs font-black uppercase tracking-wider text-white">Review Changes</button>
            </>
          )}
        </div>
      </form>
    </div></ModalPortal>}
  </div>
}

type RateTab = 'metal' | MaterialCategory | 'history'

/** Rate Management: metal rates plus price lists for diamonds, gemstones, pearls and traditional work. */
export default function MetalRates() {
  const role = useAdminAuthStore((s) => s.role)
  const [tab, setTab] = useState<RateTab>('metal')
  const [stoneRates, setStoneRates] = useState<MaterialRate[]>([])
  const [loadError, setLoadError] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (tab === 'metal' || loaded) return
    let live = true
    materialRateService.list()
      .then((rows) => { if (live) { setStoneRates(rows); setLoaded(true) } })
      .catch((err) => { if (live) setLoadError(getErrorMessage(err, 'Unable to load price lists')) })
    return () => { live = false }
  }, [tab, loaded])

  const tabs: Array<[RateTab, string]> = [['metal', 'Metal Rates'], ...(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map((c) => [c, CATEGORY_LABELS[c]] as [RateTab, string]), ['history', 'Stone Rate History']]
  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto border-b border-black/10 hide-scrollbar">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer ${tab === id ? 'border-[#111111] text-[#000000]' : 'border-transparent text-[#000000]/50 hover:text-[#000000]'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'metal' ? <MetalRatesPanel /> : (
        <div className="space-y-4">
          <div>
            <h2 className="text-[28px] font-black text-[#000000] tracking-tight">{tab === 'history' ? 'Stone Rate History' : `${CATEGORY_LABELS[tab]} Price List`}</h2>
            <p className="mt-1 text-xs font-semibold text-[#000000]">
              {tab === 'history' ? 'Every stone rate entered, with the change from the previous price. Nothing is overwritten.'
                : 'Rates by grade and size. Stones on items pick the matching rate; a stone with no matching rate is flagged instead of guessing.'}
            </p>
          </div>
          {loadError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{loadError}</p>}
          {tab === 'history' ? <StoneRateHistory rates={stoneRates} /> : <PriceListView key={tab} category={tab} rates={stoneRates} onChange={setStoneRates} isAdmin={role === 'admin'} />}
        </div>
      )}
    </div>
  )
}
