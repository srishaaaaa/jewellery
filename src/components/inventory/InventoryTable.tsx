import React, { useState, useEffect, useCallback } from 'react'
import {
  Search,
  SlidersHorizontal,
  Printer,
  History,
  AlertTriangle,
  Package,
  Layers,
  RefreshCw,
  BarChart3,
  Tag,
  Boxes,
  Coins,
  Plus,
  Edit2,
  Trash2,
  MapPin,
} from 'lucide-react'
import { inventoryService, type InventoryStockItem } from '../../services/inventoryService'
import { CreateBarcodeModal } from '../barcode/CreateBarcodeModal'
import { BarcodePrintModal } from '../barcode/BarcodePrintModal'
import { AdjustStockModal } from './AdjustStockModal'
import { StockHistoryDrawer } from './StockHistoryDrawer'
import { QuickPriceModal } from './QuickPriceModal'
import { BulkSetLocationModal } from './BulkSetLocationModal'
import { formatCurrency } from '../../lib/retail'
import { useProductStore, useAdminAuthStore } from '../../store/store'
import { CategoryManagerView } from './CategoryManagerView'
import { InventoryAnalyticsView } from './InventoryAnalyticsView'
import { AddEditProductView } from './AddEditProductView'
import { useSound } from '../../context/SoundContext'
import { getErrorMessage } from '../../lib/errorMessage'
import { lowStockLimit } from '../../lib/stockLevels'
import { useMetalRateStore } from '../../store/metalRateStore'
import { currentProductPrice } from '../../lib/jewelleryProduct'
import { formatWeight, isRatedMetal, ITEM_STATUS_LABELS, metalLabel } from '../../lib/jewellery'

type InventoryTab = 'stock' | 'products' | 'categories' | 'analytics'

