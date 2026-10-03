import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isSupabaseConfigured } from '../lib/supabase'
import { getErrorMessage } from '../lib/errorMessage'
import { supabase } from '../lib/supabase'
import { fetchAllCategories, fetchAllProducts } from '../services/productService'
import { fetchAllVariants, type ProductVariant } from '../services/variantService'
import { BRAND_ACCENT, BRAND_ADDRESS, BRAND_EN, BRAND_PHONE_DISPLAY, BRAND_INSTAGRAM, BRAND_OWNER_NAME } from '../lib/brand'
import {
  normalizeUnitType,
  toNumber,
  type QuantityOption,
  type UnitType,
} from '../lib/retail'
import {
  normalizeHallmarkStatus,
  normalizeItemStatus,
  normalizeMakingChargeType,
  normalizeMetalType,
  normalizeStoneDetails,
  normalizeWastageType,
  type HallmarkStatus,
  type ItemStatus,
  type StoneDetails,
  type MakingChargeType,
  type MetalType,
  type WastageType,
} from '../lib/jewellery'

export type { ProductVariant }

/** Shared state for authentication, products, billing, and settings. */

// --- Types ---
export interface Product {
  id: string | number // Support both legacy numeric IDs and new UUIDs
  name: string
  category: string
  categoryId?: number | string | null
  remedy: string[]
  price: number
  offerPrice?: number | null
  unitType: UnitType
  unitLabel: string
  baseQuantity: number
  stockQuantity: number
  stockUnit: string
  allowDecimalQuantity: boolean
  predefinedOptions: QuantityOption[]
  isActive: boolean
  sortOrder: number
  unit: string
  rating: number
  stock: number
  description: string
  descriptionTa?: string
  benefits: string
  benefitsTa?: string
  image: string
  imageUrl?: string
  source?: 'catalogue' | 'manual'
  note?: string | null
  hasVariants?: boolean
  /** Special offer / free gift configured for this product, e.g. "Buy 1 Get 1 Free" or "Free gift: sample sachet". */
  hasSpecialOffer?: boolean
  specialOfferNote?: string | null
  /** Store's cost of giving away the free gift/offer (for margin tracking), separate from the note text. */
  specialOfferCost?: number | null

  // POS inventory fields
  sku?: string
  barcode?: string
  brand?: string
  purchasePrice?: number
  mrp?: number
  gstPercent?: number
  openingStock?: number
  lowStockAlert?: number
  supplier?: string
  size?: string
  color?: string
  /** Optional expiry date (YYYY-MM-DD). Products without one are never flagged by the expiry alert. */
  expiryDate?: string | null
  /** Optional manufacture date (YYYY-MM-DD), shown alongside the expiry date. */
  mfgDate?: string | null
  /** Optional free-text rack/row storage location (e.g. "Rack 3, Row 2"). */
  location?: string | null

  // Jewellery fields. An item with a gold/silver/platinum metal type is priced
  // from the current metal rate at billing time, not from `price`.
  metalType?: MetalType | null
  purity?: string
  grossWeight?: number
  stoneWeight?: number
  netWeight?: number
  makingCharge?: number
  makingChargeType?: MakingChargeType
  wastage?: number
  wastageType?: WastageType
  stoneCharge?: number
  otherCharge?: number
  huid?: string
  designNumber?: string
  subcategory?: string
  otherWeight?: number
  hallmarkStatus?: HallmarkStatus | null
  stoneDetails?: StoneDetails | null
  /** Where the piece is (available, reserved, under repair...). Only available pieces can be billed. */
  itemStatus?: ItemStatus
}

interface AuthUser {
  id: string
  name: string
  email: string
  mobile?: string
  role: 'admin' | 'customer'
  avatarUrl?: string
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  isAuthenticated: () => boolean
  isAdmin: () => boolean
  setAuth: (user: AuthUser | null) => void
  logout: () => Promise<void>
  initialize: () => Promise<void>
}

interface ProductState {
  products: Product[]
  loading: boolean
  error: string | null
  lastFetch: number
  fetchProducts: (force?: boolean) => Promise<void>
}

