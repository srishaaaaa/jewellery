import type { UnitType } from './retail'

export type LocalOrderItem = {
  id?: string | null
  product_id?: string | null
  name: string
  nameTa?: string | null
  tamil_name?: string | null
  price: number
  offerPrice?: number | null
  qty: number
  quantity?: number
  unit?: string
  unit_type?: UnitType
  base_quantity?: number
  base_price?: number
  line_total?: number
  image?: string | null
  image_url?: string | null
}

export type LocalOrder = {
  id: string
  invoice_no: string
  user_id: string | null
  customer_name: string
  phone: string
  address: string
  items: LocalOrderItem[]
  subtotal: number
  shipping: number
  total: number
  status: 'pending' | 'processing' | 'completed' | 'cancelled'
  order_type?: 'online_request' | 'pos_sale' | 'manual_sale'
  created_at: string
}

const STORAGE_KEY = 'mahalashmi_stores_orders'

export function getLocalOrders(): LocalOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveLocalOrders(orders: LocalOrder[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders))
}

export function clearLocalOrders() {
  localStorage.removeItem(STORAGE_KEY)
}

export function createLocalOrder(input: {
  userId?: string | null
  customerName: string
  phone: string
  address: string
  items: LocalOrderItem[]
  subtotal: number
  shipping: number
  total: number
  orderType?: 'online_request' | 'pos_sale' | 'manual_sale'
}): LocalOrder {
  const now = new Date()
  const order: LocalOrder = {
    id: `local-${Date.now()}`,
    invoice_no: `INV-${now.getFullYear()}-${Date.now().toString().slice(-6)}`,
    user_id: input.userId || null,
    customer_name: input.customerName,
    phone: input.phone,
    address: input.address,
    items: input.items,
    subtotal: input.subtotal,
    shipping: input.shipping,
    total: input.total,
    status: 'pending',
    order_type: input.orderType || 'online_request',
    created_at: now.toISOString(),
  }

  const all = getLocalOrders()
  saveLocalOrders([order, ...all])
  return order
}

export function getLocalOrdersForUser(input: { userId?: string; phone?: string }) {
  const orders = getLocalOrders()
  const cleanPhone = (input.phone || '').replace(/\D/g, '')

  return orders.filter((order) => {
    if (input.userId && order.user_id && order.user_id === input.userId) return true
    if (cleanPhone && (order.phone || '').replace(/\D/g, '') === cleanPhone) return true
    return false
  })
}
