import React, { useState, useMemo, useEffect } from 'react'
import { X, Search, ShoppingBag, Edit2, Trash2, MapPin, Package } from 'lucide-react'
import { useProductStore, type Product } from '../store/store'
import { supabase } from '../lib/supabase'
import { useSound } from '../context/SoundContext'
import { ModalPortal } from './ModalPortal'
import { useMetalRateStore } from '../store/metalRateStore'
import { currentProductPrice } from '../lib/jewelleryProduct'
import { formatWeight, isRatedMetal, metalLabel } from '../lib/jewellery'

interface CatalogModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (product: Product) => void
}

type CategoryOption = { id: string | number; name_en: string; is_active?: boolean; sort_order?: number }

export default function CatalogModal({ isOpen, onClose, onAdd }: CatalogModalProps) {
  const { fetchProducts, products, loading, error } = useProductStore()
  const { play } = useSound()
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editForm, setEditForm] = useState({ name: '', category: '', price: '' })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([])
  const rates = useMetalRateStore((s) => s.rates)

  useEffect(() => {
    if (isOpen) void fetchProducts(true)
  }, [isOpen, fetchProducts])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const loadCategories = async () => {
      const { data } = await supabase
        .from('categories')
        .select('id, name_en, is_active, sort_order')
        .order('sort_order')
      if (!cancelled) setCategoryOptions((data || []) as CategoryOption[])
    }
    void loadCategories()
    return () => { cancelled = true }
  }, [isOpen])

  const categories = useMemo(() => {
    // Only show active categories, in dashboard sort_order
    const activeCats = categoryOptions
      .filter(c => c.is_active !== false)
      .map(c => c.name_en.trim())
      .filter(Boolean)

    // Ensure any category attached to active products (such as Unregistered) is available
    products.forEach(p => {
      const catName = (p.category || '').trim()
      if (p.isActive && catName && !activeCats.includes(catName)) {
        activeCats.push(catName)
      }
    })

    return ['All', ...activeCats]
  }, [categoryOptions, products])

  const allCategoryOptions = useMemo(() => {
    const merged = new Map<string, CategoryOption>()
    categoryOptions
      .filter(category => category.name_en.trim().toLowerCase() !== 'manual')
      .forEach(category => merged.set(category.name_en.trim().toLowerCase(), category))
    products.filter(product => product.isActive && product.category.trim()).forEach(product => {
      const key = product.category.trim().toLowerCase()
      if (key === 'manual') return
      if (!merged.has(key)) merged.set(key, { id: product.categoryId || `product-category-${key}`, name_en: product.category.trim() })
    })
    return Array.from(merged.values()).sort((a, b) => a.name_en.localeCompare(b.name_en))
  }, [categoryOptions, products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let src = products.filter(p => p.isActive)
    if (activeCategory !== 'All') src = src.filter(p => p.category === activeCategory)
    if (q) src = src.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      (p.location || '').toLowerCase().includes(q) ||
      (p.huid || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q)
    )
    return src
  }, [products, search, activeCategory])

  const startEdit = (p: Product) => {
    setEditingProduct(p)
    setEditForm({ name: p.name, category: p.category, price: String(p.price) })
    setEditError('')
  }

  const cancelEdit = () => {
    setEditingProduct(null)
    setEditError('')
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingProduct) return
    if (!editForm.name.trim()) { setEditError('Name is required'); return }
    setEditLoading(true)
    setEditError('')
    const selectedCategory = allCategoryOptions.find(c => c.name_en.trim().toLowerCase() === editForm.category.trim().toLowerCase())
    if (!selectedCategory) { setEditError('Select a valid category'); setEditLoading(false); return }
    const categoryName = selectedCategory.name_en.trim()
    // A rate-priced jewellery item has no fixed price to edit (it is calculated from the metal rate).
    const { error } = await supabase.from('products').update({
      name: editForm.name.trim(),
      category: categoryName,
      category_id: selectedCategory.id,
      ...(isRatedMetal(editingProduct.metalType) ? {} : { price: Number(editForm.price) }),
    }).eq('id', editingProduct.id)
    if (error) { play('error'); setEditError(error.message); setEditLoading(false); return }
    play('success')
    await fetchProducts(true)
    setEditLoading(false)
    cancelEdit()
  }

  const handleDelete = async (p: Product) => {
    if (!window.confirm(`Delete "${p.name}"? This will deactivate it.`)) return
    await supabase.from('products').update({ is_active: false }).eq('id', p.id)
    await fetchProducts(true)
  }

  if (!isOpen) return null

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-5xl flex min-h-0 flex-col shadow-2xl overflow-hidden border border-[#E5E7EB]/40 max-h-[calc(100dvh-1rem)] sm:max-h-[85vh]">

        {editingProduct ? (
          <>
            <div className="flex items-center justify-between p-6 border-b border-[#E5E7EB]/40 bg-[#F9FAFB]">
              <h2 className="text-xl font-black text-[#111111]">Edit Item</h2>
              <button onClick={cancelEdit} className="p-2 rounded-xl hover:bg-black/5 text-[#374151]">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={saveEdit} className="p-6 flex flex-col gap-4">
              {editError && <div className="text-red-500 text-sm font-bold bg-red-50 p-3 rounded-xl">{editError}</div>}
              <div>
                <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1.5">Item Name</label>
                <input type="text" value={editForm.name}
                  onChange={e => setEditForm({...editForm, name: e.target.value})}
                  className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB]/60 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative z-50">
                  <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1.5">Category</label>
                  <select value={editForm.category}
                    onChange={e => setEditForm({...editForm, category: e.target.value})}
                    className="w-full min-w-0 h-12 px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB]/60 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold touch-manipulation appearance-none">
                    <option value="">Select category</option>
                    {allCategoryOptions.map(category => <option key={category.id} value={category.name_en}>{category.name_en}</option>)}
                    {!allCategoryOptions.some(category => category.name_en === editForm.category) && editForm.category && (
                      <option value={editForm.category}>{editForm.category}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1.5">Price (₹)</label>
                  {isRatedMetal(editingProduct.metalType) ? (
                    <div className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB]/60 rounded-xl text-[12px] font-bold text-[#6B7280]">
                      Calculated from the metal rate
                    </div>
                  ) : (
                  <input type="number" value={editForm.price}
                    onChange={e => setEditForm({...editForm, price: e.target.value})}
                    className="w-full px-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB]/60 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-right" placeholder="0" />
                  )}
                </div>
              </div>
              <button type="submit" disabled={editLoading}
                className="mt-4 w-full py-3.5 bg-[var(--accent)] hover:bg-[var(--accent-dark)] text-white rounded-xl text-[13px] font-black uppercase tracking-wider transition-colors disabled:opacity-50">
                {editLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between p-5 border-b border-[#E5E7EB]/40 bg-[#F9FAFB]">
              <h2 className="text-[18px] font-black text-[#111111] flex items-center gap-2">
                <Search size={18} className="text-[var(--accent)]" />
                Search Catalog
              </h2>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-black/5 text-[#374151]">
                <X size={20} />
              </button>
            </div>
            <div className="p-3 sm:p-4 border-b border-[#E5E7EB]/40 bg-white space-y-3">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#374151]" />
                <input type="text" value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by item name, category, HUID or SKU..."
                  className="w-full pl-10 pr-4 py-3 bg-[#FAFAFA] border border-[#E5E7EB]/60 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-[#111111]" />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {categories.map(cat => (
                  <button key={cat} onClick={() => setActiveCategory(cat)}
                    className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-[var(--accent)] text-white' : 'bg-[#FAFAFA] text-[#374151] hover:bg-[#F9FAFB] border border-[#E5E7EB]/60'}`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 bg-[#FAFAFA]">
              {loading ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-[#374151]/70">
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[var(--accent)]" />
                  <p className="text-[13px] font-bold">Loading catalog...</p>
                </div>
              ) : error ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 text-center text-red-500">
                  <p className="text-[13px] font-bold">Unable to load catalog items.</p>
                  <button type="button" onClick={() => void fetchProducts(true)} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-black text-white">Try again</button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-[#374151]/60 py-12">
                  <ShoppingBag size={48} className="mb-4 opacity-20" />
                  <p className="text-[14px] font-bold">No items found</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {filtered.map(product => (
                    <div key={product.id}
                      className="bg-white border border-[#E5E7EB]/60 rounded-2xl p-4 hover:border-[var(--accent-a40)] hover:shadow-md transition-all group">
                      <div className="flex items-start justify-between gap-3">
                        <div onClick={() => onAdd(product)} className="cursor-pointer flex-1 min-w-0">
                          <h4 className="text-[15px] font-black text-[#111111] leading-tight break-words group-hover:text-[var(--accent)] transition-colors">{product.name}</h4>
                          {product.location && /^[a-zA-Z0-9\s,\-./]+$/.test(product.location) && (
                            <p className="flex items-center gap-1 text-[10px] font-bold text-[var(--accent)] mt-1">
                              <MapPin size={11} /> {product.location}
                            </p>
                          )}
                          <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 text-[10px] font-black uppercase tracking-wider">
                            <Package size={12} /> {product.metalType ? metalLabel(product.metalType, product.purity) : 'Item'}
                          </span>
                          {product.metalType && (product.netWeight || product.huid) ? (
                            <p className="text-[11px] font-bold text-[#6B7280] mt-1">
                              {product.netWeight ? `Net ${formatWeight(product.netWeight)}` : ''}{product.netWeight && product.huid ? ' • ' : ''}{product.huid ? `HUID ${product.huid}` : ''}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex gap-1.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); startEdit(product) }} title="Edit product"
                            className="p-2 rounded-lg bg-white border border-[#E5E7EB]/60 text-[#374151] hover:text-[var(--accent)] hover:border-[var(--accent-a40)] shadow-sm transition-colors">
                            <Edit2 size={15} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); void handleDelete(product) }} title="Delete product"
                            className="p-2 rounded-lg bg-white border border-[#E5E7EB]/60 text-red-400 hover:text-red-600 hover:border-red-300 shadow-sm transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <div onClick={() => onAdd(product)} className="cursor-pointer flex items-end justify-between mt-3 pt-3 border-t border-[#E5E7EB]/40">
                        <div>
                          {(() => {
                            const livePrice = currentProductPrice(product, rates)
                            return livePrice == null
                              ? <span className="text-[13px] font-black text-amber-700">Rate missing — update Metal Rates</span>
                              : <span className="text-[18px] font-black text-[#111111]">₹{livePrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                          })()}
                          {!!product.purchasePrice && (
                            <p className="text-[11px] font-semibold text-[#9CA3AF] mt-0.5">Cost: ₹{product.purchasePrice}</p>
                          )}
                        </div>
                        <span className="text-[10px] font-black text-[#374151] uppercase tracking-wider bg-[#F9FAFB] px-2.5 py-1.5 rounded-lg border border-[#E5E7EB]/60">{product.category}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div></ModalPortal>
  )
}
