import { supabase } from '../lib/supabase'
import { toNumber } from '../lib/retail'
import { isMissingSchemaError } from './productService'
import { currentUserName } from './auditService'

export const SALES_DESK_MIGRATION_HINT =
  'This needs the database update: run supabase/migrations/jewellery_pos.sql again in the Supabase SQL Editor.'

const fail = (error: unknown, fallback: string) => {
  if (isMissingSchemaError(error) || (error as { code?: string })?.code === 'PGRST202') return new Error(SALES_DESK_MIGRATION_HINT)
  return new Error((error as { message?: string } | null)?.message || fallback)
}

const str = (v: unknown) => (v == null ? '' : String(v))

// ── Customer advances ──────────────────────────────────────────────────────
export interface CustomerAdvance {
  id: string
  receiptNumber: string
  customerName: string
  phone: string
  amount: number
  amountUsed: number
  balance: number
  paymentMethod: string
  purpose: string
  /** payment = money paid in; exchange = credit from a return; old_gold = credit for old gold bought at the counter */
  source: 'payment' | 'exchange' | 'old_gold'
  sourceRef: string
  status: 'active' | 'used' | 'cancelled'
  notes: string
  createdBy: string
  createdAt: string
}

const mapAdvance = (r: Record<string, unknown>): CustomerAdvance => {
  const amount = toNumber(r.amount, 0)
  const used = toNumber(r.amount_used, 0)
  return {
    id: str(r.id), receiptNumber: str(r.receipt_number), customerName: str(r.customer_name), phone: str(r.phone),
    amount, amountUsed: used, balance: Math.max(0, Math.round((amount - used) * 100) / 100),
    paymentMethod: str(r.payment_method), purpose: str(r.purpose), source: r.source === 'exchange' || r.source === 'old_gold' ? r.source : 'payment',
    sourceRef: str(r.source_ref), status: r.status === 'used' || r.status === 'cancelled' ? r.status : 'active',
    notes: str(r.notes), createdBy: str(r.created_by), createdAt: str(r.created_at),
  }
}

export interface AdvanceUsage { id: string; advanceId: string; orderId: string | null; invoiceNo: string; amount: number; status: 'applied' | 'reversed'; createdAt: string }
const mapUsage = (r: Record<string, unknown>): AdvanceUsage => ({
  id: str(r.id), advanceId: str(r.advance_id), orderId: r.order_id ? str(r.order_id) : null, invoiceNo: str(r.invoice_no),
  amount: toNumber(r.amount, 0), status: r.status === 'reversed' ? 'reversed' : 'applied', createdAt: str(r.created_at),
})

