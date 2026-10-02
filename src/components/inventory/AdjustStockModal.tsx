import React, { useState, useEffect } from 'react'
import {
  X,
  SlidersHorizontal,
  AlertCircle,
  CheckCircle2,
  Plus,
  Minus,
  Undo2,
  Target,
  ArrowRight,
  Package,
} from 'lucide-react'
import { inventoryService, type InventoryStockItem } from '../../services/inventoryService'
import { BRAND_EN } from '../../lib/brand'
import { getErrorMessage } from '../../lib/errorMessage'
import { useSound } from '../../context/SoundContext'
import { ModalPortal } from '../ModalPortal'

export interface AdjustStockModalProps {
  isOpen: boolean
  onClose: () => void
  item: InventoryStockItem | null
  onSuccess?: () => void
}

type AdjustMode = 'RESTOCK' | 'RETURN' | 'DAMAGE' | 'CORRECTION'

// One entry per adjustment type card. `reason` is the movement type logged in inventory_movements.
const MODES: Record<AdjustMode, {
  label: string
  hint: string
  Icon: typeof Plus
  reason: 'RESTOCK' | 'RETURN' | 'DAMAGE' | 'CORRECTION'
  activeCard: string
  activeIcon: string
  panel: string
  text: string
  stepBtn: string
  input: string
  presetActive: string
  presetIdle: string
  qtyLabel: string
  notePlaceholder: string
}> = {
  RESTOCK: {
    label: 'Restock', hint: '+ Add Units', Icon: Plus, reason: 'RESTOCK',
    activeCard: 'bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-500/20',
    activeIcon: 'bg-emerald-500 text-white',
    panel: 'bg-emerald-50/60 border-emerald-200', text: 'text-emerald-900',
    stepBtn: 'hover:bg-emerald-100 text-emerald-900 border-emerald-300',
    input: 'border-emerald-400 text-emerald-950 focus:border-emerald-600',
    presetActive: 'bg-emerald-600 text-white border-emerald-600', presetIdle: 'text-emerald-900 border-emerald-200 hover:bg-emerald-100',
    qtyLabel: 'Quantity to Add (Restock)', notePlaceholder: 'e.g. Received new stock shipment / batch delivery',
  },
  RETURN: {
    label: 'Customer Return', hint: '+ Add Units', Icon: Undo2, reason: 'RETURN',
    activeCard: 'bg-sky-50 border-sky-500 text-sky-900 ring-2 ring-sky-500/20',
    activeIcon: 'bg-sky-500 text-white',
    panel: 'bg-sky-50/60 border-sky-200', text: 'text-sky-900',
    stepBtn: 'hover:bg-sky-100 text-sky-900 border-sky-300',
    input: 'border-sky-400 text-sky-950 focus:border-sky-600',
    presetActive: 'bg-sky-600 text-white border-sky-600', presetIdle: 'text-sky-900 border-sky-200 hover:bg-sky-100',
    qtyLabel: 'Quantity to Add (Customer Return)', notePlaceholder: 'e.g. Customer returned item, invoice number',
  },
  DAMAGE: {
    label: 'Loss / Damaged', hint: '− Deduct Units', Icon: Minus, reason: 'DAMAGE',
    activeCard: 'bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-500/20',
    activeIcon: 'bg-rose-500 text-white',
    panel: 'bg-rose-50/60 border-rose-200', text: 'text-rose-900',
    stepBtn: 'hover:bg-rose-100 text-rose-900 border-rose-300',
    input: 'border-rose-400 text-rose-950 focus:border-rose-600',
    presetActive: 'bg-rose-600 text-white border-rose-600', presetIdle: 'text-rose-900 border-rose-200 hover:bg-rose-100',
    qtyLabel: 'Quantity to Deduct (Loss / Damaged)', notePlaceholder: 'e.g. Torn fabric, stain, missing piece',
  },
  CORRECTION: {
    label: 'Reconciliation', hint: 'Set Exact Count', Icon: Target, reason: 'CORRECTION',
    activeCard: 'bg-amber-50 border-[var(--accent)] text-amber-950 ring-2 ring-[var(--accent-a30)]',
    activeIcon: 'bg-[var(--accent)] text-black',
    panel: 'bg-amber-50/60 border-[#B7E1BE]', text: 'text-amber-950',
    stepBtn: 'hover:bg-amber-100 text-amber-950 border-amber-300',
    input: 'border-[var(--accent)] text-black focus:border-black',
    presetActive: '', presetIdle: '',
    qtyLabel: 'Physical Count', notePlaceholder: 'e.g. Physical inventory count reconciliation',
  },
}