export const InventoryTable: React.FC = () => {
  const role = useAdminAuthStore((state) => state.role)
  const [activeTab, setActiveTab] = useState<InventoryTab>('stock')
  const { products: storeProducts, fetchProducts } = useProductStore()
  const rates = useMetalRateStore((state) => state.rates)
  const productById = React.useMemo(() => new Map(storeProducts.map((p) => [String(p.id), p])), [storeProducts])
  // Jewellery rows: the catalogue record (weights, purity, HUID) and today's calculated value.
  const jewelleryOf = (item: InventoryStockItem) => {
    if (item.variant_id) return null
    const product = productById.get(String(item.product_id))
    return product?.metalType ? product : null
  }
  const itemValue = (item: InventoryStockItem) => {
    const product = jewelleryOf(item)
    if (!product) return item.price
    return currentProductPrice(product, rates) ?? item.price
  }
  const [items, setItems] = useState<InventoryStockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'in_stock' | 'low' | 'out'>('all')

  // Modals state
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [selectedForReceive, setSelectedForReceive] = useState<{ productId: number; variantId?: string | null } | null>(null)

  const [printModalItem, setPrintModalItem] = useState<InventoryStockItem | null>(null)
  const [adjustModalItem, setAdjustModalItem] = useState<InventoryStockItem | null>(null)
  const [historyDrawerItem, setHistoryDrawerItem] = useState<InventoryStockItem | null>(null)
  const [priceModalItem, setPriceModalItem] = useState<InventoryStockItem | null>(null)

  // Bulk selection for storage location assignment
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkLocationOpen, setBulkLocationOpen] = useState(false)

  const { play } = useSound()
  const getStockStatus = (item: InventoryStockItem): 'ok' | 'low' | 'out' => (item.stock <= 0 ? 'out' : item.stock <= lowStockLimit(item.low_stock_alert) ? 'low' : 'ok')
  const openAdjust = (item: InventoryStockItem) => {
    const status = getStockStatus(item)
    if (status === 'low' || status === 'out') play('alert')
    setAdjustModalItem(item)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      void fetchProducts()
      const data = await inventoryService.fetchInventoryItems()
      setItems(data)
    } catch (err) {
      console.error('Failed to load inventory items:', err)
    } finally {
      setLoading(false)
    }
  }, [fetchProducts])

  const handleDeleteItem = async (item: InventoryStockItem) => {
    const itemLabel = item.variant_name ? `${item.name} (${item.variant_name})` : item.name
    if (!window.confirm(`Are you sure you want to delete "${itemLabel}" from catalog & inventory?`)) {
      return
    }

    try {
      setLoading(true)
      await inventoryService.deleteInventoryItem(item.product_id, item.variant_id)
      await fetchProducts(true)
      await loadData()
    } catch (err) {
      console.error('Failed to delete inventory item:', err)
      alert(getErrorMessage(err, 'Failed to delete item'))
      setLoading(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Filter items for Stock Management view
  const filtered = items.filter((item) => {
    const q = search.toLowerCase().trim()
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.variant_name && item.variant_name.toLowerCase().includes(q)) ||
      (item.barcode && item.barcode.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q)) ||
      (item.location && item.location.toLowerCase().includes(q)) ||
      Boolean(jewelleryOf(item)?.huid?.toLowerCase().includes(q)) ||
      Boolean(jewelleryOf(item)?.pieces?.some((pc) => pc.huid.toLowerCase().includes(q) || pc.serial.toLowerCase().includes(q)))

    if (!matchesSearch) return false

    if (filterStatus === 'out') return item.stock <= 0
    if (filterStatus === 'low') return item.stock > 0 && item.stock <= lowStockLimit(item.low_stock_alert)
    if (filterStatus === 'in_stock') return item.stock > 0

    return true
  })

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const allVisibleSelected = filtered.length > 0 && filtered.every((item) => prev.has(item.id))
      if (allVisibleSelected) return new Set()
      return new Set(filtered.map((item) => item.id))
    })
  }

  const selectedProductIds = Array.from(
    new Set(items.filter((item) => selectedIds.has(item.id)).map((item) => item.product_id))
  )

  const handleBulkSetLocation = async (location: string) => {
    await inventoryService.bulkSetLocation(selectedProductIds, location)
    setSelectedIds(new Set())
    await fetchProducts(true)
    await loadData()
    play('success')
  }

  // Summary Metrics
  const totalSkus = items.length
  const totalUnits = items.reduce((sum, i) => sum + i.stock, 0)
  const outOfStockCount = items.filter((i) => i.stock <= 0).length
  const lowStockCount = items.filter((i) => i.stock > 0 && i.stock <= lowStockLimit(i.low_stock_alert)).length
  const totalValuation = items.reduce((sum, i) => sum + i.stock * itemValue(i), 0)

  interface ProductOptionType {
    id: number
    name: string
    price: number
    cost_price?: number
    barcode?: string
    stock_quantity?: number
    category?: string
    has_variants?: boolean
  }

  // Combined product options for Barcode Generator intake
  const distinctProducts: ProductOptionType[] = Array.from(
    new Map<number, ProductOptionType>([
      ...storeProducts
        .filter((p) => p.category?.trim().toLowerCase() !== 'unregistered')
        .map(
          (p): [number, ProductOptionType] => [
            Number(p.id),
            {
              id: Number(p.id),
              name: p.name,
              price: p.price,
              cost_price: p.purchasePrice || 0,
              barcode: p.barcode,
              stock_quantity: p.stockQuantity ?? p.stock ?? 0,
              category: p.category,
              has_variants: p.hasVariants,
            },
          ]
        ),
      ...items
        .filter((i) => i.category?.trim().toLowerCase() !== 'unregistered')
        .map(
          (i): [number, ProductOptionType] => [
            i.product_id,
            {
              id: i.product_id,
              name: i.name,
              price: i.price,
              cost_price: 0,
              barcode: i.barcode || undefined,
              stock_quantity: i.stock,
              category: i.category || undefined,
              has_variants: !!i.variant_id,
            },
          ]
        ),
    ]).values()
  )

  return (
    <div className="space-y-6">
      {/* NAVIGATION */}
      {role === 'admin' && (
        <div className="bg-white border border-black/10 rounded-xl p-2 flex flex-wrap items-center gap-1 w-full sm:w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('stock')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${activeTab === 'stock' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000]/70 hover:bg-[var(--accent-a10)] hover:text-[#000000]'}`}
            >
              <Boxes className="w-4 h-4" /> Products &amp; Stock
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('products')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${activeTab === 'products' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000]/70 hover:bg-[var(--accent-a10)] hover:text-[#000000]'}`}
            >
              <Package className="w-4 h-4" /> Add / Edit Items
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('categories')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${activeTab === 'categories' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000]/70 hover:bg-[var(--accent-a10)] hover:text-[#000000]'}`}
            >
              <Tag className="w-4 h-4" /> Categories
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${activeTab === 'analytics' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000]/70 hover:bg-[var(--accent-a10)] hover:text-[#000000]'}`}
            >
              <BarChart3 className="w-4 h-4" /> Analytics &amp; Reports
            </button>
        </div>
      )}

      {/* TAB 1: STOCK MANAGEMENT VIEW */}
      {activeTab === 'stock' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Title */}
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <h2 className="text-[28px] font-black text-[#000000] tracking-tight flex items-center gap-3">
                <Boxes className="w-7 h-7 text-[var(--accent)]" />
                Inventory
              </h2>
              <p className="text-xs text-[#000000] font-semibold mt-1">Jewellery stock, weights, barcodes and stock levels — add, edit and delete.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto">
              <div className="relative flex-1 lg:flex-none">
                <Search className="w-3.5 h-3.5 text-[#000000]/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search item, HUID, barcode…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-3 py-2 bg-white border border-black/10 rounded-lg text-xs font-semibold focus:outline-none focus:border-[var(--accent)] w-full lg:w-56"
                />
              </div>
              {role === 'admin' && (
                <>
                  <button type="button" onClick={() => setActiveTab('categories')} className="text-[10px] font-bold px-3 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer text-[var(--accent)] bg-white border border-[var(--accent-a40)] hover:bg-[var(--accent-a10)]">
                    <Tag className="w-3.5 h-3.5" /> Manage Categories
                  </button>
                  <button type="button" onClick={() => { setSelectedForReceive(null); setShowReceiveModal(true) }} title="Generate & print barcodes for items" className="text-[10px] font-bold px-3 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer text-[#000000] bg-white border border-black/10 hover:bg-[#FAFAFA]">
                    <Printer className="w-3.5 h-3.5 text-[var(--accent)]" /> Add Barcode
                  </button>
                  <button type="button" onClick={() => setActiveTab('products')} className="text-[10px] font-bold px-3 py-2 rounded-lg uppercase tracking-wider flex items-center gap-1.5 transition-colors cursor-pointer text-white bg-[var(--accent)] hover:bg-[#27272A]">
                    <Plus className="w-3.5 h-3.5" /> Add Product
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {([
              ['Total SKUs', String(totalSkus), <Layers key="l" className="w-5 h-5 text-[#000000]" />, 'bg-black/5'],
              ['Total Stock', `${totalUnits} Units`, <Package key="p" className="w-5 h-5 text-[#16A34A]" />, 'bg-[#DCFCE7]'],
              ['Low Stock Items', String(lowStockCount), <AlertTriangle key="a" className="w-5 h-5 text-[#D97706]" />, 'bg-[#FEF3C7]'],
              ['Stock Valuation', formatCurrency(totalValuation), <Coins key="c" className="w-5 h-5 text-[var(--accent)]" />, 'bg-[var(--accent-a10)]'],
            ] as const).map(([label, value, icon, bg]) => (
              <div key={label} className="bg-white border border-black/10 rounded-xl p-4 shadow-xs flex justify-between items-center">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-[var(--accent-dark)] uppercase tracking-wider">{label}</p>
                  <p className="text-xl font-black text-black break-words">{value}</p>
                </div>
                <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>{icon}</div>
              </div>
            ))}
          </div>

          {/* Status filter */}
          <div className="bg-white border border-black/10 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" onClick={() => setFilterStatus('all')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${filterStatus === 'all' ? 'bg-[var(--accent)] text-white' : 'bg-[#F4F4F5] text-black hover:bg-black/10'}`}>
                All ({items.length})
              </button>
              <button type="button" onClick={() => setFilterStatus('in_stock')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${filterStatus === 'in_stock' ? 'bg-[var(--accent)] text-white' : 'bg-[#F4F4F5] text-black hover:bg-black/10'}`}>
                In Stock ({items.filter((i) => i.stock > 0).length})
              </button>
              <button type="button" onClick={() => setFilterStatus('low')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${filterStatus === 'low' ? 'bg-[var(--accent)] text-white' : 'bg-[#F4F4F5] text-black hover:bg-black/10'}`}>
                Low Stock ({lowStockCount})
              </button>
              <button type="button" onClick={() => setFilterStatus('out')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${filterStatus === 'out' ? 'bg-[var(--accent)] text-white' : 'bg-[#F4F4F5] text-black hover:bg-black/10'}`}>
                Out of Stock ({outOfStockCount})
              </button>
            </div>
            <button type="button" onClick={loadData} className="flex items-center justify-center w-8 h-8 bg-black/5 hover:bg-black/10 text-[#000000] rounded-md transition-colors cursor-pointer" title="Refresh stock list">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Bulk Selection Action Bar (Admin Only) */}
          {role === 'admin' && selectedIds.size > 0 && (
            <div className="bg-[#0A0A0A] border border-[var(--accent)] rounded-xl p-3.5 shadow-sm flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs font-black text-white">
                {selectedProductIds.length} product{selectedProductIds.length === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBulkLocationOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-[#1A1A1A] border border-[var(--accent)] text-white text-xs font-black hover:bg-[#2A2A2A] transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <MapPin size={14} /> Set Location
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3.5 py-2 rounded-xl border border-gray-600 text-gray-300 text-xs font-bold hover:bg-white/5 transition-all cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Stock Table */}
          <div className="bg-white border border-black/10 rounded-xl overflow-hidden shadow-sm">
            {loading ? (
              <div className="p-16 text-center text-gray-400 font-bold text-xs flex flex-col items-center justify-center">
                <RefreshCw size={24} className="animate-spin text-[var(--accent)] mb-2" />
                Loading inventory items...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-16 text-center text-gray-400 font-bold text-xs">
                No inventory items match your search or filter.
              </div>
            ) : (
              <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-black/10 text-xs font-bold text-gray-700 bg-[#F9FAFB]">
                    <tr>
                      {role === 'admin' && (
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">
                          <input
                            type="checkbox"
                            checked={filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id))}
                            onChange={toggleSelectAllVisible}
                            className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-[var(--accent)]"
                            title="Select all visible rows"
                          />
                        </th>
                      )}
                      <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Item &amp; Jewellery Details</th>
                      <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Barcode</th>
                      <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Location</th>
                      <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Category</th>
                      <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">Stock Level</th>
                      <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">Price / Current Value</th>
                      <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((item) => (
                      <tr key={item.id} className="hover:bg-black/[0.03] transition-colors">
                        {role === 'admin' && (
                          <td className="p-3.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-[var(--accent)]"
                            />
                          </td>
                        )}
                        {/* Name & Variant */}
                        <td className="p-3.5">
                          <div className="font-black text-gray-900 text-xs">
                            {item.name}
                          </div>
                          {item.variant_name ? (
                            <span className="inline-block mt-0.5 px-2 py-0.5 rounded-md bg-white border border-[var(--accent-a40)] text-[#000000] font-bold text-[10px]">
                              Size: {item.variant_name}
                            </span>
                          ) : jewelleryOf(item) ? (() => {
                            const j = jewelleryOf(item)!
                            return (
                              <div className="mt-0.5 text-[10px] font-bold text-[var(--accent-dark)] leading-snug">
                                <div>{metalLabel(j.metalType, j.purity)}{j.huid ? ` • HUID ${j.huid}` : ''}{j.sku ? ` • ${j.sku}` : ''}
                                  {j.itemStatus && j.itemStatus !== 'available' && <span className="ml-1.5 inline-block rounded-md border border-amber-300 bg-amber-50 px-1.5 py-px text-[9px] font-black uppercase text-amber-800">{ITEM_STATUS_LABELS[j.itemStatus]}</span>}
                                </div>
                                <div className="font-semibold text-gray-500">
                                  Gross {formatWeight(j.grossWeight || 0)} • Stone {formatWeight(j.stoneWeight || 0)} • Net {formatWeight(j.netWeight || 0)}
                                </div>
                              </div>
                            )
                          })() : (
                            <span className="text-[10px] text-gray-400 font-medium">
                              Standard Item
                            </span>
                          )}
                        </td>

                        {/* Barcode */}
                        <td className="p-3.5">
                          {item.barcode ? (
                            <span className="font-mono text-xs font-bold text-gray-800 bg-gray-100 px-2 py-1 rounded-md">
                              {item.barcode}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">No Barcode</span>
                          )}
                        </td>

                        {/* Location */}
                        <td className="p-3.5 text-gray-600 font-semibold">
                          {item.location || <span className="text-gray-400 italic font-normal">—</span>}
                        </td>

                        {/* Category */}
                        <td className="p-3.5 text-gray-600 font-semibold">
                          {item.category || 'General'}
                        </td>

                        {/* Stock */}
                        <td className="p-3.5 text-center">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-full text-xs font-black ${
                              item.stock <= 0
                                ? 'bg-red-50 text-red-700 border border-red-200'
                                : item.stock <= lowStockLimit(item.low_stock_alert)
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {item.stock} Units
                          </span>
                        </td>

                        {/* Price */}
                        <td className="p-3.5 text-right font-black text-xs text-gray-900">
                          <div className="inline-flex items-center justify-end gap-1.5 group">
                            {isRatedMetal(jewelleryOf(item)?.metalType) ? (
                              <span className="flex flex-col items-end leading-tight" title="Calculated from today's metal rate">
                                {currentProductPrice(jewelleryOf(item)!, rates) == null
                                  ? <span className="text-amber-700">Rate missing</span>
                                  : formatCurrency(currentProductPrice(jewelleryOf(item)!, rates)!)}
                                <span className="text-[9px] font-bold text-gray-400">Live rate</span>
                              </span>
                            ) : (
                            <span>{formatCurrency(item.price)}</span>
                            )}
                            {role === 'admin' && !isRatedMetal(jewelleryOf(item)?.metalType) && (
                              <button
                                type="button"
                                onClick={() => setPriceModalItem(item)}
                                className="p-1 rounded-md text-gray-400 hover:text-amber-800 hover:bg-amber-100/70 transition-all cursor-pointer"
                                title="Quick Edit Price"
                              >
                                <Edit2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Adjust Stock (Admin Only) */}
                            {role === 'admin' && (
                              <button
                                type="button"
                                onClick={() => openAdjust(item)}
                                className="text-[10px] font-bold px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1 text-black/70 hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] border border-black/15"
                                title="Adjust Stock"
                              >
                                <SlidersHorizontal className="w-3 h-3" />
                                Stock
                              </button>
                            )}

                            {/* Stock History */}
                            <button
                              type="button"
                              onClick={() => setHistoryDrawerItem(item)}
                              className="text-[10px] font-bold px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1 text-[var(--accent)] hover:text-white hover:bg-[var(--accent)] border border-[var(--accent-a30)]"
                              title="Stock History"
                            >
                              <History className="w-3 h-3" />
                              History
                            </button>

                            {/* Print Barcode (reserves identical spacing when item has no barcode) */}
                            <button
                              type="button"
                              disabled={!item.barcode}
                              onClick={() => item.barcode && setPrintModalItem(item)}
                              className={`text-[10px] font-bold px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1 border ${
                                item.barcode
                                  ? 'text-black/70 hover:text-[var(--accent)] hover:bg-[var(--accent-a10)] border-black/15'
                                  : 'invisible pointer-events-none border-transparent'
                              }`}
                              title={item.barcode ? 'Print Barcode Labels' : undefined}
                              aria-hidden={!item.barcode}
                            >
                              <Printer className="w-3 h-3" />
                              Barcode
                            </button>

                            {/* Delete Product / Variant (Admin Only) */}
                            {role === 'admin' && (
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item)}
                                className="text-[10px] font-bold px-2.5 py-1.5 rounded uppercase tracking-wider transition-colors cursor-pointer inline-flex items-center gap-1 text-[#DC2626] hover:text-white hover:bg-[#DC2626] border border-[#DC2626]/30"
                                title={`Delete "${item.variant_name ? `${item.name} (${item.variant_name})` : item.name}"`}
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: ADD / EDIT PRODUCTS VIEW */}
      {activeTab === 'products' && (
        <div className="animate-in fade-in duration-150">
          <AddEditProductView onStockUpdated={loadData} />
        </div>
      )}

      {/* TAB 3: CATEGORIES MANAGEMENT VIEW */}
      {activeTab === 'categories' && (
        <div className="animate-in fade-in duration-150">
          <CategoryManagerView />
        </div>
      )}

      {/* TAB 4: ANALYTICS & REPORTS VIEW */}
      {activeTab === 'analytics' && (
        <div className="animate-in fade-in duration-150">
          <InventoryAnalyticsView />
        </div>
      )}

      {/* Modal: Vyapar Barcode Generator Workspace */}
      {showReceiveModal && (
        <CreateBarcodeModal
          isOpen={showReceiveModal}
          onClose={() => setShowReceiveModal(false)}
          products={distinctProducts}
          preselectedProductId={selectedForReceive?.productId}
          preselectedVariantId={selectedForReceive?.variantId}
          onSuccess={loadData}
        />
      )}

      {/* Modal: Print Barcode Labels */}
      {printModalItem && (
        <BarcodePrintModal
          isOpen={!!printModalItem}
          onClose={() => setPrintModalItem(null)}
          productName={printModalItem.name}
          variantName={printModalItem.variant_name}
          barcodeValue={printModalItem.barcode || ''}
          price={printModalItem.price}
          mrp={printModalItem.offer_price}
          defaultQuantity={Math.max(1, printModalItem.stock)}
          jewelleryTag={(() => {
            const j = jewelleryOf(printModalItem)
            return j ? { purity: metalLabel(j.metalType, j.purity), grossWeight: j.grossWeight || 0, netWeight: j.netWeight || 0, sku: j.sku, huid: j.huid } : null
          })()}
        />
      )}

      {/* Modal: Adjust Stock */}
      {adjustModalItem && (
        <AdjustStockModal
          isOpen={!!adjustModalItem}
          onClose={() => setAdjustModalItem(null)}
          item={adjustModalItem}
          onSuccess={loadData}
        />
      )}

      {/* Drawer: Stock History */}
      {historyDrawerItem && (
        <StockHistoryDrawer
          isOpen={!!historyDrawerItem}
          onClose={() => setHistoryDrawerItem(null)}
          item={historyDrawerItem}
        />
      )}

      {/* Modal: Quick Edit Price */}
      {priceModalItem && (
        <QuickPriceModal
          isOpen={!!priceModalItem}
          item={priceModalItem}
          onClose={() => setPriceModalItem(null)}
          onSuccess={(updated) => {
            setItems((prev) =>
              prev.map((it) =>
                it.id === updated.id
                  ? {
                      ...it,
                      price: updated.price,
                      purchase_price: updated.cost_price ?? it.purchase_price,
                    }
                  : it
              )
            )
            void fetchProducts()
          }}
        />
      )}

      {/* Modal: Bulk Set Storage Location */}
      <BulkSetLocationModal
        isOpen={bulkLocationOpen}
        onClose={() => setBulkLocationOpen(false)}
        productCount={selectedProductIds.length}
        onSubmit={handleBulkSetLocation}
      />
    </div>
  )
}
