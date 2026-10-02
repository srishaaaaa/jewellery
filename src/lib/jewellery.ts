// Kept local (same behaviour as retail.ts) so retail.ts can import this module without a cycle.
const roundTo = (value: number, places = 2) => {
  const factor = 10 ** places
  return Math.round((value + Number.EPSILON) * factor) / factor
}

const toNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * Jewellery pricing, metal-rate resolution and savings-scheme rules.
 *
 * A jewellery item never stores a selling price. Its price is calculated when
 * it is billed:
 *   metal value = net weight x current metal rate
 *   price       = metal value + making + wastage + stone + other charges
 * The bill then keeps a snapshot of every number used, so an old invoice
 * never changes when today's rate changes.
 */

// ── Metals & purities ──────────────────────────────────────────────────────
export type MetalType = 'gold' | 'silver' | 'platinum' | 'other'
export type RatedMetal = 'gold' | 'silver' | 'platinum'
export type MakingChargeType = 'per_gram' | 'percentage' | 'fixed'
export type WastageType = 'percentage' | 'grams'

export const METAL_TYPES: MetalType[] = ['gold', 'silver', 'platinum', 'other']
export const RATED_METALS: RatedMetal[] = ['gold', 'silver', 'platinum']
export const GOLD_PURITIES = ['24K', '22K', '20K', '18K', '14K'] as const
/** Purity key used for the single silver / platinum rate. */
export const STANDARD_PURITY = 'STANDARD'
export const CUSTOM_PURITY = 'Custom'

export const METAL_LABELS: Record<MetalType, string> = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
  other: 'Other',
}

export const MAKING_CHARGE_TYPE_LABELS: Record<MakingChargeType, string> = {
  per_gram: 'Per Gram',
  percentage: 'Percentage',
  fixed: 'Fixed',
}

export const WASTAGE_TYPE_LABELS: Record<WastageType, string> = {
  percentage: 'Percentage',
  grams: 'Grams',
}

/** Every rate the Metal Rates page manages, in display order. */
export const RATE_SLOTS: Array<{ metal: RatedMetal; purity: string }> = [
  ...GOLD_PURITIES.map((purity) => ({ metal: 'gold' as const, purity })),
  { metal: 'silver', purity: STANDARD_PURITY },
  { metal: 'platinum', purity: STANDARD_PURITY },
]

export const normalizeMetalType = (value: unknown): MetalType | null => {
  const raw = String(value ?? '').trim().toLowerCase()
  return (METAL_TYPES as string[]).includes(raw) ? (raw as MetalType) : null
}

export const isRatedMetal = (metal: MetalType | null | undefined): metal is RatedMetal =>
  metal === 'gold' || metal === 'silver' || metal === 'platinum'

export const normalizeMakingChargeType = (value: unknown): MakingChargeType => {
  const raw = String(value ?? '').trim().toLowerCase()
  return raw === 'per_gram' || raw === 'percentage' ? raw : 'fixed'
}

export const normalizeWastageType = (value: unknown): WastageType =>
  String(value ?? '').trim().toLowerCase() === 'grams' ? 'grams' : 'percentage'

/** "Gold 22K", "Silver", "Platinum". */
export const metalLabel = (metal: MetalType | null | undefined, purity?: string | null) => {
  if (!metal) return ''
  const base = METAL_LABELS[metal]
  const p = String(purity || '').trim()
  return p && p !== STANDARD_PURITY ? `${base} ${p}` : base
}

export const formatWeight = (grams: number) => `${roundTo(toNumber(grams, 0), 3).toFixed(3)} g`

// ── Metal rates ────────────────────────────────────────────────────────────
export interface MetalRate {
  id: number
  metalType: RatedMetal
  purity: string
  ratePerGram: number
  effectiveFrom: string
  createdBy: string
  note: string
  createdAt: string
}

/** Latest active rate per metal/purity, keyed by rateKey(). */
export type CurrentRates = Record<string, MetalRate>

export const rateKey = (metal: string, purity: string) => `${metal}:${purity}`

export const mapMetalRateRow = (row: Record<string, unknown>): MetalRate => ({
  id: toNumber(row.id, 0),
  metalType: String(row.metal_type) as RatedMetal,
  purity: String(row.purity || STANDARD_PURITY),
  ratePerGram: toNumber(row.rate_per_gram, 0),
  effectiveFrom: String(row.effective_from || row.created_at || ''),
  createdBy: String(row.created_by || ''),
  note: String(row.note || ''),
  createdAt: String(row.created_at || ''),
})

/** Reduces rate history rows to the current (latest effective, not in the future) rate per slot. */
export const pickCurrentRates = (rows: MetalRate[], now: Date = new Date()): CurrentRates => {
  const current: CurrentRates = {}
  const nowMs = now.getTime()
  for (const row of rows) {
    const effectiveMs = new Date(row.effectiveFrom).getTime()
    if (!Number.isFinite(effectiveMs) || effectiveMs > nowMs) continue
    const key = rateKey(row.metalType, row.purity)
    const existing = current[key]
    if (
      !existing
      || effectiveMs > new Date(existing.effectiveFrom).getTime()
      || (effectiveMs === new Date(existing.effectiveFrom).getTime() && row.id > existing.id)
    ) {
      current[key] = row
    }
  }
  return current
}