export interface StoreSettings {
  name: string
  ownerName: string
  phone: string
  email: string
  address: string
  instagramHandle: string
  gstEnabled: boolean
  lowStockThreshold: number
  /** How many days before a product's expiry date it starts showing under "Expiring Soon". Customizable in Store Settings. */
  expiryAlertDays: number
  logoUrl: string | null
  /** Same image as logoUrl, pre-converted to a base64 data URI so PDF generation (invoicePdf.ts, advanceReceipt.ts) can embed it synchronously without an extra fetch. */
  logoBase64: string | null
  /** Site-wide accent colour (hex). Applied to CSS var(--accent)/var(--accent-dark) everywhere. */
  accentColor: string
  businessType: string
  /** Separate shop/business contact number, distinct from the owner's personal phone. */
  shopContactNumber: string
  /** Shop GSTIN, state and state code, printed on invoices. */
  gstin: string
  stateName: string
  stateCode: string
  posPermissions: PosPermissions
}

/** What staff may do at the counter (configured by admin in Store Settings). */
export interface PosPermissions {
  /** Largest manual discount staff may give, as % of the bill subtotal (0 = none). Admin is not limited. */
  staffMaxDiscountPercent: number
  /** Whether staff may change a scheme type's terms when enrolling a customer. */
  staffCanCustomiseSchemes: boolean
}

export const DEFAULT_POS_PERMISSIONS: PosPermissions = { staffMaxDiscountPercent: 5, staffCanCustomiseSchemes: false }

export const normalizePosPermissions = (raw: unknown): PosPermissions => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const pct = Number(r.staffMaxDiscountPercent)
  return {
    staffMaxDiscountPercent: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : DEFAULT_POS_PERMISSIONS.staffMaxDiscountPercent,
    staffCanCustomiseSchemes: typeof r.staffCanCustomiseSchemes === 'boolean' ? r.staffCanCustomiseSchemes : DEFAULT_POS_PERMISSIONS.staffCanCustomiseSchemes,
  }
}

export interface StoreSettingsInput {
  name: string
  ownerName: string
  phone: string
  email: string
  address: string
  instagramHandle: string
  gstEnabled: boolean
  lowStockThreshold: number
  expiryAlertDays: number
  accentColor: string
  businessType: string
  shopContactNumber: string
  gstin: string
  stateName: string
  stateCode: string
  posPermissions: PosPermissions
}

interface SettingsState {
  settings: StoreSettings | null
  loading: boolean
  saving: boolean
  fetchSettings: () => Promise<void>
  updateSettings: (input: StoreSettingsInput) => Promise<{ error: string | null }>
  uploadLogo: (file: File) => Promise<{ url: string | null; error: string | null }>
  clearLogo: () => Promise<{ error: string | null }>
  changePassword: (role: 'admin' | 'staff', newPassword: string) => Promise<{ error: string | null }>
}

async function urlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

interface VariantStoreState {
  variantsMap: Record<string, ProductVariant[]>
  fetched: boolean
  fetchVariants: () => Promise<void>
  refetchVariants: () => Promise<void>
  getVariants: (productId: string) => ProductVariant[]
  getDefaultVariant: (productId: string) => ProductVariant | null
  hasVariants: (productId: string | number) => boolean
}

interface VariantModalState {
  product: Product | null
  open: boolean
  openVariantModal: (product: Product) => void
  closeVariantModal: () => void
}

type SessionFallback = {
  id?: string
  email?: string | null
  phone?: string | null
  user_metadata?: {
    name?: string
    mobile?: string
  }
}

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>
  }
  return {}
}

const readString = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

const LEGACY_CATEGORY_NAMES = new Set<string>()

const toAuthUser = (profile: unknown, fallback?: SessionFallback): AuthUser => {
  const profileRow = asRecord(profile)
  const fallbackMeta = asRecord(fallback?.user_metadata)
  const email = String(profileRow.email || fallback?.email || '')
  const isAdmin = profileRow.role === 'admin'

  return {
    id: String(profileRow.id || fallback?.id || ''),
    name: String(profileRow.name || fallbackMeta.name || fallback?.email || 'Customer'),
    email,
    mobile: String(profileRow.mobile || fallbackMeta.mobile || fallback?.phone || ''),
    role: isAdmin ? 'admin' : 'customer',
    avatarUrl: readString(profileRow.avatar_url) || undefined,
  }
}

