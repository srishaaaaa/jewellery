import { useEffect, useMemo, useRef, useState, useCallback, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Trash2, Plus, Receipt, Printer,
  RefreshCw, ShoppingBag, MessageCircle,
  X, ChevronDown, Power
} from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errorMessage'
import { useProductStore, useVariantStore, useAdminAuthStore, type Product } from '../store/store'
import { useNavigationStore } from '../store/navigationStore'
import { barcodeService } from '../services/barcodeService'
import { normalizeBarcode } from '../lib/barcode'
import { Invoice } from '../components/Invoice'
import CatalogModal from '../components/CatalogModal'
import { invoicePdfFile } from '../lib/invoicePdf'
import { uploadInvoicePdf } from '../lib/storage'
import { createOrderWithStock } from '../services/orderService'
import { ModalPortal } from '../components/ModalPortal'
import { createAdvanceOrder, type AdvanceOrder, type AdvancePaymentMethod } from '../services/advanceOrderService'
import { printAdvanceReceipt } from '../lib/advanceReceipt'
import { printThermalReceipt } from '../lib/thermalPrint'
import { formatPaymentMode,
  buildStructuredOrderItem,
  calculateLineTotal,
  formatCurrency,
  formatQuantityDisplay,
  formatInvoiceNo,
  roundTo,
} from '../lib/retail'
import { buildProfessionalWhatsAppMessage, buildAdvanceDepositWhatsAppMessage, publicInvoiceUrl } from '../lib/whatsappMessage'
import { normalizePhone, toWhatsAppUrl } from '../lib/phone'
import { useLangStore } from '../store/langStore'
import { fetchVariantsByProduct, type ProductVariant } from '../services/variantService'
import { BarcodeScannerInput, type ScannedItemPayload } from '../components/pos/BarcodeScannerInput'
import { QuickAddScannedProductModal } from '../components/pos/QuickAddScannedProductModal'
import { AddUnregisteredItemModal } from '../components/pos/AddUnregisteredItemModal'
import { getOrCreateUnregisteredProduct } from '../services/productService'
import { customerService } from '../services/customerService'
import { DateInputDDMMYYYY } from '../components/DateInputDDMMYYYY'
import { toLocalDateStr } from '../lib/dateRanges'
import { useMetalRateStore } from '../store/metalRateStore'
import { priceProduct } from '../lib/jewelleryProduct'
import {
  calculateSchemeBenefit,
  checkRedemptionEligibility,
  describeSchemeBenefit,
  deriveSchemeStatus,
  formatWeight,
  metalLabel,
  normalizeSchemeRules,
  schemeBalance,
  SCHEME_STATUS_LABELS,
  type CurrentRates,
  type JewelleryScheme,
  type JewellerySnapshot,
  type SchemeRules,
} from '../lib/jewellery'
import { schemeService } from '../services/schemeService'

// ── Types ──────────────────────────────────────────────────────────────────
type PosItem = Product & {
  qty: number
  selectedUnit: string
  basePrice: number | string
  lineTotal: number
  source?: 'catalogue' | 'manual'
  note?: string | null
  variantId?: string         // product_variants.id
  variantName?: string       // snapshot
  parentProductId?: string   // products.id (before synthetic override)
  /** Jewellery pricing snapshot at the current rate (null for regular items). */
  jewellery?: JewellerySnapshot | null
  /** Set when a jewellery item cannot be priced (e.g. today's rate is missing). */
  jewelleryError?: string | null
}

type InvoiceSnap = {
  id: string
  invoiceNo: string
  orderType: 'online_request' | 'pos_sale' | 'manual_sale'
  date: string
  items: PosItem[]
  subtotal: number
  shipping: number
  couponCode?: string
  couponDiscount: number
  manualDiscountAmount: number
  manualDiscountType: 'flat' | 'percent'
  manualDiscountValue: number
  gstAmount: number
  total: number
  customerName: string
  phone: string
  address: string
  amountReceived: number
  balanceReturned: number
  paymentMode: string
  paymentMethod?: string
  invoicePdfUrl?: string
  isCredit?: boolean
  creditDueDate?: string
  schemeNumber?: string
  schemeDiscount?: number
  schemeAmountUsed?: number
  schemeBalanceAfter?: number
  /** Amount collected at the counter (total minus scheme balance used). */
  payable?: number
}

// ── Helpers ────────────────────────────────────────────────────────────────
// Returns the product ID if it looks like a real DB identifier (UUID or numeric),
// or null for synthetic/manual IDs like "manual-<timestamp>".
const toProductId = (v: string | number): string | null => {
  const s = String(v ?? '').trim()
  if (!s) return null
  // Accept pure-numeric strings (BIGINT products.id)
  if (/^\d+$/.test(s)) return s
  // Accept UUID format (product_variants.id and UUID-keyed products)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return s
  // Anything else (e.g. "manual-1786182383886") is a client-side synthetic ID — not a real DB row
  return null
}

// Products explicitly marked "sold loose by weight" (allowDecimalQuantity) accept an exact
// weighed amount like 2.3 (kg); everything else stays whole-pack, same as before.
const normalizeQty = (qty: number, allowDecimal: boolean): number =>
  allowDecimal ? Math.max(0.001, roundTo(qty, 3)) : Math.max(1, Math.round(qty))

// Jewellery items are priced from the current metal rate every time they are
// added (and again if the rate changes while the bill is open).
const priceJewellery = (p: Product, rates: CurrentRates) => {
  const priced = priceProduct(p, rates)
  if (!priced) return null
  return priced.ok
    ? { basePrice: priced.snapshot.unit_price, jewellery: priced.snapshot, jewelleryError: null }
    : { basePrice: 0, jewellery: null, jewelleryError: priced.error }
}

const makePosItem = (p: Product, qty?: number): PosItem => {
  const jewelleryPricing = priceJewellery(p, useMetalRateStore.getState().rates)
  const basePrice = jewelleryPricing ? jewelleryPricing.basePrice : (p.offerPrice || p.price)
  const q = normalizeQty(qty ?? 1, p.allowDecimalQuantity)
  const packLabel = p.predefinedOptions[0]?.label ?? p.unitLabel
  const isUnregistered = p.category === 'Unregistered'
  return {
    ...p,
    qty: q,
    selectedUnit: packLabel,
    basePrice,
    lineTotal: calculateLineTotal(q, p.unitType, p.baseQuantity, basePrice),
    source: isUnregistered ? 'manual' : (p.barcode ? 'catalogue' : 'catalogue'),
    stock: isUnregistered ? 999999 : p.stock,
    stockQuantity: isUnregistered ? 999999 : p.stockQuantity,
    ...(jewelleryPricing ? { jewellery: jewelleryPricing.jewellery, jewelleryError: jewelleryPricing.jewelleryError } : {}),
  }
}

const MANUAL_JEWELLERY_ID = 'manual-jewellery-entry'
const roundMoney = (n: number) => Math.round(Math.max(0, n) * 100) / 100

/**
 * Amounts typed into the Gold Value / Making & Wastage / Stone Charges rows of the
 * order summary become one bill line ("Gold (manual entry)") with a jewellery snapshot,
 * so invoices, receipts, reports and scheme benefits treat it like any jewellery item.
 */
const buildManualJewelleryItem = (gold: number, making: number, stone: number): PosItem | null => {
  const g = roundMoney(gold)
  const m = roundMoney(making)
  const st = roundMoney(stone)
  const total = roundMoney(g + m + st)
  if (total <= 0) return null
  const base = makePosItem({
    id: MANUAL_JEWELLERY_ID, name: 'Gold (manual entry)', category: 'Unregistered', remedy: [],
    price: total, offerPrice: null, stock: 999999, stockQuantity: 999999, hasVariants: false,
    unitType: 'unit', unitLabel: 'pcs', baseQuantity: 1, stockUnit: 'pcs', allowDecimalQuantity: false,
    predefinedOptions: [], isActive: true, sortOrder: 999, unit: 'pcs', rating: 5, description: '', benefits: '',
    image: '/product-placeholder.svg', imageUrl: '/product-placeholder.svg',
  }, 1)
  const snapshot: JewellerySnapshot = {
    metal_type: 'gold', purity: '', rate_per_gram: 0, rate_source: 'fixed', rate_id: null, rate_effective_from: null,
    gross_weight: 0, stone_weight: 0, net_weight: 0,
    making_charge: m, making_charge_type: 'fixed', making_amount: m,
    wastage: 0, wastage_type: 'percentage', wastage_weight: 0, wastage_amount: 0,
    stone_charge: st, other_charge: 0, metal_value: g, unit_price: total,
    huid: null, sku: null, barcode: null, design_number: null, priced_at: new Date().toISOString(),
  }
  return { ...base, source: 'manual', jewellery: snapshot, jewelleryError: null }
}

const repriceJewelleryItem = (item: PosItem, rates: CurrentRates): PosItem => {
  if (!item.metalType) return item
  const pricing = priceJewellery(item, rates)
  if (!pricing) return item
  return {
    ...item,
    basePrice: pricing.basePrice,
    jewellery: pricing.jewellery,
    jewelleryError: pricing.jewelleryError,
    lineTotal: calculateLineTotal(item.qty, item.unitType, item.baseQuantity, pricing.basePrice),
  }
}

const recalc = (item: PosItem, nextQty: number): PosItem => {
  const q = normalizeQty(nextQty, item.allowDecimalQuantity)
  return { ...item, qty: q, lineTotal: calculateLineTotal(q, item.unitType, item.baseQuantity, item.basePrice) }
}


/** Metal / weight / rate line under a jewellery item in the cart, with an expandable price breakdown. */
function JewelleryCartDetails({ item, expanded, onToggle, className = '' }: {
  item: PosItem
  expanded: boolean
  onToggle: () => void
  className?: string
}) {
  if (item.jewelleryError) {
    return (
      <p className={`px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900 break-words ${className}`}>
        ⚠ {item.jewelleryError}
      </p>
    )
  }
  const j = item.jewellery
  if (!j) return null
  const rows: Array<[string, string]> = [
    ['Gross / Stone / Net', `${formatWeight(j.gross_weight)} / ${formatWeight(j.stone_weight)} / ${formatWeight(j.net_weight)}`],
    [`Metal value @ ${formatCurrency(j.rate_per_gram)}/g${j.rate_source === 'derived' ? ' (from 24K)' : ''}`, formatCurrency(j.metal_value)],
    ['Making charge', formatCurrency(j.making_amount)],
    [`Wastage (${formatWeight(j.wastage_weight)})`, formatCurrency(j.wastage_amount)],
  ]
  if (j.stone_charge > 0) rows.push(['Stone charge', formatCurrency(j.stone_charge)])
  if (j.other_charge > 0) rows.push(['Other charge', formatCurrency(j.other_charge)])
  return (
    <div className={className}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-2.5 py-1 rounded-md bg-[var(--accent-a10)] border border-[var(--accent-a30)] text-[11px] font-bold text-[var(--accent-dark)] break-words flex items-center gap-1.5"
      >
        <span className="min-w-0 flex-1">
          {metalLabel(j.metal_type, j.purity)} · Net {formatWeight(j.net_weight)}{j.rate_per_gram > 0 ? ` @ ${formatCurrency(j.rate_per_gram)}/g` : ''}{j.huid ? ` · HUID ${j.huid}` : ''}
        </span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1 rounded-md border border-gray-200 bg-[#FAFAFA] px-2.5 py-1.5 space-y-0.5 text-[11px] font-bold text-[#374151]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3"><span>{label}</span><span className="text-[#111111]">{value}</span></div>
          ))}
          <div className="flex justify-between gap-3 pt-0.5 border-t border-gray-200 text-[#111111]"><span>Price per piece</span><span>{formatCurrency(j.unit_price)}</span></div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
type PosProps = {
  isEmbedded?: boolean
  externalScannedCode?: string | null
  onCodeProcessed?: () => void
}