/** Karat number for a purity like "22K", "19k" or a fineness like "916" / "750". */
export const purityToKarat = (purity: string): number | null => {
  const raw = String(purity || '').trim().toUpperCase()
  const karat = raw.match(/^(\d{1,2}(?:\.\d+)?)\s*K(?:T)?$/)
  if (karat) {
    const k = Number(karat[1])
    return k > 0 && k <= 24 ? k : null
  }
  const fineness = raw.match(/^(\d{3})$/)
  if (fineness) {
    const f = Number(fineness[1])
    return f > 0 && f <= 999 ? roundTo((f / 1000) * 24, 4) : null
  }
  return null
}

export type ResolvedRate = {
  ratePerGram: number
  /** exact = the rate entered for this purity; derived = scaled from the 24K rate for a custom purity. */
  source: 'exact' | 'derived'
  basis: MetalRate
}

/** Finds the rate to use for a metal/purity from the current rates. */
export const resolveRate = (
  metal: MetalType | null | undefined,
  purity: string | null | undefined,
  rates: CurrentRates,
): ResolvedRate | null => {
  if (!isRatedMetal(metal)) return null
  const p = String(purity || '').trim().toUpperCase()

  if (metal === 'gold') {
    const exact = rates[rateKey('gold', p)]
    if (exact) return { ratePerGram: exact.ratePerGram, source: 'exact', basis: exact }
    // Standard purities must have their own entered rate; only custom purities (19K, 916…) are derived.
    if ((GOLD_PURITIES as readonly string[]).includes(p)) return null
    const karat = purityToKarat(p)
    const base = rates[rateKey('gold', '24K')]
    if (!karat || !base) return null
    return { ratePerGram: roundTo((base.ratePerGram * karat) / 24, 2), source: 'derived', basis: base }
  }

  const exact = p ? rates[rateKey(metal, p)] : undefined
  if (exact) return { ratePerGram: exact.ratePerGram, source: 'exact', basis: exact }
  const standard = rates[rateKey(metal, STANDARD_PURITY)]
  return standard ? { ratePerGram: standard.ratePerGram, source: 'exact', basis: standard } : null
}

export type RateValidation = { ok: true; value: number } | { ok: false; error: string }

/** Rejects empty, zero, negative or non-numeric rates, and unknown metal/purity pairs. */
export const validateRateInput = (metal: string, purity: string, raw: string): RateValidation => {
  if (!isRatedMetal(normalizeMetalType(metal))) return { ok: false, error: `Invalid metal type "${metal}".` }
  const validPurity = metal === 'gold'
    ? (GOLD_PURITIES as readonly string[]).includes(purity)
    : purity === STANDARD_PURITY
  if (!validPurity) return { ok: false, error: `Invalid purity "${purity}" for ${METAL_LABELS[metal as RatedMetal]}.` }
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: `${metalLabel(metal as RatedMetal, purity)} rate is empty.` }
  const value = Number(text)
  if (!Number.isFinite(value)) return { ok: false, error: `${metalLabel(metal as RatedMetal, purity)} rate must be a number.` }
  if (value <= 0) return { ok: false, error: `${metalLabel(metal as RatedMetal, purity)} rate must be greater than zero.` }
  if (value > 10_000_000) return { ok: false, error: `${metalLabel(metal as RatedMetal, purity)} rate looks too large.` }
  return { ok: true, value: roundTo(value, 2) }
}

// ── Item attributes & price calculation ────────────────────────────────────
export interface JewelleryAttributes {
  metalType: MetalType | null
  purity: string
  grossWeight: number
  stoneWeight: number
  netWeight: number
  makingCharge: number
  makingChargeType: MakingChargeType
  wastage: number
  wastageType: WastageType
  stoneCharge: number
  otherCharge: number
  huid: string
  designNumber: string
  subcategory: string
  otherWeight?: number
  hallmarkStatus?: HallmarkStatus | null
  stoneDetails?: StoneDetails | null
}

/** Net metal weight = gross - stone - other (non-metal) weight, never below zero. */
export const calculateNetWeight = (gross: number, stone: number, other = 0) =>
  Math.max(0, roundTo(toNumber(gross, 0) - toNumber(stone, 0) - toNumber(other, 0), 3))

// ── Hallmark & stones ─────────────────────────────────────────────────────
export type HallmarkStatus = 'hallmarked' | 'not_hallmarked' | 'pending'
export const HALLMARK_LABELS: Record<HallmarkStatus, string> = {
  hallmarked: 'Hallmarked',
  not_hallmarked: 'Not hallmarked',
  pending: 'Hallmarking pending',
}
export const normalizeHallmarkStatus = (v: unknown): HallmarkStatus | null =>
  v === 'hallmarked' || v === 'not_hallmarked' || v === 'pending' ? v : null

/** Optional stone / diamond details of an item. */
export interface StoneDetails {
  type: string
  count: number
  value: number
  carat: number
  clarity: string
  colour: string
  cut: string
  certificate: string
}

export const EMPTY_STONE_DETAILS: StoneDetails = { type: '', count: 0, value: 0, carat: 0, clarity: '', colour: '', cut: '', certificate: '' }

export const normalizeStoneDetails = (raw: unknown): StoneDetails | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const d: StoneDetails = {
    type: String(r.type || '').trim(),
    count: Math.max(0, Math.round(toNumber(r.count, 0))),
    value: Math.max(0, toNumber(r.value, 0)),
    carat: Math.max(0, toNumber(r.carat, 0)),
    clarity: String(r.clarity || '').trim(),
    colour: String(r.colour || '').trim(),
    cut: String(r.cut || '').trim(),
    certificate: String(r.certificate || '').trim(),
  }
  return d.type || d.count || d.value || d.carat || d.clarity || d.colour || d.cut || d.certificate ? d : null
}

