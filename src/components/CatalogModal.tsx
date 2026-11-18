import React, { useState, useMemo, useEffect } from 'react'
import { X, Search, ShoppingBag, Edit2, Trash2, MapPin, Gift, Plus } from 'lucide-react'
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
  /** Adds the item at ₹0 as a free gift (it still leaves stock) */
  onAddFree?: (product: Product) => void
}

type CategoryOption = { id: string | number; name_en: string; is_active?: boolean; sort_order?: number }

export default function CatalogModal({ isOpen, onClose, onAdd, onAddFree }: CatalogModalProps) {
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
    // Name, category, location, HUID, SKU, barcode, design number, subcategory, metal or purity ("22k", "silver").
    if (q) src = src.filter(p =>
      [p.name, p.category, p.location, p.huid, p.sku, p.barcode, p.designNumber, p.subcategory, p.purity, p.metalType,
        ...(p.pieces || []).flatMap((pc) => [pc.huid, pc.serial])]
        .some((v) => String(v || '').toLowerCase().includes(q))
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
      <div className="bg-white rounded-2xl sm:rounded-3xl w-full max-w-5xl flex min-h-0 flex-col shadow-2xl overflow-hidden border border-black/10 max-h-[calc(100dvh-1rem)] sm:max-h-[85vh]">

        {editingProduct ? (
          <>
            <div className="flex items-center justify-between p-6 border-b border-black/10 bg-white">
              <h2 className="text-xl font-black text-[#000000]">Edit Item</h2>
              <button onClick={cancelEdit} className="p-2 rounded-xl hover:bg-black/5 text-[#000000]">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={saveEdit} className="p-6 flex flex-col gap-4">
              {editError && <div className="text-red-500 text-sm font-bold bg-red-50 p-3 rounded-xl">{editError}</div>}
              <div>
                <label className="block text-[10px] font-black text-[#000000] tracking-wider uppercase mb-1.5">Item Name</label>
                <input type="text" value={editForm.name}
                  onChange={e => setEditForm({...editForm, name: e.target.value})}
                  className="w-full px-4 py-3 bg-white border border-black/10 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative z-50">
                  <label className="block text-[10px] font-black text-[#000000] tracking-wider uppercase mb-1.5">Category</label>
                  <select value={editForm.category}
                    onChange={e => setEditForm({...editForm, category: e.target.value})}
                    className="w-full min-w-0 h-12 px-4 py-3 bg-white border border-black/10 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold touch-manipulation appearance-none">
                    <option value="">Select category</option>
                    {allCategoryOptions.map(category => <option key={category.id} value={category.name_en}>{category.name_en}</option>)}
                    {!allCategoryOptions.some(category => category.name_en === editForm.category) && editForm.category && (
                      <option value={editForm.category}>{editForm.category}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-[#000000] tracking-wider uppercase mb-1.5">Price (₹)</label>
                  {isRatedMetal(editingProduct.metalType) ? (
                    <div className="w-full px-4 py-3 bg-white border border-black/10 rounded-xl text-[12px] font-bold text-[#000000]">
                      Calculated from the metal rate
                    </div>
                  ) : (
                  <input type="number" value={editForm.price}
                    onChange={e => setEditForm({...editForm, price: e.target.value})}
                    className="w-full px-4 py-3 bg-white border border-black/10 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-right" placeholder="0" />
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
            <div className="flex items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-3.5 sm:px-5">
              <h2 className="flex items-center gap-2.5 text-[17px] font-black text-[#000000]">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-a10)] text-[var(--accent)]"><Search size={16} /></span>
                Search Catalog
                {!loading && !error && <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-black">{filtered.length}</span>}
              </h2>
              <button onClick={onClose} className="p-2 rounded-xl hover:bg-black/5 text-[#000000]">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-3 border-b border-black/10 bg-white px-4 pb-3 pt-3 sm:px-5">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#000000]" />
                <input type="text" value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Name, HUID, SKU, barcode or purity"
                  autoFocus
                  className="h-11 w-full rounded-xl border border-black/10 bg-[#FAFAFA] pl-10 pr-4 text-[13px] font-bold text-[#000000] focus:border-[var(--accent)] focus:bg-white focus:outline-none" />
              </div>
              <div className="hide-scrollbar flex gap-1.5 overflow-x-auto">
                {categories.map(cat => (
                  <button key={cat} type="button" onClick={() => setActiveCategory(cat)}
                    className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer ${activeCategory === cat ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-black/10 bg-white text-[#000000] hover:border-black/30'}`}>
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-[#FAFAF8] p-3 sm:p-4">
              {loading ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-[#000000]/70">
                  <span className="h-7 w-7 animate-spin rounded-full border-2 border-black/10 border-t-[var(--accent)]" />
                  <p className="text-[13px] font-bold">Loading catalog...</p>
                </div>
              ) : error ? (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 text-center text-red-500">
                  <p className="text-[13px] font-bold">Unable to load catalog items.</p>
                  <button type="button" onClick={() => void fetchProducts(true)} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-[11px] font-black text-white">Try again</button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-[#000000]/60 py-12">
                  <ShoppingBag size={48} className="mb-4 opacity-20" />
                  <p className="text-[14px] font-bold">No items found</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map(product => {
                    const livePrice = currentProductPrice(product, rates)
                    const metal = String(product.metalType || '').toLowerCase()
                    const tone = metal === 'gold' ? 'border-amber-200 bg-amber-50 text-amber-800' : metal === 'silver' ? 'border-slate-200 bg-slate-50 text-slate-700' : metal ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-black/10 bg-black/[0.03] text-black/70'
                    const showLocation = product.location && /^[a-zA-Z0-9\s,\-./]+$/.test(product.location)
                    return (
                      <div key={product.id}
                        className="group flex min-w-0 flex-col rounded-2xl border border-black/10 bg-white p-3.5 transition-all hover:border-[var(--accent)] hover:shadow-md">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate rounded-full bg-black/[0.04] px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-black/60">{product.category || 'Item'}</span>
                          <div className="flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
                            <button type="button" onClick={(e) => { e.stopPropagation(); startEdit(product) }} title="Edit product" aria-label={`Edit ${product.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 bg-white text-[#000000] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer">
                              <Edit2 size={13} />
                            </button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); void handleDelete(product) }} title="Delete product" aria-label={`Delete ${product.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-black/10 bg-white text-red-500 transition-colors hover:border-red-300 hover:text-red-600 cursor-pointer">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        <button type="button" onClick={() => onAdd(product)} className="mt-2.5 flex min-w-0 flex-1 flex-col items-start justify-start text-left cursor-pointer">
                          <h4 className="line-clamp-2 text-[14px] font-black leading-snug text-[#000000] transition-colors group-hover:text-[var(--accent)]">{product.name}</h4>
                          {showLocation && <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-black/50"><MapPin size={11} /> {product.location}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${tone}`}>{product.metalType ? metalLabel(product.metalType, product.purity) : 'Item'}</span>
                            {product.metalType && product.netWeight ? <span className="text-[11px] font-bold text-black/70">{formatWeight(product.netWeight)}</span> : null}
                          </div>
                          {product.metalType && ((product.pieces?.length ?? 0) > 1 || product.huid) ? (
                            <p className="mt-1 truncate text-[10px] font-semibold text-black/45">{(product.pieces?.length ?? 0) > 1 ? `${product.pieces!.length} numbered pieces` : `HUID ${product.huid}`}</p>
                          ) : null}
                        </button>

                        <div className="mt-3 flex items-end justify-between gap-2 border-t border-black/[0.07] pt-3">
                          <div className="min-w-0">
                            {livePrice == null
                              ? <span className="text-[11px] font-black text-amber-700">Rate missing: update Metal Rates</span>
                              : <span className="block truncate text-[17px] font-black leading-tight text-[#000000]">₹{livePrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>}
                            {!!product.purchasePrice && <span className="block truncate text-[10px] font-semibold text-black/40">Cost ₹{Number(product.purchasePrice).toLocaleString('en-IN')}</span>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {onAddFree && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); onAddFree(product) }}
                                title="Add at ₹0 as a free gift. It still comes out of stock."
                                className="flex h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 text-[10px] font-black uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-100 cursor-pointer">
                                <Gift size={12} /> Free
                              </button>
                            )}
                            <button type="button" onClick={() => onAdd(product)}
                              className="flex h-8 items-center gap-1 rounded-lg bg-[var(--accent)] px-3 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:brightness-110 cursor-pointer">
                              <Plus size={13} /> Add
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div></ModalPortal>
  )
}