export const advanceService = {
  async list(): Promise<CustomerAdvance[]> {
    const { data, error } = await supabase.from('customer_advances').select('*').order('created_at', { ascending: false }).limit(2000)
    if (error) throw fail(error, 'Unable to load advances')
    return (data || []).map((r) => mapAdvance(r as Record<string, unknown>))
  },
  /** Advances with balance left for a customer (billing). Empty before the database update. */
  async listActiveByPhone(phone: string): Promise<CustomerAdvance[]> {
    if (!phone.trim()) return []
    const { data, error } = await supabase.from('customer_advances').select('*').eq('phone', phone.trim()).eq('status', 'active').order('created_at')
    if (error) return []
    return (data || []).map((r) => mapAdvance(r as Record<string, unknown>)).filter((a) => a.balance > 0)
  },
  async listByPhone(phone: string): Promise<CustomerAdvance[]> {
    const { data, error } = await supabase.from('customer_advances').select('*').eq('phone', phone.trim()).order('created_at', { ascending: false })
    if (error) return []
    return (data || []).map((r) => mapAdvance(r as Record<string, unknown>))
  },
  async usages(advanceId: string): Promise<AdvanceUsage[]> {
    const { data, error } = await supabase.from('advance_usages').select('*').eq('advance_id', advanceId).order('created_at', { ascending: false })
    if (error) throw fail(error, 'Unable to load advance usage')
    return (data || []).map((r) => mapUsage(r as Record<string, unknown>))
  },
  async create(input: { customerName: string; phone: string; amount: number; paymentMethod: string; purpose: string; notes?: string }): Promise<CustomerAdvance> {
    const { data, error } = await supabase.from('customer_advances').insert({
      customer_name: input.customerName.trim(), phone: input.phone.trim(), amount: Math.round(input.amount * 100) / 100,
      payment_method: input.paymentMethod, purpose: input.purpose.trim(), notes: input.notes?.trim() || '', created_by: currentUserName(),
    }).select('*').single()
    if (error) throw fail(error, 'Unable to save the advance')
    // Keep the customer record in sync with the existing customer flow (keyed by phone).
    await supabase.from('customers').upsert({ phone: input.phone.trim(), name: input.customerName.trim(), updated_at: new Date().toISOString() }, { onConflict: 'phone', ignoreDuplicates: true })
    return mapAdvance(data as Record<string, unknown>)
  },
  async reserve(advanceId: string, amount: number): Promise<AdvanceUsage> {
    const { data, error } = await supabase.rpc('reserve_customer_advance', { p_advance_id: advanceId, p_amount: amount, p_created_by: currentUserName() })
    if (error) throw fail(error, 'Unable to use the advance')
    return mapUsage((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
  async link(usageId: string, orderId: string, invoiceNo: string) {
    const { error } = await supabase.rpc('link_advance_usage', { p_usage_id: usageId, p_order_id: orderId, p_invoice_no: invoiceNo })
    if (error) throw fail(error, 'Unable to link the advance to the invoice')
  },
  async reverse(usageId: string) {
    const { error } = await supabase.rpc('reverse_advance_usage', { p_usage_id: usageId })
    if (error) throw fail(error, 'Unable to release the advance')
  },
  async cancel(advanceId: string, reason: string): Promise<CustomerAdvance> {
    const { data, error } = await supabase.rpc('cancel_customer_advance', { p_advance_id: advanceId, p_reason: reason, p_created_by: currentUserName() })
    if (error) throw fail(error, 'Unable to cancel the advance')
    return mapAdvance((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
}

// ── Old gold exchange ──────────────────────────────────────────────────────
export interface OldGoldEntry {
  description: string
  metalType: string
  purity: string
  testedPurity: number | null
  grossWeight: number
  stoneWeight: number
  netWeight: number
  meltingDeductionPercent: number
  exchangeRate: number
  otherDeduction: number
  netValue: number
}

export interface OldGoldRecord extends OldGoldEntry {
  id: string
  exchangeNumber: string
  /** billing = part-payment on a bill; counter = bought at the Sales Desk without a bill */
  source: 'billing' | 'counter'
  /** Counter purchases only: paid to the customer now, or kept as store credit (an advance) */
  settlement: 'paid' | 'credit' | null
  payoutMethod: string
  advanceId: string | null
  orderId: string | null
  invoiceNo: string
  customerName: string
  phone: string
  createdBy: string
  createdAt: string
}

const mapOldGold = (r: Record<string, unknown>): OldGoldRecord => ({
  id: str(r.id), exchangeNumber: str(r.exchange_number),
  source: r.source === 'counter' || (r.source == null && !r.order_id && !r.invoice_no) ? 'counter' : 'billing',
  settlement: r.settlement === 'paid' || r.settlement === 'credit' ? r.settlement : null,
  payoutMethod: str(r.payout_method), advanceId: r.advance_id ? str(r.advance_id) : null,
  orderId: r.order_id ? str(r.order_id) : null, invoiceNo: str(r.invoice_no),
  customerName: str(r.customer_name), phone: str(r.phone), description: str(r.description), metalType: str(r.metal_type), purity: str(r.purity),
  testedPurity: r.tested_purity == null ? null : toNumber(r.tested_purity, 0), grossWeight: toNumber(r.gross_weight, 0),
  stoneWeight: toNumber(r.stone_weight, 0), netWeight: toNumber(r.net_weight, 0), meltingDeductionPercent: toNumber(r.melting_deduction_percent, 0),
  exchangeRate: toNumber(r.exchange_rate, 0), otherDeduction: toNumber(r.other_deduction, 0), netValue: toNumber(r.net_value, 0),
  createdBy: str(r.created_by), createdAt: str(r.created_at),
})

export const oldGoldService = {
  async list(): Promise<OldGoldRecord[]> {
    const { data, error } = await supabase.from('old_gold_exchanges').select('*').order('created_at', { ascending: false }).limit(2000)
    if (error) throw fail(error, 'Unable to load old gold exchanges')
    return (data || []).map((r) => mapOldGold(r as Record<string, unknown>))
  },
  async listByPhone(phone: string): Promise<OldGoldRecord[]> {
    const { data, error } = await supabase.from('old_gold_exchanges').select('*').eq('phone', phone.trim()).order('created_at', { ascending: false })
    if (error) return []
    return (data || []).map((r) => mapOldGold(r as Record<string, unknown>))
  },
  /** Records the old metal taken on a bill, linked to that bill. */
  async recordForOrder(entries: OldGoldEntry[], order: { orderId: string; invoiceNo: string; customerName: string; phone: string }) {
    if (!entries.length) return
    const { error } = await supabase.from('old_gold_exchanges').insert(entries.map((e) => ({
      order_id: order.orderId, invoice_no: order.invoiceNo, customer_name: order.customerName, phone: order.phone,
      description: e.description, metal_type: e.metalType, purity: e.purity, tested_purity: e.testedPurity,
      gross_weight: e.grossWeight, stone_weight: e.stoneWeight, net_weight: e.netWeight,
      melting_deduction_percent: e.meltingDeductionPercent, exchange_rate: e.exchangeRate,
      other_deduction: e.otherDeduction, net_value: e.netValue, created_by: currentUserName(),
    })))
    if (error) throw fail(error, 'Unable to record the old gold exchange')
  },
  /** Old gold bought at the counter without a bill: the customer is paid now or gets store credit. */
  async recordCounter(entry: Omit<OldGoldEntry, 'netWeight' | 'netValue'>, customer: { customerName: string; phone: string },
    settlement: 'paid' | 'credit', payoutMethod: string): Promise<{ exchange: OldGoldRecord; advance: CustomerAdvance | null }> {
    const { data, error } = await supabase.rpc('record_counter_old_gold', {
      p_customer_name: customer.customerName, p_phone: customer.phone, p_description: entry.description,
      p_metal_type: entry.metalType, p_purity: entry.purity, p_tested_purity: entry.testedPurity,
      p_gross_weight: entry.grossWeight, p_stone_weight: entry.stoneWeight, p_melting_deduction_percent: entry.meltingDeductionPercent,
      p_exchange_rate: entry.exchangeRate, p_other_deduction: entry.otherDeduction,
      p_settlement: settlement, p_payout_method: payoutMethod, p_created_by: currentUserName(),
    })
    if (error) throw fail(error, 'Unable to record the old gold purchase')
    const result = data as { exchange: Record<string, unknown>; advance: Record<string, unknown> | null }
    return { exchange: mapOldGold(result.exchange), advance: result.advance ? mapAdvance(result.advance) : null }
  },
}

// ── Returns & exchanges ────────────────────────────────────────────────────
export interface ReturnLine {
  line: number
  name: string
  quantity: number
  soldQuantity: number
  lineTotal: number
  amount: number
  product_id: string | null
  variant_id: string | null
  is_manual: boolean
  jewellery: unknown
}

export interface SalesReturn {
  id: string
  returnNumber: string
  orderId: string | null
  invoiceNo: string
  customerName: string
  phone: string
  items: ReturnLine[]
  returnType: 'refund' | 'exchange'
  reason: string
  refundAmount: number
  refundMethod: string
  status: 'pending' | 'approved' | 'rejected'
  creditAdvanceId: string | null
  createdBy: string
  approvedBy: string
  approvedAt: string | null
  createdAt: string
}

const mapReturn = (r: Record<string, unknown>): SalesReturn => ({
  id: str(r.id), returnNumber: str(r.return_number), orderId: r.order_id ? str(r.order_id) : null, invoiceNo: str(r.invoice_no),
  customerName: str(r.customer_name), phone: str(r.phone), items: Array.isArray(r.items) ? (r.items as ReturnLine[]) : [],
  returnType: r.return_type === 'exchange' ? 'exchange' : 'refund', reason: str(r.reason), refundAmount: toNumber(r.refund_amount, 0),
  refundMethod: str(r.refund_method), status: r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending',
  creditAdvanceId: r.credit_advance_id ? str(r.credit_advance_id) : null, createdBy: str(r.created_by), approvedBy: str(r.approved_by),
  approvedAt: r.approved_at ? str(r.approved_at) : null, createdAt: str(r.created_at),
})

export const returnService = {
  async list(): Promise<SalesReturn[]> {
    const { data, error } = await supabase.from('sales_returns').select('*').order('created_at', { ascending: false }).limit(2000)
    if (error) throw fail(error, 'Unable to load returns')
    return (data || []).map((r) => mapReturn(r as Record<string, unknown>))
  },
  async listForOrder(orderId: string): Promise<SalesReturn[]> {
    const { data, error } = await supabase.from('sales_returns').select('*').eq('order_id', orderId)
    if (error) throw fail(error, 'Unable to load returns for this invoice')
    return (data || []).map((r) => mapReturn(r as Record<string, unknown>))
  },
  async create(input: {
    orderId: string; invoiceNo: string; customerName: string; phone: string; items: ReturnLine[]
    returnType: 'refund' | 'exchange'; reason: string; refundAmount: number; refundMethod: string
  }): Promise<SalesReturn> {
    const { data, error } = await supabase.from('sales_returns').insert({
      order_id: input.orderId, invoice_no: input.invoiceNo, customer_name: input.customerName, phone: input.phone,
      items: input.items, return_type: input.returnType, reason: input.reason.trim(),
      refund_amount: Math.round(input.refundAmount * 100) / 100, refund_method: input.returnType === 'exchange' ? 'exchange' : input.refundMethod,
      created_by: currentUserName(),
    }).select('*').single()
    if (error) throw fail(error, 'Unable to record the return')
    return mapReturn(data as Record<string, unknown>)
  },
  async approve(id: string): Promise<SalesReturn> {
    const { data, error } = await supabase.rpc('approve_sales_return', { p_return_id: id, p_approved_by: currentUserName() })
    if (error) throw fail(error, 'Unable to approve the return')
    return mapReturn((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
  async reject(id: string): Promise<SalesReturn> {
    const { data, error } = await supabase.rpc('reject_sales_return', { p_return_id: id, p_rejected_by: currentUserName() })
    if (error) throw fail(error, 'Unable to reject the return')
    return mapReturn((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
}

// ── Quotations ─────────────────────────────────────────────────────────────
export interface Quotation {
  id: string
  quotationNumber: string
  customerName: string
  phone: string
  items: Array<Record<string, unknown>>
  subtotal: number
  discount: number
  gst: number
  total: number
  validUntil: string | null
  notes: string
  status: 'open' | 'converted' | 'cancelled'
  createdBy: string
  createdAt: string
}

const mapQuotation = (r: Record<string, unknown>): Quotation => ({
  id: str(r.id), quotationNumber: str(r.quotation_number), customerName: str(r.customer_name), phone: str(r.phone),
  items: Array.isArray(r.items) ? (r.items as Array<Record<string, unknown>>) : [], subtotal: toNumber(r.subtotal, 0),
  discount: toNumber(r.discount, 0), gst: toNumber(r.gst, 0), total: toNumber(r.total, 0),
  validUntil: r.valid_until ? str(r.valid_until).slice(0, 10) : null, notes: str(r.notes),
  status: r.status === 'converted' || r.status === 'cancelled' ? r.status : 'open', createdBy: str(r.created_by), createdAt: str(r.created_at),
})

export const quotationService = {
  async list(): Promise<Quotation[]> {
    const { data, error } = await supabase.from('quotations').select('*').order('created_at', { ascending: false }).limit(2000)
    if (error) throw fail(error, 'Unable to load quotations')
    return (data || []).map((r) => mapQuotation(r as Record<string, unknown>))
  },
  async create(input: { customerName: string; phone: string; items: Array<Record<string, unknown>>; subtotal: number; discount: number; gst: number; total: number; validUntil: string | null; notes: string }): Promise<Quotation> {
    const { data, error } = await supabase.from('quotations').insert({
      customer_name: input.customerName, phone: input.phone, items: input.items, subtotal: input.subtotal, discount: input.discount,
      gst: input.gst, total: input.total, valid_until: input.validUntil, notes: input.notes, created_by: currentUserName(),
    }).select('*').single()
    if (error) throw fail(error, 'Unable to save the quotation')
    return mapQuotation(data as Record<string, unknown>)
  },
  async setStatus(id: string, status: Quotation['status']) {
    const { error } = await supabase.from('quotations').update({ status }).eq('id', id)
    if (error) throw fail(error, 'Unable to update the quotation')
  },
}

// ── Repairs ────────────────────────────────────────────────────────────────
export type RepairStatus = 'received' | 'in_repair' | 'ready' | 'delivered' | 'cancelled'
export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  received: 'Received', in_repair: 'In Repair', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled',
}

export interface Repair {
  id: string
  repairNumber: string
  customerName: string
  phone: string
  itemName: string
  description: string
  metalType: string
  weight: number
  receivedDate: string
  expectedDate: string | null
  repairCharge: number
  advancePaid: number
  balance: number
  status: RepairStatus
  deliveredAt: string | null
  notes: string
  createdBy: string
  createdAt: string
}

const mapRepair = (r: Record<string, unknown>): Repair => {
  const charge = toNumber(r.repair_charge, 0)
  const adv = toNumber(r.advance_paid, 0)
  const status = str(r.status) as RepairStatus
  return {
    id: str(r.id), repairNumber: str(r.repair_number), customerName: str(r.customer_name), phone: str(r.phone), itemName: str(r.item_name),
    description: str(r.description), metalType: str(r.metal_type), weight: toNumber(r.weight, 0), receivedDate: str(r.received_date).slice(0, 10),
    expectedDate: r.expected_date ? str(r.expected_date).slice(0, 10) : null, repairCharge: charge, advancePaid: adv,
    balance: Math.max(0, Math.round((charge - adv) * 100) / 100),
    status: (Object.keys(REPAIR_STATUS_LABELS) as RepairStatus[]).includes(status) ? status : 'received',
    deliveredAt: r.delivered_at ? str(r.delivered_at) : null, notes: str(r.notes), createdBy: str(r.created_by), createdAt: str(r.created_at),
  }
}

export const repairService = {
  async list(): Promise<Repair[]> {
    const { data, error } = await supabase.from('repairs').select('*').order('created_at', { ascending: false }).limit(2000)
    if (error) throw fail(error, 'Unable to load repairs')
    return (data || []).map((r) => mapRepair(r as Record<string, unknown>))
  },
  async listByPhone(phone: string): Promise<Repair[]> {
    const { data, error } = await supabase.from('repairs').select('*').eq('phone', phone.trim()).order('created_at', { ascending: false })
    if (error) return []
    return (data || []).map((r) => mapRepair(r as Record<string, unknown>))
  },
  async create(input: { customerName: string; phone: string; itemName: string; description: string; metalType: string; weight: number; expectedDate: string | null; repairCharge: number; advancePaid: number; notes: string }): Promise<Repair> {
    const { data, error } = await supabase.from('repairs').insert({
      customer_name: input.customerName.trim(), phone: input.phone.trim(), item_name: input.itemName.trim(), description: input.description.trim(),
      metal_type: input.metalType, weight: input.weight, expected_date: input.expectedDate, repair_charge: input.repairCharge,
      advance_paid: input.advancePaid, notes: input.notes.trim(), created_by: currentUserName(),
    }).select('*').single()
    if (error) throw fail(error, 'Unable to save the repair')
    await supabase.from('customers').upsert({ phone: input.phone.trim(), name: input.customerName.trim(), updated_at: new Date().toISOString() }, { onConflict: 'phone', ignoreDuplicates: true })
    return mapRepair(data as Record<string, unknown>)
  },
  async update(id: string, patch: { status?: RepairStatus; repairCharge?: number; advancePaid?: number; expectedDate?: string | null }): Promise<Repair> {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (patch.status) {
      row.status = patch.status
      if (patch.status === 'delivered') row.delivered_at = new Date().toISOString()
    }
    if (patch.repairCharge != null) row.repair_charge = patch.repairCharge
    if (patch.advancePaid != null) row.advance_paid = patch.advancePaid
    if (patch.expectedDate !== undefined) row.expected_date = patch.expectedDate
    const { data, error } = await supabase.from('repairs').update(row).eq('id', id).select('*').single()
    if (error) throw fail(error, 'Unable to update the repair')
    return mapRepair(data as Record<string, unknown>)
  },
}

export type DeskTable = 'quotations' | 'sales_returns' | 'old_gold_exchanges' | 'customer_advances' | 'repairs'

/** Permanently deletes one Sales Desk record (admin only in the app). */
export async function deleteDeskRecord(table: DeskTable, id: string): Promise<void> {
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id')
  if (error) {
    // An advance that was ever applied to a bill keeps its usage history and cannot be removed.
    if (String((error as { code?: string }).code) === '23503') throw new Error('This record is linked to a bill and cannot be deleted.')
    throw fail(error, 'Unable to delete the record')
  }
  if (!data || data.length === 0) throw new Error('The record was not deleted (it may already be gone).')
}
