import React, { useState, useEffect } from 'react'
import {
  Plus,
  Trash2,
  Search,
  Check,
  Package,
  Tag,
  Boxes,
  ArrowLeft,
  Pencil,
  Layers,
  Ruler,
  SlidersHorizontal,
  Gem,
  ImagePlus,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProductStore, type Product } from '../../store/store'
import { fetchVariantsByProduct } from '../../services/variantService'
import { inventoryService, type CategoryRecord } from '../../services/inventoryService'
import { useSound } from '../../context/SoundContext'
import { getErrorMessage } from '../../lib/errorMessage'
import { normalizeBarcode } from '../../lib/barcode'
import { roundTo } from '../../lib/retail'
import { UNIT_OPTIONS, findUnitOption } from '../../lib/units'
import { UnitSelect } from './UnitSelect'
import { defaultLowStockThreshold } from '../../lib/stockLevels'
import { formatCurrency } from '../../lib/retail'
import {
  CUSTOM_PURITY,
  GOLD_PURITIES,
  MAKING_CHARGE_TYPE_LABELS,
  METAL_LABELS,
  STANDARD_PURITY,
  WASTAGE_TYPE_LABELS,
  calculateNetWeight,
  isRatedMetal,
  metalLabel,
  priceJewelleryItem,
  purityToKarat,
  type MakingChargeType,
  type MetalType,
  type WastageType,
} from '../../lib/jewellery'
import { currentProductPrice } from '../../lib/jewelleryProduct'
import { useMetalRateStore } from '../../store/metalRateStore'
import { isMissingSchemaError } from '../../services/productService'
import { uploadProductImage } from '../../lib/storage'
import { auditService } from '../../services/auditService'
import {
  EMPTY_STONE_DETAILS,
  HALLMARK_LABELS,
  ITEM_STATUS_LABELS,
  type ItemStatus,
  normalizeStoneDetails,
  type HallmarkStatus,
  type StoneDetails,
} from '../../lib/jewellery'


export interface VariantInputRow {
  id: string
  qty: string
  price: number
  costPrice: number
  stock: number
  customBarcode?: string
  /** YYYY-MM-DD; each pack size can have its own batch dates */
  mfgDate?: string
  expiryDate?: string
}

/** Saves a pack size's batch dates. Works before the mfg_date column exists (then saves expiry only). */
async function saveVariantDates(variantId: string, row: VariantInputRow) {
  const expiry_date = row.expiryDate || null
  const mfg_date = row.mfgDate || null
  const { error } = await supabase.from('product_variants').update({ expiry_date, mfg_date }).eq('id', variantId)
  if (error && /mfg_date/i.test(error.message || '')) {
    await supabase.from('product_variants').update({ expiry_date }).eq('id', variantId)
  } else if (error) {
    console.error('[AddEditProductView] saving pack size dates failed:', error)
  }
}

/** Loads batch dates for pack sizes (falls back to expiry only before mfg_date exists). */
async function loadVariantDates(productId: string): Promise<Map<string, { mfgDate: string; expiryDate: string }>> {
  const out = new Map<string, { mfgDate: string; expiryDate: string }>()
  let res = await supabase.from('product_variants').select('id, expiry_date, mfg_date').eq('product_id', productId)
  if (res.error) res = await supabase.from('product_variants').select('id, expiry_date').eq('product_id', productId) as typeof res
  for (const r of (res.data || []) as Array<{ id: string; expiry_date?: string | null; mfg_date?: string | null }>) {
    out.set(String(r.id), { mfgDate: String(r.mfg_date || '').slice(0, 10), expiryDate: String(r.expiry_date || '').slice(0, 10) })
  }
  return out
}

// Extracts the leading number from a stored size label (e.g. "20gm" -> "20") so
// existing variant rows still show a sensible quantity when the product is reopened.
const parseQtyFromLabel = (label?: string | null): string => {
  if (!label) return ''
  const match = label.match(/^(\d+(?:\.\d+)?)/)
  return match ? match[1] : ''
}

// The actual barcode_registry writes below use `.upsert(..., { onConflict: 'barcode_value' })`,
// which silently reassigns a barcode to the new owner instead of raising a unique-constraint
// error. This pre-flight check is the only thing that actually blocks reusing a barcode that
// already belongs to a different product/variant.
async function isBarcodeConflict(
  normalizedValue: string,
  owner: { productId: number | null; variantId?: string | null }
): Promise<boolean> {
  if (!normalizedValue) return false
  const { data } = await supabase
    .from('barcode_registry')
    .select('product_id, variant_id')
    .ilike('barcode_value', normalizedValue)
    .eq('is_active', true)
    .maybeSingle()
  if (!data) return false
  if (owner.variantId) return data.variant_id !== owner.variantId
  return !(data.variant_id === null && data.product_id === owner.productId)
}