/** "Diamond × 12, 0.45 ct, VS1, F, Excellent, Cert IGI123". */
export const describeStones = (d: StoneDetails | null | undefined) => {
  if (!d) return ''
  return [
    d.type ? `${d.type}${d.count ? ` × ${d.count}` : ''}` : d.count ? `${d.count} stones` : '',
    d.carat ? `${d.carat} ct` : '', d.clarity, d.colour, d.cut, d.certificate ? `Cert ${d.certificate}` : '',
  ].filter(Boolean).join(', ')
}

// ── Old gold exchange ─────────────────────────────────────────────────────
export type OldGoldInput = {
  netWeight: number
  /** Melting / wastage loss deducted from the weight, in % */
  meltingDeductionPercent: number
  /** Exchange rate per gram for the metal as tested */
  exchangeRate: number
  /** Any other deduction in ₹ */
  otherDeduction: number
}

/** Value of old metal taken in exchange: (net weight − melting loss) × rate − other deduction. */
export const calculateOldGoldValue = (input: OldGoldInput) => {
  const net = Math.max(0, toNumber(input.netWeight, 0))
  const melting = Math.min(100, Math.max(0, toNumber(input.meltingDeductionPercent, 0)))
  const effectiveWeight = roundTo(net * (1 - melting / 100), 3)
  const gross = roundTo(effectiveWeight * Math.max(0, toNumber(input.exchangeRate, 0)), 2)
  const value = Math.max(0, roundTo(gross - Math.max(0, toNumber(input.otherDeduction, 0)), 2))
  return { effectiveWeight, grossValue: gross, value }
}

/** Exchange rate for old gold of a tested purity (%), based on the 24K rate. */
export const oldGoldRateFromPurity = (rate24k: number, testedPurityPercent: number) =>
  roundTo(Math.max(0, rate24k) * Math.min(100, Math.max(0, testedPurityPercent)) / 99.9, 2)

export type PriceInput = {
  netWeight: number
  ratePerGram: number
  makingCharge: number
  makingChargeType: MakingChargeType
  wastage: number
  wastageType: WastageType
  stoneCharge: number
  otherCharge: number
}

export type PriceBreakdown = {
  metalValue: number
  makingAmount: number
  wastageWeight: number
  wastageAmount: number
  stoneCharge: number
  otherCharge: number
  /** Jewellery price before discounts and tax, for ONE piece. */
  total: number
}

export const calculateJewelleryPrice = (input: PriceInput): PriceBreakdown => {
  const net = Math.max(0, toNumber(input.netWeight, 0))
  const rate = Math.max(0, toNumber(input.ratePerGram, 0))
  const making = Math.max(0, toNumber(input.makingCharge, 0))
  const wastage = Math.max(0, toNumber(input.wastage, 0))

  const metalValue = roundTo(net * rate, 2)
  const makingAmount = roundTo(
    input.makingChargeType === 'per_gram' ? making * net
      : input.makingChargeType === 'percentage' ? (metalValue * making) / 100
        : making,
    2,
  )
  const wastageWeight = roundTo(input.wastageType === 'grams' ? wastage : (net * wastage) / 100, 3)
  const wastageAmount = roundTo(
    input.wastageType === 'grams' ? wastage * rate : (metalValue * wastage) / 100,
    2,
  )
  const stoneCharge = roundTo(Math.max(0, toNumber(input.stoneCharge, 0)), 2)
  const otherCharge = roundTo(Math.max(0, toNumber(input.otherCharge, 0)), 2)
  const total = roundTo(metalValue + makingAmount + wastageAmount + stoneCharge + otherCharge, 2)
  return { metalValue, makingAmount, wastageWeight, wastageAmount, stoneCharge, otherCharge, total }
}

/**
 * Everything used to price one jewellery line, frozen onto the invoice item.
 * Stored in orders.items[].jewellery — historical invoices read these values
 * and never recalculate with today's rate.
 */
export interface JewellerySnapshot {
  metal_type: MetalType
  purity: string
  rate_per_gram: number
  rate_source: 'exact' | 'derived' | 'fixed'
  rate_id: number | null
  rate_effective_from: string | null
  gross_weight: number
  stone_weight: number
  net_weight: number
  making_charge: number
  making_charge_type: MakingChargeType
  making_amount: number
  wastage: number
  wastage_type: WastageType
  wastage_weight: number
  wastage_amount: number
  stone_charge: number
  other_charge: number
  metal_value: number
  unit_price: number
  huid: string | null
  sku: string | null
  barcode: string | null
  design_number: string | null
  priced_at: string
  /** Optional extras (newer bills) */
  other_weight?: number
  hallmark_status?: HallmarkStatus | null
  stone_summary?: string | null
}

export type JewelleryPricingResult =
  | { ok: true; snapshot: JewellerySnapshot }
  | { ok: false; error: string }

/**
 * Prices a jewellery item with the current rates. Gold/silver/platinum items
 * are priced from the metal rate; "other" metal items keep their fixed price
 * (fallbackPrice) but still carry their weights and charges on the invoice.
 */