export default function Pos(props: PosProps = {}) {
  const embeddedMode = Boolean(props.isEmbedded)
  const { products, fetchProducts } = useProductStore()
  const { getVariants, fetchVariants } = useVariantStore()
  const { lang } = useLangStore()
  const l = (en: string, ta: string) => lang === 'ta' ? ta : en
  const navigate = useNavigate()
  const { logout, role } = useAdminAuthStore()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [billingAdjOpen, setBillingAdjOpen] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [search, setSearch] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [activeCategory, setActiveCategory] = useState('All')
  const [items, setItems] = useState<PosItem[]>([])
  const [editingOfferId, setEditingOfferId] = useState<string | number | null>(null)
  const [quickAddBarcode, setQuickAddBarcode] = useState('')
  const [scanResetTick, setScanResetTick] = useState(0)
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '' })
  const [customerBirthday, setCustomerBirthday] = useState('')
  const [customerAnniversary, setCustomerAnniversary] = useState('')

  // Look up a previously-saved customer by phone so returning customers
  // don't need to re-enter their name/address/birthday/anniversary.
  const loadCustomerSchemes = async (phone: string) => {
    setSchemesLoading(true)
    try {
      const list = await schemeService.listByPhone(phone)
      setCustomerSchemes(list)
      setAppliedScheme((current) => (current && !list.some((sch) => sch.id === current.id) ? null : current))
    } catch (err) {
      console.warn('Could not load customer schemes:', err)
      setCustomerSchemes([])
    } finally {
      setSchemesLoading(false)
    }
  }

  const handlePhoneLookup = async () => {
    const normalized = normalizePhone(customer.phone || '')
    if (!normalized) {
      setCustomerSchemes([])
      setAppliedScheme(null)
      return
    }
    void loadCustomerSchemes(normalized)
    const found = await customerService.findByPhone(normalized)
    if (!found) return
    setCustomer((prev) => ({
      ...prev,
      name: prev.name.trim() || found.name || prev.name,
      address: prev.address.trim() || found.address || prev.address,
    }))
    if (found.birthday) setCustomerBirthday((prev) => prev || found.birthday || '')
    if (found.anniversary) setCustomerAnniversary((prev) => prev || found.anniversary || '')
  }
  const [remarks, setRemarks] = useState('')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [billingDate, setBillingDate] = useState('') // '' = use current date/time
  const [paymentType, setPaymentType] = useState<'cash' | 'qr' | 'card' | 'split' | 'credit'>('cash')
  // Split payment: two different methods (any two of cash / QR / card), each with its amount
  const [splitCash, setSplitCash] = useState('') // amount of the first method
  const [splitOther, setSplitOther] = useState('') // amount of the second method
  const [splitFirstMethod, setSplitFirstMethod] = useState<'cash' | 'qr' | 'card'>('cash')
  const [splitOtherMethod, setSplitOtherMethod] = useState<'cash' | 'qr' | 'card'>('qr')
  const [creditDueDate, setCreditDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [shipping, setShipping] = useState<string>('0')
  const [couponInput, setCouponInput] = useState('')
  const [couponLoading, setCouponLoading] = useState(false)
  const [couponError, setCouponError] = useState('')
  const [availableCoupons, setAvailableCoupons] = useState<{code: string}[]>([])
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; percentage: number; minOrderValue: number; discount?: number } | null>(null)
  const [manualDiscountType, setManualDiscountType] = useState<'flat' | 'percent'>('flat')
  const [manualDiscountValue, setManualDiscountValue] = useState('')
  const [error, setError] = useState('')
  const [invoice, setInvoice] = useState<InvoiceSnap | null>(null)
  const [cashReceived, setCashReceived] = useState<string>('')
  const [mobilePanelView, setMobilePanelView] = useState<'catalogue' | 'bill'>('catalogue')
  const [ordermode, setOrdermode] = useState<'online' | 'offline'>('offline')
  const [variantPickerProduct, setVariantPickerProduct] = useState<Product | null>(null)
  const [availableVariants, setAvailableVariants] = useState<ProductVariant[]>([])
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [variantPickerQty, setVariantPickerQty] = useState(1)
  const [billGstEnabled, setBillGstEnabled] = useState(false)
  const [gstInput, setGstInput] = useState('')
  const [gstType, setGstType] = useState<'percent' | 'flat'>('percent')
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [addUnregisteredOpen, setAddUnregisteredOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [depositCreated, setDepositCreated] = useState<AdvanceOrder | null>(null)
  const [depositForm, setDepositForm] = useState({ amount: '', expectedDeliveryDate: '', paymentMethod: 'cash' as AdvancePaymentMethod, address: '', remarks: '', referenceNumber: '' })
  const [dbCategories, setDbCategories] = useState<string[]>([])
  const searchRef = useRef<HTMLInputElement>(null)

  // Jewellery: live metal rates and the customer's savings schemes
  const rates = useMetalRateStore((s) => s.rates)
  const [expandedJewelleryId, setExpandedJewelleryId] = useState<string | number | null>(null)
  const [schemeRules, setSchemeRules] = useState<SchemeRules>(() => normalizeSchemeRules(null))
  const [customerSchemes, setCustomerSchemes] = useState<JewelleryScheme[]>([])
  const [schemesLoading, setSchemesLoading] = useState(false)
  const [appliedScheme, setAppliedScheme] = useState<JewelleryScheme | null>(null)
  const [schemeUseAmount, setSchemeUseAmount] = useState('')
  const [schemeUseBenefit, setSchemeUseBenefit] = useState(true)
  // Amounts typed straight into the order summary (Gold Value / Making & Wastage / Stone Charges)
  const [manualGold, setManualGold] = useState('')
  const [manualMaking, setManualMaking] = useState('')
  const [manualStone, setManualStone] = useState('')

  useEffect(() => {
    void fetchProducts()
    void fetchVariants()
    if (!isSupabaseConfigured) return

    supabase.from('coupons').select('code').eq('is_active', true).order('created_at', { ascending: false }).limit(20)
      .then(({ data, error }) => {
        if (error) console.error('Failed to fetch coupons', error)
        else if (data) setAvailableCoupons(data)
      })

    const productChannel = supabase.channel('pos-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => void fetchProducts())
      .subscribe()

    // Load active categories in sort_order
    const loadCategories = async () => {
      const { data, error } = await supabase.from('categories').select('name_en').eq('is_active', true).order('sort_order')
      if (error) {
        console.error('Failed to load categories:', error.message)
        return
      }
      if (data) setDbCategories(data.map(c => c.name_en as string))
    }
    void loadCategories()
    schemeService.fetchRules().then(setSchemeRules).catch(() => undefined)

    return () => { void supabase.removeChannel(productChannel) }
  }, [fetchProducts, fetchVariants])

  // A new metal rate re-prices jewellery already in the cart, so the bill always uses the current rate.
  useEffect(() => {
    setItems((cur) => (cur.some((item) => item.metalType) ? cur.map((item) => repriceJewelleryItem(item, rates)) : cur))
  }, [rates])

  // ── Derived data ──────────────────────────────────────────────────────
  const categories = useMemo(() => {
    // Use DB active categories in sort_order; fall back to product categories if DB returns nothing
    if (dbCategories.length > 0) return ['All', ...dbCategories]
    const cats = Array.from(new Set(products.filter(p => p.isActive).map(p => p.category))).filter(Boolean)
    return ['All', ...cats]
  }, [dbCategories, products])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let src = products.filter(p => p.isActive)
    if (activeCategory !== 'All') src = src.filter(p => p.category === activeCategory)
    if (q) src = src.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    )
    return src.slice(0, 120)
  }, [products, search, activeCategory])

  const manualJewelleryItem = buildManualJewelleryItem(Number(manualGold) || 0, Number(manualMaking) || 0, Number(manualStone) || 0)
  /** Everything on the bill: cart items plus the manually typed jewellery amounts (if any). */
  const billItems = manualJewelleryItem ? [...items, manualJewelleryItem] : items
  const subtotal = billItems.reduce((s, i) => s + i.lineTotal, 0)

  // Jewellery price breakdown for the order summary (from each item's pricing snapshot × qty)
  const jewelleryBreakdown = items.reduce((acc, i) => {
    const j = i.jewellery
    if (!j) return acc
    acc.metal += j.metal_value * i.qty
    acc.makingWastage += (j.making_amount + j.wastage_amount) * i.qty
    acc.stone += j.stone_charge * i.qty
    acc.other += j.other_charge * i.qty
    if (j.metal_type !== 'gold') acc.allGold = false
    return acc
  }, { metal: 0, makingWastage: 0, stone: 0, other: 0, allGold: true })
  const isValidCoupon = appliedCoupon && subtotal >= (appliedCoupon.minOrderValue || 0)
  const couponDiscount = isValidCoupon
    ? ((appliedCoupon.percentage || 0) > 0
        ? Math.round((subtotal * (appliedCoupon.percentage || 0) / 100) * 100) / 100
        : (appliedCoupon.discount || 0))
    : 0
  const manualDiscountNumeric = Math.max(0, Number(manualDiscountValue) || 0)
  const manualDiscountAmount = manualDiscountType === 'percent'
    ? Math.max(0, Math.round((subtotal * manualDiscountNumeric / 100) * 100) / 100)
    : manualDiscountNumeric

  // Scheme benefit: a discount on making charges and/or wastage only — never on the metal value.
  const appliedSchemeBenefit = appliedScheme && schemeUseBenefit && !appliedScheme.benefitUsed
    ? calculateSchemeBenefit(appliedScheme, billItems
        .filter((item) => item.jewellery)
        .map((item) => ({ makingAmount: item.jewellery!.making_amount, wastageAmount: item.jewellery!.wastage_amount, qty: item.qty })))
    : null
  const schemeDiscount = appliedSchemeBenefit?.total || 0

  const discountedSubtotal = Math.max(0, subtotal - couponDiscount - manualDiscountAmount - schemeDiscount)

  const totalGst = billGstEnabled
    ? (gstType === 'percent'
      ? Math.max(0, Math.round((discountedSubtotal * (Math.max(0, Number(gstInput) || 0) / 100)) * 100) / 100)
      : Math.max(0, Number(gstInput) || 0))
    : 0
  const total = Math.max(0, discountedSubtotal + (Number(shipping || 0) || 0) + totalGst)

  // Scheme balance works like an earlier payment: it reduces what is collected now, not the invoice value.
  const appliedSchemeBalance = appliedScheme ? schemeBalance(appliedScheme) : 0
  const schemeAmountUsed = appliedScheme
    ? Math.round(Math.max(0, Math.min(
        appliedSchemeBalance,
        total,
        schemeRules.allowPartialRedemption ? (Number(schemeUseAmount) || 0) : appliedSchemeBalance,
      )) * 100) / 100
    : 0
  const payable = Math.max(0, Math.round((total - schemeAmountUsed) * 100) / 100)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const itemQtyMap = useMemo(() => {
    const m: Record<string | number, number> = {}
    items.forEach(i => { m[i.id] = i.qty })
    return m
  }, [items])

  // ── Cart actions ──────────────────────────────────────────────────────
  const addItem = async (product: Product, specificVariant?: ProductVariant) => {
    setError('')
    setMobilePanelView('catalogue')

    if (specificVariant) {
      const variantProduct: Product = {
        ...product,
        id: specificVariant.id,
        name: `${product.name} - ${specificVariant.variantName}`,
        price: specificVariant.price,
        offerPrice: null,
        stock: specificVariant.stock,
        stockQuantity: specificVariant.stock,
        hasVariants: false,
        unitType: 'unit',
        baseQuantity: 1,
        unitLabel: specificVariant.sizeLabel || specificVariant.variantName || 'piece',
        metalType: null,
      }
      setItems(cur => {
        const ex = cur.find(i => (i.variantId === specificVariant.id || String(i.id) === String(specificVariant.id)))
        if (!ex) {
          const item = makePosItem(variantProduct, 1)
          item.variantId = specificVariant.id
          item.variantName = specificVariant.variantName
          item.parentProductId = String(product.id)
          return [item, ...cur]
        }
        return cur.map(i => (i.variantId === specificVariant.id || String(i.id) === String(specificVariant.id)) ? recalc(i, i.qty + 1) : i)
      })
      return
    }

    // If product has variants, check its variants from DB or store
    if (product.hasVariants) {
      try {
        let vars = getVariants(String(product.id))
        if (!vars || vars.length === 0) {
          vars = await fetchVariantsByProduct(String(product.id))
        }

        if (vars && vars.length > 1) {
          // Multiple variants: open variant picker
          setAvailableVariants(vars)
          setVariantPickerProduct(product)
          setSelectedVariant(vars[0])
          setVariantPickerQty(1)
          return
        } else if (vars && vars.length === 1) {
          // Only 1 variant: add it directly
          void addItem(product, vars[0])
          return
        }
      } catch (err) {
        console.warn('Failed to load variants for product:', err)
      }
    }

    // Standard non-variant product
    setItems(cur => {
      const ex = cur.find(i => String(i.id) === String(product.id))
      if (!ex) return [makePosItem(product), ...cur]
      return cur.map(i => String(i.id) === String(product.id) ? recalc(i, i.qty + 1) : i)
    })
  }

  const addVariantToItems = () => {
    if (!variantPickerProduct || !selectedVariant) return
    setError('')
    const variantProduct: Product = {
      ...variantPickerProduct,
      id: selectedVariant.id,
      name: `${variantPickerProduct.name} - ${selectedVariant.variantName}`,
      price: selectedVariant.price,
      offerPrice: null,
      stock: selectedVariant.stock,
      stockQuantity: selectedVariant.stock,
      hasVariants: false,
      unitType: 'unit',
      baseQuantity: 1,
      unitLabel: selectedVariant.sizeLabel || variantPickerProduct.unitLabel || 'piece',
      metalType: null,
    }
    const addQty = Math.max(1, variantPickerQty)
    setItems(cur => {
      const ex = cur.find(i => (i.variantId === selectedVariant.id || String(i.id) === String(selectedVariant.id)))
      if (!ex) {
        const item = makePosItem(variantProduct, addQty)
        item.variantId = selectedVariant.id
        item.variantName = selectedVariant.variantName
        item.parentProductId = String(variantPickerProduct.id)
        return [item, ...cur]
      }
      return cur.map(i => (i.variantId === selectedVariant.id || String(i.id) === String(selectedVariant.id)) ? recalc(i, i.qty + addQty) : i)
    })
    setVariantPickerProduct(null)
    setSelectedVariant(null)
    setVariantPickerQty(1)
    setAvailableVariants([])
    setMobilePanelView('catalogue')
  }

  // Barcode scanner item handler (Consecutive scan increments cart quantity)
  const handleScannedItem = (scanned: ScannedItemPayload) => {
    setError('')
    const targetId = scanned.variant_id ? scanned.variant_id : scanned.product_id

    // Barcode lookup is unchanged; for a jewellery item we take its full catalogue
    // record so the weight, purity and charges are priced with today's rate.
    const catalogueProduct = !scanned.variant_id
      ? useProductStore.getState().products.find((p) => String(p.id) === String(scanned.product_id))
      : undefined
    if (catalogueProduct?.metalType) {
      setItems(cur => {
        const ex = cur.find(i => !i.variantId && String(i.id) === String(catalogueProduct.id))
        if (!ex) return [...cur, { ...makePosItem(catalogueProduct, 1), barcode: scanned.barcode || catalogueProduct.barcode }]
        return cur.map(i => (!i.variantId && String(i.id) === String(catalogueProduct.id)) ? recalc(i, i.qty + 1) : i)
      })
      return
    }

    setItems(cur => {
      const ex = cur.find(i => (scanned.variant_id ? i.variantId === scanned.variant_id : i.id === scanned.product_id))
      if (!ex) {
        const item = makePosItem({
          id: targetId,
          name: scanned.product_name,
          category: scanned.category || 'General',
          remedy: [],
          price: scanned.price,
          offerPrice: scanned.offer_price || null,
          stock: scanned.stock,
          stockQuantity: scanned.stock,
          hasVariants: false,
          unitType: 'unit',
          unitLabel: scanned.variant_name || 'piece',
          baseQuantity: 1,
          stockUnit: 'piece',
          allowDecimalQuantity: false,
          predefinedOptions: [],
          isActive: true,
          sortOrder: 0,
          unit: '1pc',
          rating: 5,
          description: '',
          benefits: '',
          image: scanned.image_url || '/product-placeholder.svg',
          imageUrl: scanned.image_url || '/product-placeholder.svg',
          barcode: scanned.barcode,
        }, 1)
        item.variantId = scanned.variant_id || undefined
        item.variantName = scanned.variant_name || undefined
        item.parentProductId = String(scanned.product_id)
        return [...cur, item]
      }

      // Existing item: increment quantity by 1
      return cur.map(i => {
        if ((scanned.variant_id && i.variantId === scanned.variant_id) || (!scanned.variant_id && i.id === scanned.product_id)) {
          return recalc(i, i.qty + 1)
        }
        return i
      })
    })
  }

  const externalCodeFromStore = useNavigationStore((s) => s.externalScannedCode)
  const setExternalScannedCode = useNavigationStore((s) => s.setExternalScannedCode)

  const processIncomingCode = useCallback(async (codeToProcess: string) => {
    const clean = normalizeBarcode(codeToProcess)
    if (!clean) return
    try {
      const record = await barcodeService.lookupBarcode(clean)
      if (!record || !record.product) {
        setQuickAddBarcode(clean)
        return
      }
      const prod = record.product
      const varnt = record.variant
      if (!prod.name) throw new Error('Product missing name field')
      const effectiveStock = varnt ? (Number(varnt.stock) || 0) : 999
      const price = varnt?.price ? Number(varnt.price) : Number(prod.price)

      const payload: ScannedItemPayload = {
        product_id: record.product_id,
        variant_id: record.variant_id || null,
        product_name: prod.name,
        name_ta: prod.name_ta,
        variant_name: varnt?.variant_name,
        price: price,
        offer_price: prod.offer_price ? Number(prod.offer_price) : undefined,
        stock: effectiveStock,
        barcode: clean,
        image_url: prod.image_url,
        category: prod.category,
      }
      handleScannedItem(payload)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err || 'Unknown error')
      console.error('Failed to process barcode:', msg)
      setError(`Barcode error: ${msg}`)
    }
  }, [])

  useEffect(() => {
    const code = props.externalScannedCode || externalCodeFromStore
    if (code) {
      void processIncomingCode(code)
      setExternalScannedCode(null)
      props.onCodeProcessed?.()
    }
  }, [props.externalScannedCode, externalCodeFromStore, processIncomingCode, setExternalScannedCode, props])



  const handleAddUnregisteredItem = async (input: {
    name: string
    price: number
    quantity: number
    note?: string
    unit?: string
    unitType?: 'unit' | 'weight' | 'volume' | 'bundle'
    jewellery?: JewellerySnapshot | null
  }) => {
    try {
      const product = await getOrCreateUnregisteredProduct(input.name, input.price)
      if (input.jewellery) {
        // A weighed jewellery piece is its own bill line (two pieces of the same name differ in weight).
        const base = makePosItem({
          id: `${product.id}-${Date.now()}`, name: input.name, category: 'Unregistered', remedy: [],
          price: input.price, offerPrice: null, stock: 999999, stockQuantity: 999999, hasVariants: false,
          unitType: 'unit', unitLabel: 'pcs', baseQuantity: 1, stockUnit: 'pcs', allowDecimalQuantity: false,
          predefinedOptions: [], isActive: true, sortOrder: 999, unit: 'pcs', rating: 5, description: '', benefits: '',
          image: '/product-placeholder.svg', imageUrl: '/product-placeholder.svg',
        }, input.quantity)
        setItems((cur) => [{ ...base, source: 'manual', note: input.note || null, parentProductId: String(product.id), jewellery: input.jewellery, jewelleryError: null }, ...cur])
        return
      }
      const unitType = input.unitType || 'unit'
      const unitLabel = input.unit || 'piece'
      const allowDecimal = unitType === 'weight' || unitType === 'volume'
      const newItem: PosItem = {
        id: product.id,
        name: input.name,
        category: 'Unregistered',
        categoryId: undefined,
        remedy: [],
        price: input.price,
        offerPrice: null,
        stock: 999999,
        stockQuantity: 999999,
        hasVariants: false,
        unitType,
        unitLabel,
        baseQuantity: 1,
        stockUnit: unitLabel,
        allowDecimalQuantity: allowDecimal,
        predefinedOptions: [],
        isActive: true,
        sortOrder: 999,
        unit: unitLabel,
        rating: 5,
        description: '',
        benefits: '',
        image: '/product-placeholder.svg',
        imageUrl: '/product-placeholder.svg',
        qty: input.quantity,
        selectedUnit: unitLabel,
        basePrice: input.price,
        lineTotal: calculateLineTotal(input.quantity, unitType, 1, input.price),
        source: 'manual',
        note: input.note || null,
      }

      setItems((cur) => {
        const ex = cur.find((i) => i.id === product.id && (i.source === 'manual' || i.category === 'Unregistered'))
        if (!ex) return [newItem, ...cur]
        return cur.map((i) => {
          if (i.id === product.id && (i.source === 'manual' || i.category === 'Unregistered')) {
            const updatedQty = i.qty + input.quantity
            return {
              ...i,
              qty: updatedQty,
              basePrice: input.price,
              lineTotal: calculateLineTotal(updatedQty, unitType, 1, input.price),
              note: input.note || i.note,
            }
          }
          return i
        })
      })
    } catch (err: unknown) {
      console.error('Failed to add unregistered item:', err)
      throw err
    }
  }

  const removeItem = (id: string | number) => setItems(cur => cur.filter(i => i.id !== id))

  const updateItem = (id: string | number, field: 'name' | 'basePrice' | 'qty', value: string | number) => {
    setItems(cur => cur.map((item) => {
      if (item.id !== id) return item
      let safeVal = value
      if (field === 'basePrice') {
        safeVal = Math.max(0, Number(value) || 0)
      } else if (field === 'qty') {
        safeVal = item.allowDecimalQuantity
          ? Math.max(0.001, Number(value) || 0.001)
          : Math.max(1, Number(value) || 1)
      }
      const nextItem = { ...item, [field]: safeVal } as PosItem
      return field === 'basePrice' || field === 'qty' ? recalc(nextItem, nextItem.qty) : nextItem
    }))
  }

  const updateItemOffer = (id: string | number, note: string) => {
    setItems(cur => cur.map((item) => item.id === id ? { ...item, specialOfferNote: note } : item))
  }

  const updateItemOfferCost = (id: string | number, cost: string) => {
    const parsed = cost.trim() === '' ? null : Math.max(0, Number(cost) || 0)
    setItems(cur => cur.map((item) => item.id === id ? { ...item, specialOfferCost: parsed } : item))
  }

  const bumpQty = (id: string | number, delta: number) => {
    setItems(cur => {
      const ex = cur.find(i => i.id === id)
      if (!ex) return cur
      const next = ex.qty + delta
      if (next <= 0) return cur.filter(i => i.id !== id)
      return cur.map(i => i.id === id ? recalc(i, next) : i)
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setQty = (id: string | number, val: number) => {
    if (val <= 0) { removeItem(id); return }
    setItems(cur => cur.map(i => i.id === id ? recalc(i, val) : i))
  }

  const clearAll = () => {
    setItems([])
    setCustomer({ name: '', phone: '', address: '' })
    setCustomerBirthday('')
    setCustomerAnniversary('')
    setInvoice(null)
    setCashReceived('')
    setCreditDueDate('')
    setCouponInput('')
    setAppliedCoupon(null)
    setCouponError('')
    setManualDiscountValue('')
    setManualDiscountType('flat')
    setError('')
    setShipping('0')
    setRemarks('')
    setReferenceNumber('')
    setBillingDate('')
    setBillGstEnabled(false)
    setGstInput('')
    setGstType('percent')
    setOrdermode('offline')
    setMobilePanelView('catalogue')
    setCustomerSchemes([])
    setAppliedScheme(null)
    setSchemeUseAmount('')
    setSchemeUseBenefit(true)
    setExpandedJewelleryId(null)
    setManualGold('')
    setManualMaking('')
    setManualStone('')
    searchRef.current?.focus()
  }

  const applyScheme = (scheme: JewelleryScheme) => {
    const eligibility = checkRedemptionEligibility(scheme, schemeRules)
    if (!eligibility.eligible) { setError(eligibility.reason); return }
    if (paymentType === 'credit') { setError('A scheme cannot be redeemed on a credit bill. Turn off "Bill on Credit" first.'); return }
    setError('')
    setAppliedScheme(scheme)
    setSchemeUseBenefit(!scheme.benefitUsed)
    // Default: use as much of the balance as the bill needs.
    setSchemeUseAmount(String(Math.min(schemeBalance(scheme), Math.max(0, total))))
  }

  const removeScheme = () => {
    setAppliedScheme(null)
    setSchemeUseAmount('')
    setSchemeUseBenefit(true)
  }

  const applyCoupon = async (overrideCode?: string) => {
    const code = (typeof overrideCode === 'string' ? overrideCode : couponInput).trim().toUpperCase()
    if (!code) { setCouponError('Enter a coupon code'); return }

    setCouponLoading(true)
    setCouponError('')
    setAppliedCoupon(null)

    try {
      if (!isSupabaseConfigured) {
        setCouponError('Coupon validation requires a live connection')
        return
      }

      const { data, error: dbErr } = await supabase
        .from('coupons')
        .select('*')
        .eq('is_active', true)
        .ilike('code', code)
        .single()

      if (dbErr || !data) {
        setCouponError('Invalid or expired coupon code')
        return
      }

      if (data.expiry_date && new Date(data.expiry_date) < new Date()) {
        setCouponError('This coupon has expired')
        return
      }

      if (data.usage_limit && data.usage_count >= data.usage_limit) {
        setCouponError('Coupon usage limit has been reached')
        return
      }

      if (data.min_order_value && subtotal < Number(data.min_order_value)) {
        setCouponError(`Minimum order of ${formatCurrency(Number(data.min_order_value))} required`)
        return
      }

      setAppliedCoupon({ code: String(data.code), percentage: Number(data.percentage), minOrderValue: Number(data.min_order_value || 0), discount: Number(data.discount || 0) })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('Coupon validation error:', msg)
      setCouponError('Coupon validation failed. Check your connection.')
    } finally {
      setCouponLoading(false)
    }
  }

  const removeCoupon = () => {
    setAppliedCoupon(null)
    setCouponInput('')
    setCouponError('')
  }

  const getOrderType = (): 'pos_sale' | 'manual_sale' => (billItems.length > 0 && billItems.every((item) => item.source === 'manual') ? 'manual_sale' : 'pos_sale')

  const openDepositOrder = () => {
    if (!billItems.length) { setError('Add at least one product before creating a deposit order.'); return }
    if (!customer.name.trim()) { setError('Enter the customer name for the deposit order.'); return }
    if (!customer.phone.trim()) { setError('Enter the customer phone number for the deposit order.'); return }
    if (total <= 0) { setError('The order total must be greater than zero.'); return }
    if (appliedScheme) { setError('Remove the applied scheme to save this as a deposit order. Schemes are redeemed on a completed sale.'); return }
    const enteredAmount = Number(cashReceived) || 0
    const suggestedDeposit = enteredAmount > 0 && enteredAmount < total ? String(enteredAmount) : ''
    setDepositForm({ amount: suggestedDeposit, expectedDeliveryDate: '', paymentMethod: 'cash', address: customer.address || '', remarks: '', referenceNumber: '' })
    setError('')
    setDepositOpen(true)
  }

  const saveDepositOrder = async (event: FormEvent) => {
    event.preventDefault()
    const depositAmount = Number(depositForm.amount)
    if (!Number.isFinite(depositAmount) || depositAmount <= 0 || depositAmount >= total) { setError(`Deposit must be greater than ${formatCurrency(0)} and less than ${formatCurrency(total)}.`); return }
    if (!depositForm.expectedDeliveryDate) { setError('Select the expected delivery date.'); return }
    setSaving(true); setError('')
    try {
      const allocationBase = billItems.reduce((sum, item) => sum + item.lineTotal, 0)
      let allocated = 0
      const productsSnapshot = billItems.map((item, index) => {
        const lineTotal = index === billItems.length - 1
          ? Math.max(0, Math.round((total - allocated) * 100) / 100)
          : Math.max(0, Math.round((allocationBase > 0 ? total * item.lineTotal / allocationBase : total / billItems.length) * 100) / 100)
        allocated += lineTotal
        return {
          product_id: item.parentProductId || toProductId(item.id), variant_id: item.variantId || null,
          variant_name: item.variantName || null, name: item.name, category: item.category,
          description: item.note || '', quantity: item.qty, unit: item.selectedUnit, unit_type: item.unitType,
          base_quantity: item.baseQuantity, base_price: Number(item.basePrice) || 0, line_total: lineTotal,
          source: 'advance_order', note: item.note || null,
          ...(item.jewellery ? { jewellery: item.jewellery } : {}),
        }
      })
      const created = await createAdvanceOrder({
        customerName: customer.name.trim(), phone: customer.phone.trim(), address: depositForm.address.trim(),
        productName: billItems.map(item => `${item.qty}× ${item.name}`).join(', '),
        category: Array.from(new Set(billItems.map(item => item.category).filter(Boolean))).join(', '),
        description: billItems.map(item => `${item.qty}× ${item.name}${item.note ? ` — ${item.note}` : ''}`).join('\n'),
        totalAmount: total, depositAmount, expectedDeliveryDate: depositForm.expectedDeliveryDate,
        remarks: depositForm.remarks, referenceNumber: depositForm.referenceNumber, paymentMethod: depositForm.paymentMethod, createdByName: role || 'Staff',
        products: productsSnapshot,
      })
      setDepositCreated(created)
      setDepositOpen(false)
      clearAll()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create deposit order'))
    } finally {
      setSaving(false)
    }
  }

  // ── Generate bill ─────────────────────────────────────────────────────
  const generateBill = async () => {
    if (!billItems.length) { setError('Add at least one item, or enter Gold Value / Making & Wastage / Stone Charges.'); return }
    // Validate required phone
    const normalizedPhone = normalizePhone(customer.phone || '')
    if (!normalizedPhone) { setError('Please enter a valid Indian mobile number (e.g. 9876543210 or +91 9876543210)'); return }
    // Jewellery items must be priced with a current metal rate
    const unpriced = items.find((item) => item.jewelleryError)
    if (unpriced) { setError(`${unpriced.name}: ${unpriced.jewelleryError}`); return }
    // Scheme redemption checks
    if (appliedScheme) {
      if (paymentType === 'credit') { setError('A scheme cannot be redeemed on a credit bill. Turn off "Bill on Credit" or remove the scheme.'); return }
      const eligibility = checkRedemptionEligibility(appliedScheme, schemeRules)
      if (!eligibility.eligible) { setError(eligibility.reason); return }
      if (!schemeRules.allowPartialRedemption && total < appliedSchemeBalance) {
        setError(`Partial redemption is not allowed: the bill must be at least the scheme balance of ${formatCurrency(appliedSchemeBalance)}.`)
        return
      }
      if (schemeAmountUsed <= 0 && schemeDiscount <= 0) { setError('Enter the scheme amount to use, or remove the scheme.'); return }
    }
    // Validate payment amount (only required for cash, and only when something is left to pay)
    if (paymentType === 'cash' && payable > 0 && !cashReceived.trim()) { setError('Enter the amount received from customer'); return }
    if (paymentType === 'cash' && cashReceivedNum < payable) { setError(`Insufficient payment. Customer still owes ${formatCurrency(payable - cashReceivedNum)}`); return }
    // Validate split payment: both parts entered and together equal the grand total
    if (paymentType === 'split' && (splitCashNum <= 0 || splitOtherNum <= 0)) { setError(`Enter both split amounts (${formatPaymentMode(splitFirstMethod)} and ${formatPaymentMode(splitOtherMethod)})`); return }
    if (paymentType === 'split' && splitDiff !== 0) { setError(splitDiff > 0 ? `Split amounts are short by ${formatCurrency(splitDiff)}` : `Split amounts exceed the total by ${formatCurrency(-splitDiff)}`); return }
    // Validate credit due date
    if (paymentType === 'credit' && !creditDueDate.trim()) { setError('Select a due date for this credit sale'); return }
    // Validate online mode availability
    if (ordermode === 'online' && !isSupabaseConfigured) { setError('Cannot place online orders while offline'); return }
    setSaving(true); setError('')
    // Scheme balance/benefit is reserved first (row-locked in the database) so it can never be
    // used twice; if the bill then fails, the reservation is released again.
    let schemeReservation: Awaited<ReturnType<typeof schemeService.reserveRedemption>> | null = null
    let orderCreated = false
    try {
      if (appliedScheme) {
        schemeReservation = await schemeService.reserveRedemption({
          schemeId: appliedScheme.id,
          amount: schemeAmountUsed,
          benefitAmount: schemeDiscount,
          rules: schemeRules,
          createdBy: role || 'Staff',
        })
      }
      const paymentMode = ordermode === 'online' ? 'online' : paymentType
      const splitPaymentDetails = paymentMode === 'split' ? { [splitFirstMethod]: splitCashNum, [splitOtherMethod]: splitOtherNum } : {}
      const created = await createOrderWithStock({
        customerName: customer.name.trim() || 'Walk-in Customer',
        phone: normalizedPhone,
        address: customer.address.trim() || 'POS Counter',
        items: billItems.map(item => buildStructuredOrderItem({
          productId:    item.parentProductId ? item.parentProductId : toProductId(item.id),
          variantId:    item.variantId   ?? null,
          variantName:  item.variantName ?? null,
          name: item.name,
          quantity: item.qty,
          unit: item.selectedUnit,
          unitType: item.unitType,
          baseQuantity: item.baseQuantity,
          basePrice: Number(item.basePrice) || 0,
          imageUrl: item.imageUrl || item.image || null,
          source: item.source || 'catalogue',
          isManual: item.source === 'manual' || item.category === 'Unregistered',
          category: item.category || null,
          note: item.note || null,
          specialOfferNote: item.specialOfferNote || null,
          specialOfferCost: item.specialOfferCost ?? null,
          jewellery: item.jewellery || null,
        })),
        shipping: Number(shipping || 0),
        status: 'completed',
        orderMode: ordermode,
        orderType: getOrderType(),
        deliveryCharge: Number(shipping || 0),
        discountAmount: couponDiscount,
        manualDiscountAmount,
        manualDiscountType,
        manualDiscountValue: manualDiscountNumeric,
        couponCode: appliedCoupon?.code,
        couponPercentage: appliedCoupon?.percentage,
        totalGst,
        gstEnabled: billGstEnabled,
        paymentMethod: paymentMode,
        splitDetails: splitPaymentDetails,
        isCredit: paymentType === 'credit',
        creditDueDate: paymentType === 'credit' ? creditDueDate : undefined,
      })
      orderCreated = true

      // ── CRITICAL: immediately fix totals in DB, independent of PDF upload ──
      // The RPC may store an incorrect total if items JSONB parsing differs.
      // This guarantees the correct client-computed values are always saved.
      // Determine the effective billing date/time
      const effectiveBillingDate = billingDate.trim()
        ? new Date(billingDate).toISOString()
        : new Date().toISOString()
      await supabase.from('orders').update({
        subtotal,
        total,
        total_gst: totalGst,
        gst_amount: totalGst,
        payment_mode: paymentMode,
        payment_method: paymentMode,
        discount_amount: couponDiscount,
        manual_discount_amount: manualDiscountAmount,
        delivery_charge: Number(shipping || 0),
        remarks: remarks.trim(),
        reference_number: referenceNumber.trim(),
        billing_date: effectiveBillingDate,
        credit_due_date: paymentType === 'credit' ? creditDueDate : null,
        credit_status: paymentType === 'credit' ? 'outstanding' : null,
      }).eq('id', created.orderId)

      if (schemeReservation && appliedScheme) {
        // The bill already exists at this point, so a failure here must not look like a failed sale.
        try {
          const { error: schemeColsError } = await supabase.from('orders').update({
            scheme_id: appliedScheme.id,
            scheme_number: appliedScheme.schemeNumber,
            scheme_amount_used: schemeAmountUsed,
            scheme_discount: schemeDiscount,
            scheme_balance_after: schemeReservation.redemption.balanceAfter,
          }).eq('id', created.orderId)
          if (schemeColsError) throw schemeColsError
          await schemeService.linkRedemption(schemeReservation.redemption.id, created.orderId, created.invoiceNo)
        } catch (linkErr) {
          console.error('Scheme redemption saved but not linked to the invoice:', linkErr)
        }
      }
      const createdInvoice: InvoiceSnap = {
        id: created.orderId,
        invoiceNo: created.invoiceNo,
        orderType: getOrderType(),
        date: billingDate.trim() ? new Date(billingDate).toISOString() : created.createdAt,
        items: [...billItems],
        subtotal,
        shipping: Number(shipping || 0),
        couponCode: appliedCoupon?.code,
        couponDiscount,
        manualDiscountAmount,
        manualDiscountType,
        manualDiscountValue: manualDiscountNumeric,
        gstAmount: totalGst,
        total,
        customerName: customer.name.trim() || 'Walk-in Customer',
        phone: normalizedPhone,
        address: customer.address.trim() || 'POS Counter',
        amountReceived: cashReceivedNum,
        balanceReturned: balanceToReturn,
        paymentMode: ordermode === 'online' ? 'Online' : formatPaymentMode(paymentType, splitPaymentDetails),
        paymentMethod: paymentMode,
        isCredit: paymentType === 'credit',
        creditDueDate: paymentType === 'credit' ? creditDueDate : undefined,
        ...(appliedScheme && schemeReservation ? {
          schemeNumber: appliedScheme.schemeNumber,
          schemeDiscount,
          schemeAmountUsed,
          schemeBalanceAfter: schemeReservation.redemption.balanceAfter,
        } : {}),
        payable,
      }
      setInvoice(createdInvoice)
      void persistInvoicePdf(createdInvoice)
      void customerService.upsertFromSale({
        phone: normalizedPhone,
        name: customer.name,
        address: customer.address,
        birthday: customerBirthday,
        anniversary: customerAnniversary,
      })

      setItems([])
      setCustomer({ name: '', phone: '', address: '' })
      setCreditDueDate('')
      setSplitCash('')
      setSplitOther('')
      setCustomerBirthday('')
      setCustomerAnniversary('')
      setCustomerSchemes([])
      setAppliedScheme(null)
      setSchemeUseAmount('')
      setManualGold('')
      setManualMaking('')
      setManualStone('')
      void fetchProducts()
    } catch (err: unknown) {
      if (schemeReservation && !orderCreated) {
        await schemeService.reverseRedemption(schemeReservation.redemption.id).catch((reverseErr) =>
          console.error('Failed to release scheme reservation:', reverseErr))
      }
      setError(getErrorMessage(err, 'Failed to generate bill'))
    } finally {
      setSaving(false)
    }
  }

  const cashReceivedNum = Number(cashReceived) || 0
  const splitCashNum = Math.max(0, Number(splitCash) || 0)
  const splitOtherNum = Math.max(0, Number(splitOther) || 0)
  // What is still to collect (negative = entered more than the total)
  const splitDiff = Math.round((payable - splitCashNum - splitOtherNum) * 100) / 100
  const balanceToReturn = cashReceivedNum > 0 && cashReceivedNum >= payable ? cashReceivedNum - payable : 0
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isInsufficientPayment = cashReceived !== '' && cashReceivedNum > 0 && cashReceivedNum < total
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const change = cashReceived && Number(cashReceived) >= total
    ? Number(cashReceived) - total : null

  const sendPosWhatsApp = (inv: InvoiceSnap) => {
    const invoiceUrl = publicInvoiceUrl(inv.invoiceNo)
    const message = buildProfessionalWhatsAppMessage({
      customerName: inv.customerName,
      phone: inv.phone,
      invoiceNumber: inv.invoiceNo,
      invoiceUrl,
      paymentMode: inv.paymentMode || 'POS',
      items: inv.items.map((item) => ({
        name: item.name,
        qty: item.qty,
        unit: item.selectedUnit,
        unitType: item.unitType,
        rate: Number(item.basePrice) || 0,
        lineTotal: item.lineTotal,
        giftNote: item.specialOfferNote,
        giftValue: item.specialOfferCost,
        jewellery: item.jewellery,
      })),
      subtotal: inv.subtotal,
      couponDiscount: inv.couponDiscount,
      manualDiscountAmount: inv.manualDiscountAmount,
      shipping: inv.shipping,
      gstAmount: inv.gstAmount,
      total: inv.total,
      isCredit: inv.isCredit,
      creditDueDate: inv.creditDueDate,
      schemeNumber: inv.schemeNumber,
      schemeDiscount: inv.schemeDiscount,
      schemeAmountUsed: inv.schemeAmountUsed,
      schemeBalanceAfter: inv.schemeBalanceAfter,
    })
    window.open(toWhatsAppUrl(inv.phone || customer.phone || '', message), '_blank', 'noopener,noreferrer')
  }

  const persistInvoicePdf = async (inv: InvoiceSnap) => {
    try {
      const file = invoicePdfFile({
        invoiceNo: inv.invoiceNo,
        date: inv.date,
        customerName: inv.customerName,
        phone: inv.phone,
        address: inv.address,
        items: inv.items.map(item => ({ name: item.name, qty: item.qty, unit: item.selectedUnit, price: Number(item.basePrice) || 0, line_total: item.lineTotal, special_offer_note: item.specialOfferNote, special_offer_cost: item.specialOfferCost, jewellery: item.jewellery || null })),
        subtotal: inv.subtotal,
        shipping: inv.shipping,
        schemeNumber: inv.schemeNumber,
        schemeDiscount: inv.schemeDiscount,
        schemeAmountUsed: inv.schemeAmountUsed,
        schemeBalanceAfter: inv.schemeBalanceAfter,
        discountAmount: inv.couponDiscount,
        manualDiscountAmount: inv.manualDiscountAmount,
        gstAmount: inv.gstAmount,
        couponCode: inv.couponCode,
        paymentMode: inv.paymentMode,
        total: inv.total,
        isCredit: inv.isCredit,
        creditDueDate: inv.creditDueDate,
      })
      // Upload PDF and save its URL — total fields already saved immediately after RPC
      const url = await uploadInvoicePdf(file, inv.invoiceNo)
      await supabase.from('orders').update({ invoice_pdf_url: url }).eq('id', inv.id)
      setInvoice(current => current?.id === inv.id ? { ...current, invoicePdfUrl: url } : current)
    } catch (err) {
      console.warn('Invoice PDF could not be stored:', err)
    }
  }

  const printReceipt = (inv: InvoiceSnap) => {
    // Print a Bluetooth/thermal receipt directly
    printThermalReceipt({
      paymentMode: inv.paymentMode,
      invoiceNo: inv.invoiceNo,
      date: inv.date,
      customerName: inv.customerName,
      phone: inv.phone,
      items: inv.items.map(item => ({ name: item.name, qty: item.qty, unit: item.selectedUnit, price: Number(item.basePrice) || 0, line_total: item.lineTotal, special_offer_note: item.specialOfferNote, special_offer_cost: item.specialOfferCost, jewellery: item.jewellery || null })),
      subtotal: inv.subtotal,
      shipping: inv.shipping,
      schemeNumber: inv.schemeNumber,
      schemeDiscount: inv.schemeDiscount,
      schemeAmountUsed: inv.schemeAmountUsed,
      schemeBalanceAfter: inv.schemeBalanceAfter,
      couponDiscount: inv.couponDiscount,
      manualDiscount: inv.manualDiscountAmount,
      totalGst: inv.gstAmount,
      total: inv.total,
      isCredit: inv.isCredit,
      creditDueDate: inv.creditDueDate,
    })
  }

  // ══ INVOICE SCREEN ════════════════════════════════════════════════════
  if (invoice) {
    const invoiceItems = invoice.items.map(item => ({
      id: item.id,
      name: item.name,
      qty: item.qty,
      quantity: item.qty,
      unit: item.selectedUnit,
      unit_type: item.unitType,
      base_quantity: item.baseQuantity,
      base_price: Number(item.basePrice) || 0,
      line_total: item.lineTotal,
      price: item.price,
      offerPrice: item.offerPrice,
      special_offer_note: item.specialOfferNote,
      special_offer_cost: item.specialOfferCost,
      jewellery: item.jewellery || null,
    }))
    const collected = invoice.payable ?? invoice.total

    return (
      <div className="mobile-page-shell h-full overflow-y-auto print:bg-white print:min-h-0 print:h-auto print:overflow-visible">
        {/* Screen UI */}
        <div className="max-w-2xl mx-auto px-4 py-6 print:hidden space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-textMain">{l('Bill Generated', 'பில் உருவாக்கப்பட்டது')}</h1>
              <p className="text-sm text-textMuted">#{formatInvoiceNo(invoice.invoiceNo)}</p>
            </div>
            <button onClick={clearAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#111111] hover:bg-[#3d4f3a] text-white font-bold text-sm">
              <Plus size={15} /> New Sale
            </button>
          </div>

          {/* Payment receipt */}
          <div className="surface-panel p-5 rounded-xl border border-gray-100 bg-white shadow-sm mb-4">
            <p className="text-xs font-black uppercase tracking-widest text-textMuted mb-3">{l('Payment Receipt', 'பண ரசீது')}</p>
            <div className="space-y-2.5">
              <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                <p className="text-sm font-bold text-textMuted">{l('Grand Total', 'மொத்த தொகை')}</p>
                <p className="text-2xl font-black text-textMain">{formatCurrency(invoice.total)}</p>
              </div>
              {(invoice.schemeAmountUsed || 0) > 0 && (
                <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                  <p className="text-sm font-bold text-textMuted">Paid from Scheme {invoice.schemeNumber}</p>
                  <p className="text-xl font-black text-[var(--accent-dark)]">−{formatCurrency(invoice.schemeAmountUsed || 0)}</p>
                </div>
              )}
              {(invoice.schemeAmountUsed || 0) > 0 && (
                <div className="flex justify-between items-center pb-2.5 border-b border-gray-100">
                  <p className="text-sm font-bold text-textMuted">Amount to Collect</p>
                  <p className="text-xl font-black text-textMain">{formatCurrency(collected)}</p>
                </div>
              )}
              <div className="flex justify-between items-center">
                <p className="text-sm font-bold text-textMuted">{l('Amount Received', 'பெற்ற தொகை')}</p>
                <p className="text-xl font-black text-textMain">{formatCurrency(invoice.amountReceived)}</p>
              </div>
              {invoice.balanceReturned > 0 ? (
                <div className="flex justify-between items-center rounded-xl bg-blue-50 border border-blue-200 px-4 py-3">
                  <p className="text-sm font-black text-blue-700">{l('Balance Returned', 'திரும்பிய பணம்')}</p>
                  <p className="text-2xl font-black text-blue-700">{formatCurrency(invoice.balanceReturned)}</p>
                </div>
              ) : (
                <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-center">
                  <p className="text-sm font-black text-green-700">✅ {l('Exact Amount Received', 'சரியான தொகை')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="grid grid-cols-3 gap-3">
            <button onClick={() => printReceipt(invoice)}
              className="flex flex-col md:flex-row items-center justify-center gap-2 py-3 px-2 rounded-xl border-2 border-gray-200 hover:border-[#111111] text-textMain font-bold text-[12px] md:text-sm transition-colors text-center leading-tight">
              <Printer size={16} className="shrink-0" /> {l('Print Receipt', 'ரசீது அச்சிடு')}
            </button>
            <button onClick={() => sendPosWhatsApp(invoice)}
              className="flex flex-col md:flex-row items-center justify-center gap-2 py-3 px-2 rounded-xl bg-green-500 hover:bg-green-600 text-white font-bold text-[12px] md:text-sm transition-colors text-center leading-tight">
              <MessageCircle size={16} className="shrink-0" /> WhatsApp Invoice
            </button>
            <button onClick={clearAll}
              className="flex flex-col md:flex-row items-center justify-center gap-2 py-3 px-2 rounded-xl bg-[#111111] hover:bg-[#3d4f3a] text-white font-bold text-[12px] md:text-sm transition-colors text-center leading-tight">
              <RefreshCw size={16} className="shrink-0" /> New Sale
            </button>
          </div>

          {/* Items summary */}
          <div className="surface-panel p-4 rounded-xl border border-gray-100 bg-white shadow-sm mt-4">
            <p className="text-xs font-bold text-textMuted uppercase tracking-wide mb-3">{l('Items Sold', 'விற்ற பொருட்கள்')}</p>
            <div className="space-y-1.5">
              {invoice.items.map(item => (
                <div key={item.id}>
                  <div className="flex justify-between text-sm">
                    <span className="text-textMain">{item.name} × {formatQuantityDisplay(item.qty, item.selectedUnit, item.unitType)}</span>
                    <span className="font-bold">{formatCurrency(item.lineTotal)}</span>
                  </div>
                  {item.jewellery && (
                    <p className="mt-0.5 text-[11px] font-semibold text-textMuted break-words">
                      {metalLabel(item.jewellery.metal_type, item.jewellery.purity)}{item.jewellery.net_weight > 0 ? ` · Net ${formatWeight(item.jewellery.net_weight)}` : ''}{item.jewellery.rate_per_gram > 0 ? ` @ ${formatCurrency(item.jewellery.rate_per_gram)}/g` : ''}
                    </p>
                  )}
                  {item.specialOfferNote && (
                    <p className="mt-0.5 text-[11px] font-bold text-amber-800 break-words">
                      🎁 FREE GIFT: {item.specialOfferNote}
                      {item.specialOfferCost != null && item.specialOfferCost > 0 ? <> — <s>₹{item.specialOfferCost}</s></> : ''} FREE
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Print view — full A4 invoice */}
        <div className="hidden print:block">
          <Invoice
            invoiceNo={invoice.invoiceNo}
            date={invoice.date}
            customerName={invoice.customerName}
            phone={invoice.phone}
            address={invoice.address}
            items={invoiceItems}
            subtotal={invoice.subtotal}
            shipping={invoice.shipping}
            total={invoice.total}
            status="Completed"
            discountAmount={invoice.couponDiscount || 0}
            manualDiscountAmount={invoice.manualDiscountAmount || 0}
            gstAmount={invoice.gstAmount || 0}
            couponCode={invoice.couponCode}
            isCredit={invoice.isCredit}
            creditDueDate={invoice.creditDueDate}
            schemeNumber={invoice.schemeNumber}
            schemeDiscount={invoice.schemeDiscount || 0}
            schemeAmountUsed={invoice.schemeAmountUsed || 0}
            schemeBalanceAfter={invoice.schemeBalanceAfter}
          />
        </div>
      </div>
    )
  }

  // ══ MAIN POS SCREEN ══════════════════════════════════════════════════
  return (
    <div data-embedded={embeddedMode} data-panel={mobilePanelView} className="flex flex-col h-full bg-[#FAFAFA] print:hidden overflow-y-auto overflow-x-hidden hide-scrollbar">
      {/* Header */}
      <div className="px-3 pt-3 pb-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6 md:pb-4 shrink-0 flex flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
        <div className="min-w-0">
          <h2 className="text-[18px] sm:text-[22px] md:text-[24px] font-black text-[#0A0A0A] flex items-center gap-2 leading-tight">
            <div className="w-1.5 h-5 sm:h-6 bg-[var(--accent)] rounded-full shrink-0"></div>
            POS Billing Panel
          </h2>
          <p className="text-[11px] sm:text-[12px] text-gray-500 font-medium ml-3.5 mt-0.5 pr-2">Quick Invoice generator & database synced checkout</p>
        </div>

        {/* Online/Offline Toggle & Logout */}
        <div className="flex gap-2 w-full min-[480px]:w-auto">
          <div className="grid grid-cols-2 bg-white rounded-xl border border-gray-200 p-1 shadow-sm flex-1 min-[480px]:flex-none">
            <button
              onClick={() => setOrdermode('offline')}
              className={`min-h-[38px] sm:min-h-[42px] px-3 sm:px-4 py-1.5 rounded-lg text-[11px] font-black tracking-wider uppercase transition-colors ${ordermode === 'offline' ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-sm' : 'text-[#374151] hover:bg-[#F9FAFB]'}`}
            >
              Offline
            </button>
            <button
              onClick={() => setOrdermode('online')}
              className={`min-h-[38px] sm:min-h-[42px] px-3 sm:px-4 py-1.5 rounded-lg text-[11px] font-black tracking-wider uppercase transition-colors ${ordermode === 'online' ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-sm' : 'text-[#374151] hover:bg-[#F9FAFB]'}`}
            >
              Online
            </button>
          </div>
          {!embeddedMode && (
            <>
              <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center justify-center min-h-[38px] sm:min-h-[42px] px-3 sm:px-4 rounded-xl bg-[#111111] text-white hover:bg-[#3d4f3a] transition-colors text-[11px] font-black tracking-wider uppercase"
              >
                Dashboard
              </button>
              <button
                onClick={() => { logout(); navigate('/admin-login', { replace: true }) }}
                title="Logout"
                className="flex items-center justify-center min-h-[38px] sm:min-h-[42px] px-3 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
              >
                <Power size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-5 md:gap-6 px-3 sm:px-4 md:px-6 pb-6 lg:h-[calc(100dvh-120px)] lg:overflow-hidden">

        {/* LEFT COLUMN (approx 68%) */}
        <div className="flex-[2.1] flex flex-col gap-4 sm:gap-6 lg:overflow-y-auto lg:pb-4 hide-scrollbar">

          {/* Customer Details Card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3.5 sm:p-4 md:p-5">
            <h3 className="text-[14px] sm:text-[15px] font-black text-[#111111] flex items-center gap-2 mb-3 sm:mb-4">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
              Customer Details
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-[11px] md:text-[10px] font-bold text-[#374151] mb-1">Customer Name</label>
                <input
                  type="text"
                  value={customer.name}
                  onChange={e => setCustomer({...customer, name: e.target.value})}
                  placeholder="Enter name"
                  className="w-full h-10 sm:h-11 px-3 sm:px-4 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-[#111111] placeholder:text-gray-400 placeholder:font-medium"
                />
              </div>
              <div>
                <label className="block text-[11px] md:text-[10px] font-bold text-[#374151] mb-1">Mobile Number (WhatsApp)</label>
                <input
                  type="text"
                  value={customer.phone}
                  onChange={e => setCustomer({...customer, phone: e.target.value})}
                  onBlur={() => void handlePhoneLookup()}
                  placeholder="Enter WhatsApp number"
                  className="w-full h-10 sm:h-11 px-3 sm:px-4 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-[#111111] placeholder:text-gray-400 placeholder:font-medium"
                />
              </div>
              <div>
                <DateInputDDMMYYYY
                  label="Birthday"
                  value={customerBirthday}
                  onChange={setCustomerBirthday}
                  placeholder="DD/MM/YYYY"
                  className="h-10 sm:h-11 px-3 sm:px-4"
                />
              </div>
              <div>
                <DateInputDDMMYYYY
                  label="Anniversary"
                  value={customerAnniversary}
                  onChange={setCustomerAnniversary}
                  placeholder="DD/MM/YYYY"
                  className="h-10 sm:h-11 px-3 sm:px-4"
                />
              </div>
              <div>
                <label className="block text-[11px] md:text-[10px] font-bold text-[#374151] mb-1">Remarks (Internal)</label>
                <input
                  type="text"
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  placeholder="Optional remarks"
                  className="w-full h-10 sm:h-11 px-3 sm:px-4 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-[#111111] placeholder:text-gray-400 placeholder:font-medium"
                />
              </div>
              <div>
                <label className="block text-[11px] md:text-[10px] font-bold text-[#374151] mb-1">Reference Number</label>
                <input
                  type="text"
                  value={referenceNumber}
                  onChange={e => setReferenceNumber(e.target.value)}
                  placeholder="Optional ref no."
                  className="w-full h-10 sm:h-11 px-3 sm:px-4 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[13px] font-bold text-[#111111] placeholder:text-gray-400 placeholder:font-medium"
                />
              </div>
              <div className="min-w-0 overflow-hidden">
                <label className="block text-[13px] md:text-[10px] font-bold text-[#374151] mb-1.5">Billing Date & Time (Optional)</label>
                <input
                  id="pos-billing-date"
                  type="datetime-local"
                  value={billingDate}
                  onChange={e => setBillingDate(e.target.value)}
                  className="block w-full max-w-full min-w-0 box-border h-12 px-4 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-[var(--accent)] text-[16px] md:text-[13px] font-bold text-[#111111]"
                  title="Format: DD-MM-YYYY"
                />
                <p className="mt-1 text-[10px] text-gray-400 font-medium">Leave blank to use today's date &amp; time</p>
              </div>
            </div>
          </div>

          {/* Order Items Card */}
          <div className="bg-white rounded-2xl border border-[#B7E1BE] shadow-sm flex-1 flex flex-col min-h-[400px]">
            {/* Card Header & Barcode Scanner */}
            <div className="flex flex-col gap-3 p-4 md:p-5 border-b border-[#B7E1BE]">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] md:text-[14px] font-black text-[#0A0A0A] flex items-center gap-2">
                  <Receipt size={16} className="text-[var(--accent)]" />
                  Order Items ({items.length})
                </h3>
              </div>

              {/* Barcode Scanner Bar */}
              <div className="w-full">
                <BarcodeScannerInput onItemScanned={handleScannedItem} onNotFound={setQuickAddBarcode} clearSignal={scanResetTick} />
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {/* Clear Order Button */}
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={items.length === 0}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 text-[11px] font-bold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-40 transition-colors shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-gray-500" />
                  <span>Clear Order</span>
                </button>

                {/* Button 1: Search Catalog */}
                <button
                  type="button"
                  onClick={() => setCatalogOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 sm:px-3.5 text-[11px] font-bold rounded-lg bg-[#0A0A0A] text-[var(--accent)] hover:bg-[#1A1A1A] border border-[var(--accent)] shadow-xs transition-all shrink-0 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span className="tracking-wide">Search Catalog</span>
                </button>

                {/* Button 2: Add Item (Ad-Hoc Unregistered) */}
                <button
                  type="button"
                  onClick={() => setAddUnregisteredOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 sm:px-3.5 text-[11px] font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 shadow-xs transition-all shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="tracking-wide">Add Item</span>
                </button>
              </div>
            </div>

            {/* Table Header */}
            <div className="hidden md:grid grid-cols-[1fr_100px_120px_40px] gap-3 px-5 py-3 border-b border-gray-200 bg-[#FAFAFA]">
              <span className="text-[10px] font-bold text-[#374151] tracking-wide">Item Name / Jewellery Details</span>
              <span className="text-[10px] font-bold text-[#374151] tracking-wide text-right">Price (₹)</span>
              <span className="text-[10px] font-bold text-[#374151] tracking-wide text-center">Qty</span>
              <span></span>
            </div>

            {/* Table Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 md:space-y-2">
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-[#374151]/60">
                  <ShoppingBag size={40} className="mb-3 opacity-20" />
                  <p className="text-[13px] font-bold">No items added yet</p>
                </div>
              )}

              {items.map(item => (
                <div key={item.id}>
                  <div className="md:hidden border border-gray-200 rounded-2xl p-4 bg-[#FFFDFC] space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-black uppercase tracking-wider text-[#374151] mb-1">Item Name</p>
                        {item.source === 'manual' ? (
                          <input
                            type="text"
                            value={item.name}
                            onChange={e => updateItem(item.id, 'name', e.target.value)}
                            placeholder="Item name"
                            className="w-full h-12 px-3 bg-[#FAFAFA] border border-gray-200 rounded-xl text-[16px] font-bold text-[#111111] focus:outline-none focus:border-[var(--accent)]"
                          />
                        ) : (
                          <div className="rounded-xl border border-gray-200 bg-white px-3 py-3">
                            <p className="text-[16px] font-bold text-[#111111] break-words">{item.name} {item.variantName ? `- ${item.variantName}` : ''}</p>
                          </div>
                        )}
                        {Boolean(item.hasSpecialOffer || item.specialOfferNote || item.specialOfferCost) && (
                          <div className="mt-2">
                            {editingOfferId === item.id ? (
                              <div className="flex flex-col gap-1.5">
                                <input
                                  autoFocus
                                  type="text"
                                  value={item.specialOfferNote || ''}
                                  onChange={e => updateItemOffer(item.id, e.target.value)}
                                  placeholder="e.g. Free gift: sample sachet"
                                  className="w-full h-10 px-3 bg-white border border-[var(--accent)] rounded-lg text-[13px] font-bold text-[#111111] focus:outline-none"
                                />
                                <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)] bg-white px-3 h-10">
                                  <span className="text-[11px] font-black text-amber-800 shrink-0">Gift Cost ₹</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={item.specialOfferCost ?? ''}
                                    onChange={e => updateItemOfferCost(item.id, e.target.value)}
                                    onBlur={() => setEditingOfferId(null)}
                                    placeholder="0"
                                    className="flex-1 min-w-0 text-[13px] font-bold text-[#111111] focus:outline-none"
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-stretch gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingOfferId(item.id)}
                                  className="flex-1 min-w-0 text-left px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[12px] font-bold text-amber-900 break-words"
                                >
                                  🎁 {item.specialOfferNote || 'Tap to apply free gifts and offers'}
                                </button>
                                {item.specialOfferCost != null && item.specialOfferCost > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingOfferId(item.id)}
                                    className="shrink-0 px-2.5 py-2 rounded-lg bg-amber-100 border border-amber-200 text-[11px] font-black text-amber-900 whitespace-nowrap"
                                  >
                                    Cost ₹{item.specialOfferCost}
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {(item.jewellery || item.jewelleryError) && (
                          <JewelleryCartDetails
                            item={item}
                            expanded={expandedJewelleryId === item.id}
                            onToggle={() => setExpandedJewelleryId(cur => cur === item.id ? null : item.id)}
                            className="mt-2"
                          />
                        )}
                      </div>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 text-[#374151] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[12px] font-black uppercase tracking-wider text-[#374151] mb-1">Unit Price</p>
                        <div className="h-11 rounded-xl border border-gray-200 bg-[#FAFAFA] px-3 flex items-center justify-end text-[14px] font-black text-[#111111]">
                          ₹{Number(item.basePrice || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div>
                        <p className="text-[12px] font-black uppercase tracking-wider text-[#374151] mb-1">Total</p>
                        <div className="h-11 rounded-xl border border-gray-200 bg-white px-3 flex items-center justify-end text-[15px] font-black text-[#0A0A0A]">
                          {formatCurrency(item.lineTotal)}
                        </div>
                      </div>
                    </div>

                    <div>
                      <p className="text-[13px] font-black uppercase tracking-wider text-[#374151] mb-1">
                        Quantity {item.allowDecimalQuantity ? `(${item.unitLabel})` : ''}
                      </p>
                      <div className="grid grid-cols-[48px_1fr_48px] items-center gap-2 border border-gray-200 rounded-xl px-2 py-2 bg-white">
                        <button
                          onClick={() => bumpQty(item.id, item.allowDecimalQuantity ? -0.1 : -1)}
                          className="w-11 h-11 rounded-xl hover:bg-[#FAFAFA] flex items-center justify-center text-[#374151] font-bold text-[20px]"
                        >-</button>
                        {item.allowDecimalQuantity ? (
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            inputMode="decimal"
                            value={item.qty}
                            onChange={e => updateItem(item.id, 'qty', e.target.value)}
                            className="w-full text-[18px] font-black text-[#111111] text-center bg-transparent outline-none"
                          />
                        ) : (
                          <span className="text-[18px] font-black text-[#111111] text-center">{item.qty}</span>
                        )}
                        <button
                          onClick={() => bumpQty(item.id, item.allowDecimalQuantity ? 0.1 : 1)}
                          className="w-11 h-11 rounded-xl hover:bg-[#FAFAFA] flex items-center justify-center text-[#374151] font-bold text-[20px]"
                        >+</button>
                      </div>
                    </div>
                  </div>

                  <div className="hidden md:grid grid-cols-[1fr_100px_120px_40px] items-center gap-3 p-2 bg-white border border-gray-200 rounded-xl hover:border-[var(--accent-a50)] transition-colors">
                    {/* Item Name */}
                    <div className="min-w-0 flex flex-col gap-1 py-1">
                      <div className="flex items-center gap-2">
                        {item.source === 'manual' ? (
                          <input
                            type="text"
                            value={item.name}
                            onChange={e => updateItem(item.id, 'name', e.target.value)}
                            placeholder="Item name"
                            className="w-full px-3 py-2 bg-[#FAFAFA] border border-gray-200 rounded-lg text-[13px] font-bold text-[#111111] focus:outline-none focus:border-[var(--accent)]"
                          />
                        ) : (
                          <div className="px-3 py-1 w-full border border-transparent flex items-center gap-2">
                            <span className="text-[13px] font-bold text-[#111111] break-words">{item.name} {item.variantName ? `- ${item.variantName}` : ''}</span>
                          </div>
                        )}
                        {item.source !== 'manual' && (
                          <span className="hidden sm:inline-flex px-2 py-0.5 rounded border border-[var(--accent-a30)] text-[var(--accent-dark)] text-[9px] font-black tracking-wider uppercase shrink-0 bg-[var(--accent-a10)]">
                            CATALOG
                          </span>
                        )}
                      </div>
                      {Boolean(item.hasSpecialOffer || item.specialOfferNote || item.specialOfferCost) && (
                        editingOfferId === item.id ? (
                          <div className="flex items-center gap-1.5 mx-3">
                            <input
                              autoFocus
                              type="text"
                              value={item.specialOfferNote || ''}
                              onChange={e => updateItemOffer(item.id, e.target.value)}
                              placeholder="e.g. Free gift: sample sachet"
                              className="flex-1 min-w-0 h-8 px-2.5 bg-white border border-[var(--accent)] rounded-md text-[12px] font-bold text-[#111111] focus:outline-none"
                            />
                            <div className="flex items-center gap-1 shrink-0 rounded-md border border-[var(--accent)] bg-white px-2 h-8">
                              <span className="text-[10px] font-black text-amber-800">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.specialOfferCost ?? ''}
                                onChange={e => updateItemOfferCost(item.id, e.target.value)}
                                onBlur={() => setEditingOfferId(null)}
                                placeholder="0"
                                className="w-16 text-[12px] font-bold text-[#111111] focus:outline-none"
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 mx-3 w-fit max-w-[calc(100%-1.5rem)]">
                            <button
                              type="button"
                              onClick={() => setEditingOfferId(item.id)}
                              className="min-w-0 text-left px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-bold text-amber-900 break-words"
                            >
                              🎁 {item.specialOfferNote || 'Tap to apply free gifts and offers'}
                            </button>
                            {item.specialOfferCost != null && item.specialOfferCost > 0 && (
                              <button
                                type="button"
                                onClick={() => setEditingOfferId(item.id)}
                                className="shrink-0 px-2 py-1 rounded-md bg-amber-100 border border-amber-200 text-[10px] font-black text-amber-900 whitespace-nowrap"
                              >
                                Cost ₹{item.specialOfferCost}
                              </button>
                            )}
                          </div>
                        )
                      )}
                      {(item.jewellery || item.jewelleryError) && (
                        <JewelleryCartDetails
                          item={item}
                          expanded={expandedJewelleryId === item.id}
                          onToggle={() => setExpandedJewelleryId(cur => cur === item.id ? null : item.id)}
                          className="mx-3"
                        />
                      )}
                    </div>

                    {/* Price */}
                    <div className="flex items-center justify-end px-3 py-2 text-right">
                      <span className="text-[13px] font-black text-[#111111] tracking-tight">
                        ₹{Number(item.basePrice || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>

                    {/* Quantity Controls */}
                    <div className="flex items-center justify-between border border-gray-200 rounded-lg px-2 py-1 bg-white">
                      <button
                        onClick={() => bumpQty(item.id, item.allowDecimalQuantity ? -0.1 : -1)}
                        className="w-6 h-6 rounded-md hover:bg-[#FAFAFA] flex items-center justify-center text-[#374151] font-bold"
                      >-</button>
                      {item.allowDecimalQuantity ? (
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          inputMode="decimal"
                          value={item.qty}
                          onChange={e => updateItem(item.id, 'qty', e.target.value)}
                          title={`Quantity in ${item.unitLabel}`}
                          className="w-14 text-[13px] font-black text-[#111111] text-center bg-transparent outline-none"
                        />
                      ) : (
                        <span className="text-[13px] font-black text-[#111111] min-w-[20px] text-center">{item.qty}</span>
                      )}
                      <button
                        onClick={() => bumpQty(item.id, item.allowDecimalQuantity ? 0.1 : 1)}
                        className="w-6 h-6 rounded-md hover:bg-[#FAFAFA] flex items-center justify-center text-[#374151] font-bold"
                      >+</button>
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => removeItem(item.id)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 text-[#374151] hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (approx 32%) */}
        <div className="flex-[1] flex min-h-0 max-lg:min-h-[420px] flex-col gap-6 lg:sticky lg:top-4 h-[calc(100dvh-140px)] max-h-[calc(100dvh-140px)]">
          <div className="flex min-h-0 h-full max-h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-[#FBFAF6] shadow-sm">

            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-white shrink-0">
              <h3 className="text-[18px] md:text-[14px] font-black text-[#111111] flex items-center gap-2">
                <Receipt size={16} className="text-[var(--accent)]" />
                Current Order
              </h3>
              <span className={`px-2 py-1 rounded-full border text-[9px] font-black tracking-wider uppercase flex items-center gap-1.5 ${ordermode === 'offline' ? 'border-[#0A0A0A] text-[#0A0A0A] bg-gray-100' : 'border-[var(--accent)] text-[var(--accent-dark)] bg-amber-50'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${ordermode === 'offline' ? 'bg-[#0A0A0A]' : 'bg-[var(--accent)]'}`}></div>
                {ordermode} (POS)
              </span>
            </div>

            {/* Content body */}
            <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3 space-y-2 hide-scrollbar">

              {/* Info Table */}
              <div className="border border-gray-200 rounded-xl overflow-hidden text-[11px] font-bold">
                <div className="flex justify-between px-3 py-2 border-b border-gray-200 bg-[#FAFAFA]">
                  <span className="text-[#374151] uppercase">Source</span>
                  <span className="text-[#0A0A0A] border border-gray-300 bg-gray-100 px-1.5 rounded uppercase">{ordermode.toUpperCase()}</span>
                </div>
                <div className="grid grid-cols-2 gap-0 border-b border-gray-200">
                  <div className="p-2 border-r border-gray-200">
                    <span className="text-[10px] text-[#374151] uppercase block mb-0.5">Customer Name</span>
                    <input
                      type="text"
                      value={customer.name}
                      onChange={e => setCustomer({...customer, name: e.target.value})}
                      placeholder="Enter name"
                      className="w-full h-8 px-2 bg-white border border-gray-200 rounded-lg text-[12px] font-bold text-[#111111] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                  <div className="p-2">
                    <span className="text-[10px] text-[#374151] uppercase block mb-0.5">WhatsApp Number</span>
                    <input
                      type="text"
                      value={customer.phone}
                      onChange={e => setCustomer({...customer, phone: e.target.value})}
                      onBlur={() => void handlePhoneLookup()}
                      placeholder="Enter WhatsApp number"
                      className={`w-full h-8 px-2 bg-white border rounded-lg text-[12px] font-bold text-[#111111] focus:outline-none ${customer.phone && !normalizePhone(customer.phone) ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-[var(--accent)]'}`}
                    />
                  </div>
                </div>
{items.length > 0 && (
                  <div className="px-3 py-2 bg-[#FAFAFA] space-y-1 border-b border-gray-200 max-h-[80px] overflow-y-auto">
                    {items.map(item => (
                <div key={item.id} className="flex justify-between text-[#111111] text-[11px]">
                        <span className="break-words pr-2">{item.qty}x {item.name}</span>
                        <span>{formatCurrency(item.lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Coupon Code */}
              <div>
                <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1">Coupon Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={e => {
                      const val = e.target.value.toUpperCase()
                      setCouponInput(val)
                      if (availableCoupons.some(c => c.code.toUpperCase() === val)) {
                        void applyCoupon(val)
                      }
                    }}
                    placeholder="Enter code"
                    disabled={appliedCoupon !== null}
                    list="pos-coupons"
                    className="w-full h-9 px-3 bg-white border border-gray-200 rounded-xl text-[12px] font-bold text-[#111111] focus:outline-none focus:border-[var(--accent)] uppercase disabled:bg-gray-100"
                  />
                  <datalist id="pos-coupons">
                    {availableCoupons.map(c => (
                      <option key={c.code} value={c.code} />
                    ))}
                  </datalist>
                  {appliedCoupon ? (
                    <button
                      onClick={removeCoupon}
                      className="h-9 px-3 bg-red-100 text-red-600 hover:bg-red-200 rounded-xl text-[11px] font-black transition-colors shrink-0"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => void applyCoupon()}
                      disabled={couponLoading || !couponInput.trim()}
                      className="h-9 px-3 bg-[#0A0A0A] text-[var(--accent)] border border-[var(--accent)] hover:bg-[#1A1A1A] rounded-xl text-[11px] font-black transition-colors disabled:opacity-50 shrink-0"
                    >
                      Apply
                    </button>
                  )}
                </div>
                {couponError && <p className="text-[10px] font-bold text-red-500 mt-0.5">{couponError}</p>}
                {appliedCoupon && (
                  <p className="text-[10px] font-bold text-green-600 mt-0.5">Applied: -{formatCurrency(couponDiscount)}</p>
                )}
              </div>

              {/* Discount */}
              <div>
                <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1">Manual Discount</label>
                <div className="flex gap-2">
                  <div className="relative shrink-0 z-20">
                    <select
                      value={manualDiscountType}
                      onChange={e => setManualDiscountType(e.target.value as 'flat'|'percent')}
                      className="appearance-none h-9 bg-white border border-gray-200 rounded-xl pl-2 pr-7 text-[12px] font-black text-[#111111] focus:outline-none focus:border-[var(--accent)] touch-manipulation"
                    >
                      <option value="flat">₹</option>
                      <option value="percent">%</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#374151] pointer-events-none" />
                  </div>
                  <input
                    type="number" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    value={manualDiscountValue}
                    onChange={e => setManualDiscountValue(e.target.value)}
                    placeholder="0"
                    className="w-full h-9 px-3 bg-white border border-gray-200 rounded-xl text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              {/* Savings Scheme (Schema) redemption */}
              <div>
                <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1">Savings Scheme</label>
                {appliedScheme ? (
                  <div className="rounded-xl border border-[var(--accent-a30)] bg-[var(--accent-a10)] p-2.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-[#111111] break-words">{appliedScheme.schemeNumber} · {appliedScheme.schemeName}</p>
                        <p className="text-[10px] font-bold text-[var(--accent-dark)]">Balance {formatCurrency(appliedSchemeBalance)} · {describeSchemeBenefit(appliedScheme, formatCurrency)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={removeScheme}
                        className="h-7 px-2.5 bg-red-100 text-red-600 hover:bg-red-200 rounded-lg text-[10px] font-black transition-colors shrink-0"
                      >
                        Remove
                      </button>
                    </div>
                    {appliedScheme.benefitUsed ? (
                      <p className="text-[10px] font-bold text-[#6B7280]">Scheme benefit already used on an earlier bill.</p>
                    ) : (
                      <label className="flex items-center justify-between gap-2 text-[11px] font-bold text-[#374151] cursor-pointer">
                        <span className="flex items-center gap-1.5">
                          <input type="checkbox" checked={schemeUseBenefit} onChange={e => setSchemeUseBenefit(e.target.checked)} className="accent-[var(--accent)]" />
                          Apply benefit (making / wastage only)
                        </span>
                        <span className="text-[#111111]">−{formatCurrency(schemeDiscount)}</span>
                      </label>
                    )}
                    <div>
                      <span className="block text-[10px] font-bold text-[#374151] mb-0.5">
                        Use from scheme balance (₹){!schemeRules.allowPartialRedemption ? ' — full balance' : ''}
                      </span>
                      <input
                        type="number" min="0" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        value={schemeRules.allowPartialRedemption ? schemeUseAmount : String(appliedSchemeBalance)}
                        disabled={!schemeRules.allowPartialRedemption}
                        onChange={e => setSchemeUseAmount(e.target.value)}
                        className="w-full h-9 px-3 bg-white border border-gray-200 rounded-xl text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[var(--accent)] disabled:bg-gray-100"
                      />
                      {schemeAmountUsed < (Number(schemeUseAmount) || 0) && schemeRules.allowPartialRedemption && (
                        <p className="text-[10px] font-bold text-amber-700 mt-0.5">Limited to {formatCurrency(schemeAmountUsed)} (balance / bill total).</p>
                      )}
                    </div>
                  </div>
                ) : !normalizePhone(customer.phone || '') ? (
                  <p className="text-[10px] font-bold text-[#6B7280]">Enter the customer's mobile number to check for savings schemes.</p>
                ) : schemesLoading ? (
                  <p className="text-[10px] font-bold text-[#6B7280]">Checking schemes…</p>
                ) : customerSchemes.filter(sch => sch.status !== 'cancelled' && sch.status !== 'redeemed').length === 0 ? (
                  <p className="text-[10px] font-bold text-[#6B7280]">No open savings scheme for this customer.</p>
                ) : (
                  <div className="space-y-1.5">
                    {customerSchemes.filter(sch => sch.status !== 'cancelled' && sch.status !== 'redeemed').map(sch => {
                      const eligibility = checkRedemptionEligibility(sch, schemeRules)
                      return (
                        <div key={sch.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-2.5 py-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-black text-[#111111] break-words">{sch.schemeNumber} · {SCHEME_STATUS_LABELS[deriveSchemeStatus(sch)]}</p>
                            <p className="text-[10px] font-bold text-[#6B7280] break-words">
                              Balance {formatCurrency(schemeBalance(sch))}{eligibility.eligible ? '' : ` · ${eligibility.reason}`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => applyScheme(sch)}
                            disabled={!eligibility.eligible}
                            className="h-8 px-3 bg-[#0A0A0A] text-[var(--accent)] border border-[var(--accent)] hover:bg-[#1A1A1A] rounded-xl text-[11px] font-black transition-colors disabled:opacity-40 shrink-0"
                          >
                            Apply
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* GST Toggle */}
              <div className="flex items-center justify-between py-1 border-b border-gray-200">
                <span className="text-[11px] font-black text-[#374151]">Enable GST on Bill</span>
                <button
                  type="button"
                  onClick={() => setBillGstEnabled(!billGstEnabled)}
                  className={`w-9 h-5 rounded-full p-0.5 transition-colors ${billGstEnabled ? 'bg-[#0A0A0A]' : 'bg-gray-200'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transition-transform ${billGstEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {billGstEnabled && (
                <div className="flex gap-2">
                  <div className="relative shrink-0 z-20">
                    <select
                      value={gstType}
                      onChange={e => setGstType(e.target.value as 'flat'|'percent')}
                      className="appearance-none h-9 bg-white border border-gray-200 rounded-xl pl-2 pr-7 text-[12px] font-black text-[#111111] focus:outline-none focus:border-[var(--accent)] touch-manipulation"
                    >
                      <option value="percent">%</option>
                      <option value="flat">₹</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#374151] pointer-events-none" />
                  </div>
                  <input
                    type="number" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    value={gstInput}
                    onChange={e => setGstInput(e.target.value)}
                    placeholder={gstType === 'percent' ? "e.g. 6" : "0"}
                    className="w-full h-9 px-3 bg-white border border-gray-200 rounded-xl text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              )}

              {/* Summary calculations */}
              <div className="bg-[#FAFAF8] rounded-xl border border-gray-200 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-[#374151]">{jewelleryBreakdown.allGold ? 'Gold Value' : 'Metal Value'}</span>
                  <div className="flex items-center gap-1.5">
                    {jewelleryBreakdown.metal > 0 && <span className="text-[12px] font-black text-[#111111] whitespace-nowrap">{formatCurrency(jewelleryBreakdown.metal)} +</span>}
                    <input
                      type="number" min="0" step="0.01" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      value={manualGold}
                      onChange={e => setManualGold(e.target.value)}
                      placeholder="0"
                      aria-label="Gold Value (enter manually)"
                      className="w-24 h-8 px-2 bg-white border border-gray-200 rounded-lg text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-[#374151]">Making &amp; Wastage</span>
                  <div className="flex items-center gap-1.5">
                    {jewelleryBreakdown.makingWastage > 0 && <span className="text-[12px] font-black text-[#111111] whitespace-nowrap">{formatCurrency(jewelleryBreakdown.makingWastage)} +</span>}
                    <input
                      type="number" min="0" step="0.01" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      value={manualMaking}
                      onChange={e => setManualMaking(e.target.value)}
                      placeholder="0"
                      aria-label="Making &amp; Wastage (enter manually)"
                      className="w-24 h-8 px-2 bg-white border border-gray-200 rounded-lg text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black text-[#374151]">Stone Charges</span>
                  <div className="flex items-center gap-1.5">
                    {jewelleryBreakdown.stone > 0 && <span className="text-[12px] font-black text-[#111111] whitespace-nowrap">{formatCurrency(jewelleryBreakdown.stone)} +</span>}
                    <input
                      type="number" min="0" step="0.01" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      value={manualStone}
                      onChange={e => setManualStone(e.target.value)}
                      placeholder="0"
                      aria-label="Stone Charges (enter manually)"
                      className="w-24 h-8 px-2 bg-white border border-gray-200 rounded-lg text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
                {jewelleryBreakdown.other > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-[#374151]">Other Charges</span>
                    <span className="text-[12px] font-black text-[#111111]">{formatCurrency(jewelleryBreakdown.other)}</span>
                  </div>
                )}
                <div className="h-px bg-gray-200"></div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-[#374151]">Subtotal ({billItems.length} items)</span>
                  <span className="text-[12px] font-black text-[#111111]">{formatCurrency(subtotal)}</span>
                </div>

                {schemeDiscount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-[#374151]">Scheme Benefit</span>
                    <span className="text-[12px] font-black text-[var(--accent-dark)]">−{formatCurrency(schemeDiscount)}</span>
                  </div>
                )}

                {billGstEnabled && totalGst > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-[#374151]">GST Amount</span>
                    <span className="text-[12px] font-black text-[#111111]">{formatCurrency(totalGst)}</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-[#374151]">Delivery</span>
                  <input
                    type="number" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    value={shipping}
                    onChange={e => setShipping(e.target.value)}
                    className="w-20 h-8 px-2 bg-white border border-gray-200 rounded-lg text-[12px] font-black text-[#111111] text-right focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <div className="h-px bg-gray-200"></div>

                {/* Grand Total */}
                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-[12px] font-black text-[#111111] uppercase tracking-wider">Grand Total</span>
                  <span className="text-[20px] font-black text-[#0A0A0A] tracking-tight">{formatCurrency(total)}</span>
                </div>
                {schemeAmountUsed > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-[#374151]">Paid from Scheme</span>
                      <span className="text-[12px] font-black text-[var(--accent-dark)]">−{formatCurrency(schemeAmountUsed)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-black text-[#111111] uppercase tracking-wider">To Collect</span>
                      <span className="text-[16px] font-black text-[#0A0A0A] tracking-tight">{formatCurrency(payable)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Payment Mode Selector — only applies when the customer is paying now */}
              {paymentType !== 'credit' && (
                <div>
                  <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-1">Payment Mode</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['cash', 'qr', 'card', 'split'] as const).map(mode => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setPaymentType(mode)}
                        className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 transition-colors ${
                          paymentType === mode
                            ? 'bg-[#0A0A0A] text-[var(--accent)] border-[#0A0A0A]'
                            : 'bg-white text-[#374151] border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {mode === 'qr' ? 'QR' : mode === 'card' ? 'Card' : mode === 'split' ? 'Split' : 'Cash'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Credit is a billing type, not a payment mode — kept as its own toggle */}
              <button
                type="button"
                onClick={() => {
                  if (paymentType !== 'credit' && appliedScheme) { setError('A scheme cannot be redeemed on a credit bill. Remove the scheme first.'); return }
                  setPaymentType(prev => prev === 'credit' ? 'cash' : 'credit')
                }}
                className={`w-full flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 transition-colors ${
                  paymentType === 'credit'
                    ? 'bg-amber-600 border-amber-600 text-white'
                    : 'bg-white border-amber-300 text-amber-800 hover:bg-amber-50'
                }`}
              >
                <span className="text-[11px] font-black uppercase tracking-wide">Bill on Credit (Pay Later)</span>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${paymentType === 'credit' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                  {paymentType === 'credit' ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Amount Received (cash / QR / card) or Due Date (credit) */}
              {ordermode !== 'online' && (
              <div>
                {paymentType === 'credit' ? (
                  <div className="border-2 border-amber-300 rounded-xl p-2.5 bg-amber-50">
                    <label className="block text-[10px] font-black text-amber-900 tracking-wider uppercase mb-0.5">
                      Credit Sale — Due Date <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={creditDueDate}
                      onChange={e => setCreditDueDate(e.target.value)}
                      min={toLocalDateStr(new Date())}
                      className="w-full h-9 px-3 bg-white border border-amber-300 rounded-xl text-[13px] font-black text-[#111111] focus:outline-none focus:border-amber-600"
                    />
                    <p className="mt-1.5 text-[10px] font-bold text-amber-800">
                      This sale is billed on credit. It shows as outstanding until marked paid, and you'll get an alert when the due date arrives.
                    </p>
                  </div>
                ) : paymentType === 'split' ? (
                <div className="border border-gray-200 rounded-xl p-2.5 bg-white space-y-2">
                  <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase">
                    Split Payment — {formatPaymentMode(splitFirstMethod)} + {formatPaymentMode(splitOtherMethod)} (₹)
                  </label>
                  {([
                    { key: 'first', label: 'Payment 1', method: splitFirstMethod, amount: splitCash },
                    { key: 'second', label: 'Payment 2', method: splitOtherMethod, amount: splitOther },
                  ] as const).map(row => (
                    <div key={row.key} className="grid grid-cols-[1fr_1fr] gap-2 items-end">
                      <div>
                        <span className="block text-[9px] font-black text-gray-500 uppercase mb-0.5">{row.label}</span>
                        <div className="grid grid-cols-3 gap-1">
                          {(['cash', 'qr', 'card'] as const).map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => {
                                // The two parts must use different methods: picking the other side's method swaps them
                                if (row.key === 'first') {
                                  if (m === splitOtherMethod) setSplitOtherMethod(splitFirstMethod)
                                  setSplitFirstMethod(m)
                                } else {
                                  if (m === splitFirstMethod) setSplitFirstMethod(splitOtherMethod)
                                  setSplitOtherMethod(m)
                                }
                              }}
                              className={`h-9 rounded-lg text-[10px] font-black uppercase transition-colors ${
                                row.method === m ? 'bg-[#0A0A0A] text-[var(--accent)]' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              {formatPaymentMode(m)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="number" min="0" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        value={row.amount}
                        onChange={e => {
                          const v = e.target.value
                          if (row.key === 'first') {
                            setSplitCash(v)
                            // Fill the second part with whatever is left of the total
                            setSplitOther(v === '' ? '' : String(Math.max(0, Math.round((payable - (Number(v) || 0)) * 100) / 100)))
                          } else {
                            setSplitOther(v)
                          }
                        }}
                        placeholder="0.00"
                        aria-label={`${row.label} amount`}
                        className="w-full h-9 px-3 bg-[#FAFAFA] border border-gray-200 rounded-xl text-[13px] font-black text-[#111111] focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                  ))}
                  {(splitCash !== '' || splitOther !== '') && (
                    <div className={`flex justify-between items-center px-3 py-1.5 rounded-lg border text-[10px] font-bold ${
                      splitDiff === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'
                    }`}>
                      <span>{splitDiff === 0 ? 'Matches grand total' : splitDiff > 0 ? 'Still to collect' : 'More than grand total by'}</span>
                      <span className="text-[12px] font-black">{splitDiff === 0 ? '✓' : formatCurrency(Math.abs(splitDiff))}</span>
                    </div>
                  )}
                </div>
                ) : (
                <div className="border border-gray-200 rounded-xl p-2.5 bg-white">
                  <label className="block text-[10px] font-black text-[#374151] tracking-wider uppercase mb-0.5">
                    {paymentType === 'qr' ? 'QR' : paymentType === 'card' ? 'Card' : 'Cash'} — Amount Received (₹)
                  </label>
                  <input
                    type="number" onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    value={cashReceived}
                    onChange={e => setCashReceived(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-9 px-3 bg-[#FAFAFA] border border-gray-200 rounded-xl text-[13px] font-black text-[#111111] focus:outline-none focus:border-[var(--accent)]"
                  />
                  {cashReceivedNum > 0 && (
                    <div className="mt-2 flex justify-between items-center bg-[#F9FAFB] px-3 py-1.5 rounded-lg border border-gray-200">
                      <span className="text-[10px] font-bold text-[#374151]">Return Balance:</span>
                      <span className="text-[12px] font-black text-[#111111]">{formatCurrency(balanceToReturn)}</span>
                    </div>
                  )}
                </div>
                )}
              </div>
              )}

              {error && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-[11px] font-bold">
                  {error}
                </div>
              )}
            </div>

            {/* Action Buttons Fixed Footer */}
            <div className="shrink-0 border-t border-gray-200 bg-white p-3 shadow-[0_-8px_20px_rgba(0,0,0,0.04)]">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={openDepositOrder}
                  disabled={saving || billItems.length === 0}
                  className="min-h-[44px] rounded-xl border-2 border-[#0A0A0A] bg-white px-3 py-3 text-[12px] font-black uppercase tracking-wide text-[#0A0A0A] transition-colors hover:bg-[#0A0A0A] hover:text-[var(--accent)] disabled:opacity-40 cursor-pointer"
                >
                  Save as Deposit Order
                </button>
                <button
                  type="button"
                  onClick={generateBill}
                  disabled={saving}
                  className="min-h-[44px] rounded-xl bg-emerald-600 px-3 py-3 text-[13px] font-black uppercase tracking-wider text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {saving ? 'Processing...' : 'Complete Sale'}
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] font-bold text-[#6B7280]">Deposit orders do not count as revenue until the remaining payment is received.</p>
            </div>
          </div>
        </div>

      </div>

      {depositOpen && (<ModalPortal>
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/55 p-3 sm:p-4">
          <form onSubmit={saveDepositOrder} className="flex w-full max-w-lg max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
            <div className="shrink-0 flex items-start justify-between gap-3 border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[.16em] text-violet-600">Advance payment only</p>
                <h3 className="text-lg sm:text-xl font-black text-[#111111]">Save as Deposit Order</h3>
                <p className="mt-0.5 text-[11px] sm:text-xs font-semibold text-amber-700">No sale or tax invoice will be created now.</p>
              </div>
              <button type="button" onClick={() => { setDepositOpen(false); setError('') }} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 shrink-0"><X size={20}/></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
            <div className="mb-3 sm:mb-4 rounded-2xl bg-violet-50 p-3 sm:p-4">
              <div className="flex justify-between text-sm"><span className="font-bold text-violet-700">Order total</span><span className="font-black text-violet-900">{formatCurrency(total)}</span></div>
              <div className="mt-2 max-h-16 sm:max-h-24 space-y-1 overflow-y-auto border-t border-violet-200 pt-2">{billItems.map(item => <div key={item.id} className="flex justify-between gap-3 text-xs"><span className="break-words">{item.qty}× {item.name}</span><span className="font-bold">{formatCurrency(item.lineTotal)}</span></div>)}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <label className="block min-w-0"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Deposit received *</span><input required autoFocus type="number" onWheel={(e) => (e.target as HTMLInputElement).blur()} min="0.01" max={Math.max(0, total - 0.01)} step="0.01" value={depositForm.amount} onChange={e => setDepositForm({...depositForm, amount:e.target.value})} className="w-full rounded-xl border px-3 py-2.5 text-sm font-bold outline-none focus:border-violet-600"/></label>
              <label className="block min-w-0"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Remaining balance</span><div className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-black text-red-700">{formatCurrency(Math.max(0,total-Number(depositForm.amount||0)))}</div></label>
              <label className="block min-w-0"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Expected delivery *</span><input required type="date" value={depositForm.expectedDeliveryDate} onChange={e => setDepositForm({...depositForm, expectedDeliveryDate:e.target.value})} className="block h-[42px] w-full min-w-0 max-w-full appearance-none rounded-xl border bg-white px-3 py-2.5 text-left text-sm font-bold outline-none focus:border-violet-600"/></label>
              <label className="block min-w-0"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Payment method *</span><select value={depositForm.paymentMethod} onChange={e => setDepositForm({...depositForm,paymentMethod:e.target.value as AdvancePaymentMethod})} className="h-[42px] w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-violet-600 touch-manipulation"><option value="cash">Cash</option><option value="upi">QR</option><option value="card">Card</option></select></label>
              <label className="block col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Delivery address</span><textarea value={depositForm.address} onChange={e => setDepositForm({...depositForm,address:e.target.value})} className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-600" rows={2}/></label>
              <label className="block col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Reference Number</span><input value={depositForm.referenceNumber} onChange={e => setDepositForm({...depositForm,referenceNumber:e.target.value})} className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-600" placeholder="e.g. PO-001, booking ref (optional)"/></label>
              <label className="block col-span-2"><span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Remarks</span><textarea value={depositForm.remarks} onChange={e => setDepositForm({...depositForm,remarks:e.target.value})} className="w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-violet-600" rows={2}/></label>
            </div>
            {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-600">{error}</div>}
            </div>
            <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6"><button type="button" onClick={() => { setDepositOpen(false); setError('') }} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button><button disabled={saving} className="flex-[1.5] rounded-xl bg-violet-700 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Confirm Deposit Order'}</button></div>
          </form>
        </div>
      </ModalPortal>)}

      {quickAddBarcode && (
        <QuickAddScannedProductModal
          barcode={quickAddBarcode}
          categories={categories.filter(c => c !== 'All')}
          onClose={() => { setQuickAddBarcode(''); setScanResetTick(t => t + 1) }}
          onCreated={(item) => {
            handleScannedItem(item)
            setQuickAddBarcode('')
            setScanResetTick(t => t + 1)
            void fetchProducts()
          }}
        />
      )}

      {depositCreated && (
        <ModalPortal><div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
            <p className="mt-4 text-[11px] font-black uppercase tracking-[.16em] text-violet-600">Deposit order saved</p>
            <h3 className="mt-1 text-2xl font-black text-[#111111]">{depositCreated.deposit_id}</h3>
            <p className="mt-2 text-sm text-[#6B7280]">Deposit {formatCurrency(depositCreated.deposit_amount)} · Balance {formatCurrency(depositCreated.remaining_balance)}</p>
            <div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => printAdvanceReceipt(depositCreated)} className="rounded-xl border border-violet-200 py-3 text-sm font-black text-violet-700"><Printer size={16} className="mr-1 inline"/>Print Receipt</button><button onClick={() => { const msg = buildAdvanceDepositWhatsAppMessage({ customerName: depositCreated.customer_name, depositId: depositCreated.deposit_id, productName: depositCreated.product_name, totalAmount: depositCreated.total_amount, depositAmount: depositCreated.deposit_amount, remainingBalance: depositCreated.remaining_balance, expectedDeliveryDate: depositCreated.expected_delivery_date }); window.open(toWhatsAppUrl(depositCreated.phone, msg), '_blank', 'noopener,noreferrer') }} className="rounded-xl bg-[#25D366] py-3 text-sm font-black text-white"><MessageCircle size={16} className="mr-1 inline -mt-0.5"/>WhatsApp</button></div>
            <button onClick={() => { setDepositCreated(null); searchRef.current?.focus() }} className="mt-3 w-full rounded-xl bg-[#111111] py-3 text-sm font-black text-white">Start New Order</button>
          </div>
        </div></ModalPortal>
      )}

      {catalogOpen && (
        <CatalogModal
          isOpen={catalogOpen}
          onClose={() => setCatalogOpen(false)}
          onAdd={(p) => {
            void addItem(p)
            setCatalogOpen(false)
          }}
        />
      )}

      {addUnregisteredOpen && (
        <AddUnregisteredItemModal
          isOpen={addUnregisteredOpen}
          onClose={() => setAddUnregisteredOpen(false)}
          onSubmit={handleAddUnregisteredItem}
        />
      )}

      {/* Variant Picker Modal for Multi-Variant Products */}
      {variantPickerProduct && (
        <ModalPortal><div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] border border-[#B7E1BE] shadow-2xl overflow-y-auto flex flex-col animate-in zoom-in-95 duration-150">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-[#FBFAF6]">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-[#0A0A0A]">
                  Select Variant / Size
                </h3>
                <p className="text-xs text-gray-500 font-bold">
                  {variantPickerProduct.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVariantPickerProduct(null)
                  setAvailableVariants([])
                }}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <label className="block text-[11px] font-black uppercase tracking-wider text-gray-600">
                  Available Sizes &amp; Options ({availableVariants.length})
                </label>
                <div className="grid grid-cols-2 gap-2.5 max-h-52 overflow-y-auto pr-1">
                  {availableVariants.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => setSelectedVariant(v)}
                      className={`p-3 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                        selectedVariant?.id === v.id
                          ? 'border-[#0A0A0A] bg-[#FFF9E6] shadow-xs'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="font-black text-xs text-gray-900">
                        {v.variantName}
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-1 border-t border-gray-100 text-[11px]">
                        <span className="font-black text-black">₹{v.price}</span>
                        <span className="text-[10px] text-emerald-700 font-bold">Stock: {v.stock}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quantity Stepper */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-[#FBFAF6] border border-gray-200">
                <span className="text-xs font-black uppercase tracking-wider text-gray-700">Quantity</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setVariantPickerQty((q) => Math.max(1, q - 1))}
                    className="w-8 h-8 rounded-xl border border-gray-300 bg-white font-black text-sm flex items-center justify-center hover:bg-gray-100 cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-black text-sm text-black min-w-[20px] text-center">
                    {variantPickerQty}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVariantPickerQty((q) => q + 1)}
                    className="w-8 h-8 rounded-xl border border-gray-300 bg-white font-black text-sm flex items-center justify-center hover:bg-gray-100 cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Add Button */}
              <button
                type="button"
                onClick={addVariantToItems}
                className="w-full py-3 rounded-2xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-xs font-black uppercase tracking-wider hover:bg-[#1A1A1A] transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                Add to Order (₹{((selectedVariant?.price || variantPickerProduct.price || 0) * variantPickerQty).toFixed(2)})
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
