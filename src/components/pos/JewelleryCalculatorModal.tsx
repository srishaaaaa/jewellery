import { useState } from 'react'
import { Calculator, X } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { formatCurrency } from '../../lib/retail'
import { useMetalRateStore } from '../../store/metalRateStore'
import {
  calculateJewelleryPrice, calculateNetWeight, resolveRate, GOLD_PURITIES, MAKING_CHARGE_TYPE_LABELS, STANDARD_PURITY, WASTAGE_TYPE_LABELS,
  type MakingChargeType, type RatedMetal, type WastageType,
} from '../../lib/jewellery'

const inputClass = 'w-full h-9 rounded-xl border border-gray-200 bg-white px-3 text-[13px] font-bold text-[#111111] outline-none focus:border-[var(--accent)]'
const label = 'mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]'
const num = (v: string) => Math.max(0, Number(v) || 0)

/**
 * Quick estimate for staff ("what would 8.42 g of 22K cost?"). Uses the same pricing function
 * as billing, but saves nothing: the bill is always priced again from the item itself.
 */
export function JewelleryCalculatorModal({ onClose }: { onClose: () => void }) {
  const rates = useMetalRateStore((s) => s.rates)
  const [f, setF] = useState({
    metal: 'gold' as RatedMetal, purity: '22K', gross: '', stone: '', other: '', rate: '',
    makingType: 'percentage' as MakingChargeType, making: '', wastageType: 'percentage' as WastageType, wastage: '',
    stoneCharge: '', otherCharge: '', discount: '', gst: '3',
  })
  const set = (patch: Partial<typeof f>) => setF((cur) => ({ ...cur, ...patch }))

  const todayRate = resolveRate(f.metal, f.metal === 'gold' ? f.purity : STANDARD_PURITY, rates)?.ratePerGram || 0
  const rate = f.rate.trim() === '' ? todayRate : num(f.rate)
  const net = calculateNetWeight(num(f.gross), num(f.stone), num(f.other))
  const price = calculateJewelleryPrice({
    netWeight: net, ratePerGram: rate, makingCharge: num(f.making), makingChargeType: f.makingType,
    wastage: num(f.wastage), wastageType: f.wastageType, stoneCharge: num(f.stoneCharge), otherCharge: num(f.otherCharge),
  })
  const discount = Math.min(price.total, num(f.discount))
  const taxable = Math.round((price.total - discount) * 100) / 100
  const gst = Math.round(taxable * num(f.gst)) / 100
  const final = Math.round((taxable + gst) * 100) / 100
  const weightError = num(f.stone) + num(f.other) > num(f.gross) && num(f.gross) > 0

  const rows: Array<[string, string]> = [
    [`Metal value (${net.toFixed(3)} g × ${formatCurrency(rate)})`, formatCurrency(price.metalValue)],
    ['Making charge', formatCurrency(price.makingAmount)],
    [`Wastage${f.wastageType === 'percentage' ? '' : ` (${price.wastageWeight.toFixed(3)} g)`}`, formatCurrency(price.wastageAmount)],
    ['Stone charge', formatCurrency(price.stoneCharge)],
    ['Other charge', formatCurrency(price.otherCharge)],
    ['Subtotal', formatCurrency(price.total)],
    ['Discount', `− ${formatCurrency(discount)}`],
    [`GST ${num(f.gst)}% on ${formatCurrency(taxable)}`, formatCurrency(gst)],
  ]

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/55 p-3 sm:p-4">
        <div className="flex w-full max-w-2xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
          <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[.16em] text-[var(--accent-dark)]">Estimate only · nothing is saved</p>
              <h3 className="flex items-center gap-2 text-lg sm:text-xl font-black text-[#111111]"><Calculator size={18} /> Jewellery Calculator</h3>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 shrink-0" aria-label="Close"><X size={20} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4 grid gap-4 md:grid-cols-[1fr_260px]">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
              <label><span className={label}>Metal</span>
                <select className={inputClass} value={f.metal} onChange={(e) => set({ metal: e.target.value as RatedMetal, rate: '' })}>
                  <option value="gold">Gold</option><option value="silver">Silver</option><option value="platinum">Platinum</option>
                </select>
              </label>
              <label><span className={label}>Purity</span>
                {f.metal === 'gold'
                  ? <select className={inputClass} value={f.purity} onChange={(e) => set({ purity: e.target.value, rate: '' })}>{GOLD_PURITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                  : <div className={`${inputClass} flex items-center bg-gray-50 text-gray-500`}>Standard</div>}
              </label>
              <label><span className={label}>Rate (₹/g)</span><input type="number" min="0" step="0.01" className={inputClass} value={f.rate} onChange={(e) => set({ rate: e.target.value })} placeholder={todayRate ? String(todayRate) : 'No rate today'} /></label>
              <label><span className={label}>Gross wt (g)</span><input type="number" min="0" step="0.001" className={inputClass} value={f.gross} onChange={(e) => set({ gross: e.target.value })} /></label>
              <label><span className={label}>Stone wt (g)</span><input type="number" min="0" step="0.001" className={inputClass} value={f.stone} onChange={(e) => set({ stone: e.target.value })} /></label>
              <label><span className={label}>Other wt (g)</span><input type="number" min="0" step="0.001" className={inputClass} value={f.other} onChange={(e) => set({ other: e.target.value })} /></label>
              <label><span className={label}>Making</span>
                <select className={inputClass} value={f.makingType} onChange={(e) => set({ makingType: e.target.value as MakingChargeType })}>
                  {(Object.keys(MAKING_CHARGE_TYPE_LABELS) as MakingChargeType[]).map((k) => <option key={k} value={k}>{MAKING_CHARGE_TYPE_LABELS[k]}</option>)}
                </select>
              </label>
              <label><span className={label}>{f.makingType === 'percentage' ? 'Making %' : f.makingType === 'per_gram' ? 'Making ₹/g' : 'Making ₹'}</span><input type="number" min="0" step="0.01" className={inputClass} value={f.making} onChange={(e) => set({ making: e.target.value })} /></label>
              <label><span className={label}>Wastage</span>
                <select className={inputClass} value={f.wastageType} onChange={(e) => set({ wastageType: e.target.value as WastageType })}>
                  {(Object.keys(WASTAGE_TYPE_LABELS) as WastageType[]).map((k) => <option key={k} value={k}>{WASTAGE_TYPE_LABELS[k]}</option>)}
                </select>
              </label>
              <label><span className={label}>{f.wastageType === 'grams' ? 'Wastage (g)' : 'Wastage %'}</span><input type="number" min="0" step="0.001" className={inputClass} value={f.wastage} onChange={(e) => set({ wastage: e.target.value })} /></label>
              <label><span className={label}>Stone charge ₹</span><input type="number" min="0" step="0.01" className={inputClass} value={f.stoneCharge} onChange={(e) => set({ stoneCharge: e.target.value })} /></label>
              <label><span className={label}>Other charge ₹</span><input type="number" min="0" step="0.01" className={inputClass} value={f.otherCharge} onChange={(e) => set({ otherCharge: e.target.value })} /></label>
              <label><span className={label}>Discount ₹</span><input type="number" min="0" step="0.01" className={inputClass} value={f.discount} onChange={(e) => set({ discount: e.target.value })} /></label>
              <label><span className={label}>GST %</span><input type="number" min="0" step="0.01" className={inputClass} value={f.gst} onChange={(e) => set({ gst: e.target.value })} /></label>
            </div>
            <div className="rounded-2xl bg-[var(--accent-a10)] p-3 text-[12px] font-bold text-[#374151] space-y-1 self-start">
              <div className="flex justify-between text-[11px] text-[#6B7280]"><span>Gross − Stone − Other</span><span>{net.toFixed(3)} g net</span></div>
              {weightError && <p className="text-[11px] text-red-600">Stone + other weight is more than the gross weight.</p>}
              {!rate && <p className="text-[11px] text-red-600">No rate is set for today. Enter one.</p>}
              {rows.map(([k, v]) => <div key={k} className={`flex justify-between gap-2 ${k === 'Subtotal' ? 'border-t border-[var(--accent-a30)] pt-1' : ''}`}><span>{k}</span><span className="whitespace-nowrap">{v}</span></div>)}
              <div className="flex justify-between border-t border-[var(--accent-a30)] pt-1 text-[15px] font-black text-[#111111]"><span>Estimated total</span><span>{formatCurrency(final)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