const mapDbProduct = (input: unknown, categoriesById: Record<string, string> = {}): Product => {
  const p = asRecord(input)
  const categoryId = typeof p.category_id === 'string' || typeof p.category_id === 'number' ? p.category_id : null
  const image = readString(p.image_url) || readString(p.image) || '/product-placeholder.svg'
  const remedy = Array.isArray(p.remedy)
    ? p.remedy.filter((entry): entry is string => typeof entry === 'string')
    : []

  return {
    id: String(p.id || ''),
    name: readString(p.name, 'Product'),
    category: categoriesById[String(categoryId)] || (() => {
      const legacyCategory = readString(p.category).trim()
      return LEGACY_CATEGORY_NAMES.has(legacyCategory.toLowerCase()) ? '' : legacyCategory
    })(),
    categoryId,
    remedy,
    price: toNumber(p.price, 0),
    offerPrice: p.offer_price != null ? toNumber(p.offer_price, 0) : null,
    unitType: normalizeUnitType(p.unit_type, 'unit'),
    unitLabel: readString(p.unit_label, 'piece'),
    baseQuantity: toNumber(p.base_quantity, 1),
    stockQuantity: toNumber(p.stock_quantity, 0),
    stockUnit: readString(p.stock_unit, 'piece'),
    allowDecimalQuantity: Boolean(p.allow_decimal_quantity),
    predefinedOptions: Array.isArray(p.predefined_options) ? p.predefined_options as QuantityOption[] : [],
    isActive: p.is_active !== false,
    sortOrder: toNumber(p.sort_order, 0),
    unit: readString(p.unit, '100g'),
    rating: toNumber(p.rating, 4.7),
    stock: Math.floor(toNumber(p.stock_quantity ?? p.stock, 0)),
    description: readString(p.description),
    descriptionTa: readString(p.description_ta),
    benefits: readString(p.benefits),
    benefitsTa: readString(p.benefits_ta),
    image,
    imageUrl: image,
    hasVariants: Boolean(p.has_variants),
    hasSpecialOffer: Boolean(p.has_special_offer),
    specialOfferNote: readString(p.special_offer_note) || null,
    specialOfferCost: p.special_offer_cost != null ? toNumber(p.special_offer_cost, 0) : null,

    // POS inventory mapping
    sku: readString(p.sku),
    barcode: readString(p.barcode),
    brand: readString(p.brand),
    purchasePrice: toNumber(p.purchase_price, 0),
    mrp: toNumber(p.mrp, 0),
    gstPercent: toNumber(p.gst_percent, 0),
    openingStock: toNumber(p.opening_stock, 0),
    lowStockAlert: toNumber(p.low_stock_alert, 5),
    supplier: readString(p.supplier),
    size: readString(p.size),
    color: readString(p.color),
    expiryDate: readString(p.expiry_date) || null,
    mfgDate: readString(p.mfg_date) || null,
    location: readString(p.location) || null,

    metalType: normalizeMetalType(p.metal_type),
    purity: readString(p.purity),
    grossWeight: toNumber(p.gross_weight, 0),
    stoneWeight: toNumber(p.stone_weight, 0),
    netWeight: toNumber(p.net_weight, 0),
    makingCharge: toNumber(p.making_charge, 0),
    makingChargeType: normalizeMakingChargeType(p.making_charge_type),
    wastage: toNumber(p.wastage, 0),
    wastageType: normalizeWastageType(p.wastage_type),
    stoneCharge: toNumber(p.stone_charge, 0),
    otherCharge: toNumber(p.other_charge, 0),
    huid: readString(p.huid),
    designNumber: readString(p.design_number),
    subcategory: readString(p.subcategory),
    otherWeight: toNumber(p.other_weight, 0),
    hallmarkStatus: normalizeHallmarkStatus(p.hallmark_status),
    stoneDetails: normalizeStoneDetails(p.stone_details),
    itemStatus: normalizeItemStatus(p.item_status),
  }
}

