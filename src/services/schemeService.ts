import { supabase } from '../lib/supabase'
import {
  mapSchemeRow,
  normalizeSchemeRules,
  type JewelleryScheme,
  type SchemeInput,
  type SchemeRules,
} from '../lib/jewellery'
import { toNumber } from '../lib/retail'
import { isMissingSchemaError } from './productService'

export const SCHEME_MIGRATION_HINT =
  'Schemes are not set up in the database yet. Apply supabase/migrations/jewellery_pos.sql in Supabase.'

const toError = (error: unknown, fallback: string) => {
  if (isMissingSchemaError(error)) return new Error(SCHEME_MIGRATION_HINT)
  const e = error as { message?: string; details?: string } | null
  return new Error(e?.message || fallback)
}

export interface SchemeInstallment {
  id: string
  schemeId: string
  installmentNumber: number
  dueDate: string
  amountDue: number
  amountPaid: number
  paymentDate: string | null
  paymentMethod: string | null
  receiptNumber: string | null
  status: 'pending' | 'paid'
  notes: string
  createdBy: string | null
}

export interface SchemeRedemption {
  id: string
  schemeId: string
  invoiceId: string | null
  invoiceNo: string | null
  amountUsed: number
  benefitApplied: number
  balanceAfter: number
  status: 'applied' | 'reversed'
  redeemedAt: string
  createdBy: string
}

export const mapInstallmentRow = (row: Record<string, unknown>): SchemeInstallment => ({
  id: String(row.id),
  schemeId: String(row.scheme_id),
  installmentNumber: toNumber(row.installment_number, 0),
  dueDate: String(row.due_date || '').slice(0, 10),
  amountDue: toNumber(row.amount_due, 0),
  amountPaid: toNumber(row.amount_paid, 0),
  paymentDate: row.payment_date ? String(row.payment_date) : null,
  paymentMethod: row.payment_method ? String(row.payment_method) : null,
  receiptNumber: row.receipt_number ? String(row.receipt_number) : null,
  status: row.status === 'paid' ? 'paid' : 'pending',
  notes: String(row.notes || ''),
  createdBy: row.created_by ? String(row.created_by) : null,
})

const mapRedemptionRow = (row: Record<string, unknown>): SchemeRedemption => ({
  id: String(row.id),
  schemeId: String(row.scheme_id),
  invoiceId: row.invoice_id ? String(row.invoice_id) : null,
  invoiceNo: row.invoice_no ? String(row.invoice_no) : null,
  amountUsed: toNumber(row.amount_used, 0),
  benefitApplied: toNumber(row.benefit_applied, 0),
  balanceAfter: toNumber(row.balance_after, 0),
  status: row.status === 'reversed' ? 'reversed' : 'applied',
  redeemedAt: String(row.redeemed_at || ''),
  createdBy: String(row.created_by || ''),
})

