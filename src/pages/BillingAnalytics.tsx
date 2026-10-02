import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  BarChart2,
  Download,
  LayoutDashboard,
  RefreshCw,
  Search,
  ShoppingCart,
  Trophy,
  Wallet,
  CreditCard,
  Smartphone,
  Zap,
} from 'lucide-react'
import CompactAnalytics from '../components/dashboard/CompactAnalytics'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

// Custom Malaysian Ringgit icon
const RMIcon = ({ size = 16, className = '' }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-label="Malaysian Ringgit"
  >
    <rect x="2" y="2" width="20" height="20" rx="4" />
    <text
      x="12"
      y="16"
      textAnchor="middle"
      fontSize="9"
      fontWeight="bold"
      stroke="none"
      fill="currentColor"
      fontFamily="Arial, sans-serif"
    >₹</text>
  </svg>
)
import { useAuthStore, useProductStore, type Product } from '../store/store'
import { formatInvoiceNo, formatCurrency, normalizeOrderMode, toNumber } from '../lib/retail'
import { getPresetRange, startOfWeekMonday, toLocalDateStr } from '../lib/dateRanges'
import { csvDate, csvPhone, toCsv } from '../lib/csv'

type BillingOrder = {
  id: string
  invoice_no: string
  customer_name: string
  phone: string
  address: string
  created_at: string
  total: number
  status: string
  order_mode: string
  order_type: string
  items: unknown
  coupon_code: string
  discount_amount: number
  delivery_charge: number
  payment_method?: string
}

type BillingOrderItem = {
  order_id: string
  product_name: string
  quantity: number
  line_total: number
  is_manual?: boolean | null
}

type BillingCoupon = {
  code: string
  usage: number
  discounts: number
}

type CategorySummary = {
  name: string
  qty: number
  revenue: number
}

type ProductSummary = {
  name: string
  variant: string
  qty: number
  revenue: number
  billCount: number
}

type AnalyticsModel = {
  totalCompletedRevenue: number
  todaySales: number
  completedOrders: number
  posRevenue: number
  onlinePosRevenue: number
  manualRevenue: number
  monthlyRevenue: number
  totalProductsSold: number
  bestCategory: string
  bestProduct: string
  monthlyTrend: { key: string; month: string; revenue: number }[]
  channelDistribution: { name: string; value: number; color: string }[]
  topCategories: CategorySummary[]
  weeklySales: { day: string; date: string; revenue: number }[]
  topProducts: ProductSummary[]
  topCoupons: BillingCoupon[]
  // Credit sale metrics
  totalCreditSales: number
  creditPaidAmount: number
  creditOutstandingAmount: number
  creditPaidCount: number
  creditOutstandingCount: number
  // Payment mode breakdown
  cashRevenue: number
  cardRevenue: number
  qrRevenue: number
  creditRevenue: number
}

const normalizeStatus = (value: unknown) => String(value || '').trim().toLowerCase()
const normalizeOrderType = (value: unknown) => String(value || '').trim().toLowerCase() || 'pos_sale'
const normalizePaymentMethod = (value: unknown) => String(value || '').trim().toLowerCase()
const isCompletedStatus = (value: unknown) => {
  const status = normalizeStatus(value)
  return status === 'completed' || status === 'paid'
}

