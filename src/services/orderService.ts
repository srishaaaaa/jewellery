import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { StructuredOrderItem } from '../lib/retail'

type CreateOrderInput = {
  customerName: string
  phone: string
  address: string
  items: StructuredOrderItem[]
  shipping: number
  status?: string
  orderMode?: 'online' | 'offline'
  orderType?: 'online_request' | 'pos_sale' | 'manual_sale'
  deliveryCharge?: number
  discountAmount?: number
  manualDiscountAmount?: number
  manualDiscountType?: 'flat' | 'percent'
  manualDiscountValue?: number
  couponCode?: string
  couponPercentage?: number

  // POS additions
  paymentMethod?: string
  splitDetails?: Record<string, unknown>
  totalGst?: number
  gstEnabled?: boolean

  // Credit (pay-later) sale
  isCredit?: boolean
  creditDueDate?: string
}

type CreatedOrder = {
  orderId: string
  invoiceNo: string
  createdAt: string
}

export const createOrderWithStock = async (input: CreateOrderInput): Promise<CreatedOrder> => {
  const customerName   = input.customerName.trim() || 'Customer'
  const phone          = input.phone.trim()
  const address        = input.address.trim()
  const shipping       = Number(input.shipping || 0)
  const status         = input.status || 'pending'
  const orderMode      = input.orderMode || 'online'
  const orderType      = input.orderType || (status === 'pending' && orderMode === 'online' ? 'online_request' : 'pos_sale')
  const deliveryCharge = Number(input.deliveryCharge || 0)
  const discountAmount = Number(input.discountAmount || 0)
  const manualDiscountAmount = Number(input.manualDiscountAmount || 0)
  const manualDiscountType = input.manualDiscountType || 'flat'
  const manualDiscountValue = Number(input.manualDiscountValue || 0)
  const couponCode     = input.couponCode?.trim() || null
  const couponPercentage = Number(input.couponPercentage || 0)
  const effectiveDiscount = discountAmount + manualDiscountAmount

  if (!isSupabaseConfigured) {
    throw new Error('Supabase is required to create orders')
  }

  // Match the RPC signature currently defined in the migration files.
  let data: unknown = null
  let error: unknown = null

  const totalGst        = Number(input.totalGst || 0)
  const gstEnabled      = Boolean(input.gstEnabled)
  const paymentMethod   = input.paymentMethod || 'cash'
  const splitDetails    = input.splitDetails || {}
  const isCredit        = Boolean(input.isCredit)
  const creditDueDate   = input.creditDueDate?.trim() || null

  const rpcPayload = {
    p_customer_name:          customerName,
    p_phone:                  phone,
    p_address:                address,
    p_items:                  input.items,
    p_shipping:               shipping,
    p_status:                 status,
    p_order_mode:             orderMode,
    p_order_type:             orderType,
    p_delivery_charge:        deliveryCharge,
    p_discount_amount:        discountAmount,
    p_manual_discount_amount: manualDiscountAmount,
    p_manual_discount_type:   manualDiscountType,
    p_manual_discount_value:  manualDiscountValue,
    p_coupon_code:            couponCode,
    p_coupon_percentage:      couponPercentage,
    p_total_gst:              totalGst,
    p_gst_enabled:            gstEnabled,
    p_payment_method:         paymentMethod,
    p_split_details:          splitDetails,
  }

  // 1. Try complete_pos_sale_with_inventory (inventory-aware transaction with atomic stock checks & movements ledger)
  // Credit fields are only passed here — create_order_with_stock and the legacy
  // fallback below don't declare those params, so reusing rpcPayload as-is for
  // them keeps those calls working even before migration 0031 is deployed.
  const inventoryRpcResult = await supabase.rpc('complete_pos_sale_with_inventory', {
    ...rpcPayload,
    p_credit_due_date: creditDueDate,
    p_is_credit: isCredit,
  })
  data = inventoryRpcResult.data
  error = inventoryRpcResult.error

  // 2. Fallback to create_order_with_stock if migration 0012 is not yet deployed
  if (inventoryRpcResult.error?.code === 'PGRST202') {
    const newRpcResult = await supabase.rpc('create_order_with_stock', rpcPayload)
    data = newRpcResult.data
    error = newRpcResult.error

    // 3. Fallback to create_order_without_stock for legacy setups
    if (newRpcResult.error?.code === 'PGRST202') {
    const legacyResult = await supabase.rpc('create_order_without_stock', {
      p_address:                address,
      p_coupon_code:            couponCode,
      p_coupon_percentage:      couponPercentage,
      p_customer_name:          customerName,
      p_delivery_charge:        deliveryCharge,
      p_discount_amount:        discountAmount,
      p_items:                  input.items,
      p_manual_discount_amount: manualDiscountAmount,
      p_manual_discount_type:   manualDiscountType,
      p_manual_discount_value:  manualDiscountValue,
      p_order_mode:             orderMode,
      p_order_type:             orderType,
      p_phone:                  phone,
      p_shipping:               shipping,
      p_status:                 status,
    })
    data = legacyResult.data
    error = legacyResult.error

    const legacyRow = Array.isArray(data) ? data[0] : data
    if (!error && legacyRow && typeof legacyRow === 'object') {
      const legacyOrderId = String((legacyRow as Record<string, unknown>).order_id ?? '')
      if (legacyOrderId) {
        const legacySubtotal = input.items.reduce((sum, item) => sum + Number(item.line_total || 0), 0)
        const legacyTotal = Math.max(
          0,
          legacySubtotal + shipping + deliveryCharge + totalGst - effectiveDiscount,
        )
        await supabase
          .from('orders')
          .update({
            subtotal: legacySubtotal,
            shipping,
            delivery_charge: deliveryCharge,
            total: legacyTotal,
            payment_method: paymentMethod,
            payment_mode: paymentMethod,
            total_gst: totalGst,
            gst_amount: totalGst,
          })
          .eq('id', legacyOrderId)
      }
    }
    }
  }



  if (error) {
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const err = error as { message: unknown; details?: unknown }
      const message = String(err.message)
      if (/invalid api key|invalid value.*apikey|apikey.*invalid/i.test(message)) {
        throw new Error('Supabase configuration is invalid. Please redeploy with the correct Supabase URL and publishable key.')
      }
      throw new Error(message + (err.details ? ` (${String(err.details)})` : ''))
    }
    throw new Error(String(error))
  }

  const row = Array.isArray(data) ? (data as unknown[])[0] : data
  if (!row || typeof row !== 'object') {
    throw new Error('Order RPC returned an invalid payload')
  }
  const rowObj = row as Record<string, unknown>
  const orderId = String(rowObj.order_id ?? rowObj.orderId ?? rowObj.id ?? '')
  const invoiceNo = String(rowObj.invoice_no ?? rowObj.invoiceNo ?? '')
  if (!orderId || !invoiceNo) {
    throw new Error('Order RPC returned an invalid payload')
  }

  // NOTE: coupon usage_count is already incremented atomically inside the
  // create_order_with_stock DB function. Do NOT increment it again here.

  return {
    orderId,
    invoiceNo,
    createdAt: new Date().toISOString(),
  }
}
