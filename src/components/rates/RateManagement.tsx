import { useMemo, useState, type FormEvent } from 'react'
import { Edit2, Plus, Power, Trash2, X } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { EyeIcon, actionBtn } from '../ActionIcons'
import { DetailDrawer } from '../DetailDrawer'
import { FilterCard, FilterField } from '../filters/PageFilters'
import { filterInput } from '../filters/filterStyles'
import { formatCurrency } from '../../lib/retail'
import { csvDate, downloadCsv } from '../../lib/csv'
import { getErrorMessage } from '../../lib/errorMessage'
import {
  CATEGORY_CONFIG, CATEGORY_LABELS, UNIT_LABELS, currentRates, materialRateService,
  type MaterialCategory, type MaterialRate, type PricingUnit,
} from '../../services/stoneRateService'

const fmtDT = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const originLabel = (cat: MaterialCategory, v: string) => CATEGORY_CONFIG[cat].origins.find(([k]) => k === v)?.[1] || v || 'Any'
const specText = (r: MaterialRate) => {
  const cfg = CATEGORY_CONFIG[r.category]
  return cfg.specs.filter((s) => r.specs[s.key]).map((s) => `${s.label} ${r.specs[s.key]}`).join(' · ')
}
const caratText = (r: MaterialRate) => (r.caratMin === null && r.caratMax === null ? 'Any size' : `${r.caratMin ?? 0} – ${r.caratMax ?? '∞'} ct`)
const field = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-[#000000] outline-none focus:border-[#111111]'
const lbl = 'mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/70'

type FormState = {
  category: MaterialCategory; name: string; variety: string; originType: string; specs: Record<string, string>
  caratMin: string; caratMax: string; pricingUnit: PricingUnit; price: string; effectiveFrom: string; supplier: string; notes: string
}
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const emptyForm = (category: MaterialCategory): FormState => ({
  category, name: CATEGORY_CONFIG[category].names[0], variety: '', originType: CATEGORY_CONFIG[category].origins[0]?.[0] || '', specs: {},
  caratMin: '', caratMax: '', pricingUnit: CATEGORY_CONFIG[category].units[0], price: '', effectiveFrom: nowLocal(), supplier: '', notes: '',
})

/** Price list of one stone category: current rates, add / new price, activate / deactivate, history per rate. */
export function PriceListView({ category, rates, onChange, isAdmin }: {
  category: MaterialCategory; rates: MaterialRate[]; onChange: (rows: MaterialRate[]) => void; isAdmin: boolean
}) {
  const cfg = CATEGORY_CONFIG[category]
  const [statusTab, setStatusTab] = useState<'active' | 'inactive' | 'scheduled' | 'all'>('active')
  const [draft, setDraft] = useState({ name: '', origin: '' })
  const [query, setQuery] = useState(draft)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [viewKey, setViewKey] = useState<string | null>(null)

  const mine = useMemo(() => rates.filter((r) => r.category === category), [rates, category])
  const now = new Date()
  // Latest current version per key, plus anything scheduled for later
  const rows = useMemo(() => {
    const cur = currentRates(mine)
    const scheduled = mine.filter((r) => new Date(r.effectiveFrom) > new Date())
    return [...cur, ...scheduled]
  }, [mine])
  const isScheduled = (r: MaterialRate) => new Date(r.effectiveFrom) > now
  const visible = rows.filter((r) =>
    (statusTab === 'all' || (statusTab === 'scheduled' ? isScheduled(r) : !isScheduled(r) && r.status === statusTab))
    && (!query.name || `${r.name} ${r.variety} ${specText(r)} ${r.supplier}`.toLowerCase().includes(query.name.toLowerCase()))
    && (!query.origin || r.originType === query.origin))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.caratMin ?? 0) - (b.caratMin ?? 0))

  const openNew = () => { setError(''); setForm(emptyForm(category)) }
  const openNewPrice = (r: MaterialRate) => {
    setError('')
    setForm({
      category, name: r.name, variety: r.variety, originType: r.originType, specs: { ...r.specs }, caratMin: r.caratMin === null ? '' : String(r.caratMin),
      caratMax: r.caratMax === null ? '' : String(r.caratMax), pricingUnit: r.pricingUnit, price: String(r.price), effectiveFrom: nowLocal(), supplier: r.supplier, notes: '',
    })
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    setSaving(true); setError('')
    try {
      const saved = await materialRateService.add({
        category, name: form.name, variety: form.variety, originType: form.originType, specs: form.specs,
        caratMin: form.caratMin.trim() === '' ? null : Number(form.caratMin), caratMax: form.caratMax.trim() === '' ? null : Number(form.caratMax),
        pricingUnit: form.pricingUnit, price: Number(form.price) || 0, effectiveFrom: new Date(form.effectiveFrom || nowLocal()).toISOString(),
        supplier: form.supplier, notes: form.notes,
      })
      onChange([saved, ...rates])
      setForm(null)
    } catch (err) { setError(getErrorMessage(err, 'Unable to save the rate')) } finally { setSaving(false) }
  }
  const toggle = async (r: MaterialRate) => {
    try {
      const updated = await materialRateService.setStatus(r.id, r.status === 'active' ? 'inactive' : 'active')
      onChange(rates.map((x) => (x.id === r.id ? updated : x)))
    } catch (err) { setError(getErrorMessage(err, 'Unable to change the rate')) }
  }
  const removeRate = async (r: MaterialRate) => {
    if (!window.confirm(`Delete the ${r.name} rate of ${formatCurrency(r.price)} (${UNIT_LABELS[r.pricingUnit].toLowerCase()})?\n\nUse this for a wrong entry. Items and bills keep the price they already have; to stop using a correct rate, deactivate it instead.`)) return
    try {
      await materialRateService.remove(r.id)
      onChange(rates.filter((x) => x.id !== r.id))
    } catch (err) { setError(getErrorMessage(err, 'Unable to delete the rate')) }
  }
  const history = viewKey ? mine.filter((r) => r.rateKey === viewKey).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)) : []
  const latest = history[0]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Active rates', rows.filter((r) => !isScheduled(r) && r.status === 'active').length],
          ['Scheduled', rows.filter(isScheduled).length],
          ['Inactive', rows.filter((r) => !isScheduled(r) && r.status === 'inactive').length],
          ['Price changes logged', mine.length]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[0.15em]">{k}</p><p className="mt-2 text-2xl font-black">{v}</p></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => downloadCsv(`${category}-rates-${new Date().toISOString().slice(0, 10)}`, [
          ['Name', 'Variety', 'Origin', 'Grades', 'Carat range', 'Unit', 'Price', 'Effective from', 'Supplier', 'Status'],
          ...visible.map((r) => [r.name, r.variety, originLabel(category, r.originType), specText(r), caratText(r), UNIT_LABELS[r.pricingUnit], r.price, csvDate(r.effectiveFrom, true), r.supplier, isScheduled(r) ? 'Scheduled' : r.status]),
        ])} className="rounded-xl border-2 border-[var(--accent)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white cursor-pointer">Export CSV</button>
        {isAdmin && <button type="button" onClick={openNew} className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-black cursor-pointer"><Plus className="w-4 h-4" /> Add {CATEGORY_LABELS[category].replace(/s$/, '')} Rate</button>}
      </div>

      <FilterCard
        tabs={[{ id: 'active' as const, label: 'Active' }, { id: 'scheduled' as const, label: 'Scheduled' }, { id: 'inactive' as const, label: 'Inactive' }, { id: 'all' as const, label: 'All' }]}
        activeTab={statusTab} onTab={setStatusTab} onSearch={() => setQuery(draft)}
      >
        <FilterField label="Search name / grade / supplier" search><input className={`${filterInput} pl-9`} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Ruby, VS1, Round" /></FilterField>
        {cfg.origins.length > 0 && (
          <FilterField label="Natural / lab / other">
            <select className={`${filterInput} cursor-pointer`} value={draft.origin} onChange={(e) => { setDraft((d) => ({ ...d, origin: e.target.value })); setQuery((q) => ({ ...q, origin: e.target.value })) }}>
              <option value="">All</option>{cfg.origins.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FilterField>
        )}
      </FilterCard>

      {error && !form && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Name', 'Type', 'Grades / quality', 'Size', 'Price', 'Effective', 'Status', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-black/5">
            {visible.length === 0 ? <tr><td colSpan={8} className="p-8 text-center font-semibold text-[#000000]/60">No {CATEGORY_LABELS[category].toLowerCase()} rates here yet.{isAdmin ? ' Use "Add" to enter the first one.' : ''}</td></tr>
              : visible.map((r) => (
                <tr key={r.id} className="hover:bg-black/[0.02]">
                  <td className="px-4 py-3"><p className="font-black">{r.name}</p>{r.variety && <p className="text-[10px] text-[#000000]/60">{r.variety}</p>}</td>
                  <td className="px-4 py-3">{cfg.origins.length ? originLabel(category, r.originType) : '—'}</td>
                  <td className="px-4 py-3 max-w-[260px] whitespace-normal">{specText(r) || 'Any grade'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{cfg.caratRange ? caratText(r) : r.specs.size_mm ? `${r.specs.size_mm} mm` : '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap font-black">{formatCurrency(r.price)}<span className="block text-[10px] font-semibold text-[#000000]/60">{UNIT_LABELS[r.pricingUnit]}</span></td>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDT(r.effectiveFrom)}<span className="block text-[10px] text-[#000000]/60">by {r.createdBy}</span></td>
                  <td className="px-4 py-3">{isScheduled(r) ? <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black text-blue-700">SCHEDULED</span>
                    : <span className={`rounded-full px-2 py-1 text-[10px] font-black ${r.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-black/5 text-[#000000]/60'}`}>{r.status.toUpperCase()}</span>}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-1.5">
                    <button type="button" title="View details and price history" onClick={() => setViewKey(r.rateKey)} className={`${actionBtn} bg-black/5 hover:bg-black/10`}><EyeIcon className="w-4 h-4" /></button>
                    {isAdmin && <button type="button" title="Enter a new price (the old one stays in the history)" onClick={() => openNewPrice(r)} className={`${actionBtn} bg-[#2563EB]/10 text-[#2563EB] hover:bg-[#2563EB]/20`}><Edit2 className="w-4 h-4" /></button>}
                    {isAdmin && <button type="button" title="Delete this rate (a wrong entry)" onClick={() => void removeRate(r)} className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`}><Trash2 className="w-4 h-4" /></button>}
                    {isAdmin && <button type="button" title={r.status === 'active' ? 'Deactivate' : 'Activate'} onClick={() => void toggle(r)} className={`${actionBtn} ${r.status === 'active' ? 'bg-[#F59E0B]/10 text-[#D97706] hover:bg-[#F59E0B]/20' : 'bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20'}`}><Power className="w-4 h-4" /></button>}
                  </div></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {viewKey && latest && (
        <DetailDrawer kicker={`${CATEGORY_LABELS[category]} • ${UNIT_LABELS[latest.pricingUnit]}`} title={`${latest.name}${latest.variety ? ` · ${latest.variety}` : ''}`}
          subtitle={[cfg.origins.length ? originLabel(category, latest.originType) : '', specText(latest), cfg.caratRange ? caratText(latest) : ''].filter(Boolean).join(' • ')}
          onClose={() => setViewKey(null)}
          stats={[{ label: 'Current price', value: formatCurrency(currentRates(history)[0]?.price ?? latest.price) }, { label: 'Versions', value: String(history.length) }, { label: 'Status', value: latest.status.toUpperCase(), tone: latest.status === 'active' ? 'green' : undefined }]}>
          <div className="overflow-x-auto rounded-xl border border-black/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Effective', 'Price', 'Change', 'By', 'Supplier / note'].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-black/5">
                {history.map((h, i) => {
                  const prev = history[i + 1]
                  const diff = prev ? h.price - prev.price : 0
                  return (
                    <tr key={h.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDT(h.effectiveFrom)}{new Date(h.effectiveFrom) > now && <span className="ml-1 text-[9px] font-black text-blue-700">SCHEDULED</span>}</td>
                      <td className="px-3 py-2 font-black">{formatCurrency(h.price)}</td>
                      <td className={`px-3 py-2 font-bold ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : ''}`}>{prev ? `${diff > 0 ? '+' : ''}${formatCurrency(diff)} (${prev.price ? ((diff / prev.price) * 100).toFixed(1) : '0'}%)` : 'First rate'}</td>
                      <td className="px-3 py-2">{h.createdBy}</td>
                      <td className="px-3 py-2">{[h.supplier, h.notes].filter(Boolean).join(' · ') || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DetailDrawer>
      )}

      {form && (
        <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setForm(null) }}>
          <form onSubmit={save} className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#1C1C1C] px-5 py-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">{CATEGORY_LABELS[category]} Rate</h3>
              <button type="button" onClick={() => setForm(null)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              {error && <p className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
              <div>
                <label className={lbl}>Name *</label>
                <input list={`names-${category}`} className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                <datalist id={`names-${category}`}>{cfg.names.map((n) => <option key={n} value={n} />)}</datalist>
              </div>
              <div><label className={lbl}>{category === 'gemstone' ? 'Variety / origin (e.g. Burmese)' : category === 'traditional' ? 'Style' : 'Variety'}</label><input className={field} value={form.variety} onChange={(e) => setForm({ ...form, variety: e.target.value })} /></div>
              {cfg.origins.length > 0 && (
                <div><label className={lbl}>Natural / lab / other</label>
                  <select className={field} value={form.originType} onChange={(e) => setForm({ ...form, originType: e.target.value })}>{cfg.origins.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              )}
              {cfg.specs.map((sp) => (
                <div key={sp.key}><label className={lbl}>{sp.label} <span className="normal-case font-semibold">(blank = any)</span></label>
                  {sp.options
                    ? <select className={field} value={form.specs[sp.key] || ''} onChange={(e) => setForm({ ...form, specs: { ...form.specs, [sp.key]: e.target.value } })}><option value="">Any</option>{sp.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    : <input className={field} value={form.specs[sp.key] || ''} onChange={(e) => setForm({ ...form, specs: { ...form.specs, [sp.key]: e.target.value } })} />}
                </div>
              ))}
              {cfg.caratRange && <>
                <div><label className={lbl}>Carat per stone — from</label><input type="number" min="0" step="0.001" className={field} value={form.caratMin} onChange={(e) => setForm({ ...form, caratMin: e.target.value })} placeholder="any" /></div>
                <div><label className={lbl}>Carat per stone — to</label><input type="number" min="0" step="0.001" className={field} value={form.caratMax} onChange={(e) => setForm({ ...form, caratMax: e.target.value })} placeholder="any" /></div>
              </>}
              <div><label className={lbl}>Pricing unit *</label>
                <select className={field} value={form.pricingUnit} onChange={(e) => setForm({ ...form, pricingUnit: e.target.value as PricingUnit })}>{cfg.units.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}</select></div>
              <div><label className={lbl}>Price (₹) *</label><input type="number" min="0.01" step="0.01" required className={field} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div><label className={lbl}>Effective from * (future = scheduled)</label><input type="datetime-local" required className={field} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></div>
              <div><label className={lbl}>Supplier</label><input className={field} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={lbl}>Notes</label><input className={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <p className="sm:col-span-2 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[11px] font-semibold text-[#78350F]">Saved rates are never changed: a new price is added as a new version and the old one stays in the history. Bills already made keep the price they were billed at.</p>
            </div>
            <div className="flex justify-end gap-3 border-t border-black/10 bg-[#FAFAFA] px-5 py-4">
              <button type="button" onClick={() => setForm(null)} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-black/60 hover:bg-black/5 cursor-pointer">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-[#111111] px-6 py-2.5 text-xs font-black uppercase tracking-wider text-white disabled:opacity-60 cursor-pointer">{saving ? 'Saving…' : 'Save Rate'}</button>
            </div>
          </form>
        </div></ModalPortal>
      )}
    </div>
  )
}

/** Every stone rate ever entered, newest first, with the change from the previous price of the same rate. */
export function StoneRateHistory({ rates }: { rates: MaterialRate[] }) {
  const [cat, setCat] = useState<'all' | MaterialCategory>('all')
  const [draft, setDraft] = useState({ name: '', from: '', to: '' })
  const [query, setQuery] = useState(draft)
  const prevOf = useMemo(() => {
    const byKey = new Map<string, MaterialRate[]>()
    for (const r of rates) byKey.set(r.rateKey, [...(byKey.get(r.rateKey) || []), r])
    const map = new Map<string, MaterialRate | undefined>()
    for (const list of byKey.values()) {
      list.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
      list.forEach((r, i) => map.set(r.id, list[i - 1]))
    }
    return map
  }, [rates])
  const rows = rates.filter((r) => (cat === 'all' || r.category === cat)
    && (!query.name || `${r.name} ${r.variety} ${specText(r)}`.toLowerCase().includes(query.name.toLowerCase()))
    && (!query.from || r.effectiveFrom.slice(0, 10) >= query.from) && (!query.to || r.effectiveFrom.slice(0, 10) <= query.to))
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => downloadCsv(`stone-rate-history-${new Date().toISOString().slice(0, 10)}`, [
          ['Effective', 'Category', 'Name', 'Grades', 'Size', 'Unit', 'Price', 'Previous', 'Change', 'By', 'Status'],
          ...rows.map((r) => { const p = prevOf.get(r.id); return [csvDate(r.effectiveFrom, true), CATEGORY_LABELS[r.category], r.name, specText(r), caratText(r), UNIT_LABELS[r.pricingUnit], r.price, p?.price ?? '', p ? r.price - p.price : '', r.createdBy, r.status] }),
        ])} className="rounded-xl border-2 border-[var(--accent)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white cursor-pointer">Export CSV</button>
      </div>
      <FilterCard tabs={[{ id: 'all' as const, label: 'All' }, ...(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map((c) => ({ id: c, label: CATEGORY_LABELS[c] }))]} activeTab={cat} onTab={setCat} onSearch={() => setQuery(draft)}>
        <FilterField label="Search" search><input className={`${filterInput} pl-9`} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name or grade" /></FilterField>
        <FilterField label="From"><input type="date" className={filterInput} value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} /></FilterField>
        <FilterField label="To"><input type="date" className={filterInput} value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} /></FilterField>
      </FilterCard>
      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Effective', 'Category', 'Rate', 'Price', 'Change', 'By', 'Status'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-black/5">
            {rows.length === 0 ? <tr><td colSpan={7} className="p-8 text-center font-semibold text-[#000000]/60">No stone rates yet.</td></tr> : rows.map((r) => {
              const p = prevOf.get(r.id)
              const diff = p ? r.price - p.price : 0
              return (
                <tr key={r.id}>
                  <td className="px-4 py-3 whitespace-nowrap">{fmtDT(r.effectiveFrom)}</td>
                  <td className="px-4 py-3">{CATEGORY_LABELS[r.category]}</td>
                  <td className="px-4 py-3"><p className="font-black">{r.name}{r.variety ? ` · ${r.variety}` : ''}</p><p className="text-[10px] text-[#000000]/60">{[specText(r), CATEGORY_CONFIG[r.category].caratRange ? caratText(r) : ''].filter(Boolean).join(' · ')}</p></td>
                  <td className="px-4 py-3 whitespace-nowrap font-black">{formatCurrency(r.price)}<span className="block text-[10px] font-semibold text-[#000000]/60">{UNIT_LABELS[r.pricingUnit]}</span></td>
                  <td className={`px-4 py-3 whitespace-nowrap font-bold ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : ''}`}>{p ? `${diff > 0 ? '+' : ''}${formatCurrency(diff)}` : 'New'}</td>
                  <td className="px-4 py-3">{r.createdBy}</td>
                  <td className="px-4 py-3">{r.status}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