export const AdjustStockModal: React.FC<AdjustStockModalProps> = ({
  isOpen,
  onClose,
  item,
  onSuccess,
}) => {
  const { play } = useSound()
  const [mode, setMode] = useState<AdjustMode>('RESTOCK')
  const [quantity, setQuantity] = useState<number | ''>(0)
  const [correctedQuantity, setCorrectedQuantity] = useState<number | ''>(0)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (item && isOpen) {
      setMode('RESTOCK')
      setQuantity(1)
      setCorrectedQuantity(item.stock)
      setNote('')
      setError('')
    }
  }, [item, isOpen])

  if (!isOpen || !item) return null

  const cfg = MODES[mode]
  const isDeduct = mode === 'DAMAGE'
  const currentStock = item.stock
  const clampQty = (n: number) => (isDeduct ? Math.min(currentStock, Math.max(0, n)) : Math.max(0, n))
  const numQty = typeof quantity === 'number' ? quantity : 0
  const numCorrected = typeof correctedQuantity === 'number' ? correctedQuantity : 0

  // Calculate effective new total stock and delta based on active mode
  let effectiveNewStock = currentStock
  if (mode === 'CORRECTION') effectiveNewStock = Math.max(0, numCorrected)
  else if (isDeduct) effectiveNewStock = Math.max(0, currentStock - Math.max(0, numQty))
  else effectiveNewStock = currentStock + Math.max(0, numQty)
  const delta = effectiveNewStock - currentStock

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (mode !== 'CORRECTION' && numQty <= 0) {
      setError(`Please enter a valid quantity to ${isDeduct ? 'deduct' : 'add'} (minimum 1 unit)`)
      return
    }

    if (isDeduct) {
      if (currentStock <= 0) {
        setError('Current stock is 0. Cannot remove units from an empty stock.')
        return
      }
      if (numQty > currentStock) {
        setError(`Cannot remove ${numQty} units. Maximum available stock to remove is ${currentStock}.`)
        return
      }
    }

    if (mode === 'CORRECTION' && numCorrected < 0) {
      setError('Reconciled stock quantity cannot be negative.')
      return
    }

    if (delta === 0) {
      setError('No stock change detected. Please adjust the quantity.')
      return
    }

    setSubmitting(true)

    try {
      const uuidRegex = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
      const variantId = item.variant_id && uuidRegex.test(item.variant_id) ? item.variant_id : null

      await inventoryService.adjustStock({
        product_id: item.product_id,
        variant_id: variantId,
        new_quantity: effectiveNewStock,
        reason: cfg.reason,
        note: note.trim() || undefined,
        created_by_name: 'Admin',
      })

      play('success')
      onSuccess?.()
      onClose()
    } catch (err: unknown) {
      play('error')
      const msg = getErrorMessage(err, 'Failed to adjust stock')
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const confirmLabel = mode === 'RESTOCK'
    ? `Confirm Restock (+${numQty} Units)`
    : mode === 'RETURN'
    ? `Confirm Return (+${numQty} Units)`
    : mode === 'DAMAGE'
    ? `Confirm Loss (-${numQty} Units)`
    : `Confirm Reconciliation (${effectiveNewStock} Units)`

  // − [ qty ] + stepper, shared by the add/deduct and reconciliation panels
  const stepper = (value: number | '', set: React.Dispatch<React.SetStateAction<number | ''>>, clamp: (n: number) => number) => (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => set((q) => clamp(typeof q === 'number' ? q - 1 : 0))}
        className="shrink-0 w-11 h-11 rounded-xl bg-white border border-gray-200 text-gray-700 flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <Minus size={16} />
      </button>
      <input
        type="number"
        min="0"
        max={isDeduct ? currentStock : undefined}
        value={value}
        onChange={(e) => {
          const val = e.target.value
          if (val === '') {
            set('')
          } else {
            const parsed = parseInt(val, 10)
            set(isNaN(parsed) ? '' : clamp(parsed))
          }
        }}
        onBlur={() => {
          if (value === '') set(0)
        }}
        className={`flex-1 min-w-0 h-11 text-center font-black text-xl rounded-xl border-2 bg-white outline-none ${cfg.input}`}
      />
      <button
        type="button"
        onClick={() => set((q) => clamp(typeof q === 'number' ? q + 1 : 1))}
        className="shrink-0 w-11 h-11 rounded-xl bg-white border border-gray-200 text-gray-700 flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer"
      >
        <Plus size={16} />
      </button>
    </div>
  )

  // Current → New Stock line with the change pill, shown inside the quantity panel
  const preview = (
    <div className="bg-white border border-gray-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 min-w-0 font-semibold text-gray-500">
        <span>Current:</span>
        <span className="text-black font-black">{currentStock}</span>
        <ArrowRight size={13} className="text-gray-400" />
        <span>New Stock:</span>
        <span className={`font-black ${delta > 0 ? 'text-emerald-700' : delta < 0 ? 'text-rose-700' : 'text-gray-700'}`}>
          {effectiveNewStock} units
        </span>
      </div>
      <span
        className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-black ${
          delta > 0 ? 'bg-emerald-100 text-emerald-800' : delta < 0 ? 'bg-rose-100 text-rose-800' : 'bg-gray-100 text-gray-600'
        }`}
      >
        {delta > 0 ? `+${delta}` : delta}
      </span>
    </div>
  )

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 overflow-hidden">
      {/* Fixed height so the box does not grow or shrink when switching adjustment type */}
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-lg w-full h-[min(660px,calc(100dvh-24px))] shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="shrink-0 bg-[#0A0A0A] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-[#1A1A1A] border border-[var(--accent-a30)] flex items-center justify-center text-[var(--accent)]">
              <SlidersHorizontal size={17} />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-white leading-snug">
                Adjust Inventory Stock ({BRAND_EN})
              </h2>
              <p className="text-[11px] text-[var(--accent)] font-semibold leading-snug">
                Restock, remove stock, or reconcile physical count
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X size={17} />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="overflow-y-auto overscroll-contain flex-1 p-4 sm:p-5 space-y-3.5">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Product card */}
            <div className="bg-[#FBFAF6] border border-[#B7E1BE] rounded-2xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-wider text-[var(--accent-dark)] flex items-center gap-1">
                    <Package size={12} /> Product
                  </div>
                  <div className="text-sm sm:text-[15px] font-black text-black break-words mt-1 leading-snug">
                    {item.name}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {item.category && (
                      <span className="inline-block text-[11px] font-bold text-[var(--accent-dark)] bg-[var(--accent-a20,#E8F5E9)] px-2 py-0.5 rounded-md">
                        {item.category}
                      </span>
                    )}
                    {item.variant_name && (
                      <span className="inline-block text-[11px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md">
                        {item.variant_name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Current Stock</span>
                  <span className="text-2xl font-black text-black leading-none">{currentStock}</span>
                  <span className="text-xs font-bold text-gray-500 ml-1">units</span>
                </div>
              </div>
              {item.barcode && (
                <div className="mt-2 pt-2 border-t border-[#B7E1BE]/50 flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                  <span>Barcode:</span>
                  <strong className="font-mono text-black bg-white px-1.5 rounded border border-gray-200">{item.barcode}</strong>
                </div>
              )}
            </div>

            {/* Adjustment type: four cards in one row on every screen size */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5">
                Select Adjustment Type <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                {(Object.keys(MODES) as AdjustMode[]).map((key) => {
                  const m = MODES[key]
                  const active = mode === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setMode(key); setQuantity(key === 'DAMAGE' && currentStock <= 0 ? 0 : 1); setError('') }}
                      className={`flex h-[84px] flex-col items-center justify-center gap-1 px-1 rounded-xl border-2 text-center transition-all cursor-pointer ${
                        active ? m.activeCard : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center ${active ? m.activeIcon : 'bg-gray-100 text-gray-400'}`}>
                        <m.Icon size={14} />
                      </span>
                      <span className="text-[10px] sm:text-xs font-black leading-tight">{m.label}</span>
                      <span className="text-[9px] sm:text-[10px] font-semibold text-gray-500 leading-tight">{m.hint}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Quantity panel — Restock, Customer Return, Loss / Damaged */}
            {mode !== 'CORRECTION' && (
              <div className={`space-y-2.5 border p-3 sm:p-3.5 rounded-2xl ${cfg.panel}`}>
                <div className="flex items-center justify-between gap-2">
                  <label className={`block text-[11px] font-black uppercase tracking-wider ${cfg.text}`}>
                    {cfg.qtyLabel} <span className="text-red-500">*</span>
                  </label>
                  {isDeduct && <span className="shrink-0 text-[10px] font-bold text-rose-700">Max: {currentStock}</span>}
                </div>
                {stepper(quantity, setQuantity, clampQty)}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-gray-500 mr-0.5">QUICK:</span>
                  {(isDeduct ? [1, 2, 5, 10].filter((p) => p <= currentStock) : [1, 5, 10, 25, 50, 100]).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQuantity(preset)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
                        quantity === preset ? cfg.presetActive : 'bg-white text-gray-800 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {isDeduct ? '-' : '+'}{preset}
                    </button>
                  ))}
                  {isDeduct && currentStock > 0 && (
                    <button
                      type="button"
                      onClick={() => setQuantity(currentStock)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
                        quantity === currentStock ? cfg.presetActive : 'bg-white text-gray-800 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      All ({currentStock})
                    </button>
                  )}
                </div>
                {preview}
              </div>
            )}

            {/* Reconciliation panel — physical count */}
            {mode === 'CORRECTION' && (
              <div className={`space-y-2.5 border p-3 sm:p-3.5 rounded-2xl ${cfg.panel}`}>
                <label className={`block text-[11px] font-black uppercase tracking-wider ${cfg.text}`}>
                  {cfg.qtyLabel} <span className="text-red-500">*</span>
                </label>
                {stepper(correctedQuantity, setCorrectedQuantity, (n) => Math.max(0, n))}
                {preview}
              </div>
            )}

            {/* Note Input */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-gray-700 mb-1.5">
                Adjustment Note / Reason Description (Optional)
              </label>
              <input
                type="text"
                placeholder={cfg.notePlaceholder}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-gray-200 bg-white text-xs sm:text-sm text-gray-900 outline-none focus:border-[#0A0A0A]"
              />
            </div>
          </div>

          {/* Fixed Footer at the bottom */}
          <div className="shrink-0 px-4 sm:px-5 py-3 bg-white border-t border-gray-100 flex items-stretch gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-100 text-gray-800 text-sm font-bold hover:bg-gray-200 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || delta === 0}
              className={`flex-[1.4] flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-black leading-tight transition-all shadow-md disabled:opacity-50 cursor-pointer ${
                isDeduct
                  ? 'bg-rose-700 text-white hover:bg-rose-800'
                  : 'bg-[#0A0A0A] text-[var(--accent)] hover:bg-[#1A1A1A]'
              }`}
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 size={15} className="shrink-0" />
                  <span className="text-center">{confirmLabel}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  )
}
