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
  Box,
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
import { formatWeight, isRatedMetal, metalLabel } from '../../lib/jewellery'

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
      Boolean(jewelleryOf(item)?.huid?.toLowerCase().includes(q))

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
      {/* NAVIGATION / HEADER */}
      {role === 'admin' ? (
        <div className="bg-white border border-[var(--accent-a40)] rounded-2xl p-2 sm:p-2.5 shadow-sm flex items-center justify-between gap-3 overflow-x-auto hide-scrollbar">
          <div className="flex items-center gap-1.5 p-1 bg-[#FBFAF6] border border-gray-200 rounded-xl shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('stock')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'stock'
                  ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-sm'
                  : 'text-gray-600 hover:text-black hover:bg-gray-100'
              }`}
            >
              <Box size={14} /> Stock Management
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('products')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'products'
                  ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-sm'
                  : 'text-gray-600 hover:text-black hover:bg-gray-100'
              }`}
            >
              <Package size={14} /> Add / Edit Items
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('categories')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'categories'
                  ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-sm'
                  : 'text-gray-600 hover:text-black hover:bg-gray-100'
              }`}
            >
              <Tag size={14} /> Categories
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'analytics'
                  ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-sm'
                  : 'text-gray-600 hover:text-black hover:bg-gray-100'
              }`}
            >
              <BarChart3 size={14} /> Analytics &amp; Reports
            </button>
          </div>

          {/* Global Add Barcode CTA */}
          <button
            type="button"
            onClick={() => {
              setSelectedForReceive(null)
              setShowReceiveModal(true)
            }}
            className="px-4 py-2.5 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-xs font-black hover:bg-[#1A1A1A] transition-all shadow-md flex items-center gap-2 cursor-pointer shrink-0 whitespace-nowrap"
            title="Generate & print barcodes for items"
          >
            <Printer size={15} /> Add Barcode
          </button>
        </div>
      ) : (
        <div className="bg-white border border-[var(--accent-a40)] rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#0A0A0A] text-[var(--accent)] flex items-center justify-center font-black">
              <Box size={18} />
            </div>
            <div>
              <h2 className="text-base font-black text-[#0A0A0A]">Stock Management</h2>
              <p className="text-xs font-semibold text-gray-500">Live jewellery stock, weights and stock levels</p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: STOCK MANAGEMENT VIEW */}
      {activeTab === 'stock' && (
        <div className="space-y-6 animate-in fade-in duration-150">
          {/* Top KPI Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white border border-[var(--accent-a40)] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-[#0A0A0A] text-[var(--accent)] flex items-center justify-center font-black shrink-0">
                <Layers size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-gray-500">Total SKUs</div>
                <div className="text-[15px] sm:text-xl font-black text-black break-words">{totalSkus}</div>
              </div>
            </div>

            <div className="bg-white border border-[var(--accent-a40)] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center font-black shrink-0">
                <Package size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-gray-500">Total Stock</div>
                <div className="text-[15px] sm:text-xl font-black text-emerald-700 break-words">{totalUnits} Units</div>
              </div>
            </div>

            <div className="bg-white border border-[var(--accent-a40)] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center font-black shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-gray-500">Low Stock Items</div>
                <div className="text-[15px] sm:text-xl font-black text-amber-700 break-words">{lowStockCount}</div>
              </div>
            </div>

            <div className="bg-white border border-[var(--accent-a40)] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3">
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-[#FBFAF6] text-[#0A0A0A] border border-[var(--accent-a40)] flex items-center justify-center font-black text-sm shrink-0">
                ₹
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold text-gray-500">Stock Valuation</div>
                <div className="text-[14px] sm:text-lg font-black text-[#0A0A0A] break-words">{formatCurrency(totalValuation)}</div>
              </div>
            </div>
          </div>

          {/* Toolbar & Filter Chips */}
          <div className="bg-white border border-[var(--accent-a40)] rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search item, HUID, barcode, category, location..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-300 bg-[#FBFAF6] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white"
              />
            </div>

            {/* Filter Chips & Refresh */}
            <div className="flex items-stretch sm:items-center gap-2">
              <div className="grid grid-cols-2 sm:flex gap-2 flex-1 sm:flex-none min-w-0">
                <button
                  type="button"
                  onClick={() => setFilterStatus('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
                    filterStatus === 'all'
                      ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-xs'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All ({items.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('in_stock')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
                    filterStatus === 'in_stock'
                      ? 'bg-emerald-800 text-white shadow-xs'
                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  In Stock ({items.filter((i) => i.stock > 0).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('low')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
                    filterStatus === 'low'
                      ? 'bg-amber-800 text-white shadow-xs'
                      : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  Low Stock ({lowStockCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('out')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer text-center ${
                    filterStatus === 'out'
                      ? 'bg-red-800 text-white shadow-xs'
                      : 'bg-red-50 text-red-800 border border-red-200 hover:bg-red-100'
                  }`}
                >
                  Out of Stock ({outOfStockCount})
                </button>
              </div>
              <button
                type="button"
                onClick={loadData}
                className="shrink-0 p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                title="Refresh stock list"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Bulk Selection Action Bar (Admin Only) */}
          {role === 'admin' && selectedIds.size > 0 && (
            <div className="bg-[#0A0A0A] border border-[var(--accent)] rounded-2xl p-3.5 shadow-sm flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs font-black text-[var(--accent)]">
                {selectedProductIds.length} product{selectedProductIds.length === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBulkLocationOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-[#1A1A1A] border border-[var(--accent)] text-[var(--accent)] text-xs font-black hover:bg-[#2A2A2A] transition-all flex items-center gap-1.5 cursor-pointer"
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
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
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
                <table className="w-full min-w-[760px] text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#FBFAF6] border-b border-gray-200 text-xs font-bold text-gray-700">
                    <tr>
                      {role === 'admin' && (
                        <th className="p-3.5 w-10">
                          <input
                            type="checkbox"
                            checked={filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id))}
                            onChange={toggleSelectAllVisible}
                            className="w-4 h-4 rounded border-gray-300 cursor-pointer accent-[var(--accent)]"
                            title="Select all visible rows"
                          />
                        </th>
                      )}
                      <th className="p-3.5">Item &amp; Jewellery Details</th>
                      <th className="p-3.5">Barcode</th>
                      <th className="p-3.5">Location</th>
                      <th className="p-3.5">Category</th>
                      <th className="p-3.5 text-center">Stock Level</th>
                      <th className="p-3.5 text-right">Price / Current Value</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map((item) => (
                      <tr key={item.id} className="hover:bg-[#FBFAF6] transition-colors">
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
                            <span className="inline-block mt-0.5 px-2 py-0.5 rounded-md bg-[#FBFAF6] border border-[var(--accent-a40)] text-[#0A0A0A] font-bold text-[10px]">
                              Size: {item.variant_name}
                            </span>
                          ) : jewelleryOf(item) ? (() => {
                            const j = jewelleryOf(item)!
                            return (
                              <div className="mt-0.5 text-[10px] font-bold text-[var(--accent-dark)] leading-snug">
                                <div>{metalLabel(j.metalType, j.purity)}{j.huid ? ` • HUID ${j.huid}` : ''}{j.sku ? ` • ${j.sku}` : ''}</div>
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
                                className="px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 text-[11px] font-bold transition-colors cursor-pointer"
                                title="Adjust Stock"
                              >
                                <SlidersHorizontal size={13} className="inline mr-1" />
                                Adjust
                              </button>
                            )}

                            {/* Stock History */}
                            <button
                              type="button"
                              onClick={() => setHistoryDrawerItem(item)}
                              className="p-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
                              title="Stock History"
                            >
                              <History size={14} />
                            </button>

                            {/* Print Barcode (reserves identical spacing when item has no barcode) */}
                            <button
                              type="button"
                              disabled={!item.barcode}
                              onClick={() => item.barcode && setPrintModalItem(item)}
                              className={`p-1.5 rounded-lg border transition-colors ${
                                item.barcode
                                  ? 'bg-[#0A0A0A] text-[var(--accent)] border-[var(--accent)] hover:bg-[#1A1A1A] cursor-pointer'
                                  : 'invisible pointer-events-none border-transparent'
                              }`}
                              title={item.barcode ? 'Print Barcode Labels' : undefined}
                              aria-hidden={!item.barcode}
                            >
                              <Printer size={14} />
                            </button>

                            {/* Delete Product / Variant (Admin Only) */}
                            {role === 'admin' && (
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item)}
                                className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer"
                                title={`Delete "${item.variant_name ? `${item.name} (${item.variant_name})` : item.name}"`}
                              >
                                <Trash2 size={14} />
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