// --- Auth Store ---
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get): AuthState => ({
      user: null,
      loading: true,
      isAuthenticated: () => !!get().user,
      isAdmin: () => get().user?.role === 'admin',
      setAuth: (user: AuthUser | null) => set({ user, loading: false }),
      logout: async () => {
        await supabase.auth.signOut()
        set({ user: null, loading: false })
      },
      initialize: async () => {
        set({ loading: true })
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user) {
            let { data: profile } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single()

            const meta = session.user.user_metadata || {}
            const email = session.user.email || ''
            const metaName  = String(meta.full_name || meta.name || (email ? email.split('@')[0] : 'Customer'))
            const metaMobile = String(meta.mobile || meta.phone || '')

            if (!profile) {
              // Bootstrap profile for users signed up before the DB trigger existed
              const role = 'customer'
              const { data: upserted } = await supabase
                .from('profiles')
                .upsert({
                  id: session.user.id,
                  email,
                  name: metaName,
                  mobile: metaMobile,
                  role,
                }, { onConflict: 'id' })
                .select()
                .single()
              profile = upserted
            } else {
              // Profile exists — backfill missing fields from user_metadata
              // (handles users who signed up before phone field was added to the form)
              const needsUpdate: Record<string, string> = {}
              if (!profile.mobile && metaMobile) needsUpdate.mobile = metaMobile
              if (!profile.name   && metaName)   needsUpdate.name   = metaName
              if (!profile.email  && email)       needsUpdate.email  = email

              if (Object.keys(needsUpdate).length > 0) {
                const { data: updated } = await supabase
                  .from('profiles')
                  .update(needsUpdate)
                  .eq('id', session.user.id)
                  .select()
                  .single()
                if (updated) profile = updated
              }
            }

            set({ user: toAuthUser(profile, session.user) })
          } else {
            set({ user: null })
          }
        } catch (e) {
          console.error('Auth init error', e)
        } finally {
          set({ loading: false })
        }
      }
    }),
    { name: 'jewellery-pos-auth' }
  )
)

// --- Product Store ---
export const useProductStore = create<ProductState>((set, get) => ({
  products: [],
  loading: false,
  error: null,
  lastFetch: 0,
  fetchProducts: async (force = false) => {
    if (!force && Date.now() - get().lastFetch < 300000 && get().products.length > 0) return

    if (!isSupabaseConfigured) {
      set({
        products: [],
        loading: false,
        error: 'Supabase is not configured',
        lastFetch: Date.now(),
      })
      return
    }

    set({ loading: true, error: null })
    try {
      const [{ data, error }, { data: categoryData }] = await Promise.all([
        fetchAllProducts(),
        fetchAllCategories(),
      ])

      if (error) throw error

      const categoriesById = Object.fromEntries(
        (categoryData || []).map(category => [String(category.id), String(category.name_en || '').trim()]),
      )
      const normalized = (data || []).map(product => mapDbProduct(product, categoriesById))

      set({ products: normalized, loading: false, lastFetch: Date.now() })
    } catch (err) {
      set({
        error: getErrorMessage(err, 'Unable to fetch products'),
        loading: false,
      })
    }
  }
}))

// --- Variant Store ---
export const useVariantStore = create<VariantStoreState>()((set, get) => ({
  variantsMap: {},
  fetched: false,
  fetchVariants: async () => {
    if (get().fetched) return
    const { data } = await fetchAllVariants()
    const map: Record<string, ProductVariant[]> = {}
    for (const v of data) {
      if (!map[v.productId]) map[v.productId] = []
      map[v.productId].push(v)
    }
    set({ variantsMap: map, fetched: true })
  },
  refetchVariants: async () => {
    set({ fetched: false })
    const { data } = await fetchAllVariants()
    const map: Record<string, ProductVariant[]> = {}
    for (const v of data) {
      if (!map[v.productId]) map[v.productId] = []
      map[v.productId].push(v)
    }
    set({ variantsMap: map, fetched: true })
  },
  getVariants: (productId) => get().variantsMap[String(productId)] || [],
  getDefaultVariant: (productId) => {
    const variants = get().variantsMap[String(productId)] || []
    return variants.find(v => v.isDefault) || variants[0] || null
  },
  hasVariants: (productId) => (get().variantsMap[String(productId)] || []).length > 0,
}))

