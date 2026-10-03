import { supabase } from '../lib/supabase'
import { toNumber } from '../lib/retail'
import { isMissingSchemaError } from './productService'
import { currentUserName } from './auditService'

export const PURCHASES_MIGRATION_HINT =
  'Purchases need the database update: run supabase/migrations/jewellery_pos.sql again in the Supabase SQL Editor.'

const fail = (error: unknown, fallback: string) => {
  if (isMissingSchemaError(error) || (error as { code?: string })?.code === 'PGRST202') return new Error(PURCHASES_MIGRATION_HINT)
  return new Error((error as { message?: string } | null)?.message || fallback)
}

const str = (v: unknown) => (v == null ? '' : String(v))

// ── Suppliers ──────────────────────────────────────────────────────────────
export interface Supplier {
  id: string
  name: string
  phone: string
  gstin: string
  address: string
  notes: string
  isActive: boolean
  createdAt: string
}

const mapSupplier = (r: Record<string, unknown>): Supplier => ({
  id: str(r.id), name: str(r.name), phone: str(r.phone), gstin: str(r.gstin), address: str(r.address),
  notes: str(r.notes), isActive: r.is_active !== false, createdAt: str(r.created_at),
})

export type SupplierInput = Pick<Supplier, 'name' | 'phone' | 'gstin' | 'address' | 'notes'>

export const supplierService = {
  async list(): Promise<Supplier[]> {
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) throw fail(error, 'Unable to load suppliers')
    return (data || []).map((r) => mapSupplier(r as Record<string, unknown>))
  },
  async save(input: SupplierInput, id?: string): Promise<Supplier> {
    const row = {
      name: input.name.trim(), phone: input.phone.trim(), gstin: input.gstin.trim().toUpperCase(),
      address: input.address.trim(), notes: input.notes.trim(), updated_at: new Date().toISOString(),
    }
    const query = id ? supabase.from('suppliers').update(row).eq('id', id) : supabase.from('suppliers').insert(row)
    const { data, error } = await query.select('*').single()
    if (error) throw fail(error, 'Unable to save the supplier')
    return mapSupplier(data as Record<string, unknown>)
  },
  async setActive(id: string, isActive: boolean) {
    const { error } = await supabase.from('suppliers').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw fail(error, 'Unable to update the supplier')
  },
}

// ── Purchases ──────────────────────────────────────────────────────────────
export interface PurchaseLine {
  /** Catalogue item this line restocks (null = not linked, e.g. bullion or loose stones) */
  product_id: string | null
  description: string
  metal_type: string
  purity: string
  gross_weight: number
  stone_weight: number
  net_weight: number
  /** Rate per gram of net weight */
  rate: number
  making_cost: number
  other_cost: number
  stone_details: string
  quantity: number
  /** Line total; recalculated by the database when weight and rate are given */
  amount: number
}

export interface Purchase {
  id: string
  purchaseNumber: string
  supplierId: string
  supplierInvoiceNo: string
  purchaseDate: string
  items: PurchaseLine[]
  totalAmount: number
  amountPaid: number
  due: number
  notes: string
  createdBy: string
  createdAt: string
}

const mapLine = (r: Record<string, unknown>): PurchaseLine => ({
  product_id: r.product_id ? str(r.product_id) : null, description: str(r.description), metal_type: str(r.metal_type),
  purity: str(r.purity), gross_weight: toNumber(r.gross_weight, 0), stone_weight: toNumber(r.stone_weight, 0),
  net_weight: toNumber(r.net_weight, 0), rate: toNumber(r.rate, 0), making_cost: toNumber(r.making_cost, 0),
  other_cost: toNumber(r.other_cost, 0), stone_details: str(r.stone_details), quantity: toNumber(r.quantity, 1), amount: toNumber(r.amount, 0),
})

const mapPurchase = (r: Record<string, unknown>): Purchase => {
  const total = toNumber(r.total_amount, 0)
  const paid = toNumber(r.amount_paid, 0)
  return {
    id: str(r.id), purchaseNumber: str(r.purchase_number), supplierId: str(r.supplier_id), supplierInvoiceNo: str(r.supplier_invoice_no),
    purchaseDate: str(r.purchase_date).slice(0, 10),
    items: (Array.isArray(r.items) ? r.items : []).map((it) => mapLine(it as Record<string, unknown>)),
    totalAmount: total, amountPaid: paid, due: Math.max(0, Math.round((total - paid) * 100) / 100),
    notes: str(r.notes), createdBy: str(r.created_by), createdAt: str(r.created_at),
  }
}

export interface SupplierPayment {
  id: string
  purchaseId: string | null
  amount: number
  paymentMethod: string
  reference: string
  notes: string
  paidAt: string
  createdBy: string
}

const mapPayment = (r: Record<string, unknown>): SupplierPayment => ({
  id: str(r.id), purchaseId: r.purchase_id ? str(r.purchase_id) : null, amount: toNumber(r.amount, 0), paymentMethod: str(r.payment_method),
  reference: str(r.reference), notes: str(r.notes), paidAt: str(r.paid_at), createdBy: str(r.created_by),
})

export const purchaseService = {
  async list(): Promise<Purchase[]> {
    const { data, error } = await supabase.from('supplier_purchases').select('*').order('purchase_date', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
    if (error) throw fail(error, 'Unable to load purchases')
    return (data || []).map((r) => mapPurchase(r as Record<string, unknown>))
  },
  async payments(purchaseId: string): Promise<SupplierPayment[]> {
    const { data, error } = await supabase.from('supplier_payments').select('*').eq('purchase_id', purchaseId).order('paid_at', { ascending: false })
    if (error) throw fail(error, 'Unable to load payments')
    return (data || []).map((r) => mapPayment(r as Record<string, unknown>))
  },
  /** Records the supplier's bill; linked catalogue items gain stock and take this cost price. */
  async create(input: {
    supplierId: string; supplierInvoiceNo: string; purchaseDate: string; items: Array<Omit<PurchaseLine, 'net_weight'>>
    amountPaid: number; paymentMethod: string; reference: string; notes: string
  }): Promise<Purchase> {
    const { data, error } = await supabase.rpc('record_supplier_purchase', {
      p_supplier_id: input.supplierId, p_supplier_invoice_no: input.supplierInvoiceNo, p_purchase_date: input.purchaseDate,
      p_items: input.items, p_amount_paid: input.amountPaid, p_payment_method: input.paymentMethod, p_reference: input.reference,
      p_notes: input.notes, p_created_by: currentUserName(),
    })
    if (error) throw fail(error, 'Unable to record the purchase')
    return mapPurchase((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
  async pay(purchaseId: string, amount: number, paymentMethod: string, reference: string, notes = ''): Promise<Purchase> {
    const { data, error } = await supabase.rpc('record_supplier_payment', {
      p_purchase_id: purchaseId, p_amount: amount, p_payment_method: paymentMethod, p_reference: reference, p_notes: notes, p_created_by: currentUserName(),
    })
    if (error) throw fail(error, 'Unable to record the payment')
    return mapPurchase((Array.isArray(data) ? data[0] : data) as Record<string, unknown>)
  },
}
