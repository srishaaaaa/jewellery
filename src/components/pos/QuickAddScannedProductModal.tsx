import React, { useState } from 'react'
import { X, PackagePlus, ScanLine } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getErrorMessage } from '../../lib/errorMessage'
import type { ScannedItemPayload } from './BarcodeScannerInput'
import { ModalPortal } from '../ModalPortal'
import { defaultLowStockThreshold } from '../../lib/stockLevels'

export interface QuickAddScannedProductModalProps {
  barcode: string
  categories: string[]
  onClose: () => void
  onCreated: (item: ScannedItemPayload) => void
}

export const QuickAddScannedProductModal: React.FC<QuickAddScannedProductModalProps> = ({
  barcode,
  categories,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [category, setCategory] = useState(categories[0] || 'General')
  const [openingStock, setOpeningStock] = useState('10')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const priceNum = Number(price)
    const stockNum = Math.max(0, Math.floor(Number(openingStock) || 0))

    if (!trimmedName) { setError('Enter a product name'); return }
    if (!priceNum || priceNum <= 0) { setError('Enter a valid selling price'); return }

    setSaving(true)
    setError('')
    try {
      const { data, error: insertError } = await supabase
        .from('products')
        .insert({
          name: trimmedName,
          category: category.trim() || 'General',
          category_id: null,
          price: priceNum,
          offer_price: priceNum,
          purchase_price: 0,
          unit_type: 'unit',
          unit_label: 'piece',
          unit: 'piece',
          base_quantity: 1,
          stock_quantity: stockNum,
          stock: stockNum,
          stock_unit: 'piece',
          low_stock_alert: defaultLowStockThreshold(),
          barcode: barcode,
          has_variants: false,
          has_special_offer: false,
          special_offer_note: '',
          special_offer_cost: 0,
          is_active: true,
        })
        .select('id, name, name_ta, price, offer_price, image_url, category')
        .single()

      if (insertError) throw insertError

      onCreated({
        product_id: data.id,
        variant_id: null,
        product_name: data.name,
        name_ta: data.name_ta || undefined,
        price: Number(data.price),
        offer_price: data.offer_price ? Number(data.offer_price) : undefined,
        stock: stockNum,
        barcode,
        image_url: data.image_url || undefined,
        category: data.category || undefined,
      })
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create product'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalPortal><div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-3xl w-full max-w-sm max-h-[90vh] overflow-y-auto border border-[var(--accent-a40)] shadow-2xl flex flex-col animate-in zoom-in-95 duration-150">
        <div className="shrink-0 bg-[#0A0A0A] p-4 border-b border-[var(--accent-a30)] flex items-center justify-between text-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#1A1A1A] border border-[var(--accent)] flex items-center justify-center text-[var(--accent)] shrink-0 shadow-sm">
              <PackagePlus size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-white tracking-wide">New Product</h3>
              <p className="text-[11px] font-mono font-bold text-[var(--accent)] break-words mt-0.5 flex items-center gap-1">
                <ScanLine size={12} className="shrink-0" /> {barcode}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer shrink-0">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 bg-[#FBFAF6]">
          <p className="text-[12px] text-gray-600 font-bold">
            This barcode isn't in your catalog yet. Fill this in once and it'll be added to your inventory and this bill immediately.
          </p>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wide text-gray-600 mb-1">Product Name *</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. 22K Gold Ring"
              className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-900 outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wide text-gray-600 mb-1">Selling Price (₹) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-900 outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wide text-gray-600 mb-1">Opening Stock</label>
              <input
                type="number"
                min="0"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-900 outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-black uppercase tracking-wide text-gray-600 mb-1">Category</label>
            {categories.length > 0 ? (
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-900 outline-none focus:border-[var(--accent)] touch-manipulation appearance-none relative z-20"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="General"
                className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-white text-sm font-bold text-gray-900 outline-none focus:border-[var(--accent)]"
              />
            )}
          </div>

          {error && (
            <p className="text-[12px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>
          )}
        </form>

        <div className="shrink-0 px-5 py-3.5 bg-white border-t border-[var(--accent-a40)] flex items-center justify-end gap-2.5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-black rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 text-xs font-black rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] hover:bg-[#1A1A1A] transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <PackagePlus size={14} />
            <span>{saving ? 'Adding...' : 'Add & Bill It'}</span>
          </button>
        </div>
      </div>
    </div></ModalPortal>
  )
}