export const schemeService = {
  async fetchRules(): Promise<SchemeRules> {
    const { data, error } = await supabase.from('store_settings').select('scheme_rules').eq('id', 1).maybeSingle()
    if (error) {
      if (isMissingSchemaError(error)) return normalizeSchemeRules(null)
      throw toError(error, 'Unable to load scheme rules')
    }
    return normalizeSchemeRules(data?.scheme_rules)
  },

  async saveRules(rules: SchemeRules): Promise<void> {
    const { error } = await supabase
      .from('store_settings')
      .update({ scheme_rules: rules, updated_at: new Date().toISOString() })
      .eq('id', 1)
    if (error) throw toError(error, 'Unable to save scheme rules')
  },

  async list(): Promise<JewelleryScheme[]> {
    // Paid-up schemes whose maturity date has arrived become "matured".
    await supabase.rpc('refresh_scheme_maturity').then(() => undefined, () => undefined)
    const { data, error } = await supabase
      .from('jewellery_schemes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000)
    if (error) throw toError(error, 'Unable to load schemes')
    return (data || []).map((row) => mapSchemeRow(row as Record<string, unknown>))
  },

  async listByPhone(phone: string): Promise<JewelleryScheme[]> {
    const clean = phone.trim()
    if (!clean) return []
    const { data, error } = await supabase
      .from('jewellery_schemes')
      .select('*')
      .eq('phone', clean)
      .order('created_at', { ascending: false })
    if (error) {
      // Billing must keep working before the scheme tables exist.
      if (isMissingSchemaError(error)) return []
      throw toError(error, 'Unable to load customer schemes')
    }
    return (data || []).map((row) => mapSchemeRow(row as Record<string, unknown>))
  },

  async fetchInstallments(schemeId: string): Promise<SchemeInstallment[]> {
    const { data, error } = await supabase
      .from('scheme_installments')
      .select('*')
      .eq('scheme_id', schemeId)
      .order('installment_number', { ascending: true })
    if (error) throw toError(error, 'Unable to load installments')
    return (data || []).map((row) => mapInstallmentRow(row as Record<string, unknown>))
  },

  async fetchRedemptions(schemeId: string): Promise<SchemeRedemption[]> {
    const { data, error } = await supabase
      .from('scheme_redemptions')
      .select('*')
      .eq('scheme_id', schemeId)
      .order('redeemed_at', { ascending: false })
    if (error) throw toError(error, 'Unable to load redemptions')
    return (data || []).map((row) => mapRedemptionRow(row as Record<string, unknown>))
  },

  /** Every paid installment (payment history), newest first. */
  async fetchPayments(filter: { from?: string; to?: string; limit?: number } = {}): Promise<SchemeInstallment[]> {
    let query = supabase
      .from('scheme_installments')
      .select('*')
      .eq('status', 'paid')
      .order('payment_date', { ascending: false })
      .limit(filter.limit ?? 1000)
    if (filter.from) query = query.gte('payment_date', `${filter.from}T00:00:00`)
    if (filter.to) query = query.lte('payment_date', `${filter.to}T23:59:59.999`)
    const { data, error } = await query
    if (error) throw toError(error, 'Unable to load scheme payments')
    return (data || []).map((row) => mapInstallmentRow(row as Record<string, unknown>))
  },

  async create(input: SchemeInput & { createdBy: string; notes?: string }): Promise<JewelleryScheme> {
    const { data, error } = await supabase.rpc('create_jewellery_scheme', {
      p_phone: input.phone.trim(),
      p_customer_name: input.customerName.trim(),
      p_scheme_name: input.schemeName.trim(),
      p_monthly_amount: input.monthlyAmount,
      p_total_installments: input.totalInstallments,
      p_duration_months: input.durationMonths,
      p_start_date: input.startDate,
      p_maturity_date: input.maturityDate,
      p_benefit_type: input.benefitType,
      p_making_benefit_value: input.benefitType === 'wastage' ? 0 : input.makingBenefitValue,
      p_making_benefit_unit: input.makingBenefitUnit,
      p_wastage_benefit_value: input.benefitType === 'making' ? 0 : input.wastageBenefitValue,
      p_wastage_benefit_unit: input.wastageBenefitUnit,
      p_created_by: input.createdBy,
      p_notes: input.notes || '',
    })
    if (error) throw toError(error, 'Unable to create scheme')
    const row = Array.isArray(data) ? data[0] : data
    return mapSchemeRow(row as Record<string, unknown>)
  },

  /** Collects the next pending installment. Returns the paid installment and the updated scheme. */
  async recordInstallment(schemeId: string, paymentMethod: string, createdBy: string, notes = '') {
    const { data, error } = await supabase.rpc('record_scheme_installment', {
      p_scheme_id: schemeId,
      p_payment_method: paymentMethod,
      p_created_by: createdBy,
      p_notes: notes,
    })
    if (error) throw toError(error, 'Unable to record the installment')
    const payload = (data || {}) as { installment?: Record<string, unknown>; scheme?: Record<string, unknown> }
    if (!payload.installment || !payload.scheme) throw new Error('Installment was not recorded')
    return { installment: mapInstallmentRow(payload.installment), scheme: mapSchemeRow(payload.scheme) }
  },

  /** Reserves scheme balance/benefit for a bill before the bill is saved. */
  async reserveRedemption(params: {
    schemeId: string
    amount: number
    benefitAmount: number
    rules: SchemeRules
    createdBy: string
  }) {
    const { data, error } = await supabase.rpc('redeem_jewellery_scheme', {
      p_scheme_id: params.schemeId,
      p_amount: params.amount,
      p_benefit_amount: params.benefitAmount,
      p_allow_partial: params.rules.allowPartialRedemption,
      p_require_maturity: params.rules.requireMaturityForRedemption,
      p_expiry_months: params.rules.expiryMonths,
      p_created_by: params.createdBy,
    })
    if (error) throw toError(error, 'Unable to redeem the scheme')
    const payload = (data || {}) as { redemption?: Record<string, unknown>; scheme?: Record<string, unknown> }
    if (!payload.redemption || !payload.scheme) throw new Error('Scheme redemption failed')
    return { redemption: mapRedemptionRow(payload.redemption), scheme: mapSchemeRow(payload.scheme) }
  },

  async linkRedemption(redemptionId: string, orderId: string, invoiceNo: string) {
    const { error } = await supabase.rpc('link_scheme_redemption', {
      p_redemption_id: redemptionId,
      p_order_id: orderId,
      p_invoice_no: invoiceNo,
    })
    if (error) throw toError(error, 'Unable to link the scheme redemption to the invoice')
  },

  async reverseRedemption(redemptionId: string) {
    const { error } = await supabase.rpc('reverse_scheme_redemption', { p_redemption_id: redemptionId })
    if (error) throw toError(error, 'Unable to release the scheme redemption')
  },

  async cancel(schemeId: string, reason: string, createdBy: string): Promise<JewelleryScheme> {
    const { data, error } = await supabase.rpc('cancel_jewellery_scheme', {
      p_scheme_id: schemeId,
      p_reason: reason,
      p_created_by: createdBy,
    })
    if (error) throw toError(error, 'Unable to cancel the scheme')
    return mapSchemeRow((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },

  async transfer(schemeId: string, phone: string, customerName: string, createdBy: string): Promise<JewelleryScheme> {
    const { data, error } = await supabase.rpc('transfer_jewellery_scheme', {
      p_scheme_id: schemeId,
      p_phone: phone,
      p_customer_name: customerName,
      p_created_by: createdBy,
    })
    if (error) throw toError(error, 'Unable to transfer the scheme')
    return mapSchemeRow((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
}