const parseOrderItems = (items: unknown): Record<string, unknown>[] => {
  if (Array.isArray(items)) {
    return items.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
  }
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

const exportCSV = (orders: BillingOrder[]) => {
  const header = ['Invoice No', 'Customer', 'Phone', 'Bill Type', 'Coupon', 'Discount', 'Delivery', 'Total', 'Date', 'Status']
  const rows = orders.map((order) => {
    const billType = normalizeOrderType(order.order_type) === 'manual_sale'
      ? 'MANUAL'
      : normalizeOrderMode(order.order_mode) === 'online'
        ? 'ONLINE'
        : 'OFFLINE'
    return [
      order.invoice_no ? formatInvoiceNo(order.invoice_no) : '—',
      order.customer_name,
      csvPhone(order.phone),
      billType,
      order.coupon_code || '',
      toNumber(order.discount_amount, 0).toFixed(2),
      toNumber(order.delivery_charge, 0).toFixed(2),
      toNumber(order.total, 0).toFixed(2),
      csvDate(order.created_at, true),
      order.status,
    ]
  })

  const csv = toCsv([header, ...rows])

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `billing_analytics_${toLocalDateStr(new Date())}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function StatCard({
  label,
  helper,
  value,
  icon,
  bg,
  color,
}: {
  label: string
  helper: string
  value: string | number
  icon: ReactNode
  bg: string
  color: string
}) {
  return (
    <div className="rounded-2xl border border-[#E5E7EB]/30 bg-white p-3 sm:p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-[#374151]">{label}</p>
        <div className={`flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-xl ${bg} ${color}`}>{icon}</div>
      </div>
      <p className="mb-2 text-[11px] font-semibold text-[#7A846F]">{helper}</p>
      <p className="break-words text-[16px] sm:text-[22px] font-black leading-tight text-[#111111]">{value}</p>
    </div>
  )
}

export default function BillingAnalytics() {
  const { user, loading: authLoading } = useAuthStore()
  const { products, fetchProducts } = useProductStore()
  const l = (en: string, _ta?: string) => en

  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState<BillingOrder[]>([])
  const [orderItems, setOrderItems] = useState<BillingOrderItem[]>([])
  const [analyticsDatePreset, setAnalyticsDatePreset] = useState<'all' | 'today' | 'week' | 'month' | 'year' | 'custom'>('all')
  const [analyticsDateFrom, setAnalyticsDateFrom] = useState('')
  const [analyticsDateTo, setAnalyticsDateTo] = useState('')
  const [billTypeFilter, setBillTypeFilter] = useState<'all' | 'offline' | 'online' | 'manual'>('all')
  const [billSearch, setBillSearch] = useState({
    invoiceNo: '',
    customerName: '',
    phone: '',
    dateFrom: '',
    dateTo: '',
  })

  const isAdmin = user?.role === 'admin'

  const toBillingOrder = (row: Record<string, unknown>): BillingOrder => ({
    id: String(row.id || ''),
    invoice_no: String(row.invoice_no || ''),
    customer_name: String(row.customer_name || ''),
    phone: String(row.phone || ''),
    address: String(row.address || ''),
    created_at: String(row.created_at || ''),
    total: toNumber(row.total, 0),
    status: String(row.status || 'pending'),
    order_mode: normalizeOrderMode(row.order_mode),
    order_type: normalizeOrderType(row.order_type),
    items: row.items,
    coupon_code: String(row.coupon_code || ''),
    discount_amount: toNumber(row.discount_amount, 0),
    delivery_charge: toNumber(row.delivery_charge, 0),
  })

  const applyAnalyticsPreset = (preset: 'all' | 'today' | 'week' | 'month' | 'year' | 'custom') => {
    setAnalyticsDatePreset(preset)
    if (preset === 'all') {
      setAnalyticsDateFrom('')
      setAnalyticsDateTo('')
      return
    }
    if (preset === 'custom') return

    const { from, to } = getPresetRange(preset)
    setAnalyticsDateFrom(from)
    setAnalyticsDateTo(to)
  }

  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured) return

    setLoading(true)
    try {
      const [ordersRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id, invoice_no, customer_name, phone, address, created_at, total, status, order_mode, order_type, items, coupon_code, discount_amount, delivery_charge')
          .order('created_at', { ascending: false })
          .limit(1000),
        fetchProducts(true),
      ])

      const mappedOrders = (ordersRes.data || []).map((row) => toBillingOrder(row as Record<string, unknown>))
      setOrders(mappedOrders)

      const orderIds = mappedOrders.map((order) => order.id).filter(Boolean)
      if (orderIds.length > 0) {
        const itemsRes = await supabase
          .from('order_items')
          .select('order_id, product_name, quantity, line_total, is_manual')
          .in('order_id', orderIds)

        let rows: Array<Record<string, unknown>> = (itemsRes.data || []) as Array<Record<string, unknown>>
        if (itemsRes.error) {
          const fallbackRes = await supabase
            .from('order_items')
            .select('order_id, product_name, quantity, line_total')
            .in('order_id', orderIds)
          rows = (fallbackRes.data || []) as Array<Record<string, unknown>>
        }

        setOrderItems(rows.map((row) => ({
          order_id: String((row as Record<string, unknown>).order_id || ''),
          product_name: String((row as Record<string, unknown>).product_name || 'Product'),
          quantity: toNumber((row as Record<string, unknown>).quantity, 0),
          line_total: toNumber((row as Record<string, unknown>).line_total, 0),
          is_manual: Boolean((row as Record<string, unknown>).is_manual ?? false),
        })))
      } else {
        setOrderItems([])
      }
    } finally {
      setLoading(false)
    }
  }, [fetchProducts])

  useEffect(() => {
    if (!isAdmin) return
    void loadData()
  }, [isAdmin, loadData])

  const analytics = useMemo<AnalyticsModel>(() => {
    let dated = orders
    if (analyticsDateFrom) dated = dated.filter((order) => order.created_at >= `${analyticsDateFrom}T00:00:00`)
    if (analyticsDateTo) dated = dated.filter((order) => order.created_at <= `${analyticsDateTo}T23:59:59`)

    const nonCancelled = dated.filter((order) => normalizeStatus(order.status) !== 'cancelled')
    const completedOrders = nonCancelled.filter((order) => isCompletedStatus(order.status))
    // TODO: Exclude unpaid credits from revenue once database columns are migrated
    // For now, include all completed orders
    const billableCompleted = completedOrders.filter((order) => normalizeOrderType(order.order_type) !== 'online_request')

    const offlinePOS = billableCompleted.filter(
      (order) => normalizeOrderType(order.order_type) === 'pos_sale' && normalizeOrderMode(order.order_mode) !== 'online',
    )
    const onlinePOS = billableCompleted.filter(
      (order) => normalizeOrderType(order.order_type) === 'pos_sale' && normalizeOrderMode(order.order_mode) === 'online',
    )
    const manualSales = billableCompleted.filter((order) => normalizeOrderType(order.order_type) === 'manual_sale')

    const completedRevenue = billableCompleted.reduce((sum, order) => sum + toNumber(order.total, 0), 0)
    const posRevenue = offlinePOS.reduce((sum, order) => sum + toNumber(order.total, 0), 0)
    const onlinePosRevenue = onlinePOS.reduce((sum, order) => sum + toNumber(order.total, 0), 0)
    const manualRevenue = manualSales.reduce((sum, order) => sum + toNumber(order.total, 0), 0)

    // Payment mode breakdown
    const cashRevenue = billableCompleted
      .filter((order) => normalizePaymentMethod(order.payment_method) === 'cash')
      .reduce((sum, order) => sum + toNumber(order.total, 0), 0)
    const cardRevenue = billableCompleted
      .filter((order) => normalizePaymentMethod(order.payment_method) === 'card')
      .reduce((sum, order) => sum + toNumber(order.total, 0), 0)
    const qrRevenue = billableCompleted
      .filter((order) => normalizePaymentMethod(order.payment_method) === 'upi')
      .reduce((sum, order) => sum + toNumber(order.total, 0), 0)

    // Credit metrics: will be enabled once database is migrated with is_credit and credit_status columns
    const totalCreditSales = 0
    const creditPaidAmount = 0
    const creditOutstandingAmount = 0
    const creditPaidCount = 0
    const creditOutstandingCount = 0
    const creditRevenue = 0

    // Local (IST) day and month of each bill, not the UTC date in its timestamp
    const todayKey = toLocalDateStr(new Date())
    const monthKey = todayKey.slice(0, 7)
    const todaySales = billableCompleted
      .filter((order) => toLocalDateStr(new Date(order.created_at)) === todayKey)
      .reduce((sum, order) => sum + toNumber(order.total, 0), 0)
    const monthlyRevenue = billableCompleted
      .filter((order) => toLocalDateStr(new Date(order.created_at)).startsWith(monthKey))
      .reduce((sum, order) => sum + toNumber(order.total, 0), 0)

    const completedIds = new Set(billableCompleted.map((order) => order.id))
    // Items saved on each counted bill; the older order_items table only for bills without them
    const legacyItemsByOrder = new Map<string, typeof orderItems>()
    orderItems.forEach((item) => {
      if (!completedIds.has(item.order_id)) return
      const list = legacyItemsByOrder.get(item.order_id) || []
      list.push(item)
      legacyItemsByOrder.set(item.order_id, list)
    })
    const completedItems = billableCompleted.flatMap((order) => {
      const rows = parseOrderItems(order.items)
      if (rows.length === 0) return legacyItemsByOrder.get(order.id) || []
      return rows.map((row) => ({
        order_id: order.id,
        product_name: String((row as Record<string, unknown>).product_name || (row as Record<string, unknown>).name || 'Product'),
        quantity: toNumber((row as Record<string, unknown>).quantity ?? (row as Record<string, unknown>).qty, 0),
        line_total: toNumber((row as Record<string, unknown>).line_total ?? (row as Record<string, unknown>).lineTotal, 0),
        is_manual: (row as Record<string, unknown>).is_manual === true || (row as Record<string, unknown>).source === 'manual',
      }))
    })

    const productMap = new Map<string, ProductSummary>()
    const productOrders = new Map<string, Set<string>>()
    const categoryMap = new Map<string, CategorySummary>()
    const prodCatLookup = new Map(products.map((product: Product) => [String(product.name || '').trim().toLowerCase(), product.category || 'Uncategorized']))

    let totalProductsSold = 0
    let totalManualRevenue = 0

    completedItems.forEach(({ product_name, quantity, line_total, order_id, is_manual }) => {
      const qty = toNumber(quantity, 0)
      const revenue = toNumber(line_total, 0)
      totalProductsSold += qty

      const rawKey = String(product_name || 'Product').trim() || 'Product'
      const dashIdx = rawKey.indexOf(' - ')
      const mainName = dashIdx > 0 ? rawKey.slice(0, dashIdx) : rawKey
      const variant = dashIdx > 0 ? rawKey.slice(dashIdx + 3) : ''

      const existingProduct = productMap.get(rawKey) || { name: mainName, variant, qty: 0, revenue: 0, billCount: 0 }
      existingProduct.qty += qty
      existingProduct.revenue += revenue
      productMap.set(rawKey, existingProduct)

      if (!productOrders.has(rawKey)) productOrders.set(rawKey, new Set())
      productOrders.get(rawKey)!.add(order_id)

      const categoryName = prodCatLookup.get(mainName.toLowerCase()) || 'Uncategorized'
      const existingCategory = categoryMap.get(categoryName) || { name: categoryName, qty: 0, revenue: 0 }
      existingCategory.qty += qty
      existingCategory.revenue += revenue
      categoryMap.set(categoryName, existingCategory)

      if (is_manual) totalManualRevenue += revenue
    })

    for (const [key, orderSet] of productOrders) {
      const item = productMap.get(key)
      if (item) {
        item.billCount = orderSet.size
        productMap.set(key, item)
      }
    }

    const topProducts = Array.from(productMap.values()).sort((a, b) => b.qty - a.qty)
    const topCategories = Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue)
    const bestProduct = topProducts[0]?.name || 'No sales yet'
    const bestCategory = topCategories[0]?.name || 'No sales yet'

    const monthlyRevenueMap = new Map<string, number>()
    billableCompleted.forEach((order) => {
      const key = order.created_at.slice(0, 7)
      monthlyRevenueMap.set(key, (monthlyRevenueMap.get(key) || 0) + toNumber(order.total, 0))
    })
    const monthlyTrend = Array.from({ length: 6 }, (_, index) => {
      const date = new Date()
      date.setMonth(date.getMonth() - (5 - index))
      const key = date.toISOString().slice(0, 7)
      return {
        key,
        month: date.toLocaleDateString('en-IN', { month: 'short' }),
        revenue: monthlyRevenueMap.get(key) || 0,
      }
    })

    const weeklyRevenueMap = new Map<string, number>()
    billableCompleted.forEach((order) => {
      // Local (IST) day, not the UTC day from the timestamp
      const key = toLocalDateStr(new Date(order.created_at))
      weeklyRevenueMap.set(key, (weeklyRevenueMap.get(key) || 0) + toNumber(order.total, 0))
    })
    const weekAnchor = new Date(`${analyticsDateTo || analyticsDateFrom || toLocalDateStr(new Date())}T00:00:00`)
    const weekStart = startOfWeekMonday(weekAnchor)
    // Week: Monday to Sunday
    const weeklySales = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart)
      date.setDate(weekStart.getDate() + index)
      const key = toLocalDateStr(date)
      return {
        day: date.toLocaleDateString('en-IN', { weekday: 'long' }),
        date: key,
        revenue: weeklyRevenueMap.get(key) || 0,
      }
    })

    const couponMap = new Map<string, BillingCoupon>()
    billableCompleted.forEach((order) => {
      const code = String(order.coupon_code || '').trim()
      if (!code) return
      const existing = couponMap.get(code) || { code, usage: 0, discounts: 0 }
      existing.usage += 1
      existing.discounts += toNumber(order.discount_amount, 0)
      couponMap.set(code, existing)
    })

    return {
      totalCompletedRevenue: completedRevenue,
      todaySales,
      completedOrders: billableCompleted.length,
      posRevenue,
      onlinePosRevenue,
      manualRevenue: manualRevenue || totalManualRevenue,
      monthlyRevenue,
      totalProductsSold,
      bestCategory,
      bestProduct,
      monthlyTrend,
      channelDistribution: [
        { name: 'Offline Bills', value: posRevenue, color: '#f97316' },
        { name: 'Online Bills', value: onlinePosRevenue, color: '#3b82f6' },
        { name: 'Manual Sales', value: manualRevenue || totalManualRevenue, color: '#8b5cf6' },
      ],
      topCategories,
      weeklySales,
      topProducts,
      topCoupons: Array.from(couponMap.values()).sort((a, b) => b.usage - a.usage),
      // Credit sale metrics
      totalCreditSales,
      creditPaidAmount,
      creditOutstandingAmount,
      creditPaidCount,
      creditOutstandingCount,
      // Payment mode breakdown
      cashRevenue,
      cardRevenue,
      qrRevenue,
      creditRevenue,
    }
  }, [analyticsDateFrom, analyticsDateTo, orderItems, orders, products])

  const filteredBills = useMemo(() => {
    const normalizedSearch = {
      invoiceNo: billSearch.invoiceNo.trim().toLowerCase(),
      customerName: billSearch.customerName.trim().toLowerCase(),
      phone: billSearch.phone.trim().toLowerCase(),
    }

    return orders.filter((order) => {
      const type = normalizeOrderType(order.order_type)
      const mode = normalizeOrderMode(order.order_mode)
      if (type === 'online_request') return false

      if (billTypeFilter === 'manual' && type !== 'manual_sale') return false
      if (billTypeFilter === 'offline' && !(type === 'pos_sale' && mode !== 'online')) return false
      if (billTypeFilter === 'online' && !(type === 'pos_sale' && mode === 'online')) return false

      if (normalizedSearch.invoiceNo && !String(order.invoice_no || '').toLowerCase().includes(normalizedSearch.invoiceNo)) return false
      if (normalizedSearch.customerName && !String(order.customer_name || '').toLowerCase().includes(normalizedSearch.customerName)) return false
      if (normalizedSearch.phone && !String(order.phone || '').toLowerCase().includes(normalizedSearch.phone)) return false
      if (billSearch.dateFrom && order.created_at < `${billSearch.dateFrom}T00:00:00`) return false
      if (billSearch.dateTo && order.created_at > `${billSearch.dateTo}T23:59:59`) return false

      return true
    })
  }, [billSearch, billTypeFilter, orders])

  const summaryCards = [
    {
      label: l('Total Revenue', 'மொத்த வருவாய்'),
      helper: 'POS + manual completed bills',
      value: formatCurrency(analytics.totalCompletedRevenue),
      icon: <RMIcon size={18} />,
      color: 'text-emerald-700',
      bg: 'bg-emerald-50',
    },
    {
      label: l("Today's Sales", 'இன்றைய விற்பனை'),
      helper: 'Completed today',
      value: formatCurrency(analytics.todaySales),
      icon: <BarChart2 size={18} />,
      color: 'text-blue-700',
      bg: 'bg-blue-50',
    },
    {
      label: l('Completed Bills', 'முடிந்த பில்கள்'),
      helper: 'Paid / completed bills',
      value: analytics.completedOrders,
      icon: <Trophy size={18} />,
      color: 'text-green-700',
      bg: 'bg-green-50',
    },
    {
      label: l('Offline Bills', 'ஆஃப்லைன் பில்'),
      helper: 'Walk-in POS sales',
      value: formatCurrency(analytics.posRevenue),
      icon: <ShoppingCart size={18} />,
      color: 'text-orange-700',
      bg: 'bg-orange-50',
    },
    {
      label: l('Online Bills', 'ஆன்லைன் பில்'),
      helper: 'Online POS sales',
      value: formatCurrency(analytics.onlinePosRevenue),
      icon: <ShoppingCart size={18} />,
      color: 'text-cyan-700',
      bg: 'bg-cyan-50',
    },
    {
      label: l('Manual Bills', 'கைமுறை பில்'),
      helper: 'Manual item revenue',
      value: formatCurrency(analytics.manualRevenue),
      icon: <ShoppingCart size={18} />,
      color: 'text-violet-700',
      bg: 'bg-violet-50',
    },
    {
      label: l('Monthly Revenue', 'மாத வருவாய்'),
      helper: 'Current month',
      value: formatCurrency(analytics.monthlyRevenue),
      icon: <BarChart2 size={18} />,
      color: 'text-pink-700',
      bg: 'bg-pink-50',
    },
    {
      label: l('Total Items Sold', 'விற்ற பொருட்கள்'),
      helper: 'From completed bills',
      value: Math.round(analytics.totalProductsSold),
      icon: <ShoppingCart size={18} />,
      color: 'text-indigo-700',
      bg: 'bg-indigo-50',
    },
    // Payment mode breakdown
    {
      label: 'CASH',
      helper: 'Cash payments received',
      value: formatCurrency(analytics.cashRevenue),
      icon: <Wallet size={18} />,
      color: 'text-green-700',
      bg: 'bg-green-50',
    },
    {
      label: 'CARD',
      helper: 'Credit/debit card payments',
      value: formatCurrency(analytics.cardRevenue),
      icon: <CreditCard size={18} />,
      color: 'text-blue-700',
      bg: 'bg-blue-50',
    },
    {
      label: 'QR / UPI',
      helper: 'QR code & UPI payments',
      value: formatCurrency(analytics.qrRevenue),
      icon: <Smartphone size={18} />,
      color: 'text-purple-700',
      bg: 'bg-purple-50',
    },
    {
      label: 'CREDIT',
      helper: 'Pending credit sales',
      value: formatCurrency(analytics.creditRevenue),
      icon: <Zap size={18} />,
      color: 'text-amber-700',
      bg: 'bg-amber-50',
    },
  ]

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA]">
        <span className="h-10 w-10 animate-spin rounded-full border-4 border-[#E5E7EB] border-t-[#111111]" />
      </div>
    )
  }

  if (!user || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8F9FA] p-4">
        <div className="max-w-sm rounded-3xl bg-white p-8 text-center shadow-xl">
          <h1 className="mb-2 text-2xl font-black text-[#111111]">Unauthorized</h1>
          <p className="mb-6 text-sm text-[#374151]">Admin access is required to view billing analytics.</p>
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl bg-[#111111] px-5 py-3 text-sm font-bold text-white">
            <LayoutDashboard size={16} />
            Go Home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-shell min-h-screen bg-white">
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="admin-logo-lockup min-w-[280px]">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0A0A0A] border border-[var(--accent-a40)] shadow-sm shrink-0">
              <span className="font-serif text-xl font-black text-[var(--accent)]">C</span>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#5F5F5F]">Admin Billing</p>
              <h1 className="mt-1 truncate text-2xl font-black text-[#111111]">{l('Billing Analytics', 'பில் பகுப்பாய்வு')}</h1>
              <p className="mt-1 text-sm text-[#5F5F5F]">Dedicated analytics view for billing, revenue, products, categories, and coupons.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB]/60 bg-white px-4 py-2 text-[13px] font-bold text-[#374151] hover:bg-[#F9FAFB]"
            >
              <LayoutDashboard size={14} />
              Dashboard
            </Link>
            <Link
              to="/pos"
              className="inline-flex items-center gap-2 rounded-xl bg-[#10B981] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#5e8c72]"
            >
              <ShoppingCart size={14} />
              Open POS
            </Link>
            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB]/60 bg-white px-4 py-2 text-[13px] font-bold text-[#374151] hover:bg-[#F9FAFB]"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-[#E5E7EB]/30 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#374151] mr-1">Period:</span>
            {(['all', 'today', 'week', 'month', 'year', 'custom'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyAnalyticsPreset(preset)}
                className={`rounded-xl px-3 py-1.5 text-[12px] font-black transition-colors ${
                  analyticsDatePreset === preset
                    ? 'bg-[#111111] text-white'
                    : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#E5E7EB]/40'
                }`}
              >
                {preset === 'all'
                  ? l('All Time', 'எல்லாம்')
                  : preset === 'today'
                    ? l('Today', 'இன்று')
                    : preset === 'week'
                      ? l('This Week', 'இந்த வாரம்')
                      : preset === 'month'
                        ? l('This Month', 'இந்த மாதம்')
                        : preset === 'year'
                          ? l('This Year', 'இந்த ஆண்டு')
                          : l('Custom', 'தேர்வு')}
              </button>
            ))}
            {analyticsDatePreset === 'custom' && (
              <>
                <input
                  type="date"
                  value={analyticsDateFrom}
                  onChange={(e) => setAnalyticsDateFrom(e.target.value)}
                  className="rounded-xl bg-[#F9FAFB] px-3 py-1.5 text-[12px] font-semibold"
                />
                <span className="text-[12px] font-bold text-[#374151]">→</span>
                <input
                  type="date"
                  value={analyticsDateTo}
                  onChange={(e) => setAnalyticsDateTo(e.target.value)}
                  className="rounded-xl bg-[#F9FAFB] px-3 py-1.5 text-[12px] font-semibold"
                />
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <StatCard
              key={card.label}
              label={card.label}
              helper={card.helper}
              value={card.value}
              icon={card.icon}
              bg={card.bg}
              color={card.color}
            />
          ))}
        </div>

        <div className="mt-6">
          <CompactAnalytics analytics={analytics} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-[#E5E7EB]/30 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-[#223126]">{l('Billing Search', 'பில் தேடல்')}</h2>
                <p className="mt-1 text-[11px] text-[#7A846F]">Search bills by invoice, customer, phone, or date range.</p>
              </div>
              <button
                type="button"
                onClick={() => exportCSV(filteredBills)}
                disabled={filteredBills.length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB]/60 bg-[#F9FAFB] px-3 py-2 text-[12px] font-bold text-[#374151] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={13} />
                Export CSV
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {([
                { v: 'all', label: l('All Bills', 'அனைத்து') },
                { v: 'offline', label: l('Offline', 'ஆஃப்லைன்') },
                { v: 'online', label: l('Online', 'ஆன்லைன்') },
                { v: 'manual', label: l('Manual', 'கைமுறை') },
              ] as const).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setBillTypeFilter(v)}
                  className={`rounded-xl px-3 py-1.5 text-[12px] font-black transition-colors ${
                    billTypeFilter === v
                      ? 'bg-[#111111] text-white'
                      : 'bg-[#F9FAFB] text-[#374151] hover:bg-[#E5E7EB]/40'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input
                value={billSearch.invoiceNo}
                onChange={(e) => setBillSearch((state) => ({ ...state, invoiceNo: e.target.value }))}
                placeholder={l('Invoice / Bill No', 'பில் எண்')}
                className="rounded-xl bg-[#F9FAFB] px-3 py-2.5 text-[13px] font-semibold outline-none"
              />
              <input
                value={billSearch.customerName}
                onChange={(e) => setBillSearch((state) => ({ ...state, customerName: e.target.value }))}
                placeholder={l('Customer Name', 'வாடிக்கையாளர் பெயர்')}
                className="rounded-xl bg-[#F9FAFB] px-3 py-2.5 text-[13px] font-semibold outline-none"
              />
              <input
                value={billSearch.phone}
                onChange={(e) => setBillSearch((state) => ({ ...state, phone: e.target.value }))}
                placeholder={l('Phone Number', 'தொலைபேசி எண்')}
                className="rounded-xl bg-[#F9FAFB] px-3 py-2.5 text-[13px] font-semibold outline-none"
              />
              <div className="flex items-center gap-2">
                <Search size={14} className="text-[#7A846F]" />
                <span className="text-[12px] font-bold text-[#7A846F]">{filteredBills.length} results</span>
              </div>
              <input
                type="date"
                value={billSearch.dateFrom}
                onChange={(e) => setBillSearch((state) => ({ ...state, dateFrom: e.target.value }))}
                className="rounded-xl bg-[#F9FAFB] px-3 py-2.5 text-[13px] font-semibold outline-none"
              />
              <input
                type="date"
                value={billSearch.dateTo}
                onChange={(e) => setBillSearch((state) => ({ ...state, dateTo: e.target.value }))}
                className="rounded-xl bg-[#F9FAFB] px-3 py-2.5 text-[13px] font-semibold outline-none"
              />
            </div>

            <div className="mt-4 md:hidden rounded-xl border border-[#E5E7EB]/30 divide-y divide-[#E5E7EB]/20 bg-white overflow-hidden">
              {filteredBills.slice(0, 50).map((order) => {
                const billTypeLabel = normalizeOrderType(order.order_type) === 'manual_sale'
                  ? 'MANUAL'
                  : normalizeOrderMode(order.order_mode) === 'online'
                    ? 'ONLINE'
                    : 'OFFLINE'
                return (
                  <div key={order.id} className="px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-[#111111] text-[13px] break-words">{order.customer_name}</p>
                        <p className="text-[11px] text-[#374151] mt-0.5 break-words">
                          {order.invoice_no || '—'}
                          {' · '}{order.phone}
                          {' · '}{billTypeLabel}
                          {' · '}{new Date(order.created_at).toLocaleDateString('en-IN')}
                          {order.coupon_code ? ` · ${order.coupon_code}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-bold text-[13px] text-[#111111]">{formatCurrency(toNumber(order.total, 0))}</p>
                        <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${normalizeStatus(order.status) === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {normalizeStatus(order.status) || 'pending'}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
              {filteredBills.length === 0 && (
                <div className="px-4 py-10 text-center text-[13px] text-[#374151]">No matching bills found.</div>
              )}
            </div>
            <div className="mt-4 hidden md:block overflow-x-auto rounded-xl border border-[#E5E7EB]/30">
              <table className="min-w-[980px] w-full text-left text-[13px]">
                <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wider text-[#374151]">
                  <tr>
                    <th className="px-3 py-3 font-black">Invoice</th>
                    <th className="px-3 py-3 font-black">Customer</th>
                    <th className="px-3 py-3 font-black">Phone</th>
                    <th className="px-3 py-3 font-black">Bill Type</th>
                    <th className="px-3 py-3 font-black">Coupon</th>
                    <th className="px-3 py-3 font-black">Discount</th>
                    <th className="px-3 py-3 font-black">Delivery</th>
                    <th className="px-3 py-3 font-black">Total</th>
                    <th className="px-3 py-3 font-black">Date</th>
                    <th className="px-3 py-3 font-black">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]/20">
                  {filteredBills.slice(0, 50).map((order) => {
                    const billTypeLabel = normalizeOrderType(order.order_type) === 'manual_sale'
                      ? 'MANUAL'
                      : normalizeOrderMode(order.order_mode) === 'online'
                        ? 'ONLINE'
                        : 'OFFLINE'
                    const billTypeClass = normalizeOrderType(order.order_type) === 'manual_sale'
                      ? 'bg-purple-100 text-purple-700'
                      : normalizeOrderMode(order.order_mode) === 'online'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-orange-100 text-orange-700'
                    return (
                      <tr key={order.id} className="hover:bg-[#F9FAFB]/50">
                        <td className="whitespace-nowrap px-3 py-3 font-bold text-[#10B981]">{order.invoice_no || '—'}</td>
                        <td className="max-w-[140px] break-words px-3 py-3 font-semibold text-[#111111]">{order.customer_name}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[#374151]">{order.phone}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${billTypeClass}`}>{billTypeLabel}</span>
                        </td>
                        <td className="px-3 py-3">{order.coupon_code ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">{order.coupon_code}</span> : <span className="text-[#9BAB9A]">—</span>}</td>
                        <td className="px-3 py-3">{order.discount_amount > 0 ? <span className="font-bold text-green-700">-{formatCurrency(order.discount_amount)}</span> : <span className="text-[#9BAB9A]">—</span>}</td>
                        <td className="px-3 py-3">{order.delivery_charge > 0 ? <span className="font-bold">{formatCurrency(order.delivery_charge)}</span> : <span className="text-[#9BAB9A]">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3 font-bold">{formatCurrency(toNumber(order.total, 0))}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-[#374151]">{new Date(order.created_at).toLocaleDateString('en-IN')}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${normalizeStatus(order.status) === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {normalizeStatus(order.status) || 'pending'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredBills.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-10 text-center text-[13px] text-[#374151]">
                        No matching bills found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-[#E5E7EB]/30 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black text-[#223126]">{l('Top Products', 'சிறந்த பொருட்கள்')}</h2>
              {analytics.topProducts.length > 0 ? (
                <div className="space-y-3">
                  {analytics.topProducts.slice(0, 8).map((product, index) => (
                    <div key={`${product.name}-${product.variant}-${index}`} className="rounded-xl bg-[#F9FAFB] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-[#111111]">{product.name}</p>
                          <p className="text-[11px] text-[#7A846F]">{product.variant || 'Variant not set'}</p>
                        </div>
                        <p className="text-right text-[12px] font-black text-emerald-700">{formatCurrency(product.revenue)}</p>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] font-bold text-[#374151]">
                        <span>Qty: {Math.round(product.qty)}</span>
                        <span>Bills: {product.billCount}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-[13px] text-[#374151]">No product sales in selected period.</p>
              )}
            </div>

            <div className="rounded-2xl border border-[#E5E7EB]/30 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black text-[#223126]">{l('Top Categories', 'சிறந்த வகைகள்')}</h2>
              {analytics.topCategories.length > 0 ? (
                <div className="space-y-3">
                  {analytics.topCategories.map((category, index) => (
                    <div key={`${category.name}-${index}`} className="rounded-xl bg-[#F9FAFB] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-[#111111]">{category.name}</p>
                          <p className="text-[11px] text-[#7A846F]">Qty sold: {Math.round(category.qty)}</p>
                        </div>
                        <p className="text-[12px] font-black text-emerald-700">{formatCurrency(category.revenue)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-[13px] text-[#374151]">No category data in selected period.</p>
              )}
            </div>

            <div className="rounded-2xl border border-[#E5E7EB]/30 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black text-[#223126]">{l('Coupon Analytics', 'கூப்பன் பகுப்பாய்வு')}</h2>
              {analytics.topCoupons.length > 0 ? (
                <div className="space-y-3">
                  {analytics.topCoupons.map((coupon) => (
                    <div key={coupon.code} className="flex items-center justify-between gap-3 rounded-xl bg-[#F9FAFB] p-3">
                      <div>
                        <p className="font-black text-[#111111]">{coupon.code}</p>
                        <p className="text-[11px] text-[#7A846F]">Used {coupon.usage} time(s)</p>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-[#111111]">{formatCurrency(coupon.discounts)}</p>
                        <p className="text-[11px] text-[#7A846F]">Discounts given</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-[13px] text-[#374151]">No coupon usage yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