export const priceJewelleryItem = (
  attrs: JewelleryAttributes,
  rates: CurrentRates,
  ids: { sku?: string | null; barcode?: string | null; fallbackPrice?: number } = {},
  now: Date = new Date(),
): JewelleryPricingResult => {
  if (!attrs.metalType) return { ok: false, error: 'Item has no metal type.' }
  const net = attrs.netWeight > 0 ? attrs.netWeight : calculateNetWeight(attrs.grossWeight, attrs.stoneWeight, attrs.otherWeight || 0)

  let ratePerGram = 0
  let rateSource: JewellerySnapshot['rate_source'] = 'fixed'
  let rateId: number | null = null
  let rateEffectiveFrom: string | null = null

  if (isRatedMetal(attrs.metalType)) {
    if (net <= 0) return { ok: false, error: 'Net weight must be greater than zero to price this item.' }
    const resolved = resolveRate(attrs.metalType, attrs.purity, rates)
    if (!resolved) {
      return { ok: false, error: `No current rate for ${metalLabel(attrs.metalType, attrs.purity) || METAL_LABELS[attrs.metalType]}. Update today's Metal Rates first.` }
    }
    ratePerGram = resolved.ratePerGram
    rateSource = resolved.source
    rateId = resolved.basis.id
    rateEffectiveFrom = resolved.basis.effectiveFrom
  }

  const breakdown = calculateJewelleryPrice({
    netWeight: net,
    ratePerGram,
    makingCharge: attrs.makingCharge,
    makingChargeType: attrs.makingChargeType,
    wastage: attrs.wastage,
    wastageType: attrs.wastageType,
    stoneCharge: attrs.stoneCharge,
    otherCharge: attrs.otherCharge,
  })

  // "Other" metal: no market rate, so the fixed price stands in for the metal value.
  const fixedMetalValue = isRatedMetal(attrs.metalType)
    ? breakdown.metalValue
    : Math.max(0, roundTo(toNumber(ids.fallbackPrice, 0) - breakdown.makingAmount - breakdown.wastageAmount - breakdown.stoneCharge - breakdown.otherCharge, 2))
  const unitPrice = isRatedMetal(attrs.metalType) ? breakdown.total : roundTo(Math.max(0, toNumber(ids.fallbackPrice, 0)), 2)

  return {
    ok: true,
    snapshot: {
      metal_type: attrs.metalType,
      purity: attrs.purity || (isRatedMetal(attrs.metalType) && attrs.metalType !== 'gold' ? STANDARD_PURITY : ''),
      rate_per_gram: ratePerGram,
      rate_source: rateSource,
      rate_id: rateId,
      rate_effective_from: rateEffectiveFrom,
      gross_weight: roundTo(attrs.grossWeight, 3),
      stone_weight: roundTo(attrs.stoneWeight, 3),
      net_weight: roundTo(net, 3),
      making_charge: roundTo(attrs.makingCharge, 2),
      making_charge_type: attrs.makingChargeType,
      making_amount: breakdown.makingAmount,
      wastage: roundTo(attrs.wastage, 3),
      wastage_type: attrs.wastageType,
      wastage_weight: breakdown.wastageWeight,
      wastage_amount: breakdown.wastageAmount,
      stone_charge: breakdown.stoneCharge,
      other_charge: breakdown.otherCharge,
      metal_value: fixedMetalValue,
      unit_price: unitPrice,
      huid: attrs.huid || null,
      sku: ids.sku || null,
      barcode: ids.barcode || null,
      design_number: attrs.designNumber || null,
      priced_at: now.toISOString(),
      ...(attrs.otherWeight ? { other_weight: roundTo(attrs.otherWeight, 3) } : {}),
      ...(attrs.hallmarkStatus ? { hallmark_status: attrs.hallmarkStatus } : {}),
      ...(attrs.stoneDetails ? { stone_summary: describeStones(attrs.stoneDetails) } : {}),
    },
  }
}

/** Reads a stored snapshot back from an invoice item (tolerates missing/old data). */
export const readJewellerySnapshot = (raw: unknown): JewellerySnapshot | null => {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const metal = normalizeMetalType(r.metal_type)
  if (!metal) return null
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
  return {
    metal_type: metal,
    purity: String(r.purity || ''),
    rate_per_gram: toNumber(r.rate_per_gram, 0),
    rate_source: r.rate_source === 'derived' || r.rate_source === 'fixed' ? r.rate_source : 'exact',
    rate_id: r.rate_id == null ? null : toNumber(r.rate_id, 0),
    rate_effective_from: text(r.rate_effective_from),
    gross_weight: toNumber(r.gross_weight, 0),
    stone_weight: toNumber(r.stone_weight, 0),
    net_weight: toNumber(r.net_weight, 0),
    making_charge: toNumber(r.making_charge, 0),
    making_charge_type: normalizeMakingChargeType(r.making_charge_type),
    making_amount: toNumber(r.making_amount, 0),
    wastage: toNumber(r.wastage, 0),
    wastage_type: normalizeWastageType(r.wastage_type),
    wastage_weight: toNumber(r.wastage_weight, 0),
    wastage_amount: toNumber(r.wastage_amount, 0),
    stone_charge: toNumber(r.stone_charge, 0),
    other_charge: toNumber(r.other_charge, 0),
    metal_value: toNumber(r.metal_value, 0),
    unit_price: toNumber(r.unit_price, 0),
    huid: text(r.huid),
    sku: text(r.sku),
    barcode: text(r.barcode),
    design_number: text(r.design_number),
    priced_at: String(r.priced_at || ''),
    other_weight: toNumber(r.other_weight, 0) || undefined,
    hallmark_status: normalizeHallmarkStatus(r.hallmark_status),
    stone_summary: text(r.stone_summary),
  }
}

