import { useEffect, useState } from 'react'
import { Gem, X } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { formatCurrency } from '../../lib/retail'
import { getErrorMessage } from '../../lib/errorMessage'
import { CATEGORY_LABELS, looseStoneService, type LooseStone } from '../../services/stoneRateService'

const field = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-[#000000] outline-none focus:border-[#111111]'
const lbl = 'mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/70'

/** Suggested price for part of a stone / lot: its selling price shared out by carat (or by pieces). */
const suggestedPrice = (s: LooseStone, qty: number, carat: number) => {
  if (!s.isLot) return s.sellingPrice
  if (s.carat > 0 && carat > 0) return Math.round((s.sellingPrice * carat / s.carat) * 100) / 100
  if (s.quantity > 0 && qty > 0) return Math.round((s.sellingPrice * qty / s.quantity) * 100) / 100
  return s.sellingPrice
}

/** Billing: pick an in-stock loose stone (or part of a lot) to sell on this bill. */
export function LooseStonePicker({ onClose, onAdd, alreadyOnBill }: {
  onClose: () => void
  onAdd: (stone: LooseStone, quantity: number, carat: number, price: number) => void
  /** Stone ids already on the bill (a stone can be billed once per bill) */
  alreadyOnBill: string[]
}) {
  const [stones, setStones] = useState<LooseStone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<{ stone: LooseStone; qty: string; carat: string; price: string } | null>(null)

  useEffect(() => {
    let live = true
    looseStoneService.list()
      .then((rows) => { if (live) setStones(rows.filter((s) => (s.status === 'available' || s.status === 'reserved') && !alreadyOnBill.includes(s.id))) })
      .catch((err) => { if (live) setError(getErrorMessage(err, 'Unable to load loose stones')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [alreadyOnBill])

  const visible = stones.filter((s) => !q || `${s.stoneCode} ${s.name} ${s.variety} ${s.certificateNo}`.toLowerCase().includes(q.toLowerCase()))
  const pick = (s: LooseStone) => setPicked({ stone: s, qty: String(s.quantity), carat: String(s.carat), price: String(s.sellingPrice || '') })
  const add = () => {
    if (!picked) return
    const qty = Math.round(Number(picked.qty) || 0)
    const carat = Number(picked.carat) || 0
    const price = Number(picked.price) || 0
    const s = picked.stone
    if (qty < 0 || carat < 0) { setError('Quantity and carat cannot be negative.'); return }
    if (qty === 0 && carat === 0) { setError('Enter the pieces or carat being sold.'); return }
    if (qty > s.quantity || carat > s.carat + 0.0005) { setError(`Only ${s.quantity} pc / ${s.carat.toFixed(3)} ct of ${s.stoneCode} are in stock.`); return }
    if (!(price > 0)) { setError('Enter the selling price.'); return }
    onAdd(s, qty, carat, price)
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#1C1C1C] px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white"><Gem className="w-4 h-4" /> Sell a Loose Stone</h3>
          <button type="button" onClick={onClose} className="text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
          {!picked ? <>
            <input className={field} placeholder="Search code, name or certificate…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            {loading ? <p className="text-xs">Loading…</p> : error ? null : visible.length === 0 ? <p className="text-xs font-semibold text-[#000000]/60">No loose stones in stock. Add them in Inventory → Loose Stones.</p> : (
              <div className="divide-y divide-black/5 rounded-xl border border-black/10">
                {visible.map((s) => (
                  <button key={s.id} type="button" onClick={() => pick(s)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-black/[0.03] cursor-pointer">
                    <span className="min-w-0">
                      <span className="block text-sm font-black">{s.stoneCode} · {s.name}{s.variety ? ` · ${s.variety}` : ''}{s.status === 'reserved' && <span className="ml-1 text-[9px] font-black text-blue-700">RESERVED</span>}</span>
                      <span className="block text-[10px] text-[#000000]/60">{[CATEGORY_LABELS[s.category], s.originType, ...Object.values(s.specs), s.certificateNo ? `${s.lab} ${s.certificateNo}` : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs font-bold">{s.quantity} pc • {s.carat.toFixed(3)} ct<span className="block font-black">{formatCurrency(s.sellingPrice)}</span></span>
                  </button>
                ))}
              </div>
            )}
          </> : <>
            <p className="text-sm font-black">{picked.stone.stoneCode} · {picked.stone.name}</p>
            <p className="text-xs">In stock: {picked.stone.quantity} pc • {picked.stone.carat.toFixed(3)} ct{picked.stone.isLot ? ' (lot — sell part or all)' : ''}</p>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={lbl}>Pieces</label><input type="number" min="0" step="1" disabled={!picked.stone.isLot} className={field} value={picked.qty}
                onChange={(e) => setPicked({ ...picked, qty: e.target.value, price: String(suggestedPrice(picked.stone, Number(e.target.value) || 0, Number(picked.carat) || 0)) })} /></div>
              <div><label className={lbl}>Carat</label><input type="number" min="0" step="0.001" disabled={!picked.stone.isLot} className={field} value={picked.carat}
                onChange={(e) => setPicked({ ...picked, carat: e.target.value, price: String(suggestedPrice(picked.stone, Number(picked.qty) || 0, Number(e.target.value) || 0)) })} /></div>
              <div><label className={lbl}>Price (₹)</label><input type="number" min="0" step="0.01" className={field} value={picked.price} onChange={(e) => setPicked({ ...picked, price: e.target.value })} /></div>
            </div>
            <p className="text-[11px] font-semibold text-[#000000]/60">The stone is marked sold in Loose Stones when this bill is completed.</p>
          </>}
        </div>
        {picked && (
          <div className="flex justify-end gap-3 border-t border-black/10 bg-[#FAFAFA] px-5 py-4">
            <button type="button" onClick={() => { setPicked(null); setError('') }} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase text-black/60">Back</button>
            <button type="button" onClick={add} className="rounded-xl bg-[#111111] px-6 py-2.5 text-xs font-black uppercase text-white">Add to Bill</button>
          </div>
        )}
      </div>
    </div></ModalPortal>
  )
}
