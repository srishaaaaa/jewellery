import React, { useState } from 'react'
import { X, PlusCircle, AlertCircle } from 'lucide-react'
import { useLangStore } from '../../store/langStore'
import { getErrorMessage } from '../../lib/errorMessage'
import { UNIT_OPTIONS, UNIT_GROUPS } from '../../lib/units'
import { ModalPortal } from '../ModalPortal'
import { formatCurrency } from '../../lib/retail'
import { useMetalRateStore } from '../../store/metalRateStore'
import {
  CUSTOM_PURITY,
  GOLD_PURITIES,
  METAL_LABELS,
  STANDARD_PURITY,
  calculateNetWeight,
  isRatedMetal,
  priceJewelleryItem,
  type JewellerySnapshot,
  type MakingChargeType,
  type MetalType,
  type WastageType,
} from '../../lib/jewellery'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSubmit: (item: {
    name: string
    price: number
    quantity: number
    note?: string
    unit?: string
    unitType?: 'unit' | 'weight' | 'volume' | 'bundle'
    /** Set for a gold/silver/platinum piece priced from today's metal rate. */
    jewellery?: JewellerySnapshot | null
  }) => Promise<void>
}

export const AddUnregisteredItemModal: React.FC<Props> = ({ isOpen, onClose, onSubmit }) => {
  const { lang } = useLangStore()
  const l = (en: string, ta: string) => (lang === 'ta' ? ta : en)

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [unitChoice, setUnitChoice] = useState('pcs')
  const [customUnitLabel, setCustomUnitLabel] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Jewellery piece weighed at the counter: priced from today's metal rate
  const rates = useMetalRateStore((st) => st.rates)
  const [metalType, setMetalType] = useState<MetalType | ''>('')
  const [purity, setPurity] = useState('22K')
  const [customPurity, setCustomPurity] = useState('')
  const [grossWeight, setGrossWeight] = useState('')
  const [stoneWeight, setStoneWeight] = useState('')
  const [makingCharge, setMakingCharge] = useState('')
  const [makingChargeType, setMakingChargeType] = useState<MakingChargeType>('fixed')
  const [wastage, setWastage] = useState('')
  const [wastageType, setWastageType] = useState<WastageType>('percentage')
  const [stoneCharge, setStoneCharge] = useState('')
  const [otherCharge, setOtherCharge] = useState('')
  const [huid, setHuid] = useState('')

  const isJewellery = isRatedMetal(metalType || null)
  const netWeight = calculateNetWeight(parseFloat(grossWeight) || 0, parseFloat(stoneWeight) || 0)
  const effectivePurity = metalType === 'gold'
    ? (purity === CUSTOM_PURITY ? customPurity.trim().toUpperCase() : purity)
    : STANDARD_PURITY
  const priced = isJewellery
    ? priceJewelleryItem({
        metalType: metalType as MetalType,
        purity: effectivePurity,
        grossWeight: parseFloat(grossWeight) || 0,
        stoneWeight: parseFloat(stoneWeight) || 0,
        netWeight,
        makingCharge: parseFloat(makingCharge) || 0,
        makingChargeType,
        wastage: parseFloat(wastage) || 0,
        wastageType,
        stoneCharge: parseFloat(stoneCharge) || 0,
        otherCharge: parseFloat(otherCharge) || 0,
        huid: huid.trim().toUpperCase(),
        designNumber: '',
        subcategory: '',
      }, rates)
    : null

  const resetJewellery = () => {
    setMetalType('')
    setPurity('22K')
    setCustomPurity('')
    setGrossWeight('')
    setStoneWeight('')
    setMakingCharge('')
    setMakingChargeType('fixed')
    setWastage('')
    setWastageType('percentage')
    setStoneCharge('')
    setOtherCharge('')
    setHuid('')
  }

  const selectedUnit = UNIT_OPTIONS.find((o) => o.value === unitChoice) || UNIT_OPTIONS[0]
  // For a one-off ad-hoc item, any weight/volume unit is decimal-billable immediately —
  // there's no persisted catalog entry to misconfigure, unlike a real saved product.
  const isDecimalUnit = selectedUnit.unitType === 'weight' || selectedUnit.unitType === 'volume'

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(l('Item name is required', 'பொருளின் பெயர் தேவை'))
      return
    }

    if (isJewellery) {
      if ((parseFloat(stoneWeight) || 0) > (parseFloat(grossWeight) || 0)) { setError('Stone weight cannot be more than the gross weight.'); return }
      if (netWeight <= 0) { setError('Enter the gross weight so the net weight is greater than zero.'); return }
      if (!priced || !priced.ok) { setError(priced && !priced.ok ? priced.error : 'Unable to price this item.'); return }
      const numQtyJ = Math.round(Number(quantity))
      if (!numQtyJ || numQtyJ < 1) { setError('Quantity must be at least 1'); return }
      try {
        setIsSubmitting(true)
        await onSubmit({
          name: trimmedName,
          price: priced.snapshot.unit_price,
          quantity: numQtyJ,
          note: note.trim() || undefined,
          unit: 'pcs',
          unitType: 'unit',
          jewellery: priced.snapshot,
        })
        setName('')
        setQuantity('1')
        setNote('')
        setError('')
        resetJewellery()
        onClose()
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Failed to add item'))
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    const numPrice = Number(price)
    if (isNaN(numPrice) || numPrice <= 0) {
      setError(l('Enter a valid price', 'சரியான விலையை உள்ளிடவும்'))
      return
    }

    if (unitChoice === 'custom' && !customUnitLabel.trim()) {
      setError(l('Type the custom unit name, or pick one from the list', 'தனிப்பயன் அளவை உள்ளிடவும்'))
      return
    }

    const numQty = Number(quantity)
    const minQty = isDecimalUnit ? 0.001 : 1
    if (isNaN(numQty) || numQty < minQty) {
      setError(isDecimalUnit
        ? l('Enter a valid quantity', 'சரியான எண்ணிக்கையை உள்ளிடவும்')
        : l('Quantity must be at least 1', 'எண்ணிக்கை குறைந்தது 1 ஆக இருக்க வேண்டும்'))
      return
    }

    const unitLabel = unitChoice === 'custom' ? (customUnitLabel.trim() || 'unit') : selectedUnit.suffix

    try {
      setIsSubmitting(true)
      await onSubmit({
        name: trimmedName,
        price: numPrice,
        quantity: numQty,
        note: note.trim() || undefined,
        unit: unitLabel,
        unitType: unitChoice === 'custom' ? 'unit' : selectedUnit.unitType,
      })
      setName('')
      setPrice('')
      setUnitChoice('pcs')
      setCustomUnitLabel('')
      setQuantity('1')
      setNote('')
      setError('')
      onClose()
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to add item')
      setError(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalPortal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-[var(--accent-a20)] animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b border-gray-200 flex items-center justify-between bg-[#FBFAF6] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
              <PlusCircle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#111111]">
                {l('Add Ad-Hoc Item', 'புதிய பொருளைச் சேர்')}
              </h3>
              <p className="text-[10px] text-gray-500 font-semibold">
                {l('Direct billing without inventory check', 'சரக்கு சரிபார்ப்பு இல்லாத பில்லிங்')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 text-xs">
          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block font-bold text-[#374151] mb-1">
              {l('Item Name *', 'பொருளின் பெயர் *')}
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={l('e.g. 22K Gold Chain, Silver Anklet, Repair Charge', 'எ.கா. 22K தங்கச் சங்கிலி, வெள்ளி கொலுசு')}
              className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-semibold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors"
            />
          </div>

          <div>
            <label className="block font-bold text-[#374151] mb-1">Metal Type</label>
            <select
              value={metalType}
              onChange={(e) => setMetalType(e.target.value as MetalType | '')}
              className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors touch-manipulation appearance-none relative z-20"
            >
              <option value="">Not jewellery (enter price)</option>
              {(['gold', 'silver', 'platinum'] as const).map((m) => <option key={m} value={m}>{METAL_LABELS[m]} (priced from today's rate)</option>)}
            </select>
          </div>

          {isJewellery && (
            <div className="space-y-3 p-3 rounded-xl border border-gray-200 bg-white">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Purity</label>
                  {metalType === 'gold' ? (
                    <div className="flex gap-2">
                      <select value={purity} onChange={(e) => setPurity(e.target.value)} className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors touch-manipulation appearance-none relative z-20">
                        {GOLD_PURITIES.map((pu) => <option key={pu} value={pu}>{pu}</option>)}
                        <option value={CUSTOM_PURITY}>Custom</option>
                      </select>
                      {purity === CUSTOM_PURITY && (
                        <input type="text" required placeholder="19K / 916" value={customPurity} onChange={(e) => setCustomPurity(e.target.value)} className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                      )}
                    </div>
                  ) : (
                    <div className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors text-gray-500">Standard</div>
                  )}
                </div>
                <div>
                  <label className="block font-bold text-[#374151] mb-1">HUID (Optional)</label>
                  <input type="text" value={huid} onChange={(e) => setHuid(e.target.value.toUpperCase())} placeholder="e.g. AB12CD" className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Gross Wt (g) *</label>
                  <input type="number" min="0" step="0.001" inputMode="decimal" required value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} placeholder="0.000" className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                </div>
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Stone Wt (g)</label>
                  <input type="number" min="0" step="0.001" inputMode="decimal" value={stoneWeight} onChange={(e) => setStoneWeight(e.target.value)} placeholder="0.000" className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                </div>
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Net Wt (g)</label>
                  <div className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors text-gray-500">{netWeight.toFixed(3)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Making Charge</label>
                  <div className="flex gap-1.5">
                    <select value={makingChargeType} onChange={(e) => setMakingChargeType(e.target.value as MakingChargeType)} aria-label="Making charge type" className="w-16 shrink-0 px-2 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20">
                      <option value="fixed">₹</option>
                      <option value="per_gram">₹/g</option>
                      <option value="percentage">%</option>
                    </select>
                    <input type="number" min="0" step="0.01" value={makingCharge} onChange={(e) => setMakingCharge(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Wastage</label>
                  <div className="flex gap-1.5">
                    <select value={wastageType} onChange={(e) => setWastageType(e.target.value as WastageType)} aria-label="Wastage type" className="w-16 shrink-0 px-2 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20">
                      <option value="percentage">%</option>
                      <option value="grams">g</option>
                    </select>
                    <input type="number" min="0" step="0.001" value={wastage} onChange={(e) => setWastage(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Stone Charge (₹)</label>
                  <input type="number" min="0" step="0.01" value={stoneCharge} onChange={(e) => setStoneCharge(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                </div>
                <div>
                  <label className="block font-bold text-[#374151] mb-1">Other Charge (₹)</label>
                  <input type="number" min="0" step="0.01" value={otherCharge} onChange={(e) => setOtherCharge(e.target.value)} placeholder="0" className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors" />
                </div>
              </div>
              {priced && priced.ok ? (
                <div className="rounded-xl bg-[#FBFAF6] border border-gray-200 p-2.5 space-y-0.5 text-[11px] font-bold text-[#374151]">
                  <div className="flex justify-between"><span>Metal value ({priced.snapshot.net_weight.toFixed(3)} g × {formatCurrency(priced.snapshot.rate_per_gram)}/g)</span><span>{formatCurrency(priced.snapshot.metal_value)}</span></div>
                  <div className="flex justify-between"><span>Making + Wastage</span><span>{formatCurrency(priced.snapshot.making_amount + priced.snapshot.wastage_amount)}</span></div>
                  {priced.snapshot.stone_charge + priced.snapshot.other_charge > 0 && <div className="flex justify-between"><span>Stone + Other</span><span>{formatCurrency(priced.snapshot.stone_charge + priced.snapshot.other_charge)}</span></div>}
                  <div className="flex justify-between pt-1 border-t border-gray-200 text-[#111111] text-xs font-black"><span>Price per piece</span><span>{formatCurrency(priced.snapshot.unit_price)}</span></div>
                </div>
              ) : netWeight > 0 && priced && !priced.ok ? (
                <p className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-800">{priced.error}</p>
              ) : null}
            </div>
          )}

          {!isJewellery && (
          <div>
            <label className="block font-bold text-[#374151] mb-1">
              {l('Unit', 'அளவு வகை')}
            </label>
            <div className="flex gap-2">
              <select
                value={unitChoice}
                onChange={(e) => setUnitChoice(e.target.value)}
                className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors touch-manipulation appearance-none relative z-20"
              >
                {UNIT_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {UNIT_OPTIONS.filter((o) => o.group === group).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {unitChoice === 'custom' && (
                <input
                  type="text"
                  required
                  placeholder={l('e.g. Sack', 'எ.கா. சாக்கு')}
                  value={customUnitLabel}
                  onChange={(e) => setCustomUnitLabel(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors"
                />
              )}
            </div>
          </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {!isJewellery && (
            <div>
              <label className="block font-bold text-[#374151] mb-1">
                {l('Price (₹) *', 'விலை (₹) *')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required={!isJewellery}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors"
              />
            </div>
            )}
            <div>
              <label className="block font-bold text-[#374151] mb-1">
                {l('Quantity *', 'எண்ணிக்கை *')} {isDecimalUnit ? `(${selectedUnit.suffix})` : ''}
              </label>
              <input
                type="number"
                min={isDecimalUnit ? '0.001' : '1'}
                step={isDecimalUnit ? '0.001' : '1'}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-[#374151] mb-1">
              {l('Notes / Size (Optional)', 'குறிப்பு / அளவு (விருப்பமானது)')}
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={l('e.g. Ring size 14, customer\'s own stone', 'எ.கா. மோதிர அளவு 14')}
              className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-semibold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors"
            />
          </div>

          <div className="p-2.5 bg-amber-50/80 border border-amber-200 rounded-xl text-[11px] text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {l(
                'This item will be billed without checking or deducting inventory stock. It is tagged as Unregistered.',
                'இந்த பொருள் சரக்கு இருப்பை குறைக்காமல் பில் செய்யப்படும். இது Unregistered பிரிவில் சேமிக்கப்படும்.'
              )}
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3 text-[11px] font-bold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              {l('Cancel', 'ரத்து')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-8 px-3.5 text-[11px] font-bold rounded-lg bg-[#0A0A0A] text-[var(--accent)] border border-[var(--accent)] hover:bg-[#1A1A1A] transition-all shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <span className="w-3 h-3 border-2 border-[var(--accent-a30)] border-t-[var(--accent)] rounded-full animate-spin inline-block" />
                  <span>{l('Adding...', 'சேர்க்கிறது...')}</span>
                </>
              ) : (
                <>
                  <PlusCircle className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>{l('Add to Bill', 'பில்லில் சேர்')}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div></ModalPortal>
  )
}