/** One-line summary used on receipts and in the cart, e.g. "Gold 22K · Net 5.200 g @ ₹6,550/g". */
export const snapshotSummary = (s: JewellerySnapshot, money: (n: number) => string) => {
  const parts = [metalLabel(s.metal_type, s.purity)]
  if (s.net_weight > 0) parts.push(`Net ${formatWeight(s.net_weight)}`)
  if (s.rate_per_gram > 0) parts.push(`@ ${money(s.rate_per_gram)}/g`)
  return parts.join(' · ')
}

// ── Savings schemes ("Schema") ─────────────────────────────────────────────
export type SchemeBenefitType = 'making' | 'wastage' | 'both'
/** Savings plan: an installment every day / week / month, or one single deposit. */
export type SchemeFrequency = 'daily' | 'weekly' | 'monthly' | 'one_time'

export const SCHEME_FREQUENCIES: SchemeFrequency[] = ['monthly', 'weekly', 'daily', 'one_time']

export const FREQUENCY_LABELS: Record<SchemeFrequency, string> = {
  daily: 'Daily Savings',
  weekly: 'Weekly Savings',
  monthly: 'Monthly Savings',
  one_time: 'One-time Deposit',
}

/** "day" / "week" / "month" for "₹100 / day"; empty for a one-time deposit. */
export const FREQUENCY_PERIOD: Record<SchemeFrequency, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  one_time: '',
}

export const normalizeFrequency = (v: unknown): SchemeFrequency =>
  v === 'daily' || v === 'weekly' || v === 'one_time' ? v : 'monthly'
export type BenefitUnit = 'percent' | 'fixed'
export type SchemeStoredStatus = 'active' | 'completed' | 'matured' | 'redeemed' | 'cancelled'
export type SchemeStatus = SchemeStoredStatus | 'payment_due'

export const SCHEME_STATUS_LABELS: Record<SchemeStatus, string> = {
  active: 'Active',
  payment_due: 'Payment Due',
  completed: 'Completed',
  matured: 'Matured',
  redeemed: 'Redeemed',
  cancelled: 'Cancelled',
}

export const BENEFIT_TYPE_LABELS: Record<SchemeBenefitType, string> = {
  making: 'Making Charge Discount',
  wastage: 'Wastage Discount',
  both: 'Making + Wastage Discount',
}

/** A scheme plan set up by the admin; staff enrol customers on these. */
export interface SchemeType {
  id: string
  name: string
  frequency: SchemeFrequency
  amount: number
  installments: number
  durationMonths: number
  benefitType: SchemeBenefitType
  makingBenefitValue: number
  makingBenefitUnit: BenefitUnit
  wastageBenefitValue: number
  wastageBenefitUnit: BenefitUnit
  active: boolean
}

export interface SchemeRules {
  /** Scheme plans offered to customers. A customer's scheme keeps its own copy of the terms. */
  types: SchemeType[]
  minInstallments: number
  maxInstallments: number
  minMonthlyAmount: number
  /** 0 = no upper limit */
  maxMonthlyAmount: number
  defaultBenefitType: SchemeBenefitType
  defaultMakingBenefitValue: number
  defaultMakingBenefitUnit: BenefitUnit
  defaultWastageBenefitValue: number
  defaultWastageBenefitUnit: BenefitUnit
  /** Redeem only on/after the maturity date (otherwise as soon as every installment is paid). */
  requireMaturityForRedemption: boolean
  /** Months after maturity during which the scheme can be redeemed; 0 = never expires. */
  expiryMonths: number
  allowPartialRedemption: boolean
  allowCancellation: boolean
  allowTransfer: boolean
}

export const DEFAULT_SCHEME_RULES: SchemeRules = {
  types: [],
  minInstallments: 1,
  maxInstallments: 24,
  minMonthlyAmount: 500,
  maxMonthlyAmount: 0,
  defaultBenefitType: 'making',
  defaultMakingBenefitValue: 20,
  defaultMakingBenefitUnit: 'percent',
  defaultWastageBenefitValue: 0,
  defaultWastageBenefitUnit: 'percent',
  requireMaturityForRedemption: true,
  expiryMonths: 0,
  allowPartialRedemption: true,
  allowCancellation: true,
  allowTransfer: false,
}

const benefitTypeOf = (v: unknown, fallback: SchemeBenefitType): SchemeBenefitType =>
  v === 'making' || v === 'wastage' || v === 'both' ? v : fallback
const unitOf = (v: unknown, fallback: BenefitUnit): BenefitUnit => (v === 'percent' || v === 'fixed' ? v : fallback)