// --- Variant Selector Modal Store ---
export const useVariantModalStore = create<VariantModalState>()((set) => ({
  product: null,
  open: false,
  openVariantModal: (product) => set({ product, open: true }),
  closeVariantModal: () => set({ open: false, product: null }),
}))

// --- Store Settings State ---
export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: null,
  loading: false,
  saving: false,
  fetchSettings: async () => {
    set({ loading: true })
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('store_settings').select('*').limit(1).single()
      if (!error && data) {
        const logoUrl: string | null = data.logo_url || null
        set({
          settings: {
            name: data.name,
            ownerName: data.owner_name,
            phone: data.phone,
            email: data.email || '',
            address: data.address,
            instagramHandle: String(data.instagram_handle || '').trim().replace(/^@+/, ''),
            gstEnabled: data.gst_enabled,
            lowStockThreshold: Number(data.low_stock_threshold ?? 5),
            expiryAlertDays: Number(data.expiry_alert_days ?? 30),
            logoUrl,
            logoBase64: null,
            accentColor: data.accent_color || BRAND_ACCENT,
            businessType: data.business_type || '',
            shopContactNumber: data.shop_contact_number || '',
            gstin: String(data.gstin || ''),
            stateName: String(data.state_name || ''),
            stateCode: String(data.state_code || ''),
            posPermissions: normalizePosPermissions(data.pos_permissions),
          },
          loading: false
        })
        if (logoUrl) {
          const base64 = await urlToBase64(logoUrl)
          if (base64) {
            set((state) => state.settings ? { settings: { ...state.settings, logoBase64: base64 } } : state)
          }
        }
        return
      }
    }
    // Fallback/Demo settings
    set({
      settings: {
        name: BRAND_EN,
        ownerName: BRAND_OWNER_NAME,
        phone: BRAND_PHONE_DISPLAY,
        email: '',
        address: BRAND_ADDRESS,
        instagramHandle: BRAND_INSTAGRAM,
        gstEnabled: false,
        lowStockThreshold: 5,
        expiryAlertDays: 30,
        logoUrl: null,
        logoBase64: null,
        accentColor: BRAND_ACCENT,
        businessType: '',
        shopContactNumber: '',
        gstin: '',
        stateName: '',
        stateCode: '',
        posPermissions: DEFAULT_POS_PERMISSIONS,
      },
      loading: false
    })
  },
  updateSettings: async (input) => {
    if (!isSupabaseConfigured) {
      set((state) => state.settings ? { settings: { ...state.settings, ...input } } : state)
      return { error: null }
    }
    set({ saving: true })
    const { error } = await supabase.from('store_settings').update({
      name: input.name,
      owner_name: input.ownerName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      instagram_handle: input.instagramHandle,
      gst_enabled: input.gstEnabled,
      low_stock_threshold: input.lowStockThreshold,
      expiry_alert_days: input.expiryAlertDays,
      accent_color: input.accentColor,
      business_type: input.businessType,
      shop_contact_number: input.shopContactNumber,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) { set({ saving: false }); return { error: error.message } }
    // Saved separately: these columns come with the jewellery database update.
    const { error: extraError } = await supabase.from('store_settings').update({
      gstin: input.gstin.trim().toUpperCase(),
      state_name: input.stateName.trim(),
      state_code: input.stateCode.trim(),
      pos_permissions: input.posPermissions,
    }).eq('id', 1)
    set({ saving: false })
    set((state) => state.settings ? { settings: { ...state.settings, ...input, gstin: input.gstin.trim().toUpperCase() } } : state)
    if (extraError) {
      return { error: 'Shop details saved. GSTIN / state / staff permissions need the database update: run supabase/migrations/jewellery_pos.sql again.' }
    }
    return { error: null }
  },
  uploadLogo: async (file) => {
    if (!isSupabaseConfigured) {
      return { url: null, error: 'Supabase is required to upload a logo' }
    }
    const ext = file.name.split('.').pop() || 'png'
    const path = `logo-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('branding').upload(path, file, { upsert: true })
    if (uploadError) return { url: null, error: uploadError.message }
    const { data: pub } = supabase.storage.from('branding').getPublicUrl(path)
    const url = pub.publicUrl
    const { error: dbError } = await supabase.from('store_settings').update({ logo_url: url, updated_at: new Date().toISOString() }).eq('id', 1)
    if (dbError) return { url: null, error: dbError.message }
    const base64 = await urlToBase64(url)
    set((state) => state.settings ? { settings: { ...state.settings, logoUrl: url, logoBase64: base64 } } : state)
    return { url, error: null }
  },
  clearLogo: async () => {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase is required to remove the logo' }
    }
    const { error } = await supabase.from('store_settings').update({ logo_url: null, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) return { error: error.message }
    set((state) => state.settings ? { settings: { ...state.settings, logoUrl: null, logoBase64: null } } : state)
    return { error: null }
  },
  changePassword: async (role, newPassword) => {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase is required to change the password' }
    }
    const column = role === 'admin' ? 'admin_password' : 'staff_password'
    const { error } = await supabase.from('store_settings').update({ [column]: newPassword, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) return { error: error.message }
    return { error: null }
  },
}))

// --- Admin Auth Store ---
export type AdminRole = 'admin' | 'staff' | null

interface AdminAuthState {
  isLoggedIn: boolean
  role: AdminRole
  adminId: string | null
  login: (portalId: string, password: string) => Promise<AdminRole | false>
  logout: () => void
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      role: null,
      adminId: null,
      login: async (portalId: string, password: string) => {
        const trimmedId = String(portalId || '').trim()
        const trimmedPass = String(password || '').trim()

        // DB-stored credentials (set via Store Settings > Change Password) take priority
        // over .env when present, so a password change actually takes effect.
        let dbRow: { admin_id?: string | null; admin_password?: string | null; staff_id?: string | null; staff_password?: string | null } | null = null
        if (isSupabaseConfigured) {
          const { data } = await supabase.from('store_settings').select('admin_id, admin_password, staff_id, staff_password').eq('id', 1).maybeSingle()
          dbRow = data
        }

        // 1. Check Admin Credentials (DB override, else VITE_ADMIN_ID/VITE_PORTAL_ID, else 'admin')
        const adminId = String(dbRow?.admin_id || import.meta.env.VITE_ADMIN_ID || import.meta.env.VITE_PORTAL_ID || 'admin').trim()
        const adminPass = String(dbRow?.admin_password || import.meta.env.VITE_ADMIN_PASSWORD || import.meta.env.VITE_PORTAL_PASSWORD || 'admin123').trim()

        if (trimmedId === adminId && trimmedPass === adminPass) {
          set({ isLoggedIn: true, role: 'admin', adminId: trimmedId })
          return 'admin'
        }

        // 2. Check Staff Credentials (DB override, else VITE_STAFF_ID, else 'staff')
        const staffId = String(dbRow?.staff_id || import.meta.env.VITE_STAFF_ID || 'staff').trim()
        const staffPass = String(dbRow?.staff_password || import.meta.env.VITE_STAFF_PASSWORD || 'staff123').trim()

        if (trimmedId === staffId && trimmedPass === staffPass) {
          set({ isLoggedIn: true, role: 'staff', adminId: trimmedId })
          return 'staff'
        }

        return false
      },
      logout: () => set({ isLoggedIn: false, role: null, adminId: null }),
    }),
    {
      name: 'jewellery-pos-admin-session',
      // Using sessionStorage so the session is cleared when the tab is closed
      storage: {
        getItem: (name) => {
          const str = sessionStorage.getItem(name)
          if (!str) return null
          return JSON.parse(str)
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value))
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name)
        }
      }
    }
  )
)
