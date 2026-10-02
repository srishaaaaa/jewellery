import React, { useState } from 'react'
import { X, PlusCircle, AlertCircle } from 'lucide-react'
import { useLangStore } from '../../store/langStore'
import { getErrorMessage } from '../../lib/errorMessage'
import { UNIT_OPTIONS, UNIT_GROUPS } from '../../lib/units'
import { ModalPortal } from '../ModalPortal'

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
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-[#B7E1BE]/50 animate-in fade-in zoom-in-95">
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
              placeholder={l('e.g. Alteration Charge, Custom Dupatta', 'எ.கா. தையல் கட்டணம், துப்பட்டா')}
              className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-semibold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors"
            />
          </div>

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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-[#374151] mb-1">
                {l('Price (₹) *', 'விலை (₹) *')}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white transition-colors"
              />
            </div>
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
              {l('Variant / Notes / Size (Optional)', 'வகை / குறிப்பு / அளவு (விருப்பமானது)')}
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={l('e.g. Size 38, Maroon, Urgent Stitching', 'எ.கா. அளவு 38, அவசரம்')}
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