export const normalizeSchemeRules = (raw: unknown): SchemeRules => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_SCHEME_RULES
  const int = (v: unknown, fb: number) => Math.max(0, Math.round(toNumber(v, fb)))
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb)
  const types: SchemeType[] = Array.isArray(r.types)
    ? (r.types as Array<Record<string, unknown>>).filter((t) => t && typeof t === 'object' && String(t.name || '').trim()).map((t, i) => ({
        id: String(t.id || `type-${i}`),
        name: String(t.name).trim(),
        frequency: normalizeFrequency(t.frequency),
        amount: Math.max(0, toNumber(t.amount, 0)),
        installments: Math.max(1, Math.round(toNumber(t.installments, 1))),
        durationMonths: Math.max(1, Math.round(toNumber(t.durationMonths, 1))),
        benefitType: benefitTypeOf(t.benefitType, 'making'),
        makingBenefitValue: Math.max(0, toNumber(t.makingBenefitValue, 0)),
        makingBenefitUnit: unitOf(t.makingBenefitUnit, 'percent'),
        wastageBenefitValue: Math.max(0, toNumber(t.wastageBenefitValue, 0)),
        wastageBenefitUnit: unitOf(t.wastageBenefitUnit, 'percent'),
        active: t.active !== false,
      }))
    : []
  return {
    types,
    minInstallments: Math.max(1, int(r.minInstallments, d.minInstallments)),
    maxInstallments: Math.max(1, int(r.maxInstallments, d.maxInstallments)),
    minMonthlyAmount: Math.max(0, toNumber(r.minMonthlyAmount, d.minMonthlyAmount)),
    maxMonthlyAmount: Math.max(0, toNumber(r.maxMonthlyAmount, d.maxMonthlyAmount)),
    defaultBenefitType: benefitTypeOf(r.defaultBenefitType, d.defaultBenefitType),
    defaultMakingBenefitValue: Math.max(0, toNumber(r.defaultMakingBenefitValue, d.defaultMakingBenefitValue)),
    defaultMakingBenefitUnit: unitOf(r.defaultMakingBenefitUnit, d.defaultMakingBenefitUnit),
    defaultWastageBenefitValue: Math.max(0, toNumber(r.defaultWastageBenefitValue, d.defaultWastageBenefitValue)),
    defaultWastageBenefitUnit: unitOf(r.defaultWastageBenefitUnit, d.defaultWastageBenefitUnit),
    requireMaturityForRedemption: bool(r.requireMaturityForRedemption, d.requireMaturityForRedemption),
    expiryMonths: int(r.expiryMonths, d.expiryMonths),
    allowPartialRedemption: bool(r.allowPartialRedemption, d.allowPartialRedemption),
    allowCancellation: bool(r.allowCancellation, d.allowCancellation),
    allowTransfer: bool(r.allowTransfer, d.allowTransfer),
  }
}

export interface JewelleryScheme {
  id: string
  frequency: SchemeFrequency
  schemeNumber: string
  customerId: string | null
  customerName: string
  phone: string
  schemeName: string
  monthlyAmount: number
  durationMonths: number
  totalInstallments: number
  startDate: string
  maturityDate: string
  benefitType: SchemeBenefitType
  makingBenefitValue: number
  makingBenefitUnit: BenefitUnit
  wastageBenefitValue: number
  wastageBenefitUnit: BenefitUnit
  status: SchemeStoredStatus
  installmentsPaid: number
  totalPaid: number
  amountRedeemed: number
  benefitUsed: boolean
  nextDueDate: string | null
  notes: string
  cancelledAt: string | null
  cancelReason: string | null
  transferHistory: Array<Record<string, unknown>>
  createdBy: string
  createdAt: string
  updatedAt: string
}

export const mapSchemeRow = (row: Record<string, unknown>): JewelleryScheme => {
  const status = String(row.status || 'active')
  return {
    id: String(row.id),
    frequency: normalizeFrequency(row.frequency),
    schemeNumber: String(row.scheme_number || ''),
    customerId: row.customer_id ? String(row.customer_id) : null,
    customerName: String(row.customer_name || ''),
    phone: String(row.phone || ''),
    schemeName: String(row.scheme_name || ''),
    monthlyAmount: toNumber(row.monthly_amount, 0),
    durationMonths: toNumber(row.duration_months, 0),
    totalInstallments: toNumber(row.total_installments, 0),
    startDate: String(row.start_date || '').slice(0, 10),
    maturityDate: String(row.maturity_date || '').slice(0, 10),
    benefitType: benefitTypeOf(row.benefit_type, 'making'),
    makingBenefitValue: toNumber(row.making_benefit_value, 0),
    makingBenefitUnit: unitOf(row.making_benefit_unit, 'percent'),
    wastageBenefitValue: toNumber(row.wastage_benefit_value, 0),
    wastageBenefitUnit: unitOf(row.wastage_benefit_unit, 'percent'),
    status: (['active', 'completed', 'matured', 'redeemed', 'cancelled'].includes(status) ? status : 'active') as SchemeStoredStatus,
    installmentsPaid: toNumber(row.installments_paid, 0),
    totalPaid: toNumber(row.total_paid, 0),
    amountRedeemed: toNumber(row.amount_redeemed, 0),
    benefitUsed: Boolean(row.benefit_used),
    nextDueDate: row.next_due_date ? String(row.next_due_date).slice(0, 10) : null,
    notes: String(row.notes || ''),
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    transferHistory: Array.isArray(row.transfer_history) ? (row.transfer_history as Array<Record<string, unknown>>) : [],
    createdBy: String(row.created_by || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

/** Local yyyy-mm-dd (matches what a DATE column stores). */
export const localIsoDate = (d: Date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Adds calendar months to a yyyy-mm-dd date, clamping to the month's last day (31 Jan + 1 = 28/29 Feb). */
export const addMonthsIso = (iso: string, months: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const target = new Date(y, m - 1 + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d, lastDay))
  return localIsoDate(target)
}

const addDaysIso = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return localIsoDate(new Date(y, m - 1, d + days))
}

/** Moves a yyyy-mm-dd date forward by n plan periods (days, weeks or months). */
export const addPeriodsIso = (iso: string, n: number, frequency: SchemeFrequency) =>
  frequency === 'daily' ? addDaysIso(iso, n)
    : frequency === 'weekly' ? addDaysIso(iso, 7 * n)
      : addMonthsIso(iso, n)

/** Due date of installment k (1-based) — the same rule the database uses. */
export const installmentDueDate = (startIso: string, k: number, frequency: SchemeFrequency) =>
  addPeriodsIso(startIso, k - 1, frequency)

/**
 * Suggested maturity date: monthly and one-time plans mature after the chosen number of
 * months; daily and weekly plans one period after the last installment is due.
 */
export const defaultMaturityDate = (startIso: string, frequency: SchemeFrequency, installments: number, durationMonths: number) =>
  frequency === 'daily' || frequency === 'weekly'
    ? addPeriodsIso(startIso, Math.max(1, installments), frequency)
    : addMonthsIso(startIso, Math.max(1, durationMonths))

/** Whole months between two yyyy-mm-dd dates (at least 1). */
export const monthsBetween = (fromIso: string, toIso: string) => {
  const [y1, m1] = fromIso.split('-').map(Number)
  const [y2, m2] = toIso.split('-').map(Number)
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1))
}

