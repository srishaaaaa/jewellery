import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Edit2, Gem, Plus, Trash2, X } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { EyeIcon, actionBtn } from '../ActionIcons'
import { DetailDrawer } from '../DetailDrawer'
import { FilterCard, FilterField } from '../filters/PageFilters'
import { filterInput } from '../filters/filterStyles'
import { formatCurrency } from '../../lib/retail'
import { csvDate, downloadCsv } from '../../lib/csv'
import { getErrorMessage } from '../../lib/errorMessage'
import { useAdminAuthStore, useProductStore } from '../../store/store'
import {
  CATEGORY_CONFIG, CATEGORY_LABELS, LOOSE_STATUS_LABELS, looseStoneService,
  type LooseAction, type LooseMovement, type LooseStatus, type LooseStone, type MaterialCategory,
} from '../../services/stoneRateService'

const field = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-[#000000] outline-none focus:border-[#111111]'
const lbl = 'mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/70'
const STATUS_TONE: Record<LooseStatus, string> = {
  available: 'bg-emerald-50 text-emerald-700', reserved: 'bg-blue-50 text-blue-700', sold: 'bg-black/5 text-[#000000]/60',
  used_in_jewellery: 'bg-amber-50 text-amber-800', returned: 'bg-purple-50 text-purple-700', damaged: 'bg-red-50 text-red-700',
}
const ACTION_LABELS: Record<string, string> = { received: 'Received', reserve: 'Reserved', unreserve: 'Reservation released', sell: 'Sold', use: 'Used in jewellery', return: 'Returned to stock', damage: 'Marked damaged', adjust: 'Stock set' }

type StoneForm = {
  id?: string; stoneCode: string; category: MaterialCategory; name: string; variety: string; originType: string; specs: Record<string, string>
  isLot: boolean; quantity: string; carat: string; costPrice: string; sellingPrice: string; supplier: string; purchaseDate: string; lab: string; certificateNo: string; notes: string
}
const emptyForm = (): StoneForm => ({
  stoneCode: `LS${Date.now().toString().slice(-6)}`, category: 'diamond', name: 'Diamond', variety: '', originType: 'natural', specs: {}, isLot: false,
  quantity: '1', carat: '', costPrice: '', sellingPrice: '', supplier: '', purchaseDate: new Date().toISOString().slice(0, 10), lab: '', certificateNo: '', notes: '',
})

/** Loose diamonds, gemstones and pearls: single stones or lots, with every stock change logged. */
export default function LooseStonesView() {
  const isAdmin = useAdminAuthStore((s) => s.role) === 'admin'
  const products = useProductStore((s) => s.products)
  const [stones, setStones] = useState<LooseStone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'all' | LooseStatus>('available')
  const [draft, setDraft] = useState({ q: '', category: '' })
  const [query, setQuery] = useState(draft)
  const [form, setForm] = useState<StoneForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')
  const [view, setView] = useState<LooseStone | null>(null)
  const [moves, setMoves] = useState<LooseMovement[]>([])
  const [act, setAct] = useState<{ stone: LooseStone; action: LooseAction; quantity: string; carat: string; productId: string; reference: string; note: string } | null>(null)

  useEffect(() => {
    let live = true
    looseStoneService.list().then((rows) => { if (live) setStones(rows) }).catch((err) => { if (live) setError(getErrorMessage(err, 'Unable to load loose stones')) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const visible = useMemo(() => stones.filter((s) => (tab === 'all' || s.status === tab)
    && (!query.category || s.category === query.category)
    && (!query.q || `${s.stoneCode} ${s.name} ${s.variety} ${s.certificateNo} ${s.supplier}`.toLowerCase().includes(query.q.toLowerCase()))), [stones, tab, query])
  const inStock = stones.filter((s) => s.status === 'available' || s.status === 'reserved')
  const productName = (id: number | null) => (id == null ? '' : products.find((p) => Number(p.id) === id)?.name || `Item #${id}`)

  const openView = (s: LooseStone) => {
    setView(s); setMoves([])
    looseStoneService.movements(s.id).then(setMoves).catch(() => undefined)
  }
  const replace = (s: LooseStone) => { setStones((rows) => rows.map((r) => (r.id === s.id ? s : r))); if (view?.id === s.id) openView(s) }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    setSaving(true); setModalError('')
    try {
      const specs = Object.fromEntries(Object.entries(form.specs).filter(([, v]) => v.trim()))
      if (form.id) {
        const s = await looseStoneService.update(form.id, { name: form.name, variety: form.variety, originType: form.originType, specs, costPrice: Number(form.costPrice) || 0, sellingPrice: Number(form.sellingPrice) || 0, supplier: form.supplier, lab: form.lab, certificateNo: form.certificateNo, notes: form.notes })
        replace(s)
      } else {
        const s = await looseStoneService.create({
          stoneCode: form.stoneCode, category: form.category, name: form.name, variety: form.variety, originType: form.originType, specs, isLot: form.isLot,
          quantity: Math.round(Number(form.quantity) || 0), carat: Number(form.carat) || 0, costPrice: Number(form.costPrice) || 0, sellingPrice: Number(form.sellingPrice) || 0,
          supplier: form.supplier, purchaseDate: form.purchaseDate || null, lab: form.lab, certificateNo: form.certificateNo, notes: form.notes,
        })
        setStones((rows) => [s, ...rows])
      }
      setForm(null)
    } catch (err) { setModalError(getErrorMessage(err, 'Unable to save the stone')) } finally { setSaving(false) }
  }

  const runAction = async (e: FormEvent) => {
    e.preventDefault()
    if (!act) return
    setSaving(true); setModalError('')
    try {
      const qty = act.quantity.trim() === '' ? undefined : Math.round(Number(act.quantity))
      const ct = act.carat.trim() === '' ? undefined : Number(act.carat)
      if ((qty ?? 0) < 0 || (ct ?? 0) < 0) throw new Error('Quantity and carat cannot be negative.')
      const s = await looseStoneService.move(act.stone.id, act.action, {
        quantity: qty, carat: ct, productId: act.productId ? Number(act.productId) : null, reference: act.reference, note: act.note,
      })
      replace(s)
      setAct(null)
    } catch (err) { setModalError(getErrorMessage(err, 'Unable to update the stock')) } finally { setSaving(false) }
  }
  const startAction = (stone: LooseStone, action: LooseAction) => {
    setModalError('')
    const whole = action === 'reserve' || action === 'unreserve'
    setAct({ stone, action, quantity: whole ? '' : String(stone.isLot ? '' : stone.quantity), carat: whole ? '' : String(stone.isLot ? '' : stone.carat), productId: '', reference: '', note: '' })
  }

  const removeStone = async (s: LooseStone) => {
    const used = s.status === 'sold' || s.status === 'used_in_jewellery'
    if (!window.confirm(`Delete ${s.stoneCode} (${s.name})?${used ? `\n\nIt is ${LOOSE_STATUS_LABELS[s.status].toLowerCase()} — its stock history will be deleted too.` : ''}\n\nThis cannot be undone.`)) return
    try {
      await looseStoneService.remove(s.id)
      setStones((rows) => rows.filter((r) => r.id !== s.id))
      if (view?.id === s.id) setView(null)
    } catch (err) { setError(getErrorMessage(err, 'Unable to delete the stone')) }
  }

  const cfg = form ? CATEGORY_CONFIG[form.category] : null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3 text-[28px] font-black tracking-tight text-[#000000]"><Gem className="w-7 h-7 text-[var(--accent)]" /> Loose Stones</h2>
          <p className="mt-1 text-xs font-semibold text-[#000000]">Loose diamonds, gemstones and pearls (single stones or lots). A stone used in a piece or sold leaves the loose stock, so it is never counted twice.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadCsv(`loose-stones-${new Date().toISOString().slice(0, 10)}`, [
            ['Code', 'Category', 'Name', 'Variety', 'Type', 'Lot', 'Qty in stock', 'Carat in stock', 'Qty bought', 'Carat bought', 'Cost', 'Selling price', 'Supplier', 'Certificate', 'Status', 'Used in', 'Received'],
            ...visible.map((s) => [s.stoneCode, CATEGORY_LABELS[s.category], s.name, s.variety, s.originType, s.isLot ? 'Yes' : 'No', s.quantity, s.carat, s.quantityBought, s.caratBought, s.costPrice, s.sellingPrice, s.supplier, [s.lab, s.certificateNo].filter(Boolean).join(' '), LOOSE_STATUS_LABELS[s.status], productName(s.productId), csvDate(s.createdAt)]),
          ])} className="rounded-xl border-2 border-[var(--accent)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white cursor-pointer">Export CSV</button>
          {isAdmin && <button type="button" onClick={() => { setModalError(''); setForm(emptyForm()) }} className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white cursor-pointer"><Plus className="w-4 h-4" /> Add Stone / Lot</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['In stock', `${inStock.length} • ${inStock.reduce((a, s) => a + s.carat, 0).toFixed(3)} ct`],
          ['Stock value (cost)', formatCurrency(inStock.reduce((a, s) => a + (s.caratBought > 0 && s.isLot ? s.costPrice * (s.carat / s.caratBought) : s.costPrice), 0))],
          ['Used in jewellery', String(stones.filter((s) => s.status === 'used_in_jewellery').length)],
          ['Sold', String(stones.filter((s) => s.status === 'sold').length)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[0.15em]">{k}</p><p className="mt-2 text-lg font-black whitespace-nowrap">{v}</p></div>
        ))}
      </div>

      <FilterCard tabs={[{ id: 'available' as const, label: 'Available' }, { id: 'reserved' as const, label: 'Reserved' }, { id: 'used_in_jewellery' as const, label: 'Used' }, { id: 'sold' as const, label: 'Sold' }, { id: 'returned' as const, label: 'Returned' }, { id: 'damaged' as const, label: 'Damaged' }, { id: 'all' as const, label: 'All' }]}
        activeTab={tab} onTab={setTab} onSearch={() => setQuery(draft)}>
        <FilterField label="Search code / name / certificate" search><input className={`${filterInput} pl-9`} value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} placeholder="e.g. LS001, Ruby, GIA 21…" /></FilterField>
        <FilterField label="Category">
          <select className={`${filterInput} cursor-pointer`} value={draft.category} onChange={(e) => { setDraft((d) => ({ ...d, category: e.target.value })); setQuery((q) => ({ ...q, category: e.target.value })) }}>
            <option value="">All</option>{(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
        </FilterField>
      </FilterCard>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Code', 'Stone', 'In stock', 'Cost / Selling', 'Certificate', 'Status', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-black/5">
            {loading ? <tr><td colSpan={7} className="p-8 text-center">Loading…</td></tr>
              : visible.length === 0 ? <tr><td colSpan={7} className="p-8 text-center font-semibold text-[#000000]/60">No loose stones here.</td></tr>
                : visible.map((s) => (
                  <tr key={s.id} className="hover:bg-black/[0.02]">
                    <td className="px-4 py-3 font-black">{s.stoneCode}{s.isLot && <span className="ml-1 rounded bg-black/5 px-1.5 py-0.5 text-[9px]">LOT</span>}</td>
                    <td className="px-4 py-3"><p className="font-bold">{s.name}{s.variety ? ` · ${s.variety}` : ''}</p><p className="text-[10px] text-[#000000]/60">{[CATEGORY_LABELS[s.category], s.originType, ...Object.values(s.specs)].filter(Boolean).join(' · ')}</p></td>
                    <td className="px-4 py-3 whitespace-nowrap font-bold">{s.quantity} pc • {s.carat.toFixed(3)} ct<span className="block text-[10px] font-semibold text-[#000000]/50">bought {s.quantityBought} pc • {s.caratBought.toFixed(3)} ct</span></td>
                    <td className="px-4 py-3 whitespace-nowrap">{isAdmin ? formatCurrency(s.costPrice) : '—'}<span className="block font-black">{formatCurrency(s.sellingPrice)}</span></td>
                    <td className="px-4 py-3">{s.certificateNo ? `${s.lab} ${s.certificateNo}` : '—'}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${STATUS_TONE[s.status]}`}>{LOOSE_STATUS_LABELS[s.status].toUpperCase()}</span>{s.productId != null && <p className="mt-1 text-[10px]">in {productName(s.productId)}</p>}</td>
                    <td className="px-4 py-3"><div className="flex items-center gap-1.5">
                      <button type="button" title="View details and history" onClick={() => openView(s)} className={`${actionBtn} bg-black/5 hover:bg-black/10`}><EyeIcon className="w-4 h-4" /></button>
                      {isAdmin && <button type="button" title="Edit details" onClick={() => { setModalError(''); setForm({ id: s.id, stoneCode: s.stoneCode, category: s.category, name: s.name, variety: s.variety, originType: s.originType, specs: { ...s.specs }, isLot: s.isLot, quantity: String(s.quantity), carat: String(s.carat), costPrice: String(s.costPrice), sellingPrice: String(s.sellingPrice), supplier: s.supplier, purchaseDate: s.purchaseDate || '', lab: s.lab, certificateNo: s.certificateNo, notes: s.notes }) }} className={`${actionBtn} bg-[#2563EB]/10 text-[#2563EB] hover:bg-[#2563EB]/20`}><Edit2 className="w-4 h-4" /></button>}
                      {isAdmin && <button type="button" title="Delete stone / lot" onClick={() => void removeStone(s)} className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`}><Trash2 className="w-4 h-4" /></button>}
                    </div></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {view && (
        <DetailDrawer kicker={`${view.stoneCode} • ${CATEGORY_LABELS[view.category]}`} title={`${view.name}${view.variety ? ` · ${view.variety}` : ''}`}
          subtitle={[view.originType, ...Object.entries(view.specs).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(' • ')}
          onClose={() => setView(null)}
          stats={[{ label: 'In stock', value: `${view.quantity} pc • ${view.carat.toFixed(3)} ct` }, { label: 'Selling price', value: formatCurrency(view.sellingPrice) }, { label: 'Status', value: LOOSE_STATUS_LABELS[view.status], tone: view.status === 'available' ? 'green' : view.status === 'damaged' ? 'red' : undefined }]}>
          {isAdmin && (
            <div className="mb-4 flex flex-wrap gap-2">
              {view.status === 'available' && <button type="button" onClick={() => startAction(view, 'reserve')} className="rounded-lg border border-black/15 px-3 py-2 text-[10px] font-black uppercase">Reserve</button>}
              {view.status === 'reserved' && <button type="button" onClick={() => startAction(view, 'unreserve')} className="rounded-lg border border-black/15 px-3 py-2 text-[10px] font-black uppercase">Release reservation</button>}
              {(view.status === 'available' || view.status === 'reserved') && <>
                <button type="button" onClick={() => startAction(view, 'use')} className="rounded-lg bg-[#111111] px-3 py-2 text-[10px] font-black uppercase text-white">Use in jewellery</button>
                <button type="button" onClick={() => startAction(view, 'sell')} className="rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white">Sell</button>
                <button type="button" onClick={() => startAction(view, 'damage')} className="rounded-lg bg-red-600 px-3 py-2 text-[10px] font-black uppercase text-white">Damaged</button>
              </>}
              <button type="button" onClick={() => startAction(view, 'return')} className="rounded-lg border border-black/15 px-3 py-2 text-[10px] font-black uppercase">Return to stock</button>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-black/10">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['When', 'Action', 'Qty / ct', 'Ref / item', 'By'].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-black/5">
                {moves.length === 0 ? <tr><td colSpan={5} className="p-4 text-center text-[#000000]/60">No movements yet.</td></tr> : moves.map((m) => (
                  <tr key={m.id}><td className="px-3 py-2 whitespace-nowrap">{new Date(m.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-3 py-2 font-bold">{ACTION_LABELS[m.action] || m.action}</td><td className="px-3 py-2">{m.quantity} pc • {m.carat.toFixed(3)} ct</td>
                    <td className="px-3 py-2">{[m.reference, productName(m.productId), m.note].filter(Boolean).join(' · ') || '—'}</td><td className="px-3 py-2">{m.createdBy}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </DetailDrawer>
      )}

      {act && (
        <ModalPortal><div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setAct(null) }}>
          <form onSubmit={runAction} className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#1C1C1C] px-5 py-4"><h3 className="text-sm font-black uppercase tracking-wider text-white">{ACTION_LABELS[act.action]} • {act.stone.stoneCode}</h3><button type="button" onClick={() => setAct(null)} className="text-white"><X className="w-4 h-4" /></button></div>
            <div className="space-y-4 p-5">
              {modalError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</p>}
              <p className="text-xs font-semibold">In stock: {act.stone.quantity} pc • {act.stone.carat.toFixed(3)} ct</p>
              {act.action !== 'reserve' && act.action !== 'unreserve' && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={lbl}>Pieces</label><input type="number" min="0" step="1" className={field} value={act.quantity} onChange={(e) => setAct({ ...act, quantity: e.target.value })} /></div>
                  <div><label className={lbl}>Carat</label><input type="number" min="0" step="0.001" className={field} value={act.carat} onChange={(e) => setAct({ ...act, carat: e.target.value })} /></div>
                </div>
              )}
              {act.action === 'use' && (
                <div><label className={lbl}>Jewellery item it went into *</label>
                  <select required className={field} value={act.productId} onChange={(e) => setAct({ ...act, productId: e.target.value })}>
                    <option value="">Choose item</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
                  </select></div>
              )}
              <div><label className={lbl}>{act.action === 'sell' ? 'Invoice / customer' : 'Reference'}</label><input className={field} value={act.reference} onChange={(e) => setAct({ ...act, reference: e.target.value })} /></div>
              <div><label className={lbl}>Note</label><input className={field} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-3 border-t border-black/10 bg-[#FAFAFA] px-5 py-4">
              <button type="button" onClick={() => setAct(null)} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase text-black/60">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-[#111111] px-6 py-2.5 text-xs font-black uppercase text-white disabled:opacity-60">{saving ? 'Saving…' : 'Confirm'}</button>
            </div>
          </form>
        </div></ModalPortal>
      )}

      {form && cfg && (
        <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setForm(null) }}>
          <form onSubmit={save} className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#1C1C1C] px-5 py-4"><h3 className="text-sm font-black uppercase tracking-wider text-white">{form.id ? `Edit ${form.stoneCode}` : 'Add Loose Stone / Lot'}</h3><button type="button" onClick={() => setForm(null)} className="text-white"><X className="w-4 h-4" /></button></div>
            <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              {modalError && <p className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</p>}
              <div><label className={lbl}>Stone / lot code *</label><input required disabled={Boolean(form.id)} className={field} value={form.stoneCode} onChange={(e) => setForm({ ...form, stoneCode: e.target.value })} /></div>
              <div><label className={lbl}>Category</label>
                <select disabled={Boolean(form.id)} className={field} value={form.category} onChange={(e) => { const c = e.target.value as MaterialCategory; setForm({ ...form, category: c, name: CATEGORY_CONFIG[c].names[0], originType: CATEGORY_CONFIG[c].origins[0]?.[0] || '', specs: {} }) }}>
                  {(Object.keys(CATEGORY_LABELS) as MaterialCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                </select></div>
              <div><label className={lbl}>Name *</label><input required list="loose-names" className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><datalist id="loose-names">{cfg.names.map((n) => <option key={n} value={n} />)}</datalist></div>
              <div><label className={lbl}>Variety / origin</label><input className={field} value={form.variety} onChange={(e) => setForm({ ...form, variety: e.target.value })} /></div>
              {cfg.origins.length > 0 && <div><label className={lbl}>Natural / lab / other</label><select className={field} value={form.originType} onChange={(e) => setForm({ ...form, originType: e.target.value })}>{cfg.origins.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
              {cfg.specs.map((sp) => (
                <div key={sp.key}><label className={lbl}>{sp.label}</label>
                  {sp.options ? <select className={field} value={form.specs[sp.key] || ''} onChange={(e) => setForm({ ...form, specs: { ...form.specs, [sp.key]: e.target.value } })}><option value="">—</option>{sp.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                    : <input className={field} value={form.specs[sp.key] || ''} onChange={(e) => setForm({ ...form, specs: { ...form.specs, [sp.key]: e.target.value } })} />}
                </div>
              ))}
              {!form.id && <>
                <label className="sm:col-span-2 flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={form.isLot} onChange={(e) => setForm({ ...form, isLot: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" /> This is a lot (several stones tracked together)</label>
                <div><label className={lbl}>Pieces</label><input type="number" min="0" step="1" className={field} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
                <div><label className={lbl}>Total carat</label><input type="number" min="0" step="0.001" className={field} value={form.carat} onChange={(e) => setForm({ ...form, carat: e.target.value })} /></div>
              </>}
              {isAdmin && <div><label className={lbl}>Purchase cost (₹)</label><input type="number" min="0" step="0.01" className={field} value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></div>}
              <div><label className={lbl}>Selling price (₹)</label><input type="number" min="0" step="0.01" className={field} value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} /></div>
              <div><label className={lbl}>Supplier</label><input className={field} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
              {!form.id && <div><label className={lbl}>Purchase date</label><input type="date" className={field} value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></div>}
              <div><label className={lbl}>Certificate lab</label><input className={field} placeholder="GIA, IGI…" value={form.lab} onChange={(e) => setForm({ ...form, lab: e.target.value })} /></div>
              <div><label className={lbl}>Certificate no.</label><input className={field} value={form.certificateNo} onChange={(e) => setForm({ ...form, certificateNo: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={lbl}>Notes</label><input className={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              {form.id && <p className="sm:col-span-2 text-[11px] font-semibold text-[#000000]/60">Stock changes (sell, use, return, damage) are made from the stone's details so each one is logged.</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-black/10 bg-[#FAFAFA] px-5 py-4">
              <button type="button" onClick={() => setForm(null)} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase text-black/60">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-[#111111] px-6 py-2.5 text-xs font-black uppercase text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div></ModalPortal>
      )}
    </div>
  )
}