export const AddEditProductView: React.FC<{ onStockUpdated?: () => void }> = ({ onStockUpdated }) => {
  const { products, fetchProducts } = useProductStore()
  const { play } = useSound()
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null)
  const [mobileView, setMobileView] = useState<'catalog' | 'form'>('catalog')

  // Form State
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [price, setPrice] = useState<string>('')
  const [purchasePrice, setPurchasePrice] = useState<string>('')
  const [unitChoice, setUnitChoice] = useState<string>('pcs')
  const [customUnitLabel, setCustomUnitLabel] = useState<string>('')
  const [contentSize, setContentSize] = useState<string>('') // e.g. "200ml", "500g" for packets
  const [contentUnit, setContentUnit] = useState<string>('') // e.g. "ml", "g"
  const [stockQuantity, setStockQuantity] = useState<string>('0')
  const [lowStockAlert, setLowStockAlert] = useState<string>(() => String(defaultLowStockThreshold()))
  const [expiryDate, setExpiryDate] = useState<string>('')
  const [mfgDate, setMfgDate] = useState<string>('')
  const [location, setLocation] = useState<string>('')
  const [barcode, setBarcode] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [hasVariants, setHasVariants] = useState<boolean>(false)
  const [soldByWeight, setSoldByWeight] = useState<boolean>(false)
  const [hasSpecialOffer, setHasSpecialOffer] = useState<boolean>(false)
  const [specialOfferNote, setSpecialOfferNote] = useState<string>('')
  const [specialOfferCost, setSpecialOfferCost] = useState<string>('')

  // Jewellery details
  const rates = useMetalRateStore((s) => s.rates)
  const [metalType, setMetalType] = useState<MetalType | ''>('')
  const [purityChoice, setPurityChoice] = useState<string>('22K')
  const [customPurity, setCustomPurity] = useState<string>('')
  const [grossWeight, setGrossWeight] = useState<string>('')
  const [stoneWeight, setStoneWeight] = useState<string>('')
  const [netWeight, setNetWeight] = useState<string>('')
  const [netWeightEdited, setNetWeightEdited] = useState(false)
  const [makingCharge, setMakingCharge] = useState<string>('')
  const [makingChargeType, setMakingChargeType] = useState<MakingChargeType>('fixed')
  const [wastage, setWastage] = useState<string>('')
  const [wastageType, setWastageType] = useState<WastageType>('percentage')
  const [stoneCharge, setStoneCharge] = useState<string>('')
  const [otherCharge, setOtherCharge] = useState<string>('')
  const [huid, setHuid] = useState<string>('')
  const [designNumber, setDesignNumber] = useState<string>('')
  const [sku, setSku] = useState<string>('')
  const [brand, setBrand] = useState<string>('')
  const [subcategory, setSubcategory] = useState<string>('')
  const [otherWeight, setOtherWeight] = useState<string>('')
  const [hallmarkStatus, setHallmarkStatus] = useState<HallmarkStatus | ''>('')
  const [itemStatus, setItemStatus] = useState<ItemStatus>('available')
  /** Status when the form opened: item_status is only sent when it changes, so saving works before the database update. */
  const [loadedItemStatus, setLoadedItemStatus] = useState<ItemStatus>('available')
  const [stoneDetails, setStoneDetails] = useState<StoneDetails>(EMPTY_STONE_DETAILS)
  const [showStones, setShowStones] = useState(false)
  const [imageUrl, setImageUrl] = useState<string>('')
  const [imageUploading, setImageUploading] = useState(false)

  // Variants Rows for dynamic addition
  const [variantRows, setVariantRows] = useState<VariantInputRow[]>([])

  const [loading, setLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Resolves the active unit choice to concrete DB fields + a short display suffix
  // (e.g. "gm", "kg"), handling the custom "Other" unit the owner typed in themselves.
  const getSelectedUnitInfo = () => {
    const preset = UNIT_OPTIONS.find((o) => o.value === unitChoice) || UNIT_OPTIONS[0]
    if (unitChoice === 'custom') {
      const custom = customUnitLabel.trim() || 'unit'
      return { unitType: 'unit' as const, unit: custom.toLowerCase(), suffix: custom }
    }
    return { unitType: preset.unitType, unit: preset.unit, suffix: preset.suffix }
  }

  useEffect(() => {
    void fetchProducts()
    inventoryService.fetchCategories().then(setCategories).catch(console.error)
  }, [fetchProducts])

  const resetForm = () => {
    setSelectedProductId(null)
    setName('')
    setCategoryId('')
    setPrice('')
    setPurchasePrice('')
    setUnitChoice('pcs')
    setCustomUnitLabel('')
    setContentSize('')
    setContentUnit('')
    setStockQuantity('0')
    setLowStockAlert(String(defaultLowStockThreshold()))
    setExpiryDate('')
    setMfgDate('')
    setLocation('')
    setBarcode('')
    setDescription('')
    setHasVariants(false)
    setSoldByWeight(false)
    setHasSpecialOffer(false)
    setSpecialOfferNote('')
    setSpecialOfferCost('')
    setVariantRows([])
    setStatusMessage(null)
    setMetalType('')
    setPurityChoice('22K')
    setCustomPurity('')
    setGrossWeight('')
    setStoneWeight('')
    setNetWeight('')
    setNetWeightEdited(false)
    setMakingCharge('')
    setMakingChargeType('fixed')
    setWastage('')
    setWastageType('percentage')
    setStoneCharge('')
    setOtherCharge('')
    setHuid('')
    setDesignNumber('')
    setSku('')
    setBrand('')
    setSubcategory('')
    setOtherWeight('')
    setHallmarkStatus('')
    setStoneDetails(EMPTY_STONE_DETAILS)
    setShowStones(false)
    setImageUrl('')
  }

  const startEditProduct = async (p: Product) => {
    setMobileView('form')
    setSelectedProductId(Number(p.id))
    setName(p.name || '')
    setCategoryId(p.categoryId ? Number(p.categoryId) : '')
    setPrice(String(p.price || ''))
    setPurchasePrice(String(p.purchasePrice || ''))
    const matchedUnit = findUnitOption(p.unitType || 'unit', p.unitLabel || 'piece')
    if (matchedUnit) {
      setUnitChoice(matchedUnit.value)
      setCustomUnitLabel('')
    } else {
      setUnitChoice('custom')
      setCustomUnitLabel(p.unitLabel || '')
    }
    setStockQuantity(String(p.stockQuantity ?? p.stock ?? 0))
    setLowStockAlert(p.lowStockAlert ? String(p.lowStockAlert) : String(defaultLowStockThreshold()))
    setExpiryDate(p.expiryDate || '')
    setMfgDate(p.mfgDate || '')
    setLocation(p.location || '')
    setBarcode(p.barcode || '')
    setDescription(p.description || '')
    setHasVariants(Boolean(p.hasVariants))
    setSoldByWeight(Boolean(p.allowDecimalQuantity))
    setHasSpecialOffer(Boolean(p.hasSpecialOffer))
    setSpecialOfferNote(p.specialOfferNote || '')
    setSpecialOfferCost(p.specialOfferCost != null ? String(p.specialOfferCost) : '')
    setStatusMessage(null)
    setMetalType(p.metalType || '')
    const storedPurity = (p.purity || '').trim()
    const presetPurities = p.metalType === 'gold' ? (GOLD_PURITIES as readonly string[]) : [STANDARD_PURITY]
    if (!storedPurity) {
      setPurityChoice(p.metalType === 'gold' ? '22K' : STANDARD_PURITY)
      setCustomPurity('')
    } else if (presetPurities.includes(storedPurity)) {
      setPurityChoice(storedPurity)
      setCustomPurity('')
    } else {
      setPurityChoice(CUSTOM_PURITY)
      setCustomPurity(storedPurity)
    }
    setGrossWeight(p.grossWeight ? String(p.grossWeight) : '')
    setStoneWeight(p.stoneWeight ? String(p.stoneWeight) : '')
    setNetWeight(p.netWeight ? String(p.netWeight) : '')
    setNetWeightEdited(Boolean(p.netWeight) && p.netWeight !== calculateNetWeight(p.grossWeight || 0, p.stoneWeight || 0, p.otherWeight || 0))
    setMakingCharge(p.makingCharge ? String(p.makingCharge) : '')
    setMakingChargeType(p.makingChargeType || 'fixed')
    setWastage(p.wastage ? String(p.wastage) : '')
    setWastageType(p.wastageType || 'percentage')
    setStoneCharge(p.stoneCharge ? String(p.stoneCharge) : '')
    setOtherCharge(p.otherCharge ? String(p.otherCharge) : '')
    setHuid(p.huid || '')
    setDesignNumber(p.designNumber || '')
    setSku(p.sku || '')
    setBrand(p.brand || '')
    setSubcategory(p.subcategory || '')
    setOtherWeight(p.otherWeight ? String(p.otherWeight) : '')
    setHallmarkStatus(p.hallmarkStatus || '')
    setItemStatus(p.itemStatus || 'available')
    setLoadedItemStatus(p.itemStatus || 'available')
    setStoneDetails(p.stoneDetails || EMPTY_STONE_DETAILS)
    setShowStones(Boolean(p.stoneDetails))
    setImageUrl(p.imageUrl && !p.imageUrl.includes('placeholder') ? p.imageUrl : '')

    if (p.hasVariants) {
      try {
        const [vars, dates] = await Promise.all([fetchVariantsByProduct(String(p.id)), loadVariantDates(String(p.id))])
        setVariantRows(
          vars.map((v) => ({
            id: v.id,
            qty: parseQtyFromLabel(v.sizeLabel || v.variantName),
            price: v.price,
            costPrice: v.purchasePrice || 0,
            stock: v.stock || 0,
            customBarcode: v.barcode || '',
            mfgDate: dates.get(String(v.id))?.mfgDate || '',
            expiryDate: dates.get(String(v.id))?.expiryDate || '',
          }))
        )
      } catch (err) {
        console.error('Failed to load variants for edit:', err)
      }
    } else {
      setVariantRows([])
    }
  }

  const handleAddVariantRow = () => {
    const baseP = parseFloat(price) || 0
    const baseC = parseFloat(purchasePrice) || 0
    setVariantRows((prev) => [
      ...prev,
      {
        id: `var_${Date.now()}_${Math.random()}`,
        qty: '',
        price: baseP,
        costPrice: baseC,
        stock: 0,
        customBarcode: '',
        mfgDate: '',
        expiryDate: '',
      },
    ])
  }

  const handleRemoveVariantRow = (id: string) => {
    setVariantRows((prev) => prev.filter((r) => r.id !== id))
  }

  const handleUpdateVariantRow = (
    id: string,
    field: keyof VariantInputRow,
    value: string | number
  ) => {
    setVariantRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )
  }

  const handleDeleteProduct = async (id: number, prodName: string) => {
    if (!window.confirm(`Are you sure you want to delete "${prodName}" from the catalog & jewellery stock?`)) {
      return
    }

    try {
      setLoading(true)
      await inventoryService.deleteInventoryItem(id)
      void auditService.log({ action: 'product_deleted', entityType: 'product', entityId: prodName, oldValue: { id } })
      await fetchProducts(true)
      resetForm()
      setMobileView('catalog')
      onStockUpdated?.()
      play('success')
      setStatusMessage({ type: 'success', text: `Product "${prodName}" deleted successfully.` })
    } catch (err) {
      console.error('Failed to delete product:', err)
      play('error')
      setStatusMessage({ type: 'error', text: getErrorMessage(err, 'Failed to delete product') })
    } finally {
      setLoading(false)
    }
  }

  // ── Jewellery derived values ──────────────────────────────────────────
  const isJewellery = metalType !== ''
  const isRatePriced = isRatedMetal(metalType || null)
  const effectivePurity = !metalType
    ? ''
    : purityChoice === CUSTOM_PURITY || metalType === 'other'
      ? customPurity.trim().toUpperCase()
      : purityChoice
  const computedNetWeight = calculateNetWeight(parseFloat(grossWeight) || 0, parseFloat(stoneWeight) || 0, parseFloat(otherWeight) || 0)
  const cleanStoneDetails = showStones ? normalizeStoneDetails(stoneDetails) : null
  const effectiveNetWeight = netWeightEdited ? Math.max(0, parseFloat(netWeight) || 0) : computedNetWeight
  const jewelleryPreview = metalType
    ? priceJewelleryItem({
        metalType,
        purity: effectivePurity,
        grossWeight: parseFloat(grossWeight) || 0,
        stoneWeight: parseFloat(stoneWeight) || 0,
        netWeight: effectiveNetWeight,
        makingCharge: parseFloat(makingCharge) || 0,
        makingChargeType,
        wastage: parseFloat(wastage) || 0,
        wastageType,
        stoneCharge: parseFloat(stoneCharge) || 0,
        otherCharge: parseFloat(otherCharge) || 0,
        huid: huid.trim(),
        designNumber: designNumber.trim(),
        subcategory: subcategory.trim(),
        otherWeight: parseFloat(otherWeight) || 0,
        hallmarkStatus: hallmarkStatus || null,
        stoneDetails: cleanStoneDetails,
      }, rates, { fallbackPrice: parseFloat(price) || 0 })
    : null

  const selectMetal = (next: MetalType | '') => {
    setMetalType(next)
    if (!next) return
    // Jewellery pieces are sold per piece with a single calculated price.
    setUnitChoice('pcs')
    setHasVariants(false)
    setSoldByWeight(false)
    if (next === 'gold') {
      setPurityChoice((current) => ((GOLD_PURITIES as readonly string[]).includes(current) || current === CUSTOM_PURITY ? current : '22K'))
    } else {
      setPurityChoice(next === 'other' ? CUSTOM_PURITY : STANDARD_PURITY)
    }
  }

  /** Validates jewellery fields; returns an error message or null. */
  const validateJewellery = (): string | null => {
    if (!metalType) return null
    const gross = parseFloat(grossWeight) || 0
    const stone = parseFloat(stoneWeight) || 0
    if (gross < 0 || stone < 0 || effectiveNetWeight < 0) return 'Weights cannot be negative.'
    if (stone > gross) return 'Stone weight cannot be more than the gross weight.'
    if (stone + (parseFloat(otherWeight) || 0) > gross) return 'Stone + other weight cannot be more than the gross weight.'
    if (gross > 0 && effectiveNetWeight > gross) return 'Net weight cannot be more than the gross weight.'
    if (isRatePriced && effectiveNetWeight <= 0) return 'Enter the gross weight (and stone weight) so the net weight is greater than zero.'
    if (metalType === 'gold' && purityChoice === CUSTOM_PURITY && !purityToKarat(effectivePurity)) {
      return 'Custom gold purity must be a karat like 19K or a fineness like 916.'
    }
    if (makingChargeType === 'percentage' && (parseFloat(makingCharge) || 0) > 100) return 'Making charge percentage cannot exceed 100%.'
    if (wastageType === 'percentage' && (parseFloat(wastage) || 0) > 100) return 'Wastage percentage cannot exceed 100%.'
    return null
  }

  /** Jewellery + identification columns for the products row. */
  const buildJewelleryColumns = (): Record<string, unknown> => {
    const base: Record<string, unknown> = { sku: sku.trim() || null, brand: brand.trim() || null, ...(imageUrl ? { image_url: imageUrl } : {}) }
    if (!metalType) {
      // Only touch jewellery columns when turning an existing jewellery item back into a regular one,
      // so regular products keep saving even before the jewellery migration is applied.
      const wasJewellery = Boolean(products.find((prod) => Number(prod.id) === selectedProductId)?.metalType)
      return wasJewellery ? { ...base, metal_type: null } : base
    }
    return {
      ...base,
      metal_type: metalType,
      purity: effectivePurity || null,
      gross_weight: roundTo(parseFloat(grossWeight) || 0, 3),
      stone_weight: roundTo(parseFloat(stoneWeight) || 0, 3),
      net_weight: roundTo(effectiveNetWeight, 3),
      making_charge: roundTo(parseFloat(makingCharge) || 0, 2),
      making_charge_type: makingChargeType,
      wastage: roundTo(parseFloat(wastage) || 0, 3),
      wastage_type: wastageType,
      stone_charge: roundTo(parseFloat(stoneCharge) || 0, 2),
      other_charge: roundTo(parseFloat(otherCharge) || 0, 2),
      huid: huid.trim().toUpperCase() || null,
      design_number: designNumber.trim() || null,
      subcategory: subcategory.trim() || null,
      other_weight: roundTo(parseFloat(otherWeight) || 0, 3),
      hallmark_status: hallmarkStatus || null,
      stone_details: cleanStoneDetails,
      ...(itemStatus !== loadedItemStatus ? { item_status: itemStatus } : {}),
    }
  }

  const handleImageFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setStatusMessage({ type: 'error', text: 'Choose an image file (JPEG, PNG or WebP).' }); return }
    if (file.size > 5_000_000) { setStatusMessage({ type: 'error', text: 'Image must be under 5 MB.' }); return }
    setImageUploading(true)
    try {
      setImageUrl(await uploadProductImage(file))
    } catch (err) {
      setStatusMessage({ type: 'error', text: `Image upload failed: ${getErrorMessage(err, 'check that the "product-images" storage bucket exists')}` })
    } finally {
      setImageUploading(false)
    }
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatusMessage(null)

    const trimmedName = name.trim()
    if (!trimmedName) {
      setStatusMessage({ type: 'error', text: 'Item Name is required' })
      return
    }

    const jewelleryError = validateJewellery()
    if (jewelleryError) {
      setStatusMessage({ type: 'error', text: jewelleryError })
      return
    }

    if (unitChoice === 'custom' && !customUnitLabel.trim()) {
      setStatusMessage({ type: 'error', text: 'Please type the custom unit name, or pick one from the list.' })
      return
    }

    const selectedUnit = getSelectedUnitInfo()
    const labelForQty = (qty: string) => `${qty.trim()}${selectedUnit.suffix}`

    const firstVariant = variantRows.find((v) => v.qty.trim())
    // With pack sizes, the product carries the earliest batch dates so Expiry Alerts flags it in time
    const earliest = (dates: Array<string | undefined>) => dates.filter(Boolean).sort()[0] || ''
    const productExpiry = hasVariants ? earliest(variantRows.map((v) => v.expiryDate)) || expiryDate : expiryDate
    const productMfg = hasVariants ? earliest(variantRows.map((v) => v.mfgDate)) || mfgDate : mfgDate
    // A rate-priced jewellery item keeps today's calculated price only as a reference
    // (barcode labels, legacy reports). Billing always recalculates from the live rate.
    const priceNum = isRatePriced
      ? (jewelleryPreview?.ok ? jewelleryPreview.snapshot.unit_price : 0)
      : hasVariants && firstVariant ? (Number(firstVariant.price) || 0) : (parseFloat(price) || 0)
    const costNum = hasVariants && firstVariant ? (Number(firstVariant.costPrice) || 0) : (parseFloat(purchasePrice) || 0)
    const jewelleryColumns = buildJewelleryColumns()

    if (!hasVariants && !isRatePriced && priceNum <= 0) {
      setStatusMessage({ type: 'error', text: 'Price must be greater than 0' })
      return
    }

    if (hasVariants && (!variantRows.length || variantRows.some((v) => !v.qty.trim() || Number(v.qty) <= 0))) {
      setStatusMessage({ type: 'error', text: 'Please provide a quantity for all added pack sizes' })
      return
    }

    const selectedCat = categories.find((c) => Number(c.id) === Number(categoryId))
    const categoryName = selectedCat ? selectedCat.name_en : 'General'
    const alertThreshold = Number(lowStockAlert) > 0 ? Number(lowStockAlert) : 5

    // Block reusing a barcode that already belongs to a different product/variant.
    if (!hasVariants) {
      const normalized = normalizeBarcode(barcode)
      if (normalized && await isBarcodeConflict(normalized, { productId: selectedProductId })) {
        setStatusMessage({ type: 'error', text: 'This barcode is already registered to another item.' })
        return
      }
    } else {
      const seen = new Set<string>()
      for (const v of variantRows) {
        const normalized = normalizeBarcode(v.customBarcode)
        if (!normalized) continue
        if (seen.has(normalized)) {
          setStatusMessage({ type: 'error', text: `Barcode "${normalized}" is used more than once in this product's pack sizes.` })
          return
        }
        seen.add(normalized)
        const ownerVariantId = v.id.startsWith('var_') ? null : v.id
        if (await isBarcodeConflict(normalized, { productId: selectedProductId, variantId: ownerVariantId })) {
          setStatusMessage({ type: 'error', text: `Barcode "${normalized}" is already registered to another item.` })
          return
        }
      }
    }

    setLoading(true)

    try {
      if (selectedProductId) {
        // UPDATE EXISTING PRODUCT
        if (!hasVariants) {
          const inputStock = soldByWeight
            ? Math.max(0, roundTo(parseFloat(stockQuantity) || 0, 3))
            : Math.max(0, parseInt(stockQuantity) || 0)

          // Check previous stock
          const { data: currentProd } = await supabase
            .from('products')
            .select('stock_quantity, stock')
            .eq('id', selectedProductId)
            .single()

          const prevStock = currentProd ? (currentProd.stock_quantity ?? currentProd.stock ?? 0) : 0
          const delta = inputStock - prevStock

          const { error: updErr } = await supabase
            .from('products')
            .update({
              name: trimmedName,
              category: categoryName,
              category_id: categoryId ? Number(categoryId) : null,
              price: priceNum,
              offer_price: priceNum,
              purchase_price: costNum,
              unit_type: selectedUnit.unitType,
              unit_label: selectedUnit.unit,
              unit: selectedUnit.unit,
              low_stock_alert: alertThreshold,
              expiry_date: productExpiry || null,
              mfg_date: productMfg || null,
              location: location.trim() || null,
              barcode: barcode.trim() || null,
              description: description.trim() || '',
              has_variants: false,
              allow_decimal_quantity: soldByWeight,
              has_special_offer: hasSpecialOffer,
              special_offer_note: specialOfferNote.trim(),
              special_offer_cost: hasSpecialOffer ? (Number(specialOfferCost) || 0) : 0,
              stock_quantity: inputStock,
              stock: Math.floor(inputStock),
              ...jewelleryColumns,
            })
            .eq('id', selectedProductId)

          if (updErr) throw updErr

          if (delta !== 0) {
            await supabase.from('inventory_movements').insert({
              product_id: selectedProductId,
              variant_id: null,
              movement_type: delta > 0 ? 'RESTOCK' : 'CORRECTION',
              quantity_delta: delta,
              quantity_before: prevStock,
              quantity_after: inputStock,
              unit_cost: costNum || null,
              reference_type: 'PRODUCT_UPDATE',
              note: 'Stock updated in product editor',
              created_by_name: 'Admin',
            })
          }

          if (normalizeBarcode(barcode)) {
            const newBarcodeValue = normalizeBarcode(barcode)
            // Retire any old registry entry for this product under a different barcode
            // value, so a since-changed sticker stops scanning and its old code can be reused.
            await supabase.from('barcode_registry')
              .update({ is_active: false })
              .eq('product_id', selectedProductId)
              .is('variant_id', null)
              .neq('barcode_value', newBarcodeValue)

            const { error: regErr } = await supabase.from('barcode_registry').upsert(
              {
                barcode_value: newBarcodeValue,
                entity_type: 'product',
                product_id: selectedProductId,
                variant_id: null,
                is_active: true,
              },
              { onConflict: 'barcode_value' }
            )
            if (regErr) console.error('[AddEditProductView] barcode_registry upsert failed:', regErr)
          }

          play('success')
          setStatusMessage({
            type: 'success',
            text: `Product "${trimmedName}" updated successfully with ${inputStock} stock units! Ready in POS Catalog.`,
          })
        } else {
          // Multi-variant update
          let totalVariantStock = 0
          for (const v of variantRows) {
            if (!v.qty.trim()) continue
            const vLabel = labelForQty(v.qty)
            const vPrice = Number(v.price) > 0 ? Number(v.price) : priceNum
            const vCost = Number(v.costPrice) > 0 ? Number(v.costPrice) : costNum
            const vStock = Math.max(0, Number(v.stock) || 0)
            totalVariantStock += vStock

            if (v.id.startsWith('var_')) {
              // Insert new variant
              const { data: createdVar, error: vErr } = await supabase
                .from('product_variants')
                .insert({
                  product_id: selectedProductId,
                  variant_name: vLabel,
                  size_label: vLabel,
                  price: vPrice,
                  purchase_price: vCost,
                  stock: vStock,
                  barcode: v.customBarcode?.trim() || null,
                  is_active: true,
                })
                .select()
                .single()

              if (!vErr && createdVar) {
                await saveVariantDates(String(createdVar.id), v)
                if (normalizeBarcode(v.customBarcode)) {
                  const { error: regErr } = await supabase.from('barcode_registry').upsert(
                    {
                      barcode_value: normalizeBarcode(v.customBarcode),
                      entity_type: 'variant',
                      product_id: selectedProductId,
                      variant_id: createdVar.id,
                      is_active: true,
                    },
                    { onConflict: 'barcode_value' }
                  )
                  if (regErr) console.error('[AddEditProductView] barcode_registry upsert failed:', regErr)
                }

                if (vStock > 0) {
                  await supabase.from('inventory_movements').insert({
                    product_id: selectedProductId,
                    variant_id: createdVar.id,
                    movement_type: 'RESTOCK',
                    quantity_delta: vStock,
                    quantity_before: 0,
                    quantity_after: vStock,
                    unit_cost: vCost || null,
                    reference_type: 'PRODUCT_UPDATE',
                    note: `Added pack size ${vLabel} with stock`,
                    created_by_name: 'Admin',
                  })
                }
              }
            } else {
              // Update existing variant
              const { data: curVar } = await supabase
                .from('product_variants')
                .select('stock')
                .eq('id', v.id)
                .single()

              const prevVarStock = curVar?.stock ?? 0
              const varDelta = vStock - prevVarStock

              await supabase
                .from('product_variants')
                .update({
                  variant_name: vLabel,
                  size_label: vLabel,
                  price: vPrice,
                  purchase_price: vCost,
                  stock: vStock,
                  barcode: v.customBarcode?.trim() || null,
                })
                .eq('id', v.id)
              await saveVariantDates(v.id, v)

              if (normalizeBarcode(v.customBarcode)) {
                const newVariantBarcodeValue = normalizeBarcode(v.customBarcode)
                // Retire any old registry entry for this pack size under a different barcode
                // value, so a since-changed sticker stops scanning and its old code can be reused.
                await supabase.from('barcode_registry')
                  .update({ is_active: false })
                  .eq('variant_id', v.id)
                  .neq('barcode_value', newVariantBarcodeValue)

                const { error: regErr } = await supabase.from('barcode_registry').upsert(
                  {
                    barcode_value: newVariantBarcodeValue,
                    entity_type: 'variant',
                    product_id: selectedProductId,
                    variant_id: v.id,
                    is_active: true,
                  },
                  { onConflict: 'barcode_value' }
                )
                if (regErr) console.error('[AddEditProductView] barcode_registry upsert failed:', regErr)
              }

              if (varDelta !== 0) {
                await supabase.from('inventory_movements').insert({
                  product_id: selectedProductId,
                  variant_id: v.id,
                  movement_type: varDelta > 0 ? 'RESTOCK' : 'CORRECTION',
                  quantity_delta: varDelta,
                  quantity_before: prevVarStock,
                  quantity_after: vStock,
                  unit_cost: vCost || null,
                  reference_type: 'PRODUCT_UPDATE',
                  note: `Stock updated for pack size ${vLabel}`,
                  created_by_name: 'Admin',
                })
              }
            }
          }

          // Update parent product
          await supabase
            .from('products')
            .update({
              name: trimmedName,
              category: categoryName,
              category_id: categoryId ? Number(categoryId) : null,
              price: priceNum,
              offer_price: priceNum,
              purchase_price: costNum,
              unit_type: selectedUnit.unitType,
              unit_label: selectedUnit.unit,
              unit: selectedUnit.unit,
              low_stock_alert: alertThreshold,
              expiry_date: productExpiry || null,
              mfg_date: productMfg || null,
              location: location.trim() || null,
              barcode: null,
              description: description.trim() || '',
              has_variants: true,
              allow_decimal_quantity: false,
              has_special_offer: hasSpecialOffer,
              special_offer_note: specialOfferNote.trim(),
              special_offer_cost: hasSpecialOffer ? (Number(specialOfferCost) || 0) : 0,
              stock_quantity: totalVariantStock,
              stock: totalVariantStock,
              ...jewelleryColumns,
            })
            .eq('id', selectedProductId)

          play('success')
          setStatusMessage({
            type: 'success',
            text: `Product "${trimmedName}" updated with ${totalVariantStock} total stock units across all pack sizes! Ready in POS Catalog.`,
          })
        }
      } else {
        // CREATE NEW PRODUCT
        if (!hasVariants) {
          const inputStock = soldByWeight
            ? Math.max(0, roundTo(parseFloat(stockQuantity) || 0, 3))
            : Math.max(0, parseInt(stockQuantity) || 0)

          const { data: newProd, error: insErr } = await supabase
            .from('products')
            .insert({
              name: trimmedName,
              category: categoryName,
              category_id: categoryId ? Number(categoryId) : null,
              price: priceNum,
              offer_price: priceNum,
              purchase_price: costNum,
              unit_type: selectedUnit.unitType,
              unit_label: selectedUnit.unit,
              unit: selectedUnit.unit,
              low_stock_alert: alertThreshold,
              expiry_date: productExpiry || null,
              mfg_date: productMfg || null,
              location: location.trim() || null,
              barcode: barcode.trim() || null,
              description: description.trim() || '',
              has_variants: false,
              allow_decimal_quantity: soldByWeight,
              has_special_offer: hasSpecialOffer,
              special_offer_note: specialOfferNote.trim(),
              special_offer_cost: hasSpecialOffer ? (Number(specialOfferCost) || 0) : 0,
              stock_quantity: inputStock,
              stock: Math.floor(inputStock),
              is_active: true,
              ...jewelleryColumns,
            })
            .select('id, name')
            .single()

          if (insErr || !newProd) throw insErr || new Error('Failed to create product')

          if (normalizeBarcode(barcode)) {
            const { error: regErr } = await supabase.from('barcode_registry').upsert(
              {
                barcode_value: normalizeBarcode(barcode),
                entity_type: 'product',
                product_id: newProd.id,
                variant_id: null,
                is_active: true,
              },
              { onConflict: 'barcode_value' }
            )
            if (regErr) console.error('[AddEditProductView] barcode_registry upsert failed:', regErr)
          }

          if (inputStock > 0) {
            await supabase.from('inventory_movements').insert({
              product_id: newProd.id,
              variant_id: null,
              movement_type: 'RESTOCK',
              quantity_delta: inputStock,
              quantity_before: 0,
              quantity_after: inputStock,
              unit_cost: costNum || null,
              reference_type: 'PRODUCT_CREATION',
              note: 'Initial received stock on product creation',
              created_by_name: 'Admin',
            })
          }

          play('success')
          resetForm()
          setStatusMessage({
            type: 'success',
            text: `Product "${trimmedName}" created with ${inputStock} stock units! Immediately ready in catalog & billing.`,
          })
        } else {
          // Multi pack-size creation
          let totalVariantStock = 0
          variantRows.forEach((v) => {
            if (v.qty.trim()) {
              totalVariantStock += Math.max(0, Number(v.stock) || 0)
            }
          })

          const { data: newProd, error: insErr } = await supabase
            .from('products')
            .insert({
              name: trimmedName,
              category: categoryName,
              category_id: categoryId ? Number(categoryId) : null,
              price: priceNum,
              offer_price: priceNum,
              purchase_price: costNum,
              unit_type: selectedUnit.unitType,
              unit_label: selectedUnit.unit,
              unit: selectedUnit.unit,
              low_stock_alert: alertThreshold,
              expiry_date: productExpiry || null,
              mfg_date: productMfg || null,
              location: location.trim() || null,
              barcode: null,
              description: description.trim() || '',
              has_variants: true,
              allow_decimal_quantity: false,
              has_special_offer: hasSpecialOffer,
              special_offer_note: specialOfferNote.trim(),
              special_offer_cost: hasSpecialOffer ? (Number(specialOfferCost) || 0) : 0,
              stock_quantity: totalVariantStock,
              stock: totalVariantStock,
              is_active: true,
              ...jewelleryColumns,
            })
            .select('id, name')
            .single()

          if (insErr || !newProd) throw insErr || new Error('Failed to create product')

          for (const v of variantRows) {
            if (!v.qty.trim()) continue
            const vLabel = labelForQty(v.qty)
            const vPrice = Number(v.price) > 0 ? Number(v.price) : priceNum
            const vCost = Number(v.costPrice) > 0 ? Number(v.costPrice) : costNum
            const vStock = Math.max(0, Number(v.stock) || 0)

            const { data: createdVar } = await supabase
              .from('product_variants')
              .insert({
                product_id: newProd.id,
                variant_name: vLabel,
                size_label: vLabel,
                price: vPrice,
                purchase_price: vCost,
                stock: vStock,
                barcode: v.customBarcode?.trim() ? normalizeBarcode(v.customBarcode) : null,
                is_active: true,
              })
              .select('id')
              .single()
            if (createdVar) await saveVariantDates(String(createdVar.id), v)

            if (createdVar && normalizeBarcode(v.customBarcode)) {
              const { error: regErr } = await supabase.from('barcode_registry').upsert(
                {
                  barcode_value: normalizeBarcode(v.customBarcode),
                  entity_type: 'variant',
                  product_id: newProd.id,
                  variant_id: createdVar.id,
                  is_active: true,
                },
                { onConflict: 'barcode_value' }
              )
              if (regErr) console.error('[AddEditProductView] barcode_registry upsert failed:', regErr)
            }

            if (createdVar && vStock > 0) {
              await supabase.from('inventory_movements').insert({
                product_id: newProd.id,
                variant_id: createdVar.id,
                movement_type: 'RESTOCK',
                quantity_delta: vStock,
                quantity_before: 0,
                quantity_after: vStock,
                unit_cost: vCost || null,
                reference_type: 'PRODUCT_CREATION',
                note: `Initial stock for pack size ${vLabel}`,
                created_by_name: 'Admin',
              })
            }
          }

          play('success')
          resetForm()
          setStatusMessage({
            type: 'success',
            text: `Multi-pack product "${trimmedName}" created with ${totalVariantStock} total units! Immediately ready in catalog & billing.`,
          })
        }
      }

      const before = selectedProductId ? products.find((prod) => Number(prod.id) === selectedProductId) : null
      void auditService.log({
        action: selectedProductId ? 'product_updated' : 'product_created',
        entityType: 'product',
        entityId: trimmedName,
        oldValue: before ? { price: before.price, metal: before.metalType, purity: before.purity, gross_weight: before.grossWeight, net_weight: before.netWeight, making: before.makingCharge, wastage: before.wastage, stock: before.stockQuantity } : null,
        newValue: { price: priceNum, metal: metalType || null, purity: effectivePurity || null, gross_weight: parseFloat(grossWeight) || 0, net_weight: effectiveNetWeight, making: parseFloat(makingCharge) || 0, wastage: parseFloat(wastage) || 0, stock: Number(stockQuantity) || 0 },
      })
      await fetchProducts()
      onStockUpdated?.()
    } catch (err: unknown) {
      let msg = getErrorMessage(err, 'An error occurred while saving')
      if (isMissingSchemaError(err)) {
        msg = 'Jewellery fields need the database update. Apply supabase/migrations/jewellery_pos.sql in Supabase, then save again.'
      } else if (msg.includes('barcode_registry_barcode_value_key') || (msg.includes('barcode') && msg.includes('duplicate key value violates unique constraint'))) {
        msg = 'This barcode is already registered to another item.'
      }
      play('error')
      setStatusMessage({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }

  const selectedUnitInfo = getSelectedUnitInfo()

  const filteredProducts = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.category && p.category.toLowerCase().includes(search.toLowerCase())) ||
    (p.barcode && p.barcode.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="h-[calc(100dvh-210px)] min-h-[480px] flex flex-col gap-3 lg:gap-5 overflow-hidden">
      {/* Mobile-only: switch between browsing the catalog and the add/edit form */}
      <div className="lg:hidden flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setMobileView('catalog')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition-colors cursor-pointer ${
            mobileView === 'catalog' ? 'bg-[#0A0A0A] text-white' : 'text-gray-600'
          }`}
        >
          <Layers size={14} /> Catalog ({products.length})
        </button>
        <button
          type="button"
          onClick={() => { resetForm(); setMobileView('form') }}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black transition-colors cursor-pointer ${
            mobileView === 'form' ? 'bg-[var(--accent)] text-white' : 'text-gray-600'
          }`}
        >
          <Plus size={14} /> Add New Item
        </button>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-5 min-h-0 overflow-hidden">
      {/* LEFT COLUMN: Products Browser List */}
      <div className={`${mobileView === 'form' ? 'hidden lg:flex' : 'flex'} w-full lg:w-80 xl:w-96 flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm shrink-0 h-full min-h-0`}>
        <div className="px-4 py-3.5 border-b border-gray-200 bg-[#FAFAFA] shrink-0">
          <h4 className="flex items-center gap-2 text-sm font-black text-gray-900">
            <Package size={16} className="text-[var(--accent)]" />
            Jewellery Catalog ({products.length})
          </h4>
          <p className="text-[11px] text-gray-500 mt-0.5">Select any item to view or edit its details</p>
        </div>

        <div className="p-3 border-b border-gray-100 bg-white shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search items, HUID, barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-3 rounded-xl border border-gray-200 bg-white text-xs sm:text-sm font-semibold text-gray-900 outline-none focus:border-[#0A0A0A]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 hide-scrollbar">
          {filteredProducts.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400 font-bold">
              No items found.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filteredProducts.map((p) => {
                const stockQty = Number(p.stockQuantity ?? p.stock ?? 0)
                const lowAt = Number(p.lowStockAlert ?? 5)
                const stockColor = stockQty <= 0 ? 'text-red-600' : stockQty <= lowAt ? 'text-amber-600' : 'text-emerald-700'
                const isSelected = selectedProductId === Number(p.id)
                const livePrice = currentProductPrice(p, rates)
                return (
                  <li
                    key={p.id}
                    onClick={() => startEditProduct(p)}
                    className={`flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors border-l-4 ${
                      isSelected ? 'bg-[#FFF9E6] border-[var(--accent)]' : 'border-transparent hover:bg-[#FBFAF6]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-black uppercase text-gray-900 break-words leading-snug">{p.name}</div>
                      <div className="mt-0.5 text-[11px] font-semibold uppercase text-gray-500 truncate">
                        {p.category || 'General'}{p.hasVariants ? ' • Multiple pack sizes' : ''}
                      </div>
                      {p.metalType && (
                        <div className="mt-0.5 text-[10px] font-bold text-[var(--accent-dark)] truncate">
                          {metalLabel(p.metalType, p.purity)}{p.netWeight ? ` • ${Number(p.netWeight).toFixed(3)} g` : ''}{p.huid ? ` • HUID ${p.huid}` : ''}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-black text-gray-900 whitespace-nowrap" title={p.metalType ? "Today's calculated price" : undefined}>
                        {livePrice == null ? <span className="text-[11px] text-amber-700">Rate missing</span> : `₹${livePrice}`}
                      </div>
                      <div className={`text-[11px] font-black whitespace-nowrap ${stockColor}`}>Stock: {stockQty}</div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void startEditProduct(p)
                        }}
                        className="w-8 h-8 rounded-lg border border-gray-200 bg-white text-gray-600 flex items-center justify-center hover:text-[var(--accent)] hover:border-[var(--accent)] transition-all cursor-pointer"
                        title={`Edit "${p.name}"`}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteProduct(Number(p.id), p.name)
                        }}
                        className="w-8 h-8 rounded-lg text-gray-400 flex items-center justify-center hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                        title={`Delete "${p.name}"`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Product Authoring Form Workspace */}
      <div className={`${mobileView === 'catalog' ? 'hidden lg:flex' : 'flex'} flex-1 flex-col bg-[#FBFAF6] border border-gray-200 rounded-2xl shadow-sm overflow-hidden h-full min-h-0`}>
        {/* Pinned Form Header */}
        <div className="px-3.5 py-3 sm:px-6 sm:py-4 bg-white border-b border-gray-200 flex items-center justify-between gap-2 shrink-0 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileView('catalog')}
              className="lg:hidden -ml-1 p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 shrink-0 cursor-pointer"
              aria-label="Back to catalog"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-black flex items-center gap-2 truncate">
                <Package size={16} className="text-[var(--accent)] shrink-0" />
                {selectedProductId ? 'Edit Item & Stock Details' : 'Add New Item to Catalog'}
              </h3>
              <p className="text-[11px] text-gray-500 font-semibold">
                {selectedProductId ? "Update jewellery details, stock & categories" : "Start with the name below"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setMobileView('catalog')}
              className="lg:hidden text-[10px] font-black text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full cursor-pointer"
            >
              Catalog ({products.length})
            </button>
            {selectedProductId && (
              <>
                <button
                  type="button"
                  onClick={() => handleDeleteProduct(selectedProductId, name)}
                  className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline flex items-center gap-1 cursor-pointer"
                  title="Delete this item"
                >
                  <Trash2 size={13} /> Delete Item
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  + Create Another
                </button>
              </>
            )}
          </div>
        </div>

        {/* Scrollable Form Body with Pinned Bottom Action Bar */}
        <form onSubmit={handleSaveProduct} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 min-h-0 hide-scrollbar">
            {/* Status Message */}
            {statusMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-bold flex items-center justify-between ${
                  statusMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                <span>{statusMessage.text}</span>
                <button onClick={() => setStatusMessage(null)} className="font-black">✕</button>
              </div>
            )}

            {/* Step 1: Name Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                  1. Item Name <span className="text-red-500 ml-0.5">*</span>
                </label>
                <input
                  type="text"
                  required
                  autoFocus={!selectedProductId}
                  placeholder="e.g. 22K Gold Ring, Silver Anklet, Diamond Stud"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                  Metal Type
                </label>
                <select
                  value={metalType}
                  onChange={(e) => selectMetal(e.target.value as MetalType | '')}
                  className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20"
                >
                  <option value="">Not jewellery (regular item)</option>
                  {(['gold', 'silver', 'platinum', 'other'] as const).map((m) => (
                    <option key={m} value={m}>{METAL_LABELS[m]}</option>
                  ))}
                </select>
              </div>

            </div>

            {/* Jewellery Details — weights, charges and hallmark; price is calculated from the day's metal rate */}
            {isJewellery && (
              <div className="p-3.5 bg-white border border-gray-200 rounded-xl space-y-3">
                <label className="block text-[11px] font-black uppercase tracking-wide text-gray-700 flex items-center gap-1.5">
                  <Gem size={13} className="text-[var(--accent)]" /> 2. Jewellery Details
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Purity</label>
                    {metalType === 'other' ? (
                      <input
                        type="text"
                        placeholder="e.g. 925, 80%"
                        value={customPurity}
                        onChange={(e) => setCustomPurity(e.target.value)}
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                      />
                    ) : (
                      <div className="flex gap-2">
                        <select
                          value={purityChoice}
                          onChange={(e) => setPurityChoice(e.target.value)}
                          className="flex-1 min-w-0 h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20"
                        >
                          {metalType === 'gold'
                            ? GOLD_PURITIES.map((pur) => <option key={pur} value={pur}>{pur}</option>)
                            : <option value={STANDARD_PURITY}>Standard</option>}
                          <option value={CUSTOM_PURITY}>Custom</option>
                        </select>
                        {purityChoice === CUSTOM_PURITY && (
                          <input
                            type="text"
                            required
                            placeholder={metalType === 'gold' ? 'e.g. 19K / 916' : 'e.g. 925'}
                            value={customPurity}
                            onChange={(e) => setCustomPurity(e.target.value)}
                            className="w-24 h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                      Subcategory <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Kids Ring, Temple Necklace"
                      value={subcategory}
                      onChange={(e) => setSubcategory(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                      Brand <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. House brand"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-start">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                      Gross Weight (g) {isRatePriced && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="0.000"
                      value={grossWeight}
                      onChange={(e) => setGrossWeight(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Stone Weight (g)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="0.000"
                      value={stoneWeight}
                      onChange={(e) => setStoneWeight(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Other Weight (g)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="0.000"
                      value={otherWeight}
                      onChange={(e) => setOtherWeight(e.target.value)}
                      title="Non-metal weight such as thread, lac or beads"
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center justify-between gap-2">
                      <span>Net Weight (g)</span>
                      {netWeightEdited ? (
                        <button type="button" onClick={() => { setNetWeightEdited(false); setNetWeight('') }} className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer">
                          Auto
                        </button>
                      ) : (
                        <span className="text-[10px] font-medium text-gray-400">Gross − Stone − Other</span>
                      )}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      placeholder="0.000"
                      value={netWeightEdited ? netWeight : (computedNetWeight ? String(computedNetWeight) : '')}
                      onChange={(e) => { setNetWeightEdited(true); setNetWeight(e.target.value) }}
                      className="w-full h-10 px-3.5 rounded-xl border border-emerald-300 bg-emerald-50/50 text-xs font-bold text-emerald-950 outline-none focus:border-emerald-600 focus:bg-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Making Charge</label>
                    <div className="flex gap-2">
                      <select
                        value={makingChargeType}
                        onChange={(e) => setMakingChargeType(e.target.value as MakingChargeType)}
                        aria-label="Making charge type"
                        className="shrink-0 h-10 px-2 rounded-xl border border-gray-300 bg-white text-[11px] font-bold text-gray-900 outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20"
                      >
                        {(Object.keys(MAKING_CHARGE_TYPE_LABELS) as MakingChargeType[]).map((t) => (
                          <option key={t} value={t}>{t === 'per_gram' ? '₹/g' : t === 'percentage' ? '%' : '₹'}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={makingCharge}
                        onChange={(e) => setMakingCharge(e.target.value)}
                        title={MAKING_CHARGE_TYPE_LABELS[makingChargeType]}
                        className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-gray-500 font-medium">{MAKING_CHARGE_TYPE_LABELS[makingChargeType]}</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Wastage</label>
                    <div className="flex gap-2">
                      <select
                        value={wastageType}
                        onChange={(e) => setWastageType(e.target.value as WastageType)}
                        aria-label="Wastage type"
                        className="shrink-0 h-10 px-2 rounded-xl border border-gray-300 bg-white text-[11px] font-bold text-gray-900 outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20"
                      >
                        {(Object.keys(WASTAGE_TYPE_LABELS) as WastageType[]).map((t) => (
                          <option key={t} value={t}>{t === 'percentage' ? '%' : 'g'}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step={wastageType === 'grams' ? '0.001' : '0.01'}
                        placeholder="0"
                        value={wastage}
                        onChange={(e) => setWastage(e.target.value)}
                        title={WASTAGE_TYPE_LABELS[wastageType]}
                        className="flex-1 min-w-0 h-10 px-3 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-gray-500 font-medium">{WASTAGE_TYPE_LABELS[wastageType]}</p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Stone Charge (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={stoneCharge}
                      onChange={(e) => setStoneCharge(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Other Charge (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0"
                      value={otherCharge}
                      onChange={(e) => setOtherCharge(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                      HUID / Hallmark No. <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. AB12CD"
                      value={huid}
                      onChange={(e) => setHuid(e.target.value.toUpperCase())}
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Hallmark Status</label>
                    <select
                      value={hallmarkStatus}
                      onChange={(e) => setHallmarkStatus(e.target.value as HallmarkStatus | '')}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20"
                    >
                      <option value="">Not set</option>
                      {(Object.keys(HALLMARK_LABELS) as HallmarkStatus[]).map((h) => <option key={h} value={h}>{HALLMARK_LABELS[h]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Piece Status</label>
                    <select
                      value={itemStatus}
                      onChange={(e) => setItemStatus(e.target.value as ItemStatus)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20"
                    >
                      {(Object.keys(ITEM_STATUS_LABELS) as ItemStatus[]).map((s) => <option key={s} value={s}>{ITEM_STATUS_LABELS[s]}</option>)}
                    </select>
                    {itemStatus !== 'available' && <p className="mt-1 text-[10px] font-semibold text-amber-700">This piece cannot be billed until it is Available again.</p>}
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                      Item Code / SKU <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. GR-22-0145"
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                      Design Number <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. D-2291"
                      value={designNumber}
                      onChange={(e) => setDesignNumber(e.target.value)}
                      className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                    />
                  </div>
                </div>

                {/* Stone / diamond details — only shown when the item has stones */}
                <div className="rounded-xl border border-gray-200 bg-[#FBFAF6] p-3">
                  <label className="flex items-center gap-2 text-[11px] font-black text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={showStones} onChange={(e) => setShowStones(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
                    Stone / diamond details
                  </label>
                  {showStones && (
                    <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Stone type</label><input className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" placeholder="e.g. Diamond, Ruby" value={stoneDetails.type} onChange={(e) => setStoneDetails((d) => ({ ...d, type: e.target.value }))} /></div>
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">No. of stones</label><input type="number" min="0" step="1" className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" value={stoneDetails.count || ''} onChange={(e) => setStoneDetails((d) => ({ ...d, count: Number(e.target.value) || 0 }))} /></div>
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Stone value (₹)</label><input type="number" min="0" step="0.01" className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" value={stoneDetails.value || ''} onChange={(e) => setStoneDetails((d) => ({ ...d, value: Number(e.target.value) || 0 }))} /></div>
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Diamond carat</label><input type="number" min="0" step="0.01" className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" value={stoneDetails.carat || ''} onChange={(e) => setStoneDetails((d) => ({ ...d, carat: Number(e.target.value) || 0 }))} /></div>
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Clarity</label><input className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" placeholder="e.g. VS1" value={stoneDetails.clarity} onChange={(e) => setStoneDetails((d) => ({ ...d, clarity: e.target.value }))} /></div>
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Colour</label><input className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" placeholder="e.g. F" value={stoneDetails.colour} onChange={(e) => setStoneDetails((d) => ({ ...d, colour: e.target.value }))} /></div>
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Cut</label><input className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" placeholder="e.g. Excellent" value={stoneDetails.cut} onChange={(e) => setStoneDetails((d) => ({ ...d, cut: e.target.value }))} /></div>
                      <div><label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">Certificate No.</label><input className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]" placeholder="e.g. IGI 123456" value={stoneDetails.certificate} onChange={(e) => setStoneDetails((d) => ({ ...d, certificate: e.target.value }))} /></div>
                      <p className="col-span-2 lg:col-span-4 text-[10px] font-medium text-gray-500">The price uses the Stone Charge above; these details are shown on the invoice.</p>
                    </div>
                  )}
                </div>

                {/* Live price preview with today's rate */}
                {isRatePriced ? (
                  jewelleryPreview?.ok ? (
                    <div className="rounded-xl border border-gray-200 bg-[#FBFAF6] p-3 text-[11px] font-bold text-gray-700 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black uppercase tracking-wide text-gray-600">Today's Calculated Price</span>
                        <span className="text-base font-black text-gray-900">{formatCurrency(jewelleryPreview.snapshot.unit_price)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>Metal value ({jewelleryPreview.snapshot.net_weight.toFixed(3)} g × {formatCurrency(jewelleryPreview.snapshot.rate_per_gram)}/g{jewelleryPreview.snapshot.rate_source === 'derived' ? ', from 24K rate' : ''})</span>
                        <span>{formatCurrency(jewelleryPreview.snapshot.metal_value)}</span>
                      </div>
                      <div className="flex justify-between gap-2"><span>Making charge</span><span>{formatCurrency(jewelleryPreview.snapshot.making_amount)}</span></div>
                      <div className="flex justify-between gap-2"><span>Wastage ({jewelleryPreview.snapshot.wastage_weight.toFixed(3)} g)</span><span>{formatCurrency(jewelleryPreview.snapshot.wastage_amount)}</span></div>
                      {jewelleryPreview.snapshot.stone_charge > 0 && <div className="flex justify-between gap-2"><span>Stone charge</span><span>{formatCurrency(jewelleryPreview.snapshot.stone_charge)}</span></div>}
                      {jewelleryPreview.snapshot.other_charge > 0 && <div className="flex justify-between gap-2"><span>Other charge</span><span>{formatCurrency(jewelleryPreview.snapshot.other_charge)}</span></div>}
                      <p className="pt-1 text-[10px] font-medium text-gray-500">
                        Recalculated automatically at billing with the current metal rate — not saved as a fixed selling price.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold text-amber-800">
                      {jewelleryPreview && !jewelleryPreview.ok ? jewelleryPreview.error : 'Enter the weights to see the calculated price.'}
                    </div>
                  )
                ) : (
                  <p className="text-[11px] font-medium text-gray-500">
                    Items of other metals are billed at the fixed selling price entered below.
                  </p>
                )}
              </div>
            )}

            <>
              {/* Step 2: Unit of Measure */}
                {!isJewellery && (
                <div className="p-3.5 bg-white border border-gray-200 rounded-xl space-y-2.5">
                  <label className="block text-[11px] font-black uppercase tracking-wide text-gray-700 flex items-center gap-1.5">
                    <Ruler size={13} className="text-[var(--accent)]" /> 2. What unit is it sold in?
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <UnitSelect
                      value={unitChoice}
                      onChange={(next) => {
                        const nextUnit = UNIT_OPTIONS.find((o) => o.value === next)
                        setUnitChoice(next)
                        if (nextUnit && nextUnit.unitType !== 'weight' && nextUnit.unitType !== 'volume') {
                          setSoldByWeight(false)
                        }
                      }}
                    />
                    {unitChoice === 'custom' && (
                      <input
                        type="text"
                        required
                        placeholder="Type your unit, e.g. Sack, Roll, Set"
                        value={customUnitLabel}
                        onChange={(e) => setCustomUnitLabel(e.target.value)}
                        className="w-full sm:max-w-xs h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                      />
                    )}
                  </div>

                  {/* For packaging units (packet, box, bag, etc.), ask what's inside */}
                  {['packet', 'box', 'bag', 'bundle', 'bottle', 'tin', 'pouch'].includes(unitChoice) && (
                    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-[10px] font-bold text-blue-700 mb-2.5">What's inside each {UNIT_OPTIONS.find(o => o.value === unitChoice)?.suffix}?</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          placeholder="Size (e.g. 200)"
                          value={contentSize}
                          onChange={(e) => setContentSize(e.target.value)}
                          className="flex-1 h-9 px-3 rounded-lg border border-blue-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-blue-600"
                        />
                        <select
                          value={contentUnit}
                          onChange={(e) => setContentUnit(e.target.value)}
                          className="h-9 px-3 rounded-lg border border-blue-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-blue-600 touch-manipulation appearance-none relative z-20"
                        >
                          <option value="">Unit</option>
                          <option value="ml">ml</option>
                          <option value="l">Litre</option>
                          <option value="g">gm</option>
                          <option value="kg">kg</option>
                          <option value="pcs">pcs</option>
                          <option value="piece">piece</option>
                        </select>
                      </div>
                      {contentSize && contentUnit && (
                        <p className="text-[10px] text-blue-600 font-medium mt-2">
                          ✓ Each {UNIT_OPTIONS.find(o => o.value === unitChoice)?.suffix} contains {contentSize}{contentUnit}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                )}

                {/* Step 3: Single price vs multiple pack sizes (jewellery pieces always have a single calculated price) */}
                {!isJewellery && (
                <div className="p-3.5 bg-white border border-gray-200 rounded-xl space-y-2.5">
                  <label className="block text-[11px] font-black uppercase tracking-wide text-gray-700 flex items-center gap-1.5">
                    <Tag size={13} className="text-[var(--accent)]" /> 3. How is it priced?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setHasVariants(false)}
                      className={`text-left p-3 rounded-xl border-2 transition-all cursor-pointer ${
                        !hasVariants ? 'border-[#0A0A0A] bg-[#FFF9E6]' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <span className="block text-xs font-black text-gray-900">Single Price</span>
                      <span className="block text-[11px] text-gray-500 font-medium mt-0.5">
                        One fixed price, e.g. a gift box at ₹450
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHasVariants(true)
                        setSoldByWeight(false)
                        if (variantRows.length === 0) handleAddVariantRow()
                      }}
                      className={`text-left p-3 rounded-xl border-2 transition-all cursor-pointer ${
                        hasVariants ? 'border-[#0A0A0A] bg-[#FFF9E6]' : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <span className="block text-xs font-black text-gray-900">Multiple Pack Sizes</span>
                      <span className="block text-[11px] text-gray-500 font-medium mt-0.5">
                        Different prices per quantity, e.g. 20{selectedUnitInfo.suffix} ₹12, 50{selectedUnitInfo.suffix} ₹45, 100{selectedUnitInfo.suffix} ₹85
                      </span>
                    </button>
                  </div>
                </div>
                )}

                {/* Sold loose by weight/volume — only makes sense for a single-price kg/gm/L/ml product */}
                {!hasVariants && (selectedUnitInfo.unitType === 'weight' || selectedUnitInfo.unitType === 'volume') && (
                  <div className="p-3.5 bg-white border border-gray-200 rounded-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <span className="block text-xs font-black text-gray-900">Sold Loose By Weight</span>
                        <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                          Turn on for items weighed at the counter. Price becomes per {selectedUnitInfo.suffix}, and billing lets you enter any amount like 2.3{selectedUnitInfo.suffix}.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={soldByWeight}
                          onChange={(e) => setSoldByWeight(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)]" />
                      </label>
                    </div>
                  </div>
                )}

                {/* Single Price & Received Stock */}
                {!hasVariants && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-white border border-gray-200 rounded-xl items-start">
                    {isRatePriced ? (
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                          Jewellery Price (₹)
                        </label>
                        <div
                          className="w-full h-10 px-3.5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-black text-gray-900 flex items-center"
                          title="Calculated from today's metal rate"
                        >
                          {jewelleryPreview?.ok ? formatCurrency(jewelleryPreview.snapshot.unit_price) : '—'}
                          <span className="ml-auto text-[10px] font-bold text-gray-400">Live rate</span>
                        </div>
                      </div>
                    ) : (
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                        {soldByWeight ? `Price per ${selectedUnitInfo.suffix} (₹)` : 'Selling Price (₹)'} <span className="text-red-500 ml-0.5">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required={!hasVariants}
                        placeholder="0.00"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                      />
                    </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                        {soldByWeight ? `Cost per ${selectedUnitInfo.suffix} (₹)` : 'Cost Price (₹)'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={purchasePrice}
                        onChange={(e) => setPurchasePrice(e.target.value)}
                        className="w-full h-10 px-3.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-emerald-800 mb-1.5 h-4 flex items-center gap-1">
                        <Boxes size={13} className="text-emerald-600 shrink-0" />
                        <span>Received / Current Stock {soldByWeight ? `(${selectedUnitInfo.suffix})` : ''}</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step={soldByWeight ? '0.001' : '1'}
                        placeholder="0"
                        value={stockQuantity}
                        onChange={(e) => setStockQuantity(e.target.value)}
                        className="w-full h-10 px-3.5 rounded-xl border border-emerald-300 bg-emerald-50/50 text-xs font-bold text-emerald-950 outline-none focus:border-emerald-600 focus:bg-white"
                      />
                    </div>
                  </div>
                )}

                {/* Pack Size Repeater */}
                {hasVariants && (
                  <div className="border border-gray-200 rounded-xl p-3.5 bg-white space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-gray-700">
                        Pack Sizes ({variantRows.length})
                      </span>
                      <button
                        type="button"
                        onClick={handleAddVariantRow}
                        className="px-3 py-1 rounded-lg bg-[#0A0A0A] text-[var(--accent)] text-xs font-black flex items-center gap-1 hover:bg-[#1A1A1A] cursor-pointer"
                      >
                        <Plus size={12} /> Add Pack Size
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      {variantRows.map((v) => (
                        <div
                          key={v.id}
                          className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3 rounded-xl bg-[#FBFAF6] border border-gray-200 items-center"
                        >
                          <div className="sm:col-span-3">
                            <label className="block text-[10px] font-bold text-gray-600 mb-0.5">
                              Quantity ({selectedUnitInfo.suffix})
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              required
                              placeholder="e.g. 20"
                              value={v.qty}
                              onChange={(e) => handleUpdateVariantRow(v.id, 'qty', e.target.value)}
                              className="w-full h-8 px-2.5 rounded-lg border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-gray-600 mb-0.5">
                              Selling Price (₹)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              required
                              placeholder="0.00"
                              value={v.price || ''}
                              onChange={(e) => handleUpdateVariantRow(v.id, 'price', parseFloat(e.target.value) || 0)}
                              className="w-full h-8 px-2.5 rounded-lg border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-gray-600 mb-0.5">
                              Cost Price (₹)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={v.costPrice || ''}
                              onChange={(e) => handleUpdateVariantRow(v.id, 'costPrice', parseFloat(e.target.value) || 0)}
                              className="w-full h-8 px-2.5 rounded-lg border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-emerald-800 mb-0.5">
                              Received Stock
                            </label>
                            <input
                              type="number"
                              min="0"
                              placeholder="0"
                              value={v.stock || ''}
                              onChange={(e) => handleUpdateVariantRow(v.id, 'stock', parseInt(e.target.value) || 0)}
                              className="w-full h-8 px-2.5 rounded-lg border border-emerald-300 bg-emerald-50/40 text-xs font-black text-emerald-950 outline-none focus:border-emerald-600"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-bold text-gray-600 mb-0.5">
                              Barcode / SKU
                            </label>
                            <input
                              type="text"
                              placeholder="e.g. 8901234567"
                              value={v.customBarcode || ''}
                              onChange={(e) => handleUpdateVariantRow(v.id, 'customBarcode', e.target.value)}
                              className="w-full h-8 px-2.5 rounded-lg border border-gray-300 bg-white text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                              title="Product barcode for this pack size (optional)"
                            />
                          </div>

                          <div className="sm:col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleRemoveVariantRow(v.id)}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                              title="Remove pack size"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Additional Details (secondary, always reachable, no extra clicks) */}
                <div className="pt-1 space-y-4">
                  <div className="flex items-center gap-2 px-0.5">
                    <SlidersHorizontal size={13} className="text-[var(--accent)]" />
                    <span className="text-[11px] font-black uppercase tracking-wide text-gray-600">Additional Details (Optional)</span>
                  </div>

                  <div className="space-y-4">
                    {/* Category, Barcode, Storage Location and Low Stock Alert */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 items-start">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                          Category
                        </label>
                        <select
                          value={categoryId}
                          onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}
                          className="w-full h-10 px-3.5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] touch-manipulation appearance-none relative z-20"
                        >
                          <option value="">-- Select Category --</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name_en}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                          Barcode / SKU <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          disabled={hasVariants}
                          placeholder={hasVariants ? 'Define per pack size →' : 'e.g. 8901234567'}
                          value={barcode}
                          onChange={(e) => setBarcode(e.target.value)}
                          autoCapitalize="off"
                          autoCorrect="off"
                          autoComplete="off"
                          spellCheck={false}
                          className="w-full h-10 px-3.5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] disabled:bg-gray-100 disabled:text-gray-400"
                          title="Enter the product barcode (EAN/UPC code printed on the package). Used for quick scanning in billing."
                        />
                        <p className="text-[10px] text-gray-500 font-medium mt-1">
                          {hasVariants
                            ? '👉 Enter barcode for each pack size below'
                            : '💡 Scan in billing to quickly add this product. Leave empty if product has no barcode.'}
                        </p>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                          Storage Location <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Rack 3, Row 2"
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          className="w-full h-10 px-3.5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                          Item Photo <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                        </label>
                        <div className="flex items-center gap-2">
                          {imageUrl && <img src={imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 object-cover" />}
                          <label className="flex-1 h-10 px-3.5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-bold text-gray-700 flex items-center gap-2 cursor-pointer hover:border-[#0A0A0A]">
                            <ImagePlus size={14} className="text-[var(--accent)]" />
                            {imageUploading ? 'Uploading…' : imageUrl ? 'Change photo' : 'Upload photo'}
                            <input type="file" accept="image/*" className="sr-only" disabled={imageUploading} onChange={(e) => void handleImageFile(e.target.files?.[0])} />
                          </label>
                          {imageUrl && <button type="button" onClick={() => setImageUrl('')} className="text-[11px] font-bold text-red-600 hover:underline">Remove</button>}
                        </div>
                      </div>

                      {hasVariants && (
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                          Description / Notes <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                        </label>
                        <textarea
                        rows={1}
                        placeholder="Product material, care instructions, or rack location notes..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full h-10 px-3.5 py-2.5 leading-5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-medium text-gray-900 outline-none focus:border-[#0A0A0A] resize-none"
                      />
                      </div>
                      )}

                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                          Low Stock Alert Threshold
                        </label>
                        <input
                          type="number"
                          min="1"
                          placeholder="5"
                          value={lowStockAlert}
                          onChange={(e) => setLowStockAlert(e.target.value)}
                          className="w-full h-10 px-3.5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                        />
                      </div>

                    </div>

                    {/* Description (with pack sizes it sits beside Low Stock Alert above) */}
                    {!hasVariants && (
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1.5 h-4 flex items-center">
                        Description / Notes <span className="text-gray-400 font-normal ml-1">(Optional)</span>
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Product material, care instructions, or rack location notes..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="w-full p-3.5 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs font-medium text-gray-900 outline-none focus:border-[#0A0A0A] resize-none"
                      />
                    </div>
                    )}

                    {/* Special Offer / Free Gift */}
                    <div className="border border-gray-200 rounded-2xl p-4 bg-white space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-black text-black flex items-center gap-1.5">
                            🎁 Special Offer / Free Gift
                          </span>
                          <p className="text-[11px] text-gray-500 font-medium">
                            Flag this product so staff see it in billing and can note what's included.
                          </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasSpecialOffer}
                            onChange={(e) => setHasSpecialOffer(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)]" />
                        </label>
                      </div>
                      {hasSpecialOffer && (
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                          <div>
                            <label className="block text-[10px] font-black uppercase tracking-wide text-gray-500 mb-1">Offer / Gift Note</label>
                            <input
                              type="text"
                              placeholder="e.g. Buy 1 Get 1 Free, or Free sample gift with purchase"
                              value={specialOfferNote}
                              onChange={(e) => setSpecialOfferNote(e.target.value)}
                              className="w-full p-3 rounded-xl border border-gray-300 bg-white text-xs font-medium text-gray-900 outline-none focus:border-[var(--accent)]"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black uppercase tracking-wide text-gray-500 mb-1">Gift Cost (₹)</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              value={specialOfferCost}
                              onChange={(e) => setSpecialOfferCost(e.target.value)}
                              className="w-full p-3 rounded-xl border border-gray-300 bg-white text-xs font-medium text-gray-900 outline-none focus:border-[var(--accent)]"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
            </>
          </div>

          {/* Pinned Bottom Actions */}
          <div className="shrink-0 px-4 py-3 sm:px-6 sm:py-3.5 border-t border-gray-200 bg-white flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 sm:px-6 sm:py-2.5 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-xs font-black uppercase tracking-wider hover:bg-[#1A1A1A] transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[var(--accent-a30)] border-t-[var(--accent)] rounded-full animate-spin inline-block" />
                  Saving Item...
                </>
              ) : (
                <>
                  <Check size={14} /> {selectedProductId ? 'Update Item' : 'Save & Add Item'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  )
}