export const schemeBalance = (s: Pick<JewelleryScheme, 'totalPaid' | 'amountRedeemed'>) =>
  Math.max(0, roundTo(s.totalPaid - s.amountRedeemed, 2))

export const schemeTarget = (s: Pick<JewelleryScheme, 'monthlyAmount' | 'totalInstallments'>) =>
  roundTo(s.monthlyAmount * s.totalInstallments, 2)

/** Remaining amount still to be collected in installments. */
export const schemeRemaining = (s: Pick<JewelleryScheme, 'monthlyAmount' | 'totalInstallments' | 'totalPaid' | 'status'>) =>
  s.status === 'cancelled' ? 0 : Math.max(0, roundTo(schemeTarget(s) - s.totalPaid, 2))

/**
 * Display status. "Payment Due" and "Matured" depend on today's date, so they
 * are worked out here rather than trusted from the stored status.
 */
export const deriveSchemeStatus = (
  s: Pick<JewelleryScheme, 'status' | 'installmentsPaid' | 'totalInstallments' | 'maturityDate' | 'nextDueDate'>,
  today: string = localIsoDate(),
): SchemeStatus => {
  if (s.status === 'cancelled' || s.status === 'redeemed') return s.status
  if (s.installmentsPaid >= s.totalInstallments) return s.maturityDate <= today ? 'matured' : 'completed'
  if (s.nextDueDate && s.nextDueDate < today) return 'payment_due'
  return 'active'
}

export type RedemptionEligibility = { eligible: true } | { eligible: false; reason: string }

export const checkRedemptionEligibility = (
  s: JewelleryScheme,
  rules: SchemeRules,
  today: string = localIsoDate(),
): RedemptionEligibility => {
  const status = deriveSchemeStatus(s, today)
  if (status === 'cancelled') return { eligible: false, reason: 'Scheme is cancelled.' }
  if (status === 'redeemed') return { eligible: false, reason: 'Scheme is fully redeemed.' }
  if (status !== 'completed' && status !== 'matured') {
    return { eligible: false, reason: `${s.totalInstallments - s.installmentsPaid} installment(s) still pending.` }
  }
  if (rules.requireMaturityForRedemption && status !== 'matured') {
    return { eligible: false, reason: `Can be redeemed from the maturity date (${s.maturityDate}).` }
  }
  if (rules.expiryMonths > 0 && addMonthsIso(s.maturityDate, rules.expiryMonths) < today) {
    return { eligible: false, reason: 'Scheme redemption period has expired.' }
  }
  if (schemeBalance(s) <= 0 && s.benefitUsed) return { eligible: false, reason: 'Nothing left to redeem.' }
  return { eligible: true }
}

export type SchemeBenefitLine = { makingAmount: number; wastageAmount: number; qty: number }

export type SchemeBenefitResult = {
  makingTotal: number
  wastageTotal: number
  makingDiscount: number
  wastageDiscount: number
  total: number
}

/**
 * Scheme benefit for a bill. It only ever reduces making charges and/or
 * wastage — never the metal value, stones or other charges.
 */
export const calculateSchemeBenefit = (
  scheme: Pick<JewelleryScheme, 'benefitType' | 'makingBenefitValue' | 'makingBenefitUnit' | 'wastageBenefitValue' | 'wastageBenefitUnit'>,
  lines: SchemeBenefitLine[],
): SchemeBenefitResult => {
  const makingTotal = roundTo(lines.reduce((sum, l) => sum + Math.max(0, l.makingAmount) * Math.max(0, l.qty), 0), 2)
  const wastageTotal = roundTo(lines.reduce((sum, l) => sum + Math.max(0, l.wastageAmount) * Math.max(0, l.qty), 0), 2)
  const discountOn = (base: number, value: number, unit: BenefitUnit) => {
    if (base <= 0 || value <= 0) return 0
    const raw = unit === 'percent' ? (base * Math.min(100, value)) / 100 : value
    return roundTo(Math.min(base, raw), 2)
  }
  const makingDiscount = scheme.benefitType === 'making' || scheme.benefitType === 'both'
    ? discountOn(makingTotal, scheme.makingBenefitValue, scheme.makingBenefitUnit) : 0
  const wastageDiscount = scheme.benefitType === 'wastage' || scheme.benefitType === 'both'
    ? discountOn(wastageTotal, scheme.wastageBenefitValue, scheme.wastageBenefitUnit) : 0
  return { makingTotal, wastageTotal, makingDiscount, wastageDiscount, total: roundTo(makingDiscount + wastageDiscount, 2) }
}

/** Status of one installment as shown to staff. */
export type InstallmentDisplayStatus = 'paid' | 'due' | 'overdue' | 'upcoming' | 'cancelled'

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentDisplayStatus, string> = {
  paid: 'Paid',
  due: 'Due',
  overdue: 'Overdue',
  upcoming: 'Upcoming',
  cancelled: 'Cancelled',
}

