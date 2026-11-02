import { supabase } from '../lib/supabase'
import { CARAT_TO_GRAMS, isDiamondKind, type StoneDetails, type StonePriceBasis } from '../lib/jewellery'
import { useAdminAuthStore } from '../store/store'

/** Price lists for stones. Metals keep their own rate table (Metal Rates). */
export type MaterialCategory = 'diamond' | 'gemstone' | 'pearl' | 'traditional'
export type PricingUnit = 'per_carat' | 'per_stone' | 'per_piece' | 'per_strand' | 'per_set' | 'per_gram' | 'per_lot' | 'fixed'

export const CATEGORY_LABELS: Record<MaterialCategory, string> = {
  diamond: 'Diamonds', gemstone: 'Gemstones', pearl: 'Pearls', traditional: 'Traditional',
}
export const UNIT_LABELS: Record<PricingUnit, string> = {
  per_carat: 'Per carat', per_stone: 'Per stone', per_piece: 'Per piece', per_strand: 'Per strand', per_set: 'Per set',
  per_gram: 'Per gram', per_lot: 'Per lot', fixed: 'Fixed price',
}

/** What each category offers: names, origin types, pricing units and the grading fields that apply. */
export const CATEGORY_CONFIG: Record<MaterialCategory, {
  names: string[]
  origins: Array<[string, string]>
  units: PricingUnit[]
  specs: Array<{ key: string; label: string; options?: string[] }>
  caratRange: boolean
}> = {
  diamond: {
    names: ['Diamond'],
    origins: [['natural', 'Natural'], ['lab_grown', 'Lab-grown'], ['simulated', 'Simulated']],
    units: ['per_carat', 'per_stone', 'per_lot', 'fixed'],
    specs: [
      { key: 'shape', label: 'Shape', options: ['Round', 'Princess', 'Oval', 'Pear', 'Emerald', 'Cushion', 'Marquise', 'Radiant', 'Heart', 'Asscher', 'Baguette', 'Trillion'] },
      { key: 'colour', label: 'Colour', options: ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'Fancy'] },
      { key: 'clarity', label: 'Clarity', options: ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2', 'I1', 'I2', 'I3'] },
      { key: 'cut', label: 'Cut', options: ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'] },
      { key: 'polish', label: 'Polish', options: ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'] },
      { key: 'symmetry', label: 'Symmetry', options: ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'] },
      { key: 'fluorescence', label: 'Fluorescence', options: ['None', 'Faint', 'Medium', 'Strong', 'Very Strong'] },
      { key: 'lab', label: 'Certified by', options: ['GIA', 'IGI', 'HRD', 'SGL', 'GSI'] },
    ],
    caratRange: true,
  },
  gemstone: {
    names: ['Ruby', 'Emerald', 'Blue Sapphire', 'Yellow Sapphire', 'Pink Sapphire', 'Sapphire (other)', 'Amethyst', 'Topaz', 'Aquamarine', 'Garnet',
      'Peridot', 'Tourmaline', 'Tanzanite', 'Opal', 'Spinel', 'Alexandrite', 'Jade', 'Turquoise', 'Lapis Lazuli', 'Onyx', 'Citrine', 'Moonstone', 'Hessonite', 'Cat\'s Eye', 'Coral'],
    origins: [['natural', 'Natural'], ['synthetic', 'Synthetic'], ['lab_grown', 'Lab-grown'], ['imitation', 'Imitation']],
    units: ['per_carat', 'per_stone', 'per_lot', 'fixed'],
    specs: [
      { key: 'shape', label: 'Shape', options: ['Round', 'Oval', 'Cushion', 'Pear', 'Emerald', 'Heart', 'Marquise', 'Cabochon', 'Bead'] },
      { key: 'cut', label: 'Cut', options: ['Faceted', 'Cabochon', 'Bead', 'Carved'] },
      { key: 'colour', label: 'Colour' },
      { key: 'clarity', label: 'Clarity', options: ['Eye clean', 'Slightly included', 'Included', 'Heavily included'] },
      { key: 'origin', label: 'Origin (country / mine)' },
      { key: 'treatment', label: 'Treatment', options: ['None', 'Heated', 'Oiled', 'Glass filled', 'Diffused', 'Irradiated'] },
    ],
    caratRange: true,
  },
  pearl: {
    names: ['Natural Pearl', 'Cultured Pearl', 'Freshwater Pearl', 'Akoya Pearl', 'South Sea Pearl', 'Tahitian Pearl', 'Basra Pearl'],
    origins: [['natural', 'Natural'], ['cultured', 'Cultured'], ['imitation', 'Imitation']],
    units: ['per_piece', 'per_strand', 'per_lot', 'fixed'],
    specs: [
      { key: 'size_mm', label: 'Size (mm)' },
      { key: 'shape', label: 'Shape', options: ['Round', 'Near round', 'Oval', 'Button', 'Drop', 'Baroque', 'Semi-baroque'] },
      { key: 'colour', label: 'Colour' },
      { key: 'overtone', label: 'Overtone' },
      { key: 'lustre', label: 'Lustre', options: ['Excellent', 'Very Good', 'Good', 'Fair'] },
      { key: 'surface', label: 'Surface', options: ['Clean', 'Lightly spotted', 'Moderately spotted', 'Heavily spotted'] },
      { key: 'nacre', label: 'Nacre', options: ['Thick', 'Medium', 'Thin'] },
      { key: 'origin', label: 'Origin' },
    ],
    caratRange: false,
  },
  traditional: {
    names: ['Polki', 'Kundan', 'Jadau', 'Navaratna', 'Meenakari', 'Uncut diamond'],
    origins: [],
    units: ['per_stone', 'per_carat', 'per_gram', 'per_piece', 'per_set', 'per_lot', 'fixed'],
    specs: [
      { key: 'quality', label: 'Quality / grade' },
      { key: 'finish', label: 'Finish / work' },
    ],
    caratRange: true,
  },
}

export interface MaterialRate {
  id: string
  rateKey: string
  category: MaterialCategory
  name: string
  variety: string
  originType: string
  specs: Record<string, string>
  caratMin: number | null
  caratMax: number | null
  pricingUnit: PricingUnit
  price: number
  effectiveFrom: string
  supplier: string
  notes: string
  status: 'active' | 'inactive'
  createdBy: string
  createdAt: string
}

const str = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const toError = (error: { message?: string } | null, fallback: string) => {
  const msg = error?.message || ''
  if (/material_rates|loose_stone|gem_certificates|stone_price_overrides|move_loose_stone|set_certificate_status/.test(msg) && /does not exist|schema cache|not find/i.test(msg)) {
    return new Error('This needs the database update: run supabase/migrations/jewellery_pos.sql again in the Supabase SQL Editor.')
  }
  return new Error(msg || fallback)
}
const who = () => {
  const s = useAdminAuthStore.getState()
  return s.staffName || (s.role === 'admin' ? 'Admin' : s.role === 'staff' ? 'Staff' : 'Admin')
}

const mapRate = (r: Record<string, unknown>): MaterialRate => ({
  id: str(r.id), rateKey: str(r.rate_key), category: str(r.category) as MaterialCategory, name: str(r.name), variety: str(r.variety),
  originType: str(r.origin_type), specs: (r.specs && typeof r.specs === 'object' ? r.specs : {}) as Record<string, string>,
  caratMin: num(r.carat_min), caratMax: num(r.carat_max), pricingUnit: str(r.pricing_unit) as PricingUnit, price: Number(r.price) || 0,
  effectiveFrom: str(r.effective_from), supplier: str(r.supplier), notes: str(r.notes), status: r.status === 'inactive' ? 'inactive' : 'active',
  createdBy: str(r.created_by), createdAt: str(r.created_at),
})

/** Same key = same kind of stone and grade; a new price for it is a new version of that key. */
export const buildRateKey = (r: Pick<MaterialRate, 'category' | 'name' | 'variety' | 'originType' | 'specs' | 'caratMin' | 'caratMax' | 'pricingUnit'>) => {
  const specs = Object.keys(r.specs).filter((k) => str(r.specs[k])).sort().map((k) => `${k}=${str(r.specs[k]).toLowerCase()}`).join(',')
  return [r.category, r.name.toLowerCase(), r.variety.toLowerCase(), r.originType, specs, r.caratMin ?? '', r.caratMax ?? '', r.pricingUnit].join('|')
}

/** Newest version of each key whose date has come (scheduled ones are left out). */
export function currentRates(rates: MaterialRate[], at = new Date()) {
  const latest = new Map<string, MaterialRate>()
  for (const r of rates) {
    if (new Date(r.effectiveFrom) > at) continue
    const prev = latest.get(r.rateKey)
    if (!prev || r.effectiveFrom > prev.effectiveFrom) latest.set(r.rateKey, r)
  }
  return [...latest.values()]
}

/** Category, name and origin a stone line is priced under. */
export function stoneLookup(d: StoneDetails): { category: MaterialCategory; name: string; origin: string } | null {
  if (isDiamondKind(d.kind) || d.kind === 'simulant') {
    return { category: 'diamond', name: 'Diamond', origin: d.kind === 'lab_diamond' ? 'lab_grown' : d.kind === 'simulant' ? 'simulated' : 'natural' }
  }
  if (d.kind === 'gemstone') return { category: 'gemstone', name: d.type, origin: d.origin }
  if (d.kind === 'pearl') return { category: 'pearl', name: d.type || d.variety, origin: d.origin }
  if (d.kind === 'traditional') return { category: 'traditional', name: d.type, origin: '' }
  return null
}

const lineSpec = (d: StoneDetails, key: string) => {
  const map: Record<string, string> = {
    shape: d.shape, colour: d.colour, clarity: d.clarity, cut: d.cut, polish: d.polish, symmetry: d.symmetry, fluorescence: d.fluorescence,
    lab: d.lab, treatment: d.treatment, size_mm: d.measurements, lustre: d.lustre, overtone: d.overtone, surface: d.surface, nacre: d.nacre,
    // traditional work: grade is kept in the clarity box, finish in the cut box
    quality: d.clarity, finish: d.cut,
  }
  return str(map[key])
}

export type RateMatch =
  | { ok: true; rate: MaterialRate; basis: StonePriceBasis; unitRate: number; value: number }
  | { ok: false; reason: string }

/**
 * Finds the price-list rate for a stone line. A rate applies only when its category, name and origin
 * match and every grade it names matches the line; the carat range is checked per stone.
 * The most specific match wins. Nothing falls back to another stone's rate or the metal rate.
 */
export function findStoneRate(d: StoneDetails, rates: MaterialRate[]): RateMatch {
  const look = stoneLookup(d)
  if (!look) return { ok: false, reason: 'This stone kind has no price list.' }
  if (look.category !== 'diamond' && !look.name.trim()) return { ok: false, reason: 'Enter the stone name first (e.g. Ruby).' }
  const perStoneCarat = d.carat > 0 ? d.carat / Math.max(1, d.count || 1) : 0
  const candidates = currentRates(rates).filter((r) => {
    if (r.status !== 'active' || r.category !== look.category) return false
    if (look.category !== 'diamond' && r.name.toLowerCase() !== look.name.trim().toLowerCase()) return false
    if (r.originType && look.origin && r.originType !== look.origin) return false
    if (r.originType && !look.origin && look.category !== 'diamond') return false
    if (look.category === 'diamond' && r.originType && r.originType !== look.origin) return false
    if (r.variety && r.variety.toLowerCase() !== d.variety.trim().toLowerCase()) return false
    for (const [k, v] of Object.entries(r.specs)) {
      if (!str(v)) continue
      // A rate for a place of origin (e.g. Burma) only fits stones whose variety / origin says so
      if (k === 'origin') { if (!d.variety.toLowerCase().includes(str(v).toLowerCase())) return false; continue }
      if (lineSpec(d, k).toLowerCase() !== str(v).toLowerCase()) return false
    }
    if ((r.caratMin !== null || r.caratMax !== null)) {
      if (perStoneCarat <= 0) return false
      if (r.caratMin !== null && perStoneCarat < r.caratMin - 1e-9) return false
      if (r.caratMax !== null && perStoneCarat > r.caratMax + 1e-9) return false
    }
    return true
  })
  if (!candidates.length) {
    const label = look.category === 'diamond' ? `${look.origin.replace('_', '-')} diamond` : look.name
    return { ok: false, reason: `No active price-list rate matches this ${label}${perStoneCarat ? ` (${perStoneCarat.toFixed(3)} ct each)` : ''}. Add one in Metal Rates → ${CATEGORY_LABELS[look.category]}, or enter a negotiated price with a reason.` }
  }
  const score = (r: MaterialRate) => Object.values(r.specs).filter((v) => str(v)).length * 2 + (r.caratMin !== null || r.caratMax !== null ? 1 : 0) + (r.variety ? 1 : 0) + (r.originType ? 1 : 0)
  candidates.sort((a, b) => score(b) - score(a) || (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
  const rate = candidates[0]
  // Convert the list unit to the line's price method
  if (rate.pricingUnit === 'per_carat') return { ok: true, rate, basis: 'per_carat', unitRate: rate.price, value: Math.round(d.carat * rate.price * 100) / 100 }
  if (rate.pricingUnit === 'per_gram') {
    const perCarat = Math.round(rate.price * CARAT_TO_GRAMS * 100) / 100
    return { ok: true, rate, basis: 'per_carat', unitRate: perCarat, value: Math.round(d.carat * perCarat * 100) / 100 }
  }
  if (rate.pricingUnit === 'per_lot' || rate.pricingUnit === 'fixed') return { ok: true, rate, basis: 'total', unitRate: rate.price, value: rate.price }
  return { ok: true, rate, basis: 'per_stone', unitRate: rate.price, value: Math.round(Math.max(1, d.count || 0) * rate.price * 100) / 100 }
}

export const materialRateService = {
  async list(): Promise<MaterialRate[]> {
    const { data, error } = await supabase.from('material_rates').select('*').order('effective_from', { ascending: false }).limit(5000)
    if (error) throw toError(error, 'Unable to load price lists')
    return (data || []).map((r) => mapRate(r as Record<string, unknown>))
  },
  /** Adds a rate (or a new price for an existing key — the old one stays in the history). */
  async add(input: Omit<MaterialRate, 'id' | 'rateKey' | 'createdBy' | 'createdAt' | 'status'> & { status?: 'active' | 'inactive' }): Promise<MaterialRate> {
    if (!(input.price > 0)) throw new Error('Enter a price above ₹0.')
    if (!input.name.trim()) throw new Error('Enter the stone / material name.')
    if (input.caratMin !== null && input.caratMax !== null && input.caratMin > input.caratMax) throw new Error('The carat "from" must not be more than "to".')
    if ((input.caratMin ?? 0) < 0 || (input.caratMax ?? 0) < 0) throw new Error('Carat values cannot be negative.')
    const specs = Object.fromEntries(Object.entries(input.specs).filter(([, v]) => str(v)).map(([k, v]) => [k, str(v)]))
    const row = { ...input, specs, name: input.name.trim(), variety: input.variety.trim() }
    const { data, error } = await supabase.from('material_rates').insert({
      rate_key: buildRateKey(row), category: row.category, name: row.name, variety: row.variety, origin_type: row.originType, specs,
      carat_min: row.caratMin, carat_max: row.caratMax, pricing_unit: row.pricingUnit, price: row.price,
      effective_from: row.effectiveFrom || new Date().toISOString(), supplier: row.supplier.trim(), notes: row.notes.trim(),
      status: row.status || 'active', created_by: who(),
    }).select('*').single()
    if (error) throw toError(error, 'Unable to save the rate')
    return mapRate(data as Record<string, unknown>)
  },
  async setStatus(id: string, status: 'active' | 'inactive'): Promise<MaterialRate> {
    const { data, error } = await supabase.from('material_rates').update({ status }).eq('id', id).select('*').single()
    if (error) throw toError(error, 'Unable to change the rate')
    return mapRate(data as Record<string, unknown>)
  },
}

// ── Price overrides ─────────────────────────────────────────────────────────
export interface PriceOverride {
  id: string; productId: number | null; productName: string; invoiceNo: string; stoneLabel: string; rateId: string | null
  listPrice: number | null; overridePrice: number; pricingUnit: string; reason: string; overriddenBy: string; createdAt: string
}
export const overrideService = {
  async log(rows: Array<Omit<PriceOverride, 'id' | 'createdAt' | 'overriddenBy'>>): Promise<void> {
    if (!rows.length) return
    const { error } = await supabase.from('stone_price_overrides').insert(rows.map((r) => ({
      product_id: r.productId, product_name: r.productName, invoice_no: r.invoiceNo, stone_label: r.stoneLabel, rate_id: r.rateId || null,
      list_price: r.listPrice, override_price: r.overridePrice, pricing_unit: r.pricingUnit, reason: r.reason, overridden_by: who(),
    })))
    if (error) throw toError(error, 'Unable to record the price override')
  },
  async list(): Promise<PriceOverride[]> {
    const { data, error } = await supabase.from('stone_price_overrides').select('*').order('created_at', { ascending: false }).limit(2000)
    if (error) throw toError(error, 'Unable to load price overrides')
    return (data || []).map((r: Record<string, unknown>) => ({
      id: str(r.id), productId: r.product_id == null ? null : Number(r.product_id), productName: str(r.product_name), invoiceNo: str(r.invoice_no),
      stoneLabel: str(r.stone_label), rateId: r.rate_id ? str(r.rate_id) : null, listPrice: num(r.list_price), overridePrice: Number(r.override_price) || 0,
      pricingUnit: str(r.pricing_unit), reason: str(r.reason), overriddenBy: str(r.overridden_by), createdAt: str(r.created_at),
    }))
  },
}

// ── Loose stones ────────────────────────────────────────────────────────────
export type LooseStatus = 'available' | 'reserved' | 'sold' | 'used_in_jewellery' | 'returned' | 'damaged'
export const LOOSE_STATUS_LABELS: Record<LooseStatus, string> = {
  available: 'Available', reserved: 'Reserved', sold: 'Sold', used_in_jewellery: 'Used in jewellery', returned: 'Returned', damaged: 'Damaged',
}
export type LooseAction = 'reserve' | 'unreserve' | 'sell' | 'use' | 'return' | 'damage' | 'adjust'
export interface LooseStone {
  id: string; stoneCode: string; category: MaterialCategory; name: string; variety: string; originType: string; specs: Record<string, string>
  isLot: boolean; quantity: number; carat: number; quantityBought: number; caratBought: number; costPrice: number; sellingPrice: number
  supplier: string; purchaseDate: string | null; lab: string; certificateNo: string; status: LooseStatus; productId: number | null
  notes: string; createdAt: string; updatedAt: string
}
export interface LooseMovement { id: string; action: string; quantity: number; carat: number; productId: number | null; reference: string; note: string; createdBy: string; createdAt: string }
const mapLoose = (r: Record<string, unknown>): LooseStone => ({
  id: str(r.id), stoneCode: str(r.stone_code), category: str(r.category) as MaterialCategory, name: str(r.name), variety: str(r.variety),
  originType: str(r.origin_type), specs: (r.specs && typeof r.specs === 'object' ? r.specs : {}) as Record<string, string>, isLot: Boolean(r.is_lot),
  quantity: Number(r.quantity) || 0, carat: Number(r.carat) || 0, quantityBought: Number(r.quantity_bought) || 0, caratBought: Number(r.carat_bought) || 0,
  costPrice: Number(r.cost_price) || 0, sellingPrice: Number(r.selling_price) || 0, supplier: str(r.supplier), purchaseDate: r.purchase_date ? str(r.purchase_date).slice(0, 10) : null,
  lab: str(r.lab), certificateNo: str(r.certificate_no), status: str(r.status) as LooseStatus, productId: r.product_id == null ? null : Number(r.product_id),
  notes: str(r.notes), createdAt: str(r.created_at), updatedAt: str(r.updated_at),
})
export const looseStoneService = {
  async list(): Promise<LooseStone[]> {
    const { data, error } = await supabase.from('loose_stones').select('*').order('created_at', { ascending: false }).limit(5000)
    if (error) throw toError(error, 'Unable to load loose stones')
    return (data || []).map((r) => mapLoose(r as Record<string, unknown>))
  },
  async create(input: Omit<LooseStone, 'id' | 'status' | 'productId' | 'createdAt' | 'updatedAt' | 'quantityBought' | 'caratBought'>): Promise<LooseStone> {
    if (!input.stoneCode.trim()) throw new Error('Enter a stone / lot code.')
    if (!input.name.trim()) throw new Error('Enter the stone name.')
    if (input.quantity < 0 || input.carat < 0 || input.costPrice < 0 || input.sellingPrice < 0) throw new Error('Quantity, carat and prices cannot be negative.')
    if (input.quantity <= 0 && input.carat <= 0) throw new Error('Enter the quantity or carat weight.')
    const { data, error } = await supabase.from('loose_stones').insert({
      stone_code: input.stoneCode.trim(), category: input.category, name: input.name.trim(), variety: input.variety.trim(), origin_type: input.originType,
      specs: input.specs, is_lot: input.isLot, quantity: input.quantity, carat: input.carat, quantity_bought: input.quantity, carat_bought: input.carat,
      cost_price: input.costPrice, selling_price: input.sellingPrice, supplier: input.supplier.trim(), purchase_date: input.purchaseDate || null,
      lab: input.lab.trim(), certificate_no: input.certificateNo.trim(), notes: input.notes.trim(), created_by: who(),
    }).select('*').single()
    if (error) {
      if (/duplicate|unique/i.test(error.message || '')) throw new Error(`Stone code ${input.stoneCode} is already used.`)
      throw toError(error, 'Unable to save the stone')
    }
    const stone = mapLoose(data as Record<string, unknown>)
    await supabase.rpc('move_loose_stone', { p_stone_id: stone.id, p_action: 'adjust', p_quantity: stone.quantity, p_carat: stone.carat, p_reference: 'Received', p_note: 'Stock received', p_by: who() })
    return stone
  },
  async update(id: string, patch: { name: string; variety: string; originType: string; specs: Record<string, string>; costPrice: number; sellingPrice: number; supplier: string; lab: string; certificateNo: string; notes: string }): Promise<LooseStone> {
    const { data, error } = await supabase.from('loose_stones').update({
      name: patch.name.trim(), variety: patch.variety.trim(), origin_type: patch.originType, specs: patch.specs, cost_price: patch.costPrice,
      selling_price: patch.sellingPrice, supplier: patch.supplier.trim(), lab: patch.lab.trim(), certificate_no: patch.certificateNo.trim(), notes: patch.notes.trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('*').single()
    if (error) throw toError(error, 'Unable to save the stone')
    return mapLoose(data as Record<string, unknown>)
  },
  async move(id: string, action: LooseAction, opts: { quantity?: number; carat?: number; productId?: number | null; reference?: string; note?: string } = {}): Promise<LooseStone> {
    const { data, error } = await supabase.rpc('move_loose_stone', {
      p_stone_id: id, p_action: action, p_quantity: opts.quantity ?? null, p_carat: opts.carat ?? null, p_product_id: opts.productId ?? null,
      p_reference: opts.reference || '', p_note: opts.note || '', p_by: who(),
    })
    if (error) throw toError(error, 'Unable to update the stock')
    return mapLoose((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
  async movements(id: string): Promise<LooseMovement[]> {
    const { data, error } = await supabase.from('loose_stone_movements').select('*').eq('stone_id', id).order('created_at', { ascending: false })
    if (error) throw toError(error, 'Unable to load the stone history')
    return (data || []).map((r: Record<string, unknown>) => ({
      id: str(r.id), action: str(r.action), quantity: Number(r.quantity) || 0, carat: Number(r.carat) || 0, productId: r.product_id == null ? null : Number(r.product_id),
      reference: str(r.reference), note: str(r.note), createdBy: str(r.created_by), createdAt: str(r.created_at),
    }))
  },
}

// ── Certificates ────────────────────────────────────────────────────────────
export type CertStatus = 'pending' | 'uploaded' | 'verified' | 'rejected' | 'expired'
export const CERT_STATUS_LABELS: Record<CertStatus, string> = { pending: 'Pending', uploaded: 'Uploaded', verified: 'Verified', rejected: 'Rejected', expired: 'Expired' }
export interface GemCertificate {
  id: string; certificateNo: string; lab: string; issueDate: string | null; expiryDate: string | null; fileUrl: string; labUrl: string
  looseStoneId: string | null; productId: number | null; stoneDescription: string; status: CertStatus; verifiedBy: string | null
  verifiedAt: string | null; notes: string; createdAt: string
}
const mapCert = (r: Record<string, unknown>): GemCertificate => ({
  id: str(r.id), certificateNo: str(r.certificate_no), lab: str(r.lab), issueDate: r.issue_date ? str(r.issue_date).slice(0, 10) : null,
  expiryDate: r.expiry_date ? str(r.expiry_date).slice(0, 10) : null, fileUrl: str(r.file_url), labUrl: str(r.lab_url),
  looseStoneId: r.loose_stone_id ? str(r.loose_stone_id) : null, productId: r.product_id == null ? null : Number(r.product_id),
  stoneDescription: str(r.stone_description), status: str(r.status) as CertStatus, verifiedBy: r.verified_by ? str(r.verified_by) : null,
  verifiedAt: r.verified_at ? str(r.verified_at) : null, notes: str(r.notes), createdAt: str(r.created_at),
})
export const certificateService = {
  async list(): Promise<GemCertificate[]> {
    const { data, error } = await supabase.from('gem_certificates').select('*').order('created_at', { ascending: false }).limit(5000)
    if (error) throw toError(error, 'Unable to load certificates')
    return (data || []).map((r) => mapCert(r as Record<string, unknown>))
  },
  async uploadFile(file: File): Promise<string> {
    if (file.size > 10 * 1024 * 1024) throw new Error('The file must be under 10 MB.')
    if (!/^(image\/|application\/pdf)/.test(file.type)) throw new Error('Upload a PDF or an image.')
    const path = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    const { error } = await supabase.storage.from('certificates').upload(path, file, { upsert: false, contentType: file.type })
    if (error) throw new Error(/bucket/i.test(error.message) ? 'Certificate storage needs the database update: run supabase/migrations/jewellery_pos.sql again.' : error.message)
    return supabase.storage.from('certificates').getPublicUrl(path).data.publicUrl
  },
  async save(input: { id?: string; certificateNo: string; lab: string; issueDate: string | null; expiryDate: string | null; fileUrl: string; labUrl: string; looseStoneId: string | null; productId: number | null; stoneDescription: string; notes: string }): Promise<GemCertificate> {
    if (!input.certificateNo.trim()) throw new Error('Enter the certificate number.')
    if (input.issueDate && input.expiryDate && input.expiryDate < input.issueDate) throw new Error('The expiry date is before the issue date.')
    const row = {
      certificate_no: input.certificateNo.trim(), lab: input.lab.trim(), issue_date: input.issueDate || null, expiry_date: input.expiryDate || null,
      file_url: input.fileUrl, lab_url: input.labUrl.trim(), loose_stone_id: input.looseStoneId, product_id: input.productId,
      stone_description: input.stoneDescription.trim(), notes: input.notes.trim(),
    }
    const q = input.id
      ? supabase.from('gem_certificates').update(row).eq('id', input.id)
      : supabase.from('gem_certificates').insert({ ...row, status: input.fileUrl ? 'uploaded' : 'pending', created_by: who() })
    const { data, error } = await q.select('*').single()
    if (error) {
      if (/duplicate|unique/i.test(error.message || '')) throw new Error(`Certificate ${input.lab} ${input.certificateNo} is already saved.`)
      throw toError(error, 'Unable to save the certificate')
    }
    return mapCert(data as Record<string, unknown>)
  },
  async setStatus(id: string, status: CertStatus, note = ''): Promise<GemCertificate> {
    const { data, error } = await supabase.rpc('set_certificate_status', { p_id: id, p_status: status, p_by: who(), p_note: note })
    if (error) throw toError(error, 'Unable to change the certificate status')
    return mapCert((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
}