export const installmentDisplayStatus = (
  i: { status: 'pending' | 'paid'; dueDate: string },
  schemeStatus: SchemeStoredStatus,
  today: string = localIsoDate(),
): InstallmentDisplayStatus => {
  if (i.status === 'paid') return 'paid'
  if (schemeStatus === 'cancelled') return 'cancelled'
  if (i.dueDate < today) return 'overdue'
  if (i.dueDate === today) return 'due'
  return 'upcoming'
}

export const describeSchemeBenefit = (
  s: Pick<JewelleryScheme, 'benefitType' | 'makingBenefitValue' | 'makingBenefitUnit' | 'wastageBenefitValue' | 'wastageBenefitUnit'>,
  money: (n: number) => string,
) => {
  const fmt = (v: number, unit: BenefitUnit) => (unit === 'percent' ? `${v}%` : money(v))
  const parts: string[] = []
  if (s.benefitType !== 'wastage') parts.push(`${fmt(s.makingBenefitValue, s.makingBenefitUnit)} off making`)
  if (s.benefitType !== 'making') parts.push(`${fmt(s.wastageBenefitValue, s.wastageBenefitUnit)} off wastage`)
  return parts.join(' + ')
}

export type SchemeInput = {
  frequency: SchemeFrequency
  customerName: string
  phone: string
  schemeName: string
  monthlyAmount: number
  totalInstallments: number
  durationMonths: number
  startDate: string
  maturityDate: string
  benefitType: SchemeBenefitType
  makingBenefitValue: number
  makingBenefitUnit: BenefitUnit
  wastageBenefitValue: number
  wastageBenefitUnit: BenefitUnit
}

/** Validates a new scheme against the store's scheme rules. Returns an error message or null. */
export const validateSchemeInput = (input: SchemeInput, rules: SchemeRules): string | null => {
  if (!input.phone.trim()) return 'Select or enter the customer phone number.'
  if (!input.schemeName.trim()) return 'Enter a scheme name.'
  const amountName = input.frequency === 'one_time' ? 'Deposit amount' : 'Installment amount'
  if (!Number.isFinite(input.monthlyAmount) || input.monthlyAmount <= 0) return `${amountName} must be greater than zero.`
  if (!Number.isInteger(input.totalInstallments) || input.totalInstallments < 1) return 'Number of installments must be a whole number of at least 1.'
  if (input.frequency === 'monthly') {
    // The store's limits on amount and installment count are for monthly plans.
    if (input.monthlyAmount < rules.minMonthlyAmount) return `Monthly installment must be at least ₹${rules.minMonthlyAmount}.`
    if (rules.maxMonthlyAmount > 0 && input.monthlyAmount > rules.maxMonthlyAmount) return `Monthly installment cannot exceed ₹${rules.maxMonthlyAmount}.`
    if (input.totalInstallments < rules.minInstallments) return `A monthly scheme needs at least ${rules.minInstallments} installments.`
    if (input.totalInstallments > rules.maxInstallments) return `A monthly scheme can have at most ${rules.maxInstallments} installments.`
    if (!Number.isInteger(input.durationMonths) || input.durationMonths < input.totalInstallments) return 'Duration (months) cannot be shorter than the number of monthly installments.'
  } else if (input.frequency === 'one_time') {
    if (input.totalInstallments !== 1) return 'A one-time deposit has exactly one payment.'
    if (!Number.isInteger(input.durationMonths) || input.durationMonths < 1) return 'Enter the deposit term in months.'
  } else if (input.totalInstallments > 1000) {
    return 'A scheme can have at most 1000 installments.'
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return 'Select a valid start date.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.maturityDate) || input.maturityDate < input.startDate) return 'Maturity date must be on or after the start date.'
  const usesMaking = input.benefitType !== 'wastage'
  const usesWastage = input.benefitType !== 'making'
  if (usesMaking && (input.makingBenefitValue < 0 || (input.makingBenefitUnit === 'percent' && input.makingBenefitValue > 100))) return 'Making charge discount must be between 0 and 100%.'
  if (usesWastage && (input.wastageBenefitValue < 0 || (input.wastageBenefitUnit === 'percent' && input.wastageBenefitValue > 100))) return 'Wastage discount must be between 0 and 100%.'
  return null
}

/** Installments whose due date has arrived (today or earlier) but are not yet paid. */
export const installmentsDueCount = (
  s: Pick<JewelleryScheme, 'status' | 'startDate' | 'installmentsPaid' | 'totalInstallments'> & { frequency?: SchemeFrequency },
  today: string = localIsoDate(),
) => {
  if (s.status !== 'active') return 0
  let due = 0
  for (let k = s.installmentsPaid + 1; k <= s.totalInstallments; k++) {
    if (installmentDueDate(s.startDate, k, s.frequency || 'monthly') <= today) due++
    else break
  }
  return due
}

/** Unpaid installments split into overdue (before today) and due today. */
export const installmentDueBreakdown = (
  s: Pick<JewelleryScheme, 'status' | 'startDate' | 'installmentsPaid' | 'totalInstallments'> & { frequency?: SchemeFrequency },
  today: string = localIsoDate(),
) => {
  let overdue = 0
  let dueToday = 0
  if (s.status !== 'active') return { overdue, dueToday }
  for (let k = s.installmentsPaid + 1; k <= s.totalInstallments; k++) {
    const due = installmentDueDate(s.startDate, k, s.frequency || 'monthly')
    if (due < today) overdue++
    else if (due === today) dueToday++
    else break
  }
  return { overdue, dueToday }
}
