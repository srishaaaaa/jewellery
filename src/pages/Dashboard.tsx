import React, { useCallback, useEffect, useState, useMemo, useRef, type FormEvent } from 'react'
import {
  BarChart2, Trash2, Edit2, ShoppingCart, LayoutDashboard,
  Box, AlertCircle, Download, TrendingUp, TrendingDown,
  Package, Search, RefreshCw, ShieldCheck, ShieldOff, Trophy,
  MessageCircle, Eye, FileText, X, Receipt, Wallet,
  Gem, PiggyBank, Briefcase, Truck, LogOut, Menu, Boxes, Clock, History, Banknote, Tag, Settings2, Users, CheckCircle2, Percent, Info, Sparkles, Ticket,
} from 'lucide-react'

// Custom Malaysian Ringgit icon — replaces the generic dollar-sign icon
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
      fontFamily="Poppins, sans-serif"
    >RM</text>
  </svg>
)
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { debounce } from '../lib/debounce'
import { useAuthStore, useProductStore, useAdminAuthStore, useSettingsStore } from '../store/store'
import { formatPaymentMode, formatCurrency, normalizeOrderMode, toNumber } from '../lib/retail'
import { normalizeStructuredOrderItem, formatInvoiceNo } from '../lib/retail'
import { Invoice } from '../components/Invoice'
import { printThermalReceipt } from '../lib/thermalPrint'
import { buildProfessionalWhatsAppMessage, buildCreditReminderWhatsAppMessage, buildCreditPaidWhatsAppMessage } from '../lib/whatsappMessage'
import { invoicePdfFile } from '../lib/invoicePdf'
import { toWhatsAppUrl } from '../lib/phone'
import { toDaysOverdue } from '../services/creditService'
import Pos from './Pos'
import AdvanceOrders from './AdvanceOrders'
import MetalRates from './MetalRates'
import Schemes from './Schemes'
import SalesDesk from './SalesDesk'
import Purchases from './Purchases'
import JewelleryReports from '../components/dashboard/JewelleryReports'
import { auditService } from '../services/auditService'
import BirthdayDashboard from '../components/dashboard/BirthdayDashboard'
import type { AdvanceOrder } from '../services/advanceOrderService'
import { InventoryTable } from '../components/inventory/InventoryTable'
import { ExpensesView } from '../components/expenses/ExpensesView'
import { expenseService, type ExpenseRecord } from '../services/expenseService'
import { useNavigationStore } from '../store/navigationStore'
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner'
import { BarcodeRedirectDialog } from '../components/pos/BarcodeRedirectDialog'
import CreditDueAlarmModal from '../components/dashboard/CreditDueAlarmModal'
import CustomerEventAlarmModal from '../components/dashboard/CustomerEventAlarmModal'
import { OutstandingCreditsView } from '../components/dashboard/OutstandingCreditsView'
import { creditService } from '../services/creditService'
import { exportAnalyticsToExcel, exportAnalyticsToPDF } from '../services/analyticsExport'
import StoreSettingsView from '../components/dashboard/StoreSettingsView'
import LowStockAlarmModal from '../components/dashboard/LowStockAlarmModal'
import { BRAND_LOGO, BRAND_EN } from '../lib/brand'
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  BarChart,
  Bar,
} from 'recharts'
import { DocIcon, EyeIcon, WhatsAppIcon, actionBtn } from '../components/ActionIcons'
import { DocumentPreviewModal } from '../components/invoice/InvoiceParts'
import { PrintSettingsModal } from '../components/invoice/PrintSettingsModal'
import { thermalWidth } from '../lib/printPrefs'
import { getPresetRange, startOfWeekMonday, toLocalDateStr } from '../lib/dateRanges'
import { csvDate, csvPhone, toCsv } from '../lib/csv'
import { lowStockLimit } from '../lib/stockLevels'

export type DashboardOrder = {
  id: string; invoice_no: string; customer_name: string; phone: string; address: string
  created_at: string; total: number; status: string; order_mode: string; order_type: string; user_id: string | null; items: unknown
  coupon_code: string; discount_amount: number; manual_discount_amount: number; delivery_charge: number
  total_gst: number; payment_mode: string; payment_method?: string; invoice_pdf_url: string; remarks?: string; reference_number?: string
  is_credit?: boolean; credit_due_date?: string | null; credit_status?: string | null; credit_paid_at?: string | null
  split_details?: Record<string, unknown> | null
  scheme_number?: string | null; scheme_amount_used?: number; scheme_discount?: number; scheme_balance_after?: number | null
  advance_amount_used?: number; exchange_amount?: number; customer_gstin?: string | null
  customer_pan?: string | null; scheme_grams_used?: number | null; scheme_gold_rate?: number | null
}

/**
 * Adds savings-scheme redemption details to bills that used a scheme. A separate query,
 * so order history keeps loading on databases without the jewellery migration.
 */
const attachSchemeInfo = async (orders: DashboardOrder[]): Promise<DashboardOrder[]> => {
  if (!orders.length || !isSupabaseConfigured) return orders
  const base = 'id, scheme_number, scheme_amount_used, scheme_discount, scheme_balance_after, advance_amount_used, exchange_amount, customer_gstin'
  const baseFilter = 'scheme_number.not.is.null,advance_amount_used.gt.0,exchange_amount.gt.0,customer_gstin.not.is.null'
  const query = (columns: string, filter: string) => supabase.from('orders').select(columns).or(filter).order('created_at', { ascending: false }).limit(5000)
  // PAN and gram redemption come with a later database update; fall back to the older columns until then.
  let { data, error } = await query(`${base}, customer_pan, scheme_grams_used, scheme_gold_rate`, `${baseFilter},customer_pan.not.is.null`)
  if (error) ({ data, error } = await query(base, baseFilter))
  if (error || !data?.length) return orders
  const info = new Map((data as unknown as Array<Record<string, unknown>>).map(row => [String(row.id), row]))
  return orders.map(o => {
    const row = info.get(o.id)
    return row ? {
      ...o,
      scheme_number: String(row.scheme_number || ''),
      scheme_amount_used: toNumber(row.scheme_amount_used, 0),
      scheme_discount: toNumber(row.scheme_discount, 0),
      scheme_balance_after: row.scheme_balance_after == null ? null : toNumber(row.scheme_balance_after, 0),
      advance_amount_used: toNumber(row.advance_amount_used, 0),
      exchange_amount: toNumber(row.exchange_amount, 0),
      customer_gstin: row.customer_gstin ? String(row.customer_gstin) : null,
      customer_pan: row.customer_pan ? String(row.customer_pan) : null,
      scheme_grams_used: row.scheme_grams_used == null ? null : toNumber(row.scheme_grams_used, 0),
      scheme_gold_rate: row.scheme_gold_rate == null ? null : toNumber(row.scheme_gold_rate, 0),
    } : o
  })
}
type DashboardOrderItem = { order_id: string; product_name: string; category?: string; quantity: number; line_total: number; is_manual?: boolean | null }
type DashboardCoupon = {
  id: number
  code: string
  percentage: number
  is_active: boolean
  expiry_date: string | null
  usage_limit: number | null
  usage_count: number
  min_order_value: number
}
type TabKey = 'overview' | 'whatsapp' | 'pos_analytics' | 'billing' | 'advance_orders' | 'inventory' | 'expenses' | 'coupons' | 'users' | 'history' | 'settings' | 'outstanding_credits' | 'customer_events' | 'metal_rates' | 'schemes' | 'sales_desk' | 'purchases'
type PosAnalyticsTab = 'revenue' | 'today' | 'products' | 'categories' | 'coupons' | 'jewellery'
type ProfileUser = { id: string; email: string; name: string; mobile: string; role: string; created_at: string }

const normalizeStatus = (v: unknown) => String(v || '').trim().toLowerCase()
const statusTone = (v: unknown) => normalizeStatus(v) === 'completed' ? 'border-transparent bg-[#10B981]/10 text-[#10B981]'
  : normalizeStatus(v) === 'cancelled' ? 'border-transparent bg-black/5 text-black/50'
    : 'border-transparent bg-[#FEF3C7] text-[#78350F]'
const normalizeOrderType = (v: unknown) => String(v || '').trim().toLowerCase() || 'pos_sale'
const formatPhoneWithCountryCode = (phone: string) => {
  const cleaned = String(phone || '').replace(/\D/g, '')
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return { code: '+91', number: cleaned.slice(2) }
  }
  return { code: '+91', number: cleaned.slice(-10) }
}
const isCompletedStatus = (v: unknown) => {
  const status = normalizeStatus(v)
  return status === 'completed' || status === 'paid'
}
const parseOrderItems = (items: unknown): Record<string, unknown>[] => {
  if (Array.isArray(items)) return items.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
  if (typeof items === 'string') { try { const p = JSON.parse(items); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

// When o.total is 0 (legacy orders saved with bug), compute it from the items JSON
const getOrderTotal = (order: { total: unknown; items: unknown; shipping?: unknown; delivery_charge?: unknown; total_gst?: unknown; discount_amount?: unknown; manual_discount_amount?: unknown }): number => {
  const stored = toNumber(order.total, 0)
  if (stored > 0) return stored
  const items = parseOrderItems(order.items)
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = toNumber(item.line_total ?? item.lineTotal, 0)
    if (lineTotal > 0) return sum + lineTotal
    return sum + toNumber(item.base_price ?? item.basePrice ?? item.price, 0) * Math.max(1, toNumber(item.quantity, 1))
  }, 0)
  return Math.max(0, subtotal
    + toNumber(order.shipping ?? order.delivery_charge, 0)
    + toNumber(order.total_gst, 0)
    - toNumber(order.discount_amount, 0)
    - toNumber(order.manual_discount_amount, 0)
  )
}

// A settled credit sale should land in Order History on the date it was actually
// paid, not the date the credit was originally extended.
const getOrderHistoryDate = (order: { created_at: string; credit_status?: string | null; credit_paid_at?: string | null }): string =>
  order.credit_status === 'paid' && order.credit_paid_at ? order.credit_paid_at : order.created_at

const exportCSV = (orders: DashboardOrder[]) => {
  if (!orders || orders.length === 0) {
    alert('No orders to export')
    return
  }
  const header = ['Order Ref', 'Customer', 'Phone', 'Date', 'Total (INR)', 'Order Type', 'Status']
  const rows = orders.map(o => {
    const historyDate = getOrderHistoryDate(o)
    const dateStr = historyDate ? csvDate(historyDate, true) : 'N/A'
    const total = getOrderTotal(o) || 0
    return [
      o.order_type === 'online_request' ? o.id : formatInvoiceNo(o.invoice_no),
      o.customer_name || 'Customer',
      csvPhone(o.phone),
      dateStr,
      total.toFixed(2),
      o.order_type || 'unknown',
      o.status || 'pending',
    ]
  })
  const csv = toCsv([header, ...rows])
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orders_${toLocalDateStr(new Date())}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function Dashboard() {
  const { user } = useAuthStore()
  const { products, fetchProducts } = useProductStore()
  const logoUrl = useSettingsStore(s => s.settings?.logoUrl) || BRAND_LOGO
  const shopName = useSettingsStore(s => s.settings?.name) || BRAND_EN
  const location = useLocation()
  const navigate = useNavigate()
  const role = useAdminAuthStore(state => state.role)
  const [tab, setTab] = useState<TabKey>(() => {
    const params = new URLSearchParams(location.search)
    const tabParam = params.get('tab') as TabKey | null
    // 'expiry_alerts' was removed; old links open the billing panel instead.
    if (tabParam && (tabParam as string) !== 'expiry_alerts') return tabParam
    if (location.pathname === '/whatsapp-center') return 'whatsapp'
    if (location.pathname === '/pos-analytics' && role === 'admin') return 'pos_analytics'
    if (location.pathname === '/advance-orders') return 'advance_orders'
    if (location.pathname === '/expenses' || location.pathname === '/dashboard/expenses') return 'expenses'
    return 'billing'
  })
  const { setCurrentTab } = useNavigationStore()
  const [cartItemToInject, setCartItemToInject] = useState<string | null>(null)

  // Sync tab with navigation store
  useEffect(() => {
    setCurrentTab(tab)
  }, [tab, setCurrentTab])

  // Global hardware scanner listener
  useHardwareBarcodeScanner({
    isBillingActive: tab === 'billing',
    onScanDirect: (barcode) => {
      setCartItemToInject(barcode)
    },
  })

  const handleNavigateToBillingFromDialog = (barcode: string) => {
    setTab('billing')
    setCurrentTab('billing')
    navigate('/dashboard', { replace: true })
    setCartItemToInject(barcode)
  }

  const [posAnalyticsTab, setPosAnalyticsTab] = useState<PosAnalyticsTab>('revenue')
  const [exportingPdf, setExportingPdf] = useState(false)
  const [, setLoading] = useState(false)
  const [orders, setOrders] = useState<DashboardOrder[]>([])
  const [orderItems, setOrderItems] = useState<DashboardOrderItem[]>([])
  const [coupons, setCoupons] = useState<DashboardCoupon[]>([])
  const [couponForm, setCouponForm] = useState({ code: '', percentage: '10', expiry_date: '', usage_limit: '', min_order_value: '' })
  const [couponSaveError, setCouponSaveError] = useState('')
  const [couponSaveSuccess, setCouponSaveSuccess] = useState('')
  const [editingCouponId, setEditingCouponId] = useState<number | null>(null)

  const [analyticsTab, setAnalyticsTab] = useState('revenue')

  const [invoicePreviewOrder, setInvoicePreviewOrder] = useState<DashboardOrder | null>(null)
  const [printOrder, setPrintOrder] = useState<DashboardOrder | null>(null)

  // WA detail expansion
  const [waExpandedId, setWaExpandedId] = useState<string | null>(null)

  // Order history row expansion (remarks / ref no)
  const [historyExpandedId, setHistoryExpandedId] = useState<string | null>(null)

  // Search & date filter
  const [search, setSearch] = useState({ invoiceNo: '', phone: '', customerName: '', dateFrom: '', dateTo: '' })
  const [todayBillsSearch, setTodayBillsSearch] = useState('')
  const [productAnalyticsSearch, setProductAnalyticsSearch] = useState('')
  const [datePreset, setDatePreset] = useState<'today' | 'week' | 'month' | 'year' | 'custom' | ''>('')
  const [searchResults, setSearchResults] = useState<DashboardOrder[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Phones and tablets start with the menu closed (it slides over the page).
    if (typeof window !== 'undefined' && window.innerWidth < 1024) return true
    try {
      return window.localStorage.getItem('dashboard-sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })

  // Analytics global date filter
  const [analyticsDatePreset, setAnalyticsDatePreset] = useState<'all' | 'today' | 'week' | 'month' | 'year' | 'custom'>('all')
  const [analyticsDateFrom, setAnalyticsDateFrom] = useState('')
  const [analyticsDateTo, setAnalyticsDateTo] = useState('')
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])

  // Order Management bill type filter
  const [billTypeFilter, setBillTypeFilter] = useState<'all' | 'offline' | 'online' | 'manual'>('all')

  // Users tab
  const [allUsers, setAllUsers] = useState<ProfileUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null)

  const isAdmin = true // bypassed for local demo
  const l = (en: string, _ta?: string) => en

  useEffect(() => {
    if (role === 'staff') {
      const staffAllowedTabs: TabKey[] = ['billing', 'inventory', 'metal_rates', 'schemes', 'sales_desk', 'advance_orders', 'history', 'customer_events']
      if (!staffAllowedTabs.includes(tab)) {
        setTab('billing')
        navigate('/dashboard', { replace: true })
      }
    }
  }, [role, tab, navigate])

  const handleTabClick = (tabKey: TabKey) => {
    if (role === 'staff') {
      const staffAllowedTabs: TabKey[] = ['billing', 'inventory', 'metal_rates', 'schemes', 'sales_desk', 'advance_orders', 'history', 'customer_events']
      if (!staffAllowedTabs.includes(tabKey)) return
    }
    setTab(tabKey)
    setCurrentTab(tabKey)
    if (tabKey === 'pos_analytics') {
      navigate('/dashboard?tab=pos_analytics', { replace: true })
    } else if (tabKey === 'expenses') {
      navigate('/dashboard?tab=expenses', { replace: true })
    } else if (tabKey === 'advance_orders') {
      navigate('/dashboard?tab=advance_orders', { replace: true })
    } else if (tabKey === 'metal_rates' || tabKey === 'schemes' || tabKey === 'sales_desk') {
      navigate(`/dashboard?tab=${tabKey}`, { replace: true })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  const deletedOrderIds = React.useRef<Set<string>>(new Set())

  const toDashboardOrder = (row: Record<string, unknown>): DashboardOrder => {
    if (!row.id) throw new Error('Order missing required field: id')
    if (!row.invoice_no) throw new Error('Order missing required field: invoice_no')
    return {
      id: String(row.id), invoice_no: String(row.invoice_no),
      customer_name: String(row.customer_name || ''), phone: String(row.phone || ''),
      address: String(row.address || ''),
      created_at: String(row.created_at || ''), total: toNumber(row.total, 0),
      status: String(row.status || 'pending'),
      order_mode: normalizeOrderMode(row.order_mode),
      order_type: normalizeOrderType(row.order_type),
      user_id: typeof row.user_id === 'string' ? row.user_id : null,
      items: row.items,
      coupon_code: String(row.coupon_code || ''),
      discount_amount: toNumber(row.discount_amount, 0),
      manual_discount_amount: toNumber(row.manual_discount_amount, 0),
      delivery_charge: toNumber(row.delivery_charge, 0),
      total_gst: toNumber(row.total_gst ?? row.gst_amount, 0),
      payment_mode: String(row.payment_mode || row.payment_method || ''),
      split_details: row.split_details && typeof row.split_details === 'object' ? row.split_details as Record<string, unknown> : null,
      invoice_pdf_url: String(row.invoice_pdf_url || ''),
      remarks: row.remarks ? String(row.remarks) : undefined,
      reference_number: row.reference_number ? String(row.reference_number) : undefined,
      is_credit: row.is_credit === true || row.is_credit === 'true',
      credit_due_date: row.credit_due_date ? String(row.credit_due_date) : null,
      credit_status: row.credit_status ? String(row.credit_status) : null,
      credit_paid_at: row.credit_paid_at ? String(row.credit_paid_at) : null,
    }
  }

  const handleAdvanceOrderCompleted = useCallback((advance: AdvanceOrder) => {
    if (!advance.completed_order_id || !advance.invoice_number) return
    const createdAt = advance.completed_at || new Date().toISOString()
    const fallbackItem = {
      name: advance.product_name,
      category: advance.category,
      quantity: 1,
      base_price: advance.total_amount,
      line_total: advance.total_amount,
      unit: 'piece',
      unit_type: 'unit',
      source: 'advance_order',
    }
    const completedItems = advance.products.length ? advance.products : [fallbackItem]
    const completed: DashboardOrder = {
      id: advance.completed_order_id,
      invoice_no: advance.invoice_number,
      customer_name: advance.customer_name,
      phone: advance.phone,
      address: advance.address,
      created_at: createdAt,
      total: advance.total_amount,
      status: 'completed',
      order_mode: 'offline',
      order_type: 'advance_order',
      user_id: user?.id || null,
      items: completedItems,
      coupon_code: '',
      discount_amount: 0,
      manual_discount_amount: 0,
      delivery_charge: 0,
      total_gst: 0,
      payment_mode: advance.final_payment_method || '',
      payment_method: advance.final_payment_method || '',
      invoice_pdf_url: '',
    }
    setOrders(current => [completed, ...current.filter(order => order.id !== completed.id)])
    setSearchResults(current => [completed, ...current.filter(order => order.id !== completed.id)].slice(0, 100))
    setOrderItems(current => [...completedItems.map(item => ({ order_id: completed.id, product_name: String(item.name || 'Product'), category: String(item.category || advance.category || ''), quantity: Number(item.quantity || 1), line_total: Number(item.line_total || 0), is_manual: false })), ...current.filter(row => row.order_id !== completed.id)])
  }, [user?.id])

  // Analytics (date-aware)
  const analytics = useMemo(() => {
    // Apply global date filter
    let dated = orders
    if (analyticsDateFrom) dated = dated.filter(o => o.created_at >= `${analyticsDateFrom}T00:00:00`)
    if (analyticsDateTo)   dated = dated.filter(o => o.created_at <= `${analyticsDateTo}T23:59:59`)

    // Classify
    const nonCancelled = dated.filter(o => normalizeStatus(o.status) !== 'cancelled')
    const completedOrders = nonCancelled.filter(o => isCompletedStatus(o.status))
    const pendingOrders   = nonCancelled.filter(o => normalizeStatus(o.status) === 'pending')

    // WhatsApp = online_request type (all statuses, no revenue)
    const waOrders = dated.filter(o => normalizeOrderType(o.order_type) === 'online_request')

    // Billable = completed and NOT online_request and NOT outstanding credit
    const billableCompleted = completedOrders.filter(o =>
      normalizeOrderType(o.order_type) !== 'online_request' &&
      (!o.is_credit || o.credit_status === 'paid')
    )
    // The trend charts are fixed calendar views. The period selector filters
    // KPIs/tables, but must not change the year/week bars underneath them.
    const allBillableCompleted = orders
      .filter(o => normalizeStatus(o.status) !== 'cancelled')
      .filter(o => isCompletedStatus(o.status))
      .filter(o => normalizeOrderType(o.order_type) !== 'online_request')
      .filter(o => !o.is_credit || o.credit_status === 'paid')
    // Channel is determined by order_mode. Older orders can use a different
    // order_type, so requiring exactly `pos_sale` hides valid online bills.
    const offlinePOS  = billableCompleted.filter(o => normalizeOrderMode(o.order_mode) === 'offline' && normalizeOrderType(o.order_type) !== 'manual_sale')
    const onlinePOS   = billableCompleted.filter(o => normalizeOrderMode(o.order_mode) === 'online')
    const manualSales = billableCompleted.filter(o => normalizeOrderType(o.order_type) === 'manual_sale')

    // Revenue (WhatsApp never included)
    const completedRevenue   = billableCompleted.reduce((s, o) => s + getOrderTotal(o), 0)
    const averageRevenuePerBill = billableCompleted.length > 0 ? completedRevenue / billableCompleted.length : 0
    const posRevenue         = offlinePOS.reduce((s, o) => s + getOrderTotal(o), 0)
    const onlinePosRevenue   = onlinePOS.reduce((s, o) => s + getOrderTotal(o), 0)
    const manualRevenue      = manualSales.reduce((s, o) => s + getOrderTotal(o), 0)

    // Expenses & Net Profit calculation:
    // Net Profit = Revenue (total selling based on orders) - Total Expense (from expense tracker)
    let datedExpenses = expenses
    if (analyticsDateFrom) datedExpenses = datedExpenses.filter(e => e.expense_date >= analyticsDateFrom)
    if (analyticsDateTo)   datedExpenses = datedExpenses.filter(e => e.expense_date <= analyticsDateTo)
    const totalExpenses = datedExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const netProfit = completedRevenue - totalExpenses
    const isProfitable = netProfit >= 0

    const toLocalDateKey = (value: string | Date) => {
      const date = value instanceof Date ? value : new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }
    const toLocalMonthKey = (value: string | Date) => toLocalDateKey(value).slice(0, 7)

    const todayKey  = toLocalDateKey(new Date())
    const monthKey  = todayKey.slice(0, 7)
    const todaySales   = orders.filter(o => isCompletedStatus(o.status) && o.order_type !== 'whatsapp_request' && toLocalDateKey(o.created_at) === todayKey).reduce((s, o) => s + getOrderTotal(o), 0)

    // Today-specific analytics (for TODAY'S SALES tab)
    const todayOrders = billableCompleted.filter(o => toLocalDateKey(o.created_at) === todayKey)
    const todayCompletedOrdersCount = todayOrders.length
    const todayItemsSold = todayOrders.reduce((s, o) => {
      const items = parseOrderItems(o.items)
      return s + items.reduce((sum, item) => sum + toNumber(item.quantity ?? item.qty, 0), 0)
    }, 0)
    const todayAvgOrderValue = todayCompletedOrdersCount > 0 ? todaySales / todayCompletedOrdersCount : 0

    // Hourly trend for today
    const hourlyMap = new Map<string, number>()
    todayOrders.forEach(o => {
      const hour = String(new Date(o.created_at).getHours()).padStart(2, '0')
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + getOrderTotal(o))
    })
    const todayHourlyTrend = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0')
      // Use 12-hour format
      const ampm = i < 12 ? 'AM' : 'PM'
      const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i
      return { hour: `${h12} ${ampm}`, key: h, revenue: hourlyMap.get(h) || 0 }
    })

    // Today's top products
    const todayProductMap = new Map<string, { name: string; qty: number; revenue: number }>()
    todayOrders.forEach(o => {
      parseOrderItems(o.items).forEach(item => {
        const name = String(item.product_name || item.name || 'Product').trim()
        const qty = toNumber(item.quantity ?? item.qty, 0)
        const rev = toNumber(item.line_total ?? item.lineTotal, 0)
        const p = todayProductMap.get(name) || { name, qty: 0, revenue: 0 }
        p.qty += qty; p.revenue += rev
        todayProductMap.set(name, p)
      })
    })
    const todayTopProducts = Array.from(todayProductMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
    const todayBills = todayOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10)

    // Today's channel breakdown
    const todayOffline = todayOrders.filter(o => normalizeOrderType(o.order_type) === 'pos_sale' && normalizeOrderMode(o.order_mode) !== 'online')
    const todayOnline = todayOrders.filter(o => normalizeOrderType(o.order_type) === 'pos_sale' && normalizeOrderMode(o.order_mode) === 'online')
    const todayManual = todayOrders.filter(o => normalizeOrderType(o.order_type) === 'manual_sale')
    const todayOfflineRevenue = todayOffline.reduce((s, o) => s + getOrderTotal(o), 0)
    const todayOnlineRevenue = todayOnline.reduce((s, o) => s + getOrderTotal(o), 0)
    const todayManualRevenue = todayManual.reduce((s, o) => s + getOrderTotal(o), 0)

    // Product hourly trend (products sold per hour today)
    const productHourlyMap = new Map<string, number>()
    todayOrders.forEach(o => {
      const hour = String(new Date(o.created_at).getHours()).padStart(2, '0')
      const totalQty = parseOrderItems(o.items).reduce((s, item) => s + toNumber(item.quantity ?? item.qty, 0), 0)
      productHourlyMap.set(hour, (productHourlyMap.get(hour) || 0) + totalQty)
    })
    const todayProductHourlyTrend = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0')
      const ampm = i < 12 ? 'AM' : 'PM'
      const h12 = i === 0 ? 12 : i > 12 ? i - 12 : i
      return { hour: `${h12} ${ampm}`, key: h, qty: productHourlyMap.get(h) || 0 }
    })

    const monthlyRevenue = billableCompleted.filter(o => toLocalMonthKey(o.created_at) === monthKey).reduce((s, o) => s + getOrderTotal(o), 0)

    // Item-level analytics: items saved on each counted bill. The older order_items
    // table only holds rows for some bills, so it is used only for bills that
    // have no items stored on the bill itself.
    const legacyItemsByOrder = new Map<string, typeof orderItems>()
    orderItems.forEach(item => {
      const list = legacyItemsByOrder.get(item.order_id) || []
      list.push(item)
      legacyItemsByOrder.set(item.order_id, list)
    })
    const completedItems = billableCompleted.flatMap(order => {
      const rows = parseOrderItems(order.items)
      if (rows.length === 0) return legacyItemsByOrder.get(order.id) || []
      return rows.map(row => ({
        order_id: order.id,
        product_name: String((row as Record<string,unknown>).product_name || (row as Record<string,unknown>).name || 'Product'),
        category: String((row as Record<string,unknown>).category || ''),
        quantity: toNumber((row as Record<string,unknown>).quantity ?? (row as Record<string,unknown>).qty, 0),
        line_total: toNumber((row as Record<string,unknown>).line_total ?? (row as Record<string,unknown>).lineTotal, 0),
        is_manual: (row as Record<string,unknown>).is_manual === true || (row as Record<string,unknown>).source === 'manual',
      }))
    })

    const productMap    = new Map<string, { name: string; variant: string; qty: number; revenue: number; billCount: number }>()
    const productOrders = new Map<string, Set<string>>()
    const categoryMap   = new Map<string, { name: string; qty: number; revenue: number }>()
    const prodCatLookup = new Map(products.map(p => [String(p.name || '').trim().toLowerCase(), p.category || 'Uncategorized']))

    let totalProductsSold = 0
    let totalManualRevenue = 0

    completedItems.forEach(({ product_name, category, quantity, line_total, order_id, is_manual }) => {
      const qty = toNumber(quantity, 0)
      const rev = toNumber(line_total, 0)
      totalProductsSold += qty

      const rawKey  = String(product_name || 'Product').trim() || 'Product'
      const dashIdx = rawKey.indexOf(' - ')
      const mainName   = dashIdx > 0 ? rawKey.slice(0, dashIdx) : rawKey
      const variantName = dashIdx > 0 ? rawKey.slice(dashIdx + 3) : ''

      const pc = productMap.get(rawKey) || { name: mainName, variant: variantName, qty: 0, revenue: 0, billCount: 0 }
      pc.qty += qty; pc.revenue += rev; productMap.set(rawKey, pc)

      if (!productOrders.has(rawKey)) productOrders.set(rawKey, new Set())
      productOrders.get(rawKey)!.add(order_id)

      const catName = category || prodCatLookup.get(mainName.toLowerCase()) || 'Uncategorized'
      const cc = categoryMap.get(catName) || { name: catName, qty: 0, revenue: 0 }
      cc.qty += qty; cc.revenue += rev; categoryMap.set(catName, cc)

      if (is_manual) totalManualRevenue += rev
    })

    for (const [key, orderSet] of productOrders) {
      const p = productMap.get(key); if (p) { p.billCount = orderSet.size; productMap.set(key, p) }
    }

    const topProducts   = Array.from(productMap.values()).sort((a, b) => b.qty - a.qty)
    const topCategories = Array.from(categoryMap.values()).sort((a, b) => b.revenue - a.revenue)
    const bestProduct   = topProducts[0]?.name || 'No sales yet'
    const bestCategory  = topCategories[0]?.name || 'No sales yet'

    // Average items per bill
    const avgItemsPerBill = billableCompleted.length > 0
      ? totalProductsSold / billableCompleted.length : 0
    const averageProductRevenue = totalProductsSold > 0
      ? completedRevenue / totalProductsSold : 0

    // Category distribution for chart
    const categoryDist = Array.from(categoryMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8)
      .map(([name, data]) => ({ name, value: data.revenue }))

    // Trend charts
    const chartYear = new Date().getFullYear()
    const monthlyRevenueMap = new Map<string, number>()
    allBillableCompleted.forEach(o => {
      const k = toLocalMonthKey(o.created_at)
      monthlyRevenueMap.set(k, (monthlyRevenueMap.get(k) || 0) + getOrderTotal(o))
    })
    const monthlyTrend = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(chartYear, i, 1)
      const k = toLocalMonthKey(d)
      return { key: k, month: d.toLocaleDateString('en-IN', { month: 'short' }), revenue: monthlyRevenueMap.get(k) || 0 }
    })

    const weeklyRevenueMap = new Map<string, number>()
    allBillableCompleted.forEach(o => {
      const k = toLocalDateKey(o.created_at)
      weeklyRevenueMap.set(k, (weeklyRevenueMap.get(k) || 0) + getOrderTotal(o))
    })

    // Week: Monday to Sunday
    const mondayDate = startOfWeekMonday(new Date())

    const weeklySales = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mondayDate)
      d.setDate(d.getDate() + i)
      const k = toLocalDateKey(d)
      // Force short weekday names in English to match Mon, Tue, Wed, Thu, Fri, Sat, Sun exactly
      const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)
      return { day: dayName, date: k, revenue: weeklyRevenueMap.get(k) || 0 }
    })

    const currentMonthDate = new Date()
    const daysInCurrentMonth = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() + 1, 0).getDate()
    const monthDailySales = Array.from({ length: daysInCurrentMonth }, (_, i) => {
      const d = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth(), i + 1)
      const k = toLocalDateKey(d)
      return { day: `${i + 1}`, date: `${i + 1}/${currentMonthDate.getMonth() + 1}`, label: `Day ${i + 1}`, revenue: weeklyRevenueMap.get(k) || 0 }
    })

    const statusDistribution = [
      { name: 'WA Requests', value: waOrders.length, color: '#3b82f6' },
      { name: 'POS Pending', value: pendingOrders.filter(o => normalizeOrderType(o.order_type) !== 'online_request').length, color: '#f59e0b' },
      { name: 'Completed',   value: billableCompleted.length, color: '#10b981' },
    ]
    const channelDistribution = [
      { name: 'Offline Bills', value: posRevenue, color: '#f97316' },
      { name: 'Online Bills',  value: onlinePosRevenue, color: '#3b82f6' },
      { name: 'Manual Sales',  value: manualRevenue || totalManualRevenue, color: '#8b5cf6' },
    ]

    const couponMap = new Map<string, { code: string; usage: number; discounts: number }>()
    billableCompleted.forEach(order => {
      const code = String((order as Record<string,unknown>).coupon_code || '').trim(); if (!code) return
      const u = couponMap.get(code) || { code, usage: 0, discounts: 0 }
      u.usage += 1; u.discounts += toNumber((order as Record<string,unknown>).discount_amount, 0)
      couponMap.set(code, u)
    })
    const topCoupons = Array.from(couponMap.values()).sort((a, b) => b.usage - a.usage)
    const totalCouponDiscounts = topCoupons.reduce((s, c) => s + c.discounts, 0)
    const totalCouponOrders = topCoupons.reduce((s, c) => s + c.usage, 0)
    const couponUsageRate = billableCompleted.length > 0
      ? (totalCouponOrders / billableCompleted.length) * 100 : 0

    // Coupon daily trend (last 7 days)
    const couponDailyMap = new Map<string, { orders: number; discounts: number }>()
    billableCompleted.forEach(order => {
      const code = String((order as Record<string,unknown>).coupon_code || '').trim()
      if (!code) return
      const k = toLocalDateKey(order.created_at)
      const d = couponDailyMap.get(k) || { orders: 0, discounts: 0 }
      d.orders += 1
      d.discounts += toNumber((order as Record<string,unknown>).discount_amount, 0)
      couponDailyMap.set(k, d)
    })
    const couponDailyTrend = Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      const k = toLocalDateKey(d)
      const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d)
      const data = couponDailyMap.get(k) || { orders: 0, discounts: 0 }
      return { day: dayName, date: k, orders: data.orders, discounts: data.discounts }
    })

    // WhatsApp analytics (zero revenue - status changes never affect revenue)
    const waRequests  = waOrders.length
    const waPending   = waOrders.filter(o => normalizeStatus(o.status) === 'pending').length
    const waContacted = waOrders.filter(o => normalizeStatus(o.status) === 'contacted').length
    const waCompleted = waOrders.filter(o => isCompletedStatus(o.status)).length

    const waProductMap = new Map<string, number>()
    waOrders.forEach(order => {
      parseOrderItems(order.items).forEach(item => {
        const n = String((item as Record<string,unknown>).name || (item as Record<string,unknown>).product_name || '').trim()
        if (n) waProductMap.set(n, (waProductMap.get(n) || 0) + 1)
      })
    })
    const topWAProducts = Array.from(waProductMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name, count }))

    const waCategoryMap = new Map<string, number>()
    waOrders.forEach(order => {
      parseOrderItems(order.items).forEach(item => {
        const n = String((item as Record<string,unknown>).name || (item as Record<string,unknown>).product_name || '').trim()
        if (n) {
          const mainName = n.includes(' - ') ? n.split(' - ')[0] : n
          const catName = prodCatLookup.get(mainName.toLowerCase()) || 'Uncategorized'
          waCategoryMap.set(catName, (waCategoryMap.get(catName) || 0) + 1)
        }
      })
    })
    const topWACategories = Array.from(waCategoryMap.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, count]) => ({ name, count }))

    return {
      totalCompletedRevenue: completedRevenue,
      averageRevenuePerBill,
      todaySales,
      todayCompletedOrdersCount,
      todayItemsSold,
      todayAvgOrderValue,
      todayHourlyTrend,
      todayTopProducts,
      todayBills,
      todayOfflineRevenue,
      todayOnlineRevenue,
      todayManualRevenue,
      todayProductHourlyTrend,
      avgItemsPerBill,
      averageProductRevenue,
      categoryDist,
      totalCouponDiscounts,
      totalCouponOrders,
      couponUsageRate,
      couponDailyTrend,
      pendingOrders: pendingOrders.length,
      onlineRequests: waRequests,
      onlineRequestOrders: waOrders,
      completedOrders: billableCompleted.length,
      posRevenue,
      onlinePosRevenue,
      // Keep the bill count separate from revenue so the TOTAL ONLINE BILLS
      // card stays visible and always reflects the current completed orders.
      onlineBillCount: onlinePOS.length,
      monthDailySales,
      offlineOrderCount: offlinePOS.length,
      manualRevenue: manualRevenue || totalManualRevenue,
      monthlyRevenue,
      totalProductsSold,
      bestCategory,
      bestProduct,
      monthlyTrend,
      chartYear,
      channelDistribution,
      statusDistribution,
      topCoupons,
      topCategories,
      weeklySales,
      topProducts,
      waRequests,
      waPending,
      waContacted,
      waCompleted,
      topWAProducts,
      topWACategories,
      totalExpenses,
      netProfit,
      isProfitable,
    }
  }, [orders, orderItems, products, expenses, analyticsDateFrom, analyticsDateTo])

  // Bill-type filtered results for Order Management table (client-side, instant)
  const filteredSearchResults = useMemo(() => {
    // Credit sales stay out of Order History (they live in Outstanding Credits
    // instead) until they're marked paid, at which point they "move" here.
    const settled = searchResults.filter(o => o.credit_status !== 'outstanding' && !(o.is_credit && !o.credit_status))
    if (billTypeFilter === 'all') return settled
    return settled.filter(o => {
      const type = normalizeOrderType(o.order_type)
      const mode = normalizeOrderMode(o.order_mode)
      if (billTypeFilter === 'manual')  return type === 'manual_sale'
      if (billTypeFilter === 'offline') return type === 'pos_sale' && mode !== 'online'
      if (billTypeFilter === 'online')  return type === 'pos_sale' && mode === 'online'
      return true
    })
  }, [searchResults, billTypeFilter])

  // Load dashboard data
  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setLoading(true)
    try {
      const productsPromise = fetchProducts(true)
      const [oRes, couponRes, expList] = await Promise.all([
        supabase.from('orders')
          .select('id, invoice_no, customer_name, phone, address, created_at, total, status, order_mode, order_type, user_id, items, coupon_code, discount_amount, manual_discount_amount, delivery_charge, total_gst, gst_amount, payment_mode, payment_method, split_details, invoice_pdf_url, remarks, reference_number, is_credit, credit_due_date, credit_status, credit_paid_at')
          .order('created_at', { ascending: false })
          .limit(1000),
        supabase.from('coupons')
          .select('id, code, percentage, is_active, expiry_date, usage_limit, usage_count, min_order_value')
          .order('created_at', { ascending: false }),
        expenseService.getExpenses(),
      ])
      if (oRes.error) throw oRes.error
      const mappedOrders = await attachSchemeInfo((oRes.data || []).map(r => toDashboardOrder(r as Record<string, unknown>)))
      setOrders(mappedOrders)
      setSearchResults(mappedOrders.filter(o => normalizeOrderType(o.order_type) !== 'online_request').slice(0, 100))
      setCoupons((couponRes.data || []) as DashboardCoupon[])
      setExpenses(expList || [])

      const orderIds = mappedOrders.map(o => o.id).filter(Boolean)
      if (orderIds.length > 0) {
        let oi: unknown[] | null = null
        let orderItemsError: unknown = null
        const orderItemsResult = await supabase
          .from('order_items').select('order_id,product_name,category,quantity,line_total,is_manual')
          .in('order_id', orderIds)
        oi = orderItemsResult.data
        orderItemsError = orderItemsResult.error

        if (orderItemsError) {
          const fallbackItemsResult = await supabase
            .from('order_items').select('order_id,product_name,quantity,line_total')
            .in('order_id', orderIds)
          oi = fallbackItemsResult.data
        }

        setOrderItems((oi || []).map(r => ({
          order_id: String((r as Record<string,unknown>).order_id || ''),
          product_name: String((r as Record<string,unknown>).product_name || 'Product'),
          category: String((r as Record<string,unknown>).category || ''),
          quantity: toNumber((r as Record<string,unknown>).quantity, 0),
          line_total: toNumber((r as Record<string,unknown>).line_total, 0),
          is_manual: Boolean((r as Record<string,unknown>).is_manual),
        })))
      }

      await productsPromise
    } catch (err) { console.error('Dashboard load error', err) }
    finally { setLoading(false) }
  }, [fetchProducts])

  const loadUsers = useCallback(async () => {
    if (!isSupabaseConfigured) return
    setUsersLoading(true); setUsersError('')
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, mobile, role, created_at')
      .order('created_at', { ascending: false })
    if (error) { setUsersError(error.message) }
    else { setAllUsers((data || []) as ProfileUser[]) }
    setUsersLoading(false)
  }, [])

  const loadCoupons = useCallback(async () => {
    if (!isSupabaseConfigured) return
    const { data } = await supabase
      .from('coupons')
      .select('id, code, percentage, is_active, expiry_date, usage_limit, usage_count, min_order_value')
      .order('created_at', { ascending: false })
    setCoupons((data || []) as DashboardCoupon[])
  }, [])

  const toggleUserRole = async (u: ProfileUser) => {
    const newRole = u.role === 'admin' ? 'customer' : 'admin'
    setRoleUpdating(u.id)
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', u.id)
    if (!error) {
      setAllUsers(prev => prev.map(p => p.id === u.id ? { ...p, role: newRole } : p))
    }
    setRoleUpdating(null)
  }

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    if (newStatus === 'cancelled') { await cancelOrder(orderId); return }
    const before = orders.find(o => o.id === orderId)
    await supabase.from('orders').update({ status: newStatus }).eq('id', orderId)
    void auditService.log({ action: 'invoice_status_changed', entityType: 'invoice', entityId: before?.invoice_no || orderId, oldValue: { status: before?.status }, newValue: { status: newStatus } })
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
    setSearchResults(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o))
  }

  /**
   * Voids a bill but keeps it on record (marked cancelled). Stock goes back and any scheme / advance
   * amount used on it is released by the database; the bill can no longer be reopened.
   */
  const cancelOrder = async (orderId: string) => {
    const before = orders.find(o => o.id === orderId) || searchResults.find(o => o.id === orderId)
    const invoiceLabel = formatInvoiceNo(before?.invoice_no || '')
    if (role !== 'admin') { alert('Only the admin can cancel an invoice. Record a return in Sales Desk instead.'); return }
    const reason = window.prompt(`Cancel invoice ${invoiceLabel}?\n\nIt stays in Order History marked CANCELLED and drops out of sales. Items go back to stock and any scheme or advance amount used on it is given back. A cancelled bill cannot be reopened.\n\nEnter the reason:`)
    if (!reason || !reason.trim()) return
    const { error } = await supabase.rpc('cancel_invoice', { p_order_id: orderId, p_reason: reason.trim(), p_cancelled_by: role === 'admin' ? 'Admin' : 'Staff' })
    if (error) {
      alert((error as { code?: string }).code === 'PGRST202'
        ? 'Cancelling invoices needs the database update: run supabase/migrations/jewellery_pos.sql again in the Supabase SQL Editor.'
        : `Could not cancel the invoice: ${error.message}`)
      return
    }
    void auditService.log({ action: 'invoice_cancelled', entityType: 'invoice', entityId: before?.invoice_no || orderId, oldValue: { status: before?.status, total: before?.total }, newValue: { status: 'cancelled' }, note: reason.trim() })
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'cancelled' } : o))
    setSearchResults(prev => prev.map(o => o.id === orderId ? { ...o, status: 'cancelled' } : o))
  }

  const deleteOrder = async (orderId: string, invoiceNo: string) => {
    // Invoices are deleted only by the admin; staff record a return instead (Sales Desk).
    if (role !== 'admin') {
      alert('Only the admin can delete an invoice. Record a return in Sales Desk instead.')
      return
    }
    if (!window.confirm(`Delete invoice ${formatInvoiceNo(invoiceNo)} completely?\n\nIt is removed from sales, revenue and reports, items go back to stock, and any scheme or advance amount used on it is given back. Its old gold, returns and advance order are removed too.\n\nThis cannot be undone.`)) return
    const before = orders.find(o => o.id === orderId) || searchResults.find(o => o.id === orderId)
    const { error } = await supabase.from('orders').delete().eq('id', orderId)
    if (error) {
      alert(`Error deleting order: ${error.message}`)
      return
    }
    void auditService.log({ action: 'invoice_deleted', entityType: 'invoice', entityId: invoiceNo, oldValue: before ? { total: before.total, customer: before.customer_name, phone: before.phone, date: before.created_at } : null })
    // Track deleted ID so re-searches don't bring it back
    deletedOrderIds.current.add(orderId)
    setOrders(prev => prev.filter(o => o.id !== orderId))
    setSearchResults(prev => prev.filter(o => o.id !== orderId))
  }

  const getOrderWhatsAppPreview = (order: DashboardOrder) => {
    const rawItems = parseOrderItems(order.items)
    const fallbackItems = orderItems
      .filter(item => item.order_id === order.id)
      .map(item => ({ name: item.product_name, quantity: item.quantity, line_total: item.line_total }))
    const items = (rawItems.length ? rawItems : fallbackItems).map(normalizeStructuredOrderItem)
    if (!items.length) return null

    const subtotal = items.reduce((sum, item) => sum + toNumber(item.line_total, 0), 0)
    const message = buildProfessionalWhatsAppMessage({
      customerName: order.customer_name,
      phone: order.phone,
      invoiceNumber: order.invoice_no || order.id,
      invoiceDate: order.created_at,
      paymentMode: formatPaymentMode(order.payment_mode || order.payment_method, order.split_details) || undefined,
      items: items.map(item => ({
        name: item.name,
        qty: item.quantity,
        unit: item.unit,
        unitType: item.unit_type,
        rate: item.base_price,
        lineTotal: item.line_total,
        giftNote: item.special_offer_note,
        giftValue: item.special_offer_cost,
        jewellery: item.jewellery,
      })),
      subtotal,
      couponDiscount: order.discount_amount,
      shipping: order.delivery_charge,
      total: order.total,
      schemeNumber: order.scheme_number,
      schemeDiscount: order.scheme_discount,
      schemeAmountUsed: order.scheme_amount_used,
      schemeBalanceAfter: order.scheme_balance_after,
      advanceAmountUsed: order.advance_amount_used,
      exchangeAmount: order.exchange_amount,
      isCredit: order.credit_status === 'outstanding' || order.credit_status === 'paid',
      creditDueDate: order.credit_status === 'outstanding' ? order.credit_due_date : undefined,
      creditPaidAt: order.credit_status === 'paid' ? order.credit_paid_at : undefined,
    })
    return { items, subtotal, message, fileName: `Invoice-${order.invoice_no || order.id}.pdf` }
  }


  const handleShareViaWhatsApp = (order: DashboardOrder) => {
    const preview = getOrderWhatsAppPreview(order)
    if (!preview) { alert('This order has no invoice details available.'); return }
    window.open(toWhatsAppUrl(order.phone, preview.message), '_blank', 'noopener,noreferrer')
  }

  const handlePrintReceipt = (order: DashboardOrder, paperWidth: 58 | 80 = 80) => {
    const preview = getOrderWhatsAppPreview(order)
    if (!preview) { alert('This order has no invoice details available.'); return }
    const subtotal = order.total - (order.delivery_charge || 0) + (order.discount_amount || 0)

    printThermalReceipt({
      paperWidth,
      paymentMode: formatPaymentMode(order.payment_mode || order.payment_method, order.split_details) || undefined,
      invoiceNo: order.invoice_no || order.id,
      date: order.created_at,
      customerName: order.customer_name,
      phone: order.phone,
      items: (preview.items as Array<{
        name?: string
        product_name?: string
        qty?: number
        quantity?: number
        unit?: string
        price?: number
        base_price?: number
        line_total?: number
        special_offer_note?: string | null
        special_offer_cost?: number | null
        jewellery?: import('../lib/jewellery').JewellerySnapshot | null
      }>).map((item) => ({
        name: item.name || item.product_name || '',
        qty: item.qty || item.quantity || 0,
        unit: item.unit || '',
        price: item.price || item.base_price || 0,
        line_total: item.line_total || 0,
        special_offer_note: item.special_offer_note,
        special_offer_cost: item.special_offer_cost,
        jewellery: item.jewellery || null,
      })),
      subtotal,
      shipping: order.delivery_charge || 0,
      splitDetails: order.split_details,
      customerPan: order.customer_pan,
      schemeGramsUsed: order.scheme_grams_used,
      schemeGoldRate: order.scheme_gold_rate,
      schemeNumber: order.scheme_number,
      schemeDiscount: order.scheme_discount,
      schemeAmountUsed: order.scheme_amount_used,
      schemeBalanceAfter: order.scheme_balance_after,
      advanceAmountUsed: order.advance_amount_used,
      exchangeAmount: order.exchange_amount,
      couponDiscount: order.discount_amount || 0,
      totalGst: order.total_gst || 0,
      total: order.total,
      isCredit: order.credit_status === 'outstanding' || order.credit_status === 'paid',
      creditDueDate: order.credit_status === 'outstanding' ? order.credit_due_date : undefined,
      creditPaidAt: order.credit_status === 'paid' ? order.credit_paid_at : undefined,
    })
  }

  const openOrderInvoice = async (order: DashboardOrder, mode: 'view' | 'download' | 'print') => {
    if (mode === 'view') {
      setInvoicePreviewOrder(order)
      return
    }

    // A credit sale's stored PDF was generated before payment (or before it was
    // ever credit at all) — once settled, regenerate fresh instead of serving
    // the stale "payment due" snapshot from checkout time.
    if (order.invoice_pdf_url && order.credit_status !== 'paid') {
      const link = document.createElement('a')
      link.href = order.invoice_pdf_url
      if (mode === 'download') link.download = `Invoice-${order.invoice_no || order.id}.pdf`
      if (mode === 'download') { link.click(); return }
      const opened = window.open(order.invoice_pdf_url, '_blank', 'noopener,noreferrer')
      if (mode === 'print') opened?.addEventListener('load', () => opened.print())
      return
    }
    const preview = getOrderWhatsAppPreview(order)
    if (!preview) { alert('This order has no invoice details available.'); return }
    const file = invoicePdfFile({
      invoiceNo: order.invoice_no || order.id,
      date: order.created_at,
      customerName: order.customer_name,
      phone: order.phone,
      address: order.address,
      items: preview.items as unknown as Array<Record<string, unknown>>,
      subtotal: preview.subtotal,
      shipping: order.delivery_charge,
      discountAmount: order.discount_amount,
      manualDiscountAmount: order.manual_discount_amount,
      gstAmount: order.total_gst,
      paymentMode: formatPaymentMode(order.payment_mode || order.payment_method, order.split_details) || undefined,
      total: order.total,
      splitDetails: order.split_details,
      customerGstin: order.customer_gstin,
      customerPan: order.customer_pan,
      schemeGramsUsed: order.scheme_grams_used,
      schemeGoldRate: order.scheme_gold_rate,
      schemeNumber: order.scheme_number,
      schemeDiscount: order.scheme_discount,
      schemeAmountUsed: order.scheme_amount_used,
      schemeBalanceAfter: order.scheme_balance_after,
      advanceAmountUsed: order.advance_amount_used,
      exchangeAmount: order.exchange_amount,
      isCredit: order.credit_status === 'outstanding' || order.credit_status === 'paid',
      creditDueDate: order.credit_status === 'outstanding' ? order.credit_due_date : undefined,
      creditPaidAt: order.credit_status === 'paid' ? order.credit_paid_at : undefined,
    })
    const url = URL.createObjectURL(file)
    if (mode === 'download') {
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (mode === 'print') opened?.addEventListener('load', () => opened.print())
  }

  const generateCouponCode = () => {
    const prefixes = ['SAVE', 'DEAL', 'OFFER', 'SHOP', 'SPECIAL', 'FRESH', 'NEW']
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
    const suffix = Math.floor(Math.random() * 90 + 10)
    setCouponForm(f => ({ ...f, code: `${prefix}${suffix}` }))
    setCouponSaveError('')
    setCouponSaveSuccess('')
  }

  const saveCoupon = async (e: FormEvent) => {
    e.preventDefault()
    setCouponSaveError('')
    setCouponSaveSuccess('')
    if (!couponForm.code.trim()) { setCouponSaveError('Coupon code is required'); return }
    if (!(toNumber(couponForm.percentage, 0) > 0 && toNumber(couponForm.percentage, 0) <= 100)) {
      setCouponSaveError('Discount must be between 1% and 100%'); return
    }
    const code = couponForm.code.trim().toUpperCase()
    const payload = {
      code,
      percentage: toNumber(couponForm.percentage, 0),
      is_active: true,
      expiry_date: couponForm.expiry_date || null,
      usage_limit: couponForm.usage_limit ? toNumber(couponForm.usage_limit, 0) : null,
      min_order_value: toNumber(couponForm.min_order_value, 0),
    }
    let error: unknown = null
    if (editingCouponId !== null) {
      // Update existing - don't change code (it's the PK equivalent)
      const res = await supabase.from('coupons').update({ ...payload }).eq('id', editingCouponId)
      error = res.error
    } else {
      // Insert new coupon - UNIQUE constraint on code catches duplicates
      const res = await supabase.from('coupons').insert(payload)
      error = res.error
    }
    if (error) {
      const msg = (error as { message?: string }).message || 'Failed to save coupon'
      if (msg.toLowerCase().includes('row-level security')) {
        setCouponSaveError('Coupon save was blocked by Supabase RLS. Confirm your user has the admin role.')
      } else {
        setCouponSaveError(msg.includes('unique') || msg.includes('duplicate') ? `Coupon code "${code}" already exists` : msg)
      }
    } else {
      setCouponForm({ code: '', percentage: '10', expiry_date: '', usage_limit: '', min_order_value: '' })
      setEditingCouponId(null)
      setCouponSaveSuccess(editingCouponId !== null ? 'Coupon updated!' : 'Coupon created!')
      await loadCoupons()
    }
  }

  const startEditCoupon = (coupon: DashboardCoupon) => {
    setEditingCouponId(coupon.id)
    setCouponForm({
      code: coupon.code,
      percentage: String(coupon.percentage),
      expiry_date: coupon.expiry_date ? coupon.expiry_date.slice(0, 10) : '',
      usage_limit: coupon.usage_limit !== null ? String(coupon.usage_limit) : '',
      min_order_value: coupon.min_order_value ? String(coupon.min_order_value) : '',
    })
    setCouponSaveError('')
    setCouponSaveSuccess('')
  }

  const cancelEditCoupon = () => {
    setEditingCouponId(null)
    setCouponForm({ code: '', percentage: '10', expiry_date: '', usage_limit: '', min_order_value: '' })
    setCouponSaveError('')
    setCouponSaveSuccess('')
  }

  const deleteCoupon = async (coupon: DashboardCoupon) => {
    if (!window.confirm(`Delete coupon "${coupon.code}"? This cannot be undone.`)) return
    await supabase.from('coupons').delete().eq('id', coupon.id)
    await loadCoupons()
  }

  const toggleCoupon = async (coupon: DashboardCoupon) => {
    await supabase.from('coupons').update({ is_active: !coupon.is_active }).eq('id', coupon.id)
    await loadCoupons()
  }

  // Keep a stable ref to the debounced loader so realtime events don't
  // trigger a full data reload more than once every 4 seconds.
  const debouncedLoadRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    debouncedLoadRef.current = debounce(() => void loadData(), 350)
  }, [loadData])

  useEffect(() => {
    if (!isAdmin) return
    void loadData()
    if (!isSupabaseConfigured) return
    const handleChange = () => debouncedLoadRef.current?.()
    const ch = supabase.channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, handleChange)
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [isAdmin, loadData])

  useEffect(() => {
    if (tab === 'users') void loadUsers()
    if (tab === 'coupons') void loadCoupons()
  }, [tab, loadUsers, loadCoupons])

  const applyAnalyticsPreset = (preset: 'all' | 'today' | 'week' | 'month' | 'year' | 'custom') => {
    setAnalyticsDatePreset(preset)
    if (preset === 'all')    { setAnalyticsDateFrom(''); setAnalyticsDateTo(''); return }
    if (preset === 'custom') return
    const { from, to } = getPresetRange(preset)
    setAnalyticsDateFrom(from); setAnalyticsDateTo(to)
  }

  const applyDatePreset = (preset: 'all' | 'today' | 'week' | 'month' | 'year' | 'custom') => {
    if (preset === 'all') { setDatePreset(''); setSearch(s => ({ ...s, dateFrom: '', dateTo: '' })); return }
    setDatePreset(preset)
    if (preset === 'custom') { setSearch(s => ({ ...s, dateFrom: '', dateTo: '' })); return }
    const { from, to } = getPresetRange(preset)
    setSearch(s => ({ ...s, dateFrom: from, dateTo: to }))
  }

  // Order search - POS bills only (online_request excluded)
  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault()
    setSearchLoading(true)
    try {
      const invInput = search.invoiceNo.trim().replace(/[,()%*\\]/g, '')
      const phoneInput = search.phone.trim().replace(/[,()%*\\]/g, '')
      const custInput = search.customerName.trim()
      const hasQuery = Boolean(invInput || phoneInput || custInput)

      let q = supabase.from('orders')
        .select('id, invoice_no, customer_name, phone, address, created_at, total, status, order_mode, order_type, items, coupon_code, discount_amount, manual_discount_amount, delivery_charge, total_gst, gst_amount, payment_mode, payment_method, split_details, invoice_pdf_url, remarks, reference_number, is_credit, credit_due_date, credit_status, credit_paid_at')
        .neq('order_type', 'online_request')
        .order('created_at', { ascending: false })
        .limit(hasQuery ? 1000 : 500)

      if (invInput) {
        const digitsOnly = invInput.replace(/\D/g, '')
        const nonZeroDigits = digitsOnly.replace(/^0+/, '')
        const conds = [`invoice_no.ilike.%${invInput}%`]
        if (digitsOnly && digitsOnly !== invInput) conds.push(`invoice_no.ilike.%${digitsOnly}%`)
        if (nonZeroDigits && nonZeroDigits !== digitsOnly && nonZeroDigits !== invInput) conds.push(`invoice_no.ilike.%${nonZeroDigits}%`)
        q = q.or(conds.join(','))
      }

      if (phoneInput) {
        const digitsOnly = phoneInput.replace(/\D/g, '')
        if (digitsOnly && digitsOnly.length >= 4) {
          q = q.or(`phone.ilike.%${phoneInput}%,phone.ilike.%${digitsOnly}%`)
        } else {
          q = q.ilike('phone', `%${phoneInput}%`)
        }
      }

      if (custInput) {
        q = q.ilike('customer_name', `%${custInput}%`)
      }

      // Apply date filters only if no specific text query is active or if custom date range was selected
      if (!hasQuery || datePreset === 'custom') {
        // Day bounds in the shop's local time (IST), sent as UTC instants
        if (search.dateFrom) q = q.gte('created_at', new Date(`${search.dateFrom}T00:00:00`).toISOString())
        if (search.dateTo)   q = q.lte('created_at', new Date(`${search.dateTo}T23:59:59.999`).toISOString())
      }

      if (billTypeFilter === 'manual')       q = q.eq('order_type', 'manual_sale')
      else if (billTypeFilter === 'offline') q = q.eq('order_type', 'pos_sale').eq('order_mode', 'offline')
      else if (billTypeFilter === 'online')  q = q.eq('order_type', 'pos_sale').eq('order_mode', 'online')

      const { data, error } = await q
      if (error) throw error

      let results = await attachSchemeInfo((data || []).map(r => toDashboardOrder(r as Record<string, unknown>)))

      // Client-side match filter to handle formatted invoice numbers (e.g. INV0000013 vs PB-20260716-000013)
      const matchOrder = (o: DashboardOrder) => {
        if (invInput) {
          const matchRaw = o.invoice_no.toLowerCase().includes(invInput.toLowerCase())
          const matchFmt = formatInvoiceNo(o.invoice_no).toLowerCase().includes(invInput.toLowerCase())
          const matchId  = o.id.toLowerCase() === invInput.toLowerCase()
          const invDigits = invInput.replace(/\D/g, '')
          const rawDigits = o.invoice_no.replace(/\D/g, '')
          const matchDigits = invDigits && (rawDigits.endsWith(invDigits) || rawDigits.includes(invDigits))
          if (!matchRaw && !matchFmt && !matchId && !matchDigits) return false
        }
        if (custInput) {
          const matchCust = o.customer_name.toLowerCase().includes(custInput.toLowerCase())
          if (!matchCust) return false
        }
        if (phoneInput) {
          const pDigits = phoneInput.replace(/\D/g, '')
          const rawPhoneDigits = o.phone.replace(/\D/g, '')
          const matchPhoneRaw = o.phone.toLowerCase().includes(phoneInput.toLowerCase())
          const matchPhoneDigits = Boolean(pDigits && rawPhoneDigits.includes(pDigits))
          if (!matchPhoneRaw && !matchPhoneDigits) return false
        }
        return true
      }

      if (hasQuery) {
        results = results.filter(matchOrder)
      }

      // Fallback: if query returned no results from Supabase, search in pre-loaded orders
      if (hasQuery && results.length === 0 && orders.length > 0) {
        const localMatches = orders.filter(o => {
          if (normalizeOrderType(o.order_type) === 'online_request') return false
          return matchOrder(o)
        })
        if (localMatches.length > 0) {
          results = localMatches
        }
      }

      setSearchResults(results.filter(o => !deletedOrderIds.current.has(o.id)))
    } catch (err) {
      console.error('Search error:', err)
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  // Re-run the search when a bill-type or date filter changes, so tapping a
  // filter updates the list without also pressing "Search Bills".
  const runSearchRef = useRef(runSearch)
  runSearchRef.current = runSearch
  const searchFiltersReady = useRef(false)
  useEffect(() => {
    if (!searchFiltersReady.current) { searchFiltersReady.current = true; return }
    void runSearchRef.current()
  }, [billTypeFilter, search.dateFrom, search.dateTo])

  // Order ID / name / phone filter as you type (debounced).
  const typedFiltersReady = useRef(false)
  useEffect(() => {
    if (!typedFiltersReady.current) { typedFiltersReady.current = true; return }
    const t = window.setTimeout(() => { void runSearchRef.current() }, 400)
    return () => window.clearTimeout(t)
  }, [search.invoiceNo, search.customerName, search.phone])

  useEffect(() => {
    try {
      window.localStorage.setItem('dashboard-sidebar-collapsed', sidebarCollapsed ? '1' : '0')
    } catch {
      // Ignore persistence failures in private mode or restricted storage.
    }
  }, [sidebarCollapsed])

  // Auto-refresh analytics data every 30 seconds
  useEffect(() => {
    if (tab !== 'pos_analytics' || (posAnalyticsTab !== 'today' && posAnalyticsTab !== 'products' && posAnalyticsTab !== 'categories' && posAnalyticsTab !== 'coupons' && posAnalyticsTab !== 'jewellery')) return
    const interval = setInterval(() => { void loadData() }, 30000)
    return () => clearInterval(interval)
  }, [tab, posAnalyticsTab, loadData])


  const [outstandingCreditCount, setOutstandingCreditCount] = useState(0)
  const refreshOutstandingCreditCount = useCallback(() => {
    creditService.fetchOverdueCount().then(setOutstandingCreditCount).catch(() => {})
  }, [])
  useEffect(() => {
    refreshOutstandingCreditCount()
  }, [tab, refreshOutstandingCreditCount])

  // A credit sale "moves" into Order History the moment it's marked paid —
  // patch it into both lists locally instead of waiting on a full refetch.
  const handleCreditSettled = useCallback((orderId: string, paidAt: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, credit_status: 'paid', credit_paid_at: paidAt } : o))
    setSearchResults(prev => prev.map(o => o.id === orderId ? { ...o, credit_status: 'paid', credit_paid_at: paidAt } : o))
    refreshOutstandingCreditCount()
  }, [refreshOutstandingCreditCount])

  const handleCreditDueDateChanged = useCallback((orderId: string, newDate: string) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, credit_due_date: newDate } : o))
    setSearchResults(prev => prev.map(o => o.id === orderId ? { ...o, credit_due_date: newDate } : o))
    refreshOutstandingCreditCount()
  }, [refreshOutstandingCreditCount])

  // Outstanding Credits reuses the same full order records (and the same
  // view/print/download/share/delete actions) as Order History — it's just
  // a different filter over the same data, not a separate fetch.
  const outstandingCreditOrders = useMemo(
    () => orders
      // A credit bill with no credit_status yet (e.g. saved before the column existed) is still unpaid
      .filter(o => o.credit_status === 'outstanding' || (o.is_credit && !o.credit_status))
      .sort((a, b) => (a.credit_due_date || '9999-99-99').localeCompare(b.credit_due_date || '9999-99-99')),
    [orders]
  )
  const creditHistoryOrders = useMemo(
    () => orders
      .filter(o => o.credit_status === 'paid')
      .sort((a, b) => (b.credit_paid_at || '').localeCompare(a.credit_paid_at || '')),
    [orders]
  )

  if (!isAdmin) return (
    <div className="min-h-screen bg-bgMain flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-xl text-center max-w-sm">
        <AlertCircle className="mx-auto text-red-400 mb-4" size={48} />
        <h2 className="text-[28px] font-black text-[#000000] tracking-tight mb-2">{l('Unauthorized', 'அன� மதி இல� லை')}</h2>
        <Link to="/" className="px-6 py-3 bg-sageDark text-white rounded-xl font-bold inline-block mt-4">{l('Go Home', 'ம� கப� பிற� க� ')}</Link>
      </div>
    </div>
  )

  const navItems: Array<{ id: TabKey; icon: React.ReactNode; label: string; badge?: number }> = role === 'staff'
    ? [
        { id: 'billing',        icon: <Receipt size={20} />,      label: 'Billing Panel' },
        { id: 'inventory',      icon: <Boxes size={20} />,        label: 'Inventory' },
        { id: 'metal_rates',    icon: <Gem size={20} />,          label: 'Metal Rates' },
        { id: 'schemes',        icon: <PiggyBank size={20} />,    label: 'Schema' },
        { id: 'sales_desk',     icon: <Briefcase size={20} />,    label: 'Sales Desk' },
        { id: 'advance_orders', icon: <Clock size={20} />,        label: 'Advance Orders' },
        { id: 'customer_events', icon: <Users size={20} />,        label: 'Customers' },
        { id: 'history',        icon: <History size={20} />,      label: 'Order History' },
      ]
    : [
        { id: 'billing',        icon: <Receipt size={20} />,      label: 'Billing Panel' },
        { id: 'inventory',      icon: <Boxes size={20} />,        label: 'Inventory' },
        { id: 'purchases',      icon: <Truck size={20} />,        label: 'Purchases' },
        { id: 'metal_rates',    icon: <Gem size={20} />,          label: 'Metal Rates' },
        { id: 'schemes',        icon: <PiggyBank size={20} />,    label: 'Schema' },
        { id: 'sales_desk',     icon: <Briefcase size={20} />,    label: 'Sales Desk' },
        { id: 'advance_orders', icon: <Clock size={20} />,        label: 'Advance Orders' },
        { id: 'customer_events', icon: <Users size={20} />,        label: 'Customers' },
        { id: 'expenses',       icon: <Wallet size={20} />,       label: 'Expense Tracker' },
        { id: 'outstanding_credits', icon: <Banknote size={20} />, label: 'Outstanding Credits', badge: outstandingCreditCount },
        { id: 'history',        icon: <History size={20} />,      label: 'Order History' },
        { id: 'pos_analytics',  icon: <BarChart2 size={20} />,    label: 'Analytics Dashboard' },
        { id: 'coupons',        icon: <Tag size={20} />,          label: 'Coupons' },
        { id: 'settings',       icon: <Settings2 size={20} />,    label: 'Settings' },
      ]

  const sidebarOpen = !sidebarCollapsed
  const logout = () => {
    useAdminAuthStore.getState().logout()
    navigate('/admin-login', { replace: true })
  }

  return (
    <div className="admin-shell h-dvh max-h-dvh min-h-dvh bg-white flex overflow-hidden">
      <LowStockAlarmModal triggerKey={tab} />
      <CreditDueAlarmModal triggerKey={tab} />
      <CustomerEventAlarmModal triggerKey={tab} />

      {/* Mobile / tablet sidebar backdrop */}
      {sidebarOpen && (
        <div onClick={() => setSidebarCollapsed(true)} className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-30 lg:hidden print:hidden" />
      )}

      {/* Collapsible left sidebar */}
      <aside
        className={`fixed lg:sticky top-0 bottom-0 left-0 bg-gradient-to-b from-[var(--accent)] via-[var(--accent-dark)] to-[color-mix(in_srgb,var(--accent)_55%,#000000)] text-white flex flex-col justify-between h-dvh shrink-0 shadow-2xl z-40 transition-all duration-300 ease-in-out print:hidden ${sidebarOpen ? 'w-64 border-r border-white/20 translate-x-0' : 'w-0 min-w-0 border-r-0 -translate-x-64 overflow-hidden'}`}
      >
        <div className="w-64 flex flex-col justify-between h-full shrink-0 overflow-hidden relative">
          <div className="flex flex-col min-h-0">
            {/* Header branding */}
            <div className="p-6 border-b border-white/20 flex items-center justify-between gap-3 shrink-0">
              <Link to="/pos" title="Go to Billing Panel" className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shadow-md overflow-hidden shrink-0 border border-white/25 bg-white">
                  <img src={logoUrl} alt={`${shopName} Logo`} className="w-full h-full object-contain" />
                </div>
                <span className="font-black text-sm tracking-tight text-white block leading-tight break-words">{shopName}</span>
              </Link>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="w-8 h-8 rounded-lg hover:bg-white/20 flex items-center justify-center text-white font-bold transition-all cursor-pointer shrink-0"
                title="Close Menu"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation links */}
            <nav className="px-4 py-6 space-y-2 overflow-y-auto min-h-0 hide-scrollbar">
              {navItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    handleTabClick(item.id)
                    if (window.innerWidth < 1024) setSidebarCollapsed(true)
                  }}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer text-left ${tab === item.id ? 'bg-white text-[#27272A] shadow-md' : 'text-white/90 hover:bg-white/20 hover:text-white'}`}
                >
                  <span className="w-5 h-5 shrink-0 flex items-center justify-center">{item.icon}</span>
                  <span className="flex-1 min-w-0 whitespace-nowrap">{item.label}</span>
                  {Boolean(item.badge) && (
                    <span className="ml-auto min-w-[22px] h-[22px] px-1.5 rounded-full text-[10px] font-black flex items-center justify-center bg-[#F59E0B] text-white">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}

              <div className="pt-4 border-t border-white/20 mt-4">
                <button
                  onClick={logout}
                  className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl font-bold text-xs uppercase tracking-wider text-white bg-white/10 hover:bg-white/25 hover:shadow-md border border-white/20 transition-all cursor-pointer"
                >
                  <LogOut className="w-5 h-5" />
                  Log Out
                </button>
              </div>
            </nav>
          </div>

          {/* Footer branding */}
          <div className="p-5 border-t border-white/20 bg-white/10 flex items-center gap-3 shrink-0">
            <div className="w-8 h-8 rounded-full bg-white/20 border border-white/30 flex items-center justify-center text-white font-black text-xs uppercase">
              {role === 'admin' ? 'A' : 'S'}
            </div>
            <div>
              <span className="text-xs font-bold text-white block uppercase tracking-wider">{role === 'admin' ? 'Admin Access' : 'Staff Access'}</span>
              <span className="text-[9px] text-white/80 font-bold tracking-wider block">V2.1.0 • PREMIUM POS</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 h-dvh overflow-y-auto overflow-x-hidden min-w-0 px-3 sm:px-8 lg:px-12 pt-3 pb-8 relative flex flex-col">
        {/* Global top navbar */}
        <header className="flex-shrink-0 flex flex-col sm:flex-row justify-between items-start sm:items-center py-4 border-b border-black/10 w-full mb-6 gap-4 print:hidden">
          <div className="flex items-center gap-4">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="w-9 h-9 bg-white border border-black/10 rounded-lg flex items-center justify-center transition-all shadow-sm cursor-pointer"
                title="Open Menu"
                aria-label="Open menu"
              >
                <Menu className="w-[18px] h-[18px] text-[var(--accent)]" />
              </button>
            )}
            <h1 className="text-lg font-black text-[#000000] tracking-tight">{shopName}</h1>
          </div>
          <div id="dashboard-header-actions" className={tab === 'billing' ? '' : 'hidden'} />
        </header>
        <div className="flex-1 w-full max-w-[1400px] mx-auto min-w-0">

        {/* ΓöÇΓöÇ ANALYTICS TAB ΓöÇΓöÇ */}

        {/* ── BUSINESS CONTROL CENTER ── */}
        {/* ── BUSINESS CONTROL CENTER ── */}
        {tab === 'overview' && (() => {
          const latestPOS = searchResults.slice(0, 10)
          return (
          <div className="space-y-6 rounded-xl bg-[#0A0A0A] p-5 sm:p-6 lg:p-7 shadow-2xl border border-white/10 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-[#000000]">{l('Analytics Dashboard', 'பகுப்பாய்வு தட்டு')}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => void loadData()}
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-black/10 rounded-xl text-[12px] font-bold text-[#000000] hover:bg-black/[0.03]">
                  <RefreshCw size={13} /> {l('Refresh', 'புதுப்பி')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 sm:gap-2 pb-2 border-b border-black/10">
              {[
                { id: 'revenue', label: 'Revenue' },
                { id: 'product', label: 'Product & Category' },
                { id: 'inventory', label: 'Inventory' },
                { id: 'customer', label: 'Customer' },
                { id: 'billing', label: 'Billing' },
              ].map(sub => (
                <button key={sub.id} onClick={() => setAnalyticsTab(sub.id)}
                  className={`px-3 sm:px-4 py-2 rounded-xl text-[12px] sm:text-[13px] font-bold text-center transition-colors ${analyticsTab === sub.id ? 'bg-[#111111] text-white' : 'bg-white border border-black/10 text-[#000000] hover:bg-black/[0.03]'}`}>
                  {sub.label}
                </button>
              ))}
            </div>

            {analyticsTab === 'revenue' && (
              <>

            {/* Revenue KPIs - 6 cards in 3 columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: l('Total Revenue', 'மொத்த வருவாய்'),    value: formatCurrency(analytics.totalCompletedRevenue), from: 'from-emerald-50 via-emerald-50/80 to-teal-50', iconBg: 'from-emerald-400 to-teal-500', icon: <RMIcon size={16} /> },
                {
                  label: analytics.isProfitable ? l('Net Profit', 'நிகர லாபம்') : l('Net Loss', 'நிகர நஷ்டம்'),
                  value: formatCurrency(Math.abs(analytics.netProfit)),
                  from: analytics.isProfitable ? 'from-emerald-50 via-teal-50/80 to-green-50' : 'from-rose-50 via-red-50/80 to-orange-50',
                  iconBg: analytics.isProfitable ? 'from-emerald-500 to-teal-600' : 'from-rose-500 to-red-600',
                  icon: analytics.isProfitable ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
                  arrow: analytics.isProfitable ? '↑' : '↓',
                  arrowColor: analytics.isProfitable ? 'text-emerald-700 bg-emerald-100' : 'text-rose-700 bg-rose-100',
                  valueColor: analytics.isProfitable ? 'text-emerald-700' : 'text-rose-700',
                },
                { label: l('Total Expenses', 'மொத்த செலவு'),    value: formatCurrency(analytics.totalExpenses),         from: 'from-amber-50 via-amber-50/80 to-orange-50', iconBg: 'from-amber-400 to-orange-500', icon: <Receipt size={16} /> },
                { label: l("Today's Sales",  'இன்றைய விற்பனை'),  value: formatCurrency(analytics.todaySales),            from: 'from-blue-50 via-blue-50/80 to-indigo-50', iconBg: 'from-blue-400 to-indigo-500', icon: <TrendingUp size={16} /> },
                { label: l('Offline Revenue', 'ஆஃப்லைன் வருவாய்'), value: formatCurrency(analytics.posRevenue),           from: 'from-orange-50 via-orange-50/80 to-amber-50', iconBg: 'from-orange-400 to-amber-500', icon: <RMIcon size={16} /> },
                { label: l('Online Revenue',  'ஆன்லைன் வருவாய்'),  value: formatCurrency(analytics.onlinePosRevenue),     from: 'from-cyan-50 via-cyan-50/80 to-sky-50', iconBg: 'from-cyan-400 to-sky-500', icon: <RMIcon size={16} /> },
              ].map((card, i) => (
                <div key={i} className={`bg-gradient-to-br ${card.from} rounded-2xl border border-white/40 p-4 sm:p-5 shadow-sm backdrop-blur-sm flex flex-col justify-between`}>
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <p className="text-[11px] uppercase font-black text-[#000000] tracking-wider leading-tight">{card.label}</p>
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${card.iconBg} flex items-center justify-center text-white shrink-0 shadow-sm`}>{card.icon}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-[21px] sm:text-[23px] font-black break-words leading-tight ${card.valueColor || 'text-[#000000]'}`}>{card.value}</p>
                    {card.arrow && (
                      <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-md ${card.arrowColor}`}>
                        {card.arrow}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Latest POS Bills */}
            <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-black text-[#000000]">{l('Latest POS Bills', 'POS பில்கள்')}</h3>
                <button onClick={() => setTab('billing')} className="text-[12px] font-bold text-[#10B981] hover:underline">{l('View All →', 'அனைத்தும் →')}</button>
              </div>
              {latestPOS.length > 0 ? (
                <>
                <div className="md:hidden rounded-xl border border-black/10 divide-y divide-black/5 overflow-hidden bg-white">
                  {latestPOS.map(o => {
                    const btLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                    return (
                      <div key={o.id} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-[#000000] text-xs break-words">{o.customer_name}</p>
                            <p className="text-[11px] text-[#000000] mt-0.5 break-words">
                              {formatInvoiceNo(o.invoice_no)}{' · '}{btLabel}{' · '}{new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-black text-[#000000] text-xs">{formatCurrency(getOrderTotal(o))}</p>
                            <span className={`inline-block mt-1 text-[10px] font-black px-2 py-0.5 rounded-lg ${normalizeStatus(o.status) === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              {normalizeStatus(o.status)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="hidden md:block overflow-x-auto rounded-xl border border-black/10">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-[#000000] bg-[#F9FAFB]">
                      <tr>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Invoice', 'பில்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Customer', 'வாடிக்கையாளர்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Total', 'மொத்தம்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Date', 'தேதி')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Type', 'வகை')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Status', 'நிலை')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {latestPOS.map(o => {
                        const btLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                        const btClass = normalizeOrderType(o.order_type) === 'manual_sale' ? 'bg-purple-100 text-purple-700' : normalizeOrderMode(o.order_mode) === 'online' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                        return (
                          <tr key={o.id} className="hover:bg-black/[0.03]">
                            <td className="px-4 py-2.5 font-bold text-[#10B981] text-[11px]">{formatInvoiceNo(o.invoice_no)}</td>
                            <td className="px-4 py-2.5 font-semibold text-[#000000] max-w-[100px] break-words">{o.customer_name}</td>
                            <td className="px-4 py-2.5 font-black text-[#000000]">{formatCurrency(getOrderTotal(o))}</td>
                            <td className="px-4 py-2.5 text-[#000000]">{new Date(o.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                            <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${btClass}`}>{btLabel}</span></td>
                            <td className="px-4 py-2.5">
                              <span className={`text-[11px] font-black px-2 py-0.5 rounded-lg ${normalizeStatus(o.status) === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                {normalizeStatus(o.status)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              ) : (
                <p className="text-xs text-[#000000] text-center py-4">{l('No bills yet', 'பில்கள் இல்லை')}</p>
              )}
            </div>
            </>
            )}

            {analyticsTab === 'product' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#000000] mb-4">Top Products by Volume</h3>
                  <div className="space-y-3">
                    {analytics.topProducts.slice(0, 10).map((p, i) => (
                      <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl">
                        <div>
                          <p className="text-xs font-bold text-[#000000]">{p.name}</p>
                          <p className="text-[11px] text-[#000000]">{p.billCount} bills</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-[#000000]">{p.qty}</p>
                          <p className="text-[11px] font-bold text-[#10B981]">{formatCurrency(p.revenue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#000000] mb-4">Top Categories by Revenue</h3>
                  <div className="space-y-3">
                    {analytics.topCategories.slice(0, 10).map((c, i) => (
                      <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl">
                        <div>
                          <p className="text-xs font-bold text-[#000000]">{c.name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-[#000000]">{formatCurrency(c.revenue)}</p>
                          <p className="text-[11px] text-[#000000]">{c.qty} sold</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {analyticsTab === 'inventory' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#000000] mb-4">Low Stock Alerts</h3>
                  <div className="space-y-3">
                    {products.filter(p => p.stock <= lowStockLimit(p.lowStockAlert)).slice(0, 10).map((p, i) => (
                      <div key={i} className="flex justify-between items-center bg-red-50 border border-red-100 p-3 rounded-xl">
                        <p className="text-xs font-bold text-red-900">{p.name}</p>
                        <p className="text-sm font-black text-red-700">{p.stock} left</p>
                      </div>
                    ))}
                    {products.filter(p => p.stock <= lowStockLimit(p.lowStockAlert)).length === 0 && (
                      <p className="text-xs text-[#000000]">No low stock alerts.</p>
                    )}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#000000] mb-4">Total Inventory Value</h3>
                  <div className="bg-white p-5 rounded-xl">
                    <p className="text-[11px] uppercase tracking-wider font-bold text-[#000000] mb-1">Selling Value (MRP)</p>
                    <p className="text-[18px] sm:text-[24px] font-black text-[#000000] break-words">
                      {formatCurrency(products.reduce((acc, p) => acc + (p.stock * p.price), 0))}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {analyticsTab === 'customer' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#000000] mb-4">Customer Insights</h3>
                  <div className="bg-blue-50 border border-blue-100 p-5 rounded-xl mb-4">
                    <p className="text-[11px] uppercase tracking-wider font-bold text-blue-800 mb-1">Unique Customers</p>
                    <p className="text-[18px] sm:text-[24px] font-black text-blue-900 break-words">
                      {new Set(searchResults.filter(o => o.phone).map(o => o.phone)).size}
                    </p>
                  </div>
                  <div className="bg-white p-5 rounded-xl">
                    <p className="text-[11px] uppercase tracking-wider font-bold text-[#000000] mb-1">Avg Order Value</p>
                    <p className="text-[18px] sm:text-[24px] font-black text-[#000000] break-words">
                      {formatCurrency(analytics.totalCompletedRevenue / (searchResults.filter(o => isCompletedStatus(o.status)).length || 1))}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {analyticsTab === 'billing' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#000000] mb-4">Billing Metrics</h3>
                  <div className="space-y-4">
                    <div className="bg-white p-4 rounded-xl flex justify-between items-center">
                      <span className="text-xs font-bold text-[#000000]">Total Invoices Generated</span>
                      <span className="text-[16px] font-black text-[#000000]">{searchResults.length}</span>
                    </div>
                    <div className="bg-white p-4 rounded-xl flex justify-between items-center">
                      <span className="text-xs font-bold text-[#000000]">Discounts Applied</span>
                      <span className="text-[16px] font-black text-[#10B981]">
                        {formatCurrency(searchResults.reduce((acc, o) => acc + (toNumber(o.discount_amount, 0)), 0))}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-base font-black text-[#000000] mb-4">Top Coupons</h3>
                  <div className="space-y-3">
                    {analytics.topCoupons.slice(0, 5).map((c, i) => (
                      <div key={i} className="flex justify-between items-center bg-white p-3 rounded-xl">
                        <span className="text-xs font-bold text-[#000000]">{c.code}</span>
                        <span className="text-xs font-bold text-[#10B981]">{c.usage} uses</span>
                      </div>
                    ))}
                    {analytics.topCoupons.length === 0 && <p className="text-xs text-[#000000]">No coupons used yet.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
          )
        })()}

        {/* ── WHATSAPP CENTER ── */}
        {tab === 'whatsapp' && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-black text-[#000000]">{l('WhatsApp Center', 'வாட்ஸ் அப் மையம்')}</h2>
                {analytics.waPending > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-black animate-pulse">
                    {analytics.waPending} {l('pending', 'நிலுவை')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* Compact period filter */}
                <div className="flex gap-1">
                  {(['all', 'today', 'week', 'month'] as const).map(preset => (
                    <button key={preset} type="button" onClick={() => applyAnalyticsPreset(preset)}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-black transition-colors ${analyticsDatePreset === preset ? 'bg-[#111111] text-white' : 'bg-white text-[#000000] hover:bg-[#E5E7EB]/40'}`}>
                      {preset === 'all' ? l('All','எல்லாம்') : preset === 'today' ? l('Today','இன்று') : preset === 'week' ? l('Week','வாரம்') : l('Month','மாதம்')}
                    </button>
                  ))}
                </div>
                <button onClick={() => void loadData()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-black/10 rounded-lg text-[11px] font-bold text-[#000000] hover:bg-black/[0.03]">
                  <RefreshCw size={12} /> {l('Refresh', 'புதுப்பி')}
                </button>
              </div>
            </div>

            {/* Status summary cards */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: l('Total Requests', 'மொத்த கோரிக்கை'), val: analytics.waRequests,  bg: 'bg-blue-50',   color: 'text-blue-700',   border: 'border-blue-100' },
                { label: l('Pending', 'நிலுவை'),                 val: analytics.waPending,   bg: 'bg-amber-50',  color: 'text-amber-700',  border: 'border-amber-100' },
                { label: l('Contacted', 'தொடர்பு'),               val: analytics.waContacted, bg: 'bg-orange-50', color: 'text-orange-700', border: 'border-orange-100' },
                { label: l('Completed', 'முடிந்தது'),              val: analytics.waCompleted, bg: 'bg-green-50',  color: 'text-green-700',  border: 'border-green-100' },
              ].map(({ label, val, bg, color, border }) => (
                <div key={label} className={`${bg} border ${border} rounded-xl p-2 sm:p-3 text-center`}>
                  <p className={`text-[9px] sm:text-[10px] uppercase font-black ${color} tracking-wider mb-1`}>{label}</p>
                  <p className="text-[18px] sm:text-[28px] font-black text-[#000000] leading-none break-words">{val}</p>
                </div>
              ))}
            </div>

            {/* ═══ CUSTOMER REQUEST MANAGEMENT - PRIMARY SECTION ═══ */}
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-blue-100">
                <div className="flex items-center gap-2">
                  <MessageCircle size={17} className="text-blue-600" />
                  <h3 className="text-base font-black text-[#000000]">{l('Customer Requests', 'வாடிக்கையாளர் கோரிக்கைகள்')}</h3>
                  <span className="text-[10px] font-bold text-[#9BAB9A] bg-white px-2 py-0.5 rounded-full">{l('RM0 revenue - status updates only', 'RM0 வருவாய் - நிலை மட்டும்')}</span>
                </div>
                <span className="text-xs text-[#000000] font-bold">{analytics.onlineRequestOrders.length} {l('requests', 'கோரிக்கைகள்')}</span>
              </div>

              {analytics.onlineRequestOrders.length > 0 ? (
                <>
                <div className="md:hidden divide-y divide-blue-50">
                  {analytics.onlineRequestOrders.map(order => {
                    const its = parseOrderItems(order.items)
                    const isExpanded = waExpandedId === order.id
                    const normalizedItems = its.map(raw => normalizeStructuredOrderItem(raw as Record<string, unknown>))
                    const waMsg = buildProfessionalWhatsAppMessage({
                      customerName: order.customer_name,
                      phone: order.phone,
                      invoiceNumber: formatInvoiceNo(order.invoice_no || order.id),
                      invoiceDate: order.created_at,
                      items: normalizedItems.map(item => ({
                        name: item.name,
                        qty: item.quantity,
                        unit: item.unit,
                        unitType: item.unit_type,
                        rate: item.base_price,
                        lineTotal: item.line_total,
                        giftNote: item.special_offer_note,
                        giftValue: item.special_offer_cost,
                      })),
                      subtotal: normalizedItems.reduce((sum, item) => sum + item.line_total, 0),
                      total: getOrderTotal(order),
                      paymentMode: formatPaymentMode(order.payment_mode || order.payment_method, order.split_details) || undefined,
                    })

                    return (
                      <div key={order.id} className={`p-3 space-y-2.5 ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-[#000000] text-xs break-words">{order.customer_name || '-'}</p>
                            <p className="text-[11px] text-[#000000] mt-0.5 break-words">
                              {[order.phone, order.address, new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-black text-[#000000] text-xs">{formatCurrency(getOrderTotal(order))}</p>
                            <p className="text-[10px] text-[#000000] font-bold">{its.length} {l('items', 'பொருட்கள்')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={normalizeStatus(order.status)} disabled={normalizeStatus(order.status) === 'cancelled'}
                            onChange={e => void updateOrderStatus(order.id, e.target.value)}
                            className={`text-[11px] font-black px-2 py-1.5 rounded-lg border cursor-pointer outline-none ${
                              normalizeStatus(order.status) === 'cancelled' ? 'bg-gray-100 text-gray-500 border-black/10 cursor-not-allowed'
                              : isCompletedStatus(order.status) ? 'bg-green-100 text-green-700 border-green-200'
                              : normalizeStatus(order.status) === 'contacted' ? 'bg-orange-100 text-orange-700 border-orange-200'
                              : 'bg-amber-100 text-amber-700 border-amber-200'
                            }`}>
                            <option value="pending">{l('Pending', 'நிலுவை')}</option>
                            <option value="contacted">{l('Contacted', 'தொடர்பு')}</option>
                            <option value="completed">{l('Completed', 'முடிந்தது')}</option>
<option value="cancelled">{l('Cancelled', 'ரத்து')}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => setWaExpandedId(isExpanded ? null : order.id)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${
                              isExpanded ? 'bg-[#111111] text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                            }`}>
                            {isExpanded ? l('Close', 'மூடு') : l('View', 'பார்')}
                          </button>
                          <button onClick={() => void deleteOrder(order.id, order.invoice_no)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete Order">
                            <Trash2 size={14} />
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="space-y-3 pt-1">
                            {Boolean(order.remarks) && (
                              <div className="text-[11px] bg-white rounded-xl p-3 border border-blue-100"><span className="font-black text-[#000000]">Remarks: </span><span className="font-bold text-[#000000] break-words">{order.remarks}</span></div>
                            )}
                            {Boolean(order.reference_number) && (
                              <div className="text-[11px] bg-white rounded-xl p-3 border border-blue-100"><span className="font-black text-[#000000]">Ref Number: </span><span className="font-bold text-[#000000] break-words">{order.reference_number}</span></div>
                            )}

                            {its.length > 0 && (
                              <div className="bg-white rounded-xl border border-blue-100 divide-y divide-black/5">
                                {its.map((raw, idx) => {
                                  const item = raw as Record<string, unknown>
                                  const fullName  = String(item.name || item.product_name || 'Product')
                                  const dashIdx   = fullName.indexOf(' - ')
                                  const prodName  = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName
                                  const variant   = dashIdx > 0 ? fullName.slice(dashIdx + 3) : ''
                                  const qty       = toNumber(item.quantity ?? item.qty, 0)
                                  const basePrice = toNumber(item.base_price ?? item.basePrice ?? item.price, 0)
                                  const lineTotal = toNumber(item.line_total ?? item.lineTotal, 0)
                                  const unit      = String(item.unit || 'pc')
                                  const unitType  = String(item.unit_type || item.unitType || 'unit')
                                  const sizeLabel = unitType === 'weight'
                                    ? qty >= 1000 ? `${qty / 1000}kg` : `${qty}g`
                                    : unitType === 'volume'
                                      ? qty >= 1000 ? `${qty / 1000}L` : `${qty}ml`
                                      : `${qty} ${unit}`
                                  return (
                                    <div key={idx} className="px-3 py-2 flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="font-bold text-[#000000] text-xs break-words">{prodName}</p>
                                        <p className="text-[10px] text-[#000000] mt-0.5">{[variant, sizeLabel, formatCurrency(basePrice)].filter(Boolean).join(' · ')}</p>
                                      </div>
                                      <p className="font-black text-[#000000] text-xs shrink-0">{formatCurrency(lineTotal)}</p>
                                    </div>
                                  )
                                })}
                                <div className="px-3 py-2.5 flex items-center justify-between bg-white">
                                  <span className="font-black text-[#000000] text-[11px] uppercase tracking-wider">{l('Grand Total', 'மொத்த தொகை')}</span>
                                  <span className="font-black text-[16px] text-[#000000]">{formatCurrency(getOrderTotal(order))}</span>
                                </div>
                              </div>
                            )}

                            <div className="bg-white rounded-xl border border-blue-100 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-black text-[#000000] uppercase tracking-wider">{l('WhatsApp Message', 'வாட்ஸ் அப் செய்தி')}</span>
                                <button
                                  type="button"
                                  onClick={() => void navigator.clipboard.writeText(waMsg)}
                                  className="px-3 py-1 rounded-lg bg-[#25D366] text-white text-[11px] font-black hover:bg-[#1da851] transition-colors">
                                  {l('Copy', 'நகல்')}
                                </button>
                              </div>
                              <pre className="text-[11px] text-[#000000] bg-white rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed select-all break-words">{waMsg}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-blue-100 sticky top-0 z-10 bg-[#F9FAFB]">
                      <tr className="text-left text-[#000000] font-black text-[10px] uppercase tracking-wider">
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Customer', 'வாடிக்கையாளர்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Phone', 'தொலைபேசி')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Address', 'முகவரி')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">{l('Products', 'பொருட்கள்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Est. Total', 'மதிப்பீடு')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Date & Time', 'தேதி & நேரம்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Status', 'நிலை')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">{l('Details', 'விவரம்')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-50">
                      {analytics.onlineRequestOrders.map(order => {
                        const its = parseOrderItems(order.items)
                        const isExpanded = waExpandedId === order.id

                        const normalizedItems = its.map(raw => normalizeStructuredOrderItem(raw as Record<string, unknown>))
                        const waMsg = buildProfessionalWhatsAppMessage({
                          customerName: order.customer_name,
                          phone: order.phone,
                          invoiceNumber: formatInvoiceNo(order.invoice_no || order.id),
                          invoiceDate: order.created_at,
                          items: normalizedItems.map(item => ({
                            name: item.name,
                            qty: item.quantity,
                            unit: item.unit,
                            unitType: item.unit_type,
                            rate: item.base_price,
                            lineTotal: item.line_total,
                            giftNote: item.special_offer_note,
                            giftValue: item.special_offer_cost,
                          })),
                          subtotal: normalizedItems.reduce((sum, item) => sum + item.line_total, 0),
                          total: getOrderTotal(order),
                          paymentMode: formatPaymentMode(order.payment_mode || order.payment_method, order.split_details) || undefined,
                        })

                        return (
                          <React.Fragment key={order.id}>
                            <tr className={`hover:bg-blue-50/40 align-middle ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                              <td className="px-4 py-3 font-bold text-[#000000]">{order.customer_name || '-'}</td>
                              <td className="px-4 py-3 text-[#000000] text-xs">
                                <span className="font-semibold text-[#000000]">{formatPhoneWithCountryCode(order.phone).code}</span>
                                <span className="ml-1">{formatPhoneWithCountryCode(order.phone).number}</span>
                              </td>
                              <td className="px-4 py-3 text-[#000000] max-w-[140px] break-words" title={order.address || '-'}>{order.address || '-'}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-[11px] font-black">{its.length}</span>
                              </td>
                              <td className="px-4 py-3 font-black text-[#000000]">{formatCurrency(getOrderTotal(order))}</td>
                              <td className="px-4 py-3 text-[#000000] text-[11px]">
                                <div>{new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                                <div className="text-[10px]">{new Date(order.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <select
                                    value={normalizeStatus(order.status)} disabled={normalizeStatus(order.status) === 'cancelled'}
                                    onChange={e => void updateOrderStatus(order.id, e.target.value)}
                                    className={`text-[11px] font-black px-2 py-1.5 rounded-lg border cursor-pointer outline-none ${
                                      normalizeStatus(order.status) === 'cancelled' ? 'bg-gray-100 text-gray-500 border-black/10 cursor-not-allowed'
                              : isCompletedStatus(order.status) ? 'bg-green-100 text-green-700 border-green-200'
                                      : normalizeStatus(order.status) === 'contacted' ? 'bg-orange-100 text-orange-700 border-orange-200'
                                      : 'bg-amber-100 text-amber-700 border-amber-200'
                                    }`}>
                                    <option value="pending">{l('Pending', 'நிலுவை')}</option>
                                    <option value="contacted">{l('Contacted', 'தொடர்பு')}</option>
                                    <option value="completed">{l('Completed', 'முடிந்தது')}</option>
<option value="cancelled">{l('Cancelled', 'ரத்து')}</option>
                                  </select>
                                  <button onClick={() => void deleteOrder(order.id, order.invoice_no)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Delete Order">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={() => setWaExpandedId(isExpanded ? null : order.id)}
                                  className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition-colors whitespace-nowrap ${
                                    isExpanded ? 'bg-[#111111] text-white' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                  }`}>
                                  {isExpanded ? l('Close', 'மூடு') : l('View', 'பார்')}
                                </button>
                              </td>
                            </tr>

                            {/* Expanded detail row */}
                            {isExpanded && (
                              <tr>
                                <td colSpan={8} className="px-4 pb-5 pt-2 bg-blue-50/40">
                                  <div className="space-y-4">
                                    {/* Customer info bar */}
                                    <div className="flex flex-wrap gap-4 text-xs bg-white rounded-xl p-3 border border-blue-100">
                                      <div><span className="font-black text-[#000000]">{l('Name', 'பெயர்')}: </span><span className="font-bold text-[#000000]">{order.customer_name || '-'}</span></div>
                                      <div><span className="font-black text-[#000000]">{l('Phone', 'தொலைபேசி')}: </span><span className="font-bold text-[#000000]">{order.phone || '-'}</span></div>
                                      <div className="flex-1"><span className="font-black text-[#000000]">{l('Address', 'முகவரி')}: </span><span className="text-[#000000]">{order.address || '-'}</span></div>
                                      {Boolean(order.remarks) && (
                                        <div className="w-full mt-1 border-t border-blue-50 pt-2"><span className="font-black text-[#000000]">Remarks: </span><span className="font-bold text-[#000000]">{order.remarks}</span></div>
                                      )}
                                      {Boolean(order.reference_number) && (
                                        <div className="w-full mt-1 border-t border-blue-50 pt-2"><span className="font-black text-[#000000]">Ref Number: </span><span className="font-bold text-[#000000]">{order.reference_number}</span></div>
                                      )}
                                    </div>

                                    {/* Items table */}
                                    {its.length > 0 && (
                                      <div className="overflow-x-auto">
                                        <table className="w-full bg-white rounded-xl overflow-hidden border border-blue-100 text-xs">
                                          <thead className="bg-[#F9FAFB]">
                                            <tr className="text-left text-[#000000] font-black text-[10px] uppercase tracking-wider">
                                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Product', 'பொருள்')}</th>
                                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Variant', 'வகைப்படி')}</th>
                                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Size / Weight', 'அளவு / எடை')}</th>
                                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">{l('Qty', 'அளவு')}</th>
                                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Unit Price', 'ஒரு விலை')}</th>
                                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">{l('Line Total', 'வரி மொத்தம்')}</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-black/5">
                                            {its.map((raw, idx) => {
                                              const item = raw as Record<string, unknown>
                                              const fullName  = String(item.name || item.product_name || 'Product')
                                              const dashIdx   = fullName.indexOf(' - ')
                                              const prodName  = dashIdx > 0 ? fullName.slice(0, dashIdx) : fullName
                                              const variant   = dashIdx > 0 ? fullName.slice(dashIdx + 3) : '-'
                                              const qty       = toNumber(item.quantity ?? item.qty, 0)
                                              const basePrice = toNumber(item.base_price ?? item.basePrice ?? item.price, 0)
                                              const lineTotal = toNumber(item.line_total ?? item.lineTotal, 0)
                                              const unit      = String(item.unit || 'pc')
                                              const unitType  = String(item.unit_type || item.unitType || 'unit')
                                              const sizeLabel = unitType === 'weight'
                                                ? qty >= 1000 ? `${qty / 1000}kg` : `${qty}g`
                                                : unitType === 'volume'
                                                  ? qty >= 1000 ? `${qty / 1000}L` : `${qty}ml`
                                                  : `${qty} ${unit}`
                                              const priceLabel = formatCurrency(basePrice)
                                              return (
                                                <tr key={idx} className="hover:bg-blue-50/20">
                                                  <td className="px-4 py-2.5 font-bold text-[#000000]">{prodName}</td>
                                                  <td className="px-4 py-2.5 text-[#000000]">{variant}</td>
                                                  <td className="px-4 py-2.5 text-[#000000]">{sizeLabel}</td>
                                                  <td className="px-4 py-2.5 text-center font-bold">{qty}</td>
                                                  <td className="px-4 py-2.5 text-[#000000]">{priceLabel}</td>
                                                  <td className="px-4 py-2.5 font-black text-[#000000] text-right">{formatCurrency(lineTotal)}</td>
                                                </tr>
                                              )
                                            })}
                                          </tbody>
                                          <tfoot className="bg-white border-t border-black/10">
                                            <tr>
                                              <td colSpan={5} className="px-4 py-2.5 text-right font-black text-[#000000] text-[11px] uppercase tracking-wider">{l('Grand Total', 'மொத்த தொகை')}</td>
                                              <td className="px-4 py-2.5 text-right font-black text-[18px] text-[#000000]">{formatCurrency(getOrderTotal(order))}</td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                    )}

                                    {/* WhatsApp message */}
                                    <div className="bg-white rounded-xl border border-blue-100 p-4">
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-black text-[#000000] uppercase tracking-wider">{l('WhatsApp Message', 'வாட்ஸ் அப் செய்தி')}</span>
                                        <button
                                          type="button"
                                          onClick={() => void navigator.clipboard.writeText(waMsg)}
                                          className="px-3 py-1 rounded-lg bg-[#25D366] text-white text-[11px] font-black hover:bg-[#1da851] transition-colors">
                                          {l('Copy Message', 'நகல் எடு')}
                                        </button>
                                      </div>
                                      <pre className="text-[12px] text-[#000000] bg-white rounded-xl p-3 whitespace-pre-wrap font-sans leading-relaxed select-all">{waMsg}</pre>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              ) : (
                <div className="px-5 py-12 text-center">
                  <MessageCircle size={40} className="mx-auto text-blue-200 mb-3" />
                  <p className="text-sm font-bold text-[#000000]">{l('No WhatsApp requests in selected period', 'தேர்ந்த காலத்தில் WA கோரிக்கை இல்லை')}</p>
                </div>
              )}
            </div>

            {/* ——— ANALYTICS - secondary, compact, bottom ——— */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Top Requested Products */}
              <div className="bg-white rounded-xl border border-black/10 p-4 shadow-sm">
                <h3 className="text-xs font-black text-[#000000] mb-3">{l('Top Requested Products', 'அதிக தேவை')}</h3>
                {analytics.topWAProducts.length > 0 ? (
                  <div className="space-y-1.5">
                    {analytics.topWAProducts.slice(0, 6).map((item, i) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[9px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="text-[11px] font-bold text-[#000000] break-words flex-1">{item.name}</span>
                        <span className="text-[11px] font-black text-blue-600 shrink-0">{item.count}x</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#9BAB9A] text-center py-3">{l('No data', 'தரவு இல்லை')}</p>
                )}
              </div>

              {/* Top Requested Categories */}
              <div className="bg-white rounded-xl border border-black/10 p-4 shadow-sm">
                <h3 className="text-xs font-black text-[#000000] mb-3">{l('Top Categories', 'வகைகள்')}</h3>
                {analytics.topWACategories.length > 0 ? (
                  <div className="space-y-1.5">
                    {analytics.topWACategories.slice(0, 6).map((cat, i) => (
                      <div key={cat.name} className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="text-[11px] font-bold text-[#000000] break-words flex-1">{cat.name}</span>
                        <span className="text-[11px] font-black text-emerald-600 shrink-0">{cat.count}x</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#9BAB9A] text-center py-3">{l('No data', 'தரவு இல்லை')}</p>
                )}
              </div>

              {/* Status Distribution - compact bar */}
              <div className="bg-white rounded-xl border border-black/10 p-4 shadow-sm">
                <h3 className="text-xs font-black text-[#000000] mb-3">{l('Status Distribution', 'நிலை விளக்கம்')}</h3>
                <div className="h-[144px] w-full min-w-0 relative">
                  <ResponsiveContainer width="100%" height={144} minWidth={0} minHeight={0}>
                    <BarChart data={analytics.statusDistribution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD0" />
                      <XAxis dataKey="name" tick={{ fill: '#6B7661', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fill: '#6B7661', fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
                      <Tooltip formatter={(value) => toNumber(value as number | string, 0)} />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={20}>
                        {analytics.statusDistribution.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ——— POS ANALYTICS ——— */}
        {tab === 'pos_analytics' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight">POS Analytics</h2>
                <p className="text-xs text-[#000000]">Real time store & channel intelligence</p>
              </div>

              {/* Export Actions */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    void exportAnalyticsToExcel({
                      data: analytics,
                      activeTab: posAnalyticsTab,
                      datePreset: analyticsDatePreset,
                      dateFrom: analyticsDateFrom,
                      dateTo: analyticsDateTo,
                    })
                  }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-[var(--accent-a40)] text-[#000000] font-bold text-xs hover:bg-black/[0.03] shadow-xs transition-all cursor-pointer hover:scale-[1.02]"
                  title="Export current analytics view to Excel"
                >
                  <Download size={14} className="text-[var(--accent-dark)]" />
                  <span>Export Excel</span>
                </button>

                <button
                  type="button"
                  disabled={exportingPdf}
                  onClick={async () => {
                    try {
                      setExportingPdf(true)
                      await exportAnalyticsToPDF({
                        data: analytics,
                        activeTab: posAnalyticsTab,
                        datePreset: analyticsDatePreset,
                        dateFrom: analyticsDateFrom,
                        dateTo: analyticsDateTo,
                      })
                    } catch (err) {
                      console.error('PDF export error:', err)
                    } finally {
                      setExportingPdf(false)
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] font-black text-xs hover:bg-[#1A1A1A] shadow-md transition-all cursor-pointer hover:scale-[1.02] disabled:opacity-60"
                  title="Export formatted executive PDF with chart diagrams"
                >
                  {exportingPdf ? (
                    <RefreshCw size={14} className="animate-spin text-[var(--accent)]" />
                  ) : (
                    <FileText size={14} className="text-[var(--accent)]" />
                  )}
                  <span>{exportingPdf ? 'Generating PDF...' : 'Export PDF (Charts)'}</span>
                </button>
              </div>
            </div>

            {/* Period filter (hidden for Today's Sales), IGMOLS pill bar + date range */}
            {posAnalyticsTab !== 'today' && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center bg-white border border-black/10 rounded-xl p-1 gap-1 max-w-full">
                  <span className="text-[9px] font-bold text-[#000000] uppercase tracking-wider px-2">Period:</span>
                  {(['all', 'today', 'week', 'month', 'year'] as const).map(preset => (
                    <button key={preset} type="button" onClick={() => applyAnalyticsPreset(preset)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider whitespace-nowrap transition-all cursor-pointer ${analyticsDatePreset === preset ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000] hover:bg-black/5'}`}>
                      {preset === 'all' ? 'All Time' : preset === 'today' ? 'Today' : preset === 'week' ? 'This Week' : preset === 'month' ? 'This Month' : 'This Year'}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center border rounded-xl px-3 py-1.5 gap-2 shadow-sm bg-white border-black/10 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">From:</span>
                    <input type="date" value={analyticsDateFrom} onChange={e => { setAnalyticsDateFrom(e.target.value); setAnalyticsDatePreset('custom'); }} className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[118px]" />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">To:</span>
                    <input type="date" value={analyticsDateTo} onChange={e => { setAnalyticsDateTo(e.target.value); setAnalyticsDatePreset('custom'); }} className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[118px]" />
                  </div>
                </div>
              </div>
            )}

            {/* Sub-tabs */}
            <div className="flex flex-wrap gap-x-7 gap-y-2 border-b border-black/10">
              {([
                { id: 'revenue' as const,    label: 'Revenue' },
                { id: 'today' as const,      label: "Today's Sales" },
                { id: 'products' as const,   label: 'Products' },
                { id: 'coupons' as const,    label: 'Coupons' },
                { id: 'jewellery' as const,  label: 'Jewellery' },
              ]).map(({ id, label }) => (
                <button key={id} onClick={() => setPosAnalyticsTab(id as PosAnalyticsTab)}
                  className={`pb-3 text-sm font-bold uppercase whitespace-nowrap transition-colors relative cursor-pointer ${posAnalyticsTab === id ? 'text-[var(--accent)]' : 'text-[#000000] hover:text-[var(--accent)]'}`}>
                  {label}
                  {posAnalyticsTab === id && <div className="absolute -bottom-px left-0 right-0 h-[3px] bg-[var(--accent)] rounded-t-md" />}
                </button>
              ))}
            </div>

            {/* Revenue sub-tab */}
            {posAnalyticsTab === 'revenue' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                  {[
                    {
                      label: 'Total Revenue',
                      helper: 'POS + manual sales combined',
                      value: formatCurrency(analytics.totalCompletedRevenue),
                      icon: <RMIcon size={16} />,
                      color: 'text-emerald-500',
                      bg: 'bg-emerald-50',
                    },
                    {
                      label: analytics.isProfitable ? 'Net Profit' : 'Net Loss',
                      helper: `Revenue (${formatCurrency(analytics.totalCompletedRevenue)}) − Expenses (${formatCurrency(analytics.totalExpenses)})`,
                      value: formatCurrency(Math.abs(analytics.netProfit)),
                      icon: analytics.isProfitable ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
                      color: analytics.isProfitable ? 'text-emerald-600' : 'text-rose-600',
                      bg: analytics.isProfitable ? 'bg-emerald-50' : 'bg-rose-50',
                      valueColor: analytics.isProfitable ? 'text-emerald-600' : 'text-rose-600',
                      arrow: analytics.isProfitable ? '↑' : '↓',
                    },
                    {
                      label: 'Total Expenses',
                      helper: 'Overheads from expense tracker',
                      value: formatCurrency(analytics.totalExpenses),
                      icon: <Receipt size={16} />,
                      color: 'text-amber-500',
                      bg: 'bg-amber-50',
                    },
                    {
                      label: 'Completed Bills',
                      helper: 'POS + manual bills',
                      value: String(analytics.completedOrders),
                      icon: <Trophy size={16} />,
                      color: 'text-emerald-500',
                      bg: 'bg-emerald-50',
                    },
                    {
                      label: 'Offline Revenue',
                      helper: 'Walk-in POS sales',
                      value: formatCurrency(analytics.posRevenue),
                      icon: <RMIcon size={16} />,
                      color: 'text-cyan-500',
                      bg: 'bg-cyan-50',
                    },
                    {
                      label: 'Total Offline Bills',
                      helper: 'Walk-in POS orders',
                      value: String(analytics.offlineOrderCount),
                      icon: <LayoutDashboard size={16} />,
                      color: 'text-red-500',
                      bg: 'bg-red-50',
                    },
                    {
                      label: 'Total Online Bills',
                      helper: 'Live completed online bills',
                      value: String(analytics.onlineBillCount),
                      icon: <Box size={16} />,
                      color: 'text-blue-500',
                      bg: 'bg-blue-50',
                    },
                    {
                      label: 'Total Items Sold',
                      helper: 'From completed bills',
                      value: String(Math.round(analytics.totalProductsSold)),
                      icon: <Box size={16} />,
                      color: 'text-purple-500',
                      bg: 'bg-purple-50',
                    },
                    {
                      label: 'Average Revenue Per Bill',
                      helper: 'Average per bill',
                      value: formatCurrency(analytics.averageRevenuePerBill),
                      icon: <RMIcon size={16} />,
                      color: 'text-emerald-500',
                      bg: 'bg-emerald-50',
                    },
                    {
                      label: 'Top Product',
                      helper: 'Most sold item',
                      value: analytics.bestProduct || 'No sales yet',
                      icon: <Trophy size={16} />,
                      color: 'text-pink-500',
                      bg: 'bg-pink-50',
                    },
                  ].map((card, index) => (
                    <div key={index} className="bg-white rounded-xl border border-black/10 p-5 sm:p-5 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <p className="text-[11px] font-bold text-[#000000]">{card.label}</p>
                          <div className={`w-9 h-9 rounded-xl border border-current/20 ${card.bg} flex items-center justify-center ${card.color} shrink-0 shadow-sm`}>{card.icon}</div>
                        </div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <p className={`text-[22px] sm:text-[24px] font-bold leading-tight ${card.valueColor || 'text-[#000000]'}`}>
                            {card.value}
                          </p>
                          {card.arrow && (
                            <span className={`inline-flex items-center text-xs font-black px-1.5 py-0.5 rounded-md ${card.bg} ${card.color}`}>
                              {card.arrow}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-[#000000] leading-snug" title={card.helper}>{card.helper}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-white border border-black/10 rounded-xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col min-h-[250px]">
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <h3 className="font-bold text-[#000000] text-sm mb-2 flex items-center">
                          Revenue Trend This Year{' '}
                          <span className="text-[var(--accent)] font-black ml-1.5">{analytics.chartYear}</span>
                        </h3>
                        {(() => {
                          const yearTotal = analytics.monthlyTrend.reduce((sum, m) => sum + m.revenue, 0)
                          return (
                            <div className="flex items-center gap-3">
                              <span className="text-xl font-black text-[#000000]">₹{Math.round(yearTotal).toLocaleString('en-IN')}</span>
                              {yearTotal > 0 && (
                                <span className="bg-[#FFFFFF] border border-black/10 text-[var(--accent)] px-2 py-0.5 rounded text-[10px] font-bold">
                                  Avg ₹{Math.round(yearTotal / 12).toLocaleString('en-IN')}/mo
                                </span>
                              )}
                            </div>
                          )
                        })()}
                      </div>
                    </div>
                    {(() => {
                      const short = (v: number) => v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`
                      const max = Math.max(1, ...analytics.monthlyTrend.map(m => m.revenue))
                      return (
                        <div className="flex-1 overflow-x-auto scrollbar-thin pb-2">
                          <div className="flex items-end justify-between px-2 gap-1 relative mt-4 min-w-[500px] h-[170px] pt-10">
                            {analytics.monthlyTrend.map(m => (
                              <div key={m.key} className="flex flex-col items-center gap-1.5 w-full group/bar relative outline-none" tabIndex={0}>
                                <span className="text-[8px] font-black text-[var(--accent)] h-3 flex items-end">{m.revenue > 0 ? short(m.revenue) : ''}</span>
                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[#000000] text-white text-[10px] font-bold px-2 py-1.5 rounded-lg opacity-0 group-hover/bar:opacity-100 group-focus/bar:opacity-100 transition-all duration-200 whitespace-nowrap pointer-events-none z-10 shadow-lg">
                                  <div className="text-[9px] text-white/70 font-semibold mb-0.5">{m.month.slice(0, 3)}</div>
                                  {formatCurrency(m.revenue)}
                                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#000000]"></div>
                                </div>
                                <div className="w-full max-w-[24px] bg-[var(--accent)] rounded-t-sm transition-all duration-1000 group-hover/bar:bg-[#6E9DB8] cursor-pointer min-h-[4px]"
                                  style={{ height: `${Math.max(4, (m.revenue / max) * 100)}px` }} />
                                <span className="text-[10px] font-bold text-[#000000] uppercase">{m.month.slice(0, 3)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                  <div className="space-y-6">
                    <div className="bg-white rounded-xl border border-black/10 p-6 shadow-sm">
                      <h3 className="text-[16px] font-bold text-[#000000] mb-6">Order Source</h3>
                      <div className="space-y-4">
                        <div>
                          <div className="flex justify-between text-xs font-bold mb-2">
                            <span className="text-[#000000] uppercase">Offline</span>
                            <span className="text-[#000000]">{analytics.completedOrders}</span>
                          </div>
                          <div className="w-full bg-black/[0.03] rounded-full h-2.5">
                            <div className="bg-[#0A0A0A] h-2.5 rounded-full" style={{ width: '100%' }}></div>
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-xs font-bold mb-2">
                            <span className="text-[#000000] uppercase">Online</span>
                            <span className="text-[#000000]">0</span>
                          </div>
                          <div className="w-full bg-black/[0.03] rounded-full h-2.5">
                            <div className="bg-[#E5E7EB] h-2.5 rounded-full" style={{ width: '0%' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-black/10 p-6 shadow-sm">
                      <h3 className="text-[16px] font-bold text-[#000000] mb-4">Top Items by Revenue</h3>
                      <div className="space-y-3">
                        {analytics.topProducts.slice(0, 3).map((p, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 text-xs">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <span className="font-bold text-[#000000] w-4 shrink-0">{i + 1}</span>
                              <span className="font-bold text-[#000000] truncate" title={p.name}>{p.name}</span>
                            </div>
                            <div className="flex items-center gap-4 shrink-0">
                              <span className="font-bold text-[#000000]">{formatCurrency(p.revenue)}</span>
                              <span className="text-[#000000] text-[11px] w-8 text-right">{Math.round(p.qty)} pcs</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-white border border-black/10 rounded-xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col min-h-[250px]">
                    <div className="flex justify-between items-center mb-6">
                      <div>
                        <h3 className="font-bold text-[#000000] text-sm flex items-center">
                          Revenue This Week{' '}
                          <span className="text-[var(--accent)] font-black ml-1.5">
                            (Week {(() => { const now = new Date(); const start = new Date(now.getFullYear(), 0, 1); const diff = Math.floor((now.getTime() - start.getTime()) / 86400000); return Math.ceil((diff + start.getDay() + 1) / 7) })()} of {new Date().getFullYear()})
                          </span>
                        </h3>
                        <p className="text-[10px] text-[#000000] font-semibold mt-1">₹{Math.round(analytics.weeklySales.reduce((sum, d) => sum + d.revenue, 0)).toLocaleString('en-IN')} total</p>
                      </div>
                    </div>
                    {(() => {
                      const short = (v: number) => v >= 1000 ? `₹${(v / 1000).toFixed(1)}k` : `₹${Math.round(v)}`
                      const max = Math.max(1, ...analytics.weeklySales.map(d => d.revenue))
                      return (
                        <div className="flex-1 flex items-end justify-between px-2 gap-2">
                          {analytics.weeklySales.map(d => (
                            <div key={d.day} className="flex flex-col items-center gap-3 w-full group/bar relative outline-none" tabIndex={0}>
                              <span className="text-[9px] font-black text-[var(--accent)]">{d.revenue > 0 ? short(d.revenue) : ''}</span>
                              <div className="absolute bottom-[52px] mb-2 left-1/2 -translate-x-1/2 bg-[#000000] text-white text-[10px] font-bold px-2 py-1.5 rounded-lg opacity-0 group-hover/bar:opacity-100 group-focus/bar:opacity-100 transition-all duration-200 whitespace-nowrap pointer-events-none z-10 shadow-lg">
                                <div className="text-[9px] text-white/70 font-semibold mb-0.5">{d.day}{d.date ? ` · ${d.date}` : ''}</div>
                                {formatCurrency(d.revenue)}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#000000]"></div>
                              </div>
                              <div className="w-full max-w-[20px] h-32 bg-[#F3F4F6] rounded-full relative overflow-hidden cursor-pointer">
                                <div className="absolute bottom-0 w-full bg-[var(--accent)] rounded-full transition-all duration-1000 group-hover/bar:bg-[#6E9DB8]"
                                  style={{ height: `${(d.revenue / max) * 100}%` }} />
                              </div>
                              <span className="text-[10px] font-bold text-[#000000] uppercase">{d.day}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>

                  <div className="bg-white rounded-xl border border-black/10 p-6 shadow-sm">
                    <h3 className="text-[16px] font-bold text-[#000000] mb-4">Top Products This Week</h3>
                    {analytics.topProducts.length === 0 ? (
                      <p className="text-xs text-[#000000]">No completed product sales yet.</p>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-[#F0EEE9]">
                        <table className="w-full text-left text-xs">
                          <thead className="text-[10px] font-bold uppercase tracking-widest text-[#000000] bg-[#F9FAFB]">
                            <tr>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Product</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">Bills</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">Qty</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/5">
                            {analytics.topProducts.slice(0, 5).map((p, i) => (
                              <tr key={`${p.name}-${i}`}>
                                <td className="max-w-[160px] whitespace-normal break-words px-4 py-2.5 text-xs font-bold text-[#000000]">{p.name}</td>
                                <td className="px-4 py-2.5 text-right text-xs text-[#000000]">{p.billCount}</td>
                                <td className="px-4 py-2.5 text-right text-xs font-black text-[#000000]">{Math.round(p.qty)}</td>
                                <td className="px-4 py-2.5 text-right text-xs font-bold text-[#10B981]">{formatCurrency(p.revenue)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Today's Sales sub-tab */}
            {posAnalyticsTab === 'today' && (
              <div className="space-y-6">
                {/* Key metrics box grid row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "TODAY'S REVENUE", value: formatCurrency(analytics.todaySales), icon: <RMIcon size={20} className="text-emerald-700" />, bg: 'bg-emerald-50', border: 'border-emerald-100' },
                    { label: "COMPLETED ORDERS", value: String(analytics.todayCompletedOrdersCount), icon: <ShoppingCart size={20} className="text-blue-700" />, bg: 'bg-blue-50', border: 'border-blue-100' },
                    { label: "ITEMS SOLD", value: String(Math.round(analytics.todayItemsSold)), icon: <Package size={20} className="text-purple-700" />, bg: 'bg-purple-50', border: 'border-purple-100' },
                    { label: "AVG ORDER VALUE", value: formatCurrency(analytics.todayAvgOrderValue), icon: <Trophy size={20} className="text-amber-700" />, bg: 'bg-amber-50', border: 'border-amber-100' },
                  ].map((card, i) => (
                    <div key={i} className="bg-white rounded-xl border border-gray-200/80 p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500 mb-1">{card.label}</p>
                        <p className="text-sm sm:text-[24px] font-black text-[#000000] leading-tight break-words">{card.value}</p>
                      </div>
                      <div className={`w-11 h-11 rounded-2xl ${card.bg} border ${card.border} flex items-center justify-center shrink-0 shadow-xs`}>
                        {card.icon}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Top products today */}
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <h3 className="text-sm font-bold text-[#000000] mb-4">Top Products Today</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {analytics.todayTopProducts.map((p, i) => (
                      <div key={i} className="flex items-center justify-between bg-white p-3 rounded-xl border border-black/10">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-[#000000] break-words">{p.name}</p>
                          <p className="text-[11px] text-[#000000]">{Math.round(p.qty)} sold</p>
                        </div>
                        <p className="text-xs font-black text-[#10B981] ml-2">{formatCurrency(p.revenue)}</p>
                      </div>
                    ))}
                    {analytics.todayTopProducts.length === 0 && (
                      <p className="col-span-full text-center text-xs text-[#000000] py-6">No products sold yet today.</p>
                    )}
                  </div>
                </div>

                {/* Today's latest bills */}
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#000000]">Today's Bills</h3>
                    <span className="text-[11px] font-bold text-[#10B981]">{analytics.todayCompletedOrdersCount} orders</span>
                  </div>
                  <div className="mb-3">
                    <input
                      type="text"
                      placeholder="Search by invoice number..."
                      value={todayBillsSearch}
                      onChange={e => setTodayBillsSearch(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-black/10 rounded-xl text-[13px] font-bold text-[#000000] placeholder:text-[#000000] focus:outline-none focus:border-[var(--accent)] transition-colors"
                    />
                  </div>
                  {(() => {
                    const filteredBills = analytics.todayBills.filter(b => !todayBillsSearch || b.invoice_no?.toLowerCase().includes(todayBillsSearch.toLowerCase()))
                    return filteredBills.length > 0 ? (
                    <>
                    <div className="md:hidden rounded-xl border border-black/10 divide-y divide-black/5 overflow-hidden bg-white">
                      {filteredBills.map(o => {
                        const btLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                        return (
                          <div key={o.id} className="px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-[#000000] text-xs break-words">{o.customer_name}</p>
                                <p className="text-[11px] text-[#000000] mt-0.5 break-words">
                                  {formatInvoiceNo(o.invoice_no)}{' · '}{btLabel}{' · '}{new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                              <p className="shrink-0 font-black text-[#000000] text-xs">{formatCurrency(getOrderTotal(o))}</p>
                            </div>
                            <button onClick={() => void openOrderInvoice(o, 'view')} className="mt-2 inline-flex items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-[11px] font-black text-[#000000] hover:bg-black/[0.03]" title="View Invoice">
                              <Eye size={13} /> View Invoice
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <div className="hidden md:block overflow-x-auto rounded-xl border border-black/10">
                      <table className="w-full text-xs">
                        <thead className="text-[10px] uppercase tracking-wider text-[#000000] bg-[#F9FAFB]">
                          <tr>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Invoice</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Customer</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Total</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Time</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Type</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {filteredBills.map(o => {
                            const btLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                            const btClass = normalizeOrderType(o.order_type) === 'manual_sale' ? 'bg-purple-100 text-purple-700' : normalizeOrderMode(o.order_mode) === 'online' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                            return (
                              <tr key={o.id} className="hover:bg-black/[0.03]">
                                <td className="px-4 py-2.5 font-bold text-[#10B981] text-[11px]">{formatInvoiceNo(o.invoice_no)}</td>
                                <td className="px-4 py-2.5 font-semibold text-[#000000] max-w-[100px] break-words">{o.customer_name}</td>
                                <td className="px-4 py-2.5 font-black text-[#000000]">{formatCurrency(getOrderTotal(o))}</td>
                                <td className="px-4 py-2.5 text-[#000000]">{new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                                <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${btClass}`}>{btLabel}</span></td>
                                <td className="px-4 py-2.5">
                                  <button onClick={() => void openOrderInvoice(o, 'view')} className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-2 py-1.5 text-[11px] font-black text-[#000000] hover:bg-black/[0.03]" title="View Invoice">
                                    <Eye size={13} /> View Invoice
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    </>
                  ) : (
                    <p className="text-xs text-[#000000] text-center py-4">{todayBillsSearch ? 'No bills match your search.' : 'No bills yet today.'}</p>
                  )})()}
                </div>
              </div>
            )}

            {/* Products sub-tab */}
            {posAnalyticsTab === 'products' && (
              <div className="space-y-6">
                {/* Key metrics row: Revenue is 1st KPI card */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Product Revenue', value: formatCurrency(analytics.totalCompletedRevenue), icon: <RMIcon size={18} />, from: 'from-emerald-500 to-teal-600' },
                    { label: 'Total Products Sold', value: String(Math.round(analytics.totalProductsSold)), icon: <Package size={18} />, from: 'from-blue-500 to-indigo-600' },
                    { label: 'Average Product Revenue', value: `${formatCurrency(analytics.averageProductRevenue)}`, icon: <RMIcon size={18} />, from: 'from-violet-500 to-purple-600' },
                    { label: 'Top Product', value: analytics.bestProduct, icon: <Trophy size={18} />, from: 'from-amber-500 to-orange-600' },
                  ].map((card, i) => (
                    <div key={i} className={`relative overflow-hidden rounded-2xl p-5 shadow-lg border border-white/20 bg-gradient-to-br ${card.from}`}>
                      <div className="absolute inset-0 bg-gradient-to-tl from-white/30 via-white/10 to-transparent" />
                      <div className="relative z-10">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] uppercase font-bold text-white/80 tracking-wider">{card.label}</p>
                          <div className="w-9 h-9 rounded-xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white shadow-sm">{card.icon}</div>
                        </div>
                        <p className="text-sm sm:text-[22px] font-extrabold text-white drop-shadow-sm break-words">{card.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Full product table with Search by Name, SKU, Category */}
                <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-[#000000]">All Products Analytics</h3>
                      <p className="text-xs text-[#000000]">Search by Product Name, SKU, or Category for instant statistics</p>
                    </div>
                    <span className="text-[11px] font-bold text-[#10B981] bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 self-start sm:self-auto">{analytics.topProducts.length} products</span>
                  </div>
                  <div className="mb-4">
                    <input
                      type="text"
                      placeholder="Search by Product Name, SKU, or Category..."
                      value={productAnalyticsSearch}
                      onChange={e => setProductAnalyticsSearch(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-black/10 rounded-xl text-[13px] font-bold text-[#000000] placeholder:text-[#000000] focus:outline-none focus:border-[var(--accent)] transition-colors"
                    />
                  </div>
                  {(() => {
                    const filteredProds = analytics.topProducts.filter(p => {
                      if (!productAnalyticsSearch.trim()) return true
                      const q = productAnalyticsSearch.toLowerCase()
                      return p.name.toLowerCase().includes(q) || (p.variant && p.variant.toLowerCase().includes(q))
                    })
                    return filteredProds.length > 0 ? (
                      <>
                      <div className="md:hidden rounded-xl border border-black/10 divide-y divide-black/5 overflow-hidden bg-white">
                        {filteredProds.slice(0, 50).map((p, i) => (
                          <div key={`${p.name}-${p.variant || i}`} className="px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-[#000000] break-words">#{i + 1} {p.name}</p>
                                <p className="text-[11px] text-[#000000] mt-0.5 break-words">
                                  {p.variant || 'No variant'}{' · '}Qty {Math.round(p.qty)}{' · '}{p.billCount} bills{' · '}Avg {formatCurrency(p.billCount > 0 ? p.revenue / p.billCount : 0)}
                                </p>
                              </div>
                              <p className="shrink-0 text-xs font-black text-emerald-700">{formatCurrency(p.revenue)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="hidden md:block overflow-x-auto rounded-xl border border-black/10">
                        <table className="w-full text-left text-xs">
                          <thead className="text-[10px] uppercase tracking-wider text-[#000000] bg-[#F9FAFB]">
                            <tr>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">#</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Product</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Variant / SKU</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Qty Sold</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Revenue</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Bills</th>
                              <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Avg Revenue/Bill</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/5">
                            {filteredProds.slice(0, 50).map((p, i) => (
                              <tr key={`${p.name}-${p.variant || i}`} className="hover:bg-black/[0.03]">
                                <td className="px-4 py-2 text-[11px] text-[#9BAB9A] font-bold">{i + 1}</td>
                                <td className="px-4 py-2 font-bold text-[#000000]">{p.name}</td>
                                <td className="px-4 py-2 text-[#000000]">{p.variant || '-'}</td>
                                <td className="px-4 py-2 font-bold">{Math.round(p.qty)}</td>
                                <td className="px-4 py-2 font-bold text-emerald-700">{formatCurrency(p.revenue)}</td>
                                <td className="px-4 py-2 text-[#000000]">{p.billCount}</td>
                                <td className="px-4 py-2 font-bold text-[#000000]">{formatCurrency(p.billCount > 0 ? p.revenue / p.billCount : 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      </>
                    ) : (
                      <p className="text-center text-xs text-[#000000] py-6">{productAnalyticsSearch ? 'No products match your search query.' : 'No product sales in selected period'}</p>
                    )
                  })()}
                </div>
              </div>
            )}

            {/* Categories sub-tab */}
            {posAnalyticsTab === 'categories' && (
              <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                <h3 className="text-base font-black text-[#000000] mb-4">{l('Category Analytics', 'வகை பகுப்பாய்வு')}</h3>
                {analytics.topCategories.length > 0 ? (
                  <>
                  <div className="md:hidden rounded-xl border border-black/10 divide-y divide-black/5 overflow-hidden bg-white">
                    {analytics.topCategories.map((c, i) => (
                      <div key={c.name} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#000000] break-words">#{i + 1} {c.name}</p>
                            <p className="text-[11px] text-[#000000] mt-0.5">Qty Sold {Math.round(c.qty)}</p>
                          </div>
                          <p className="shrink-0 text-xs font-black text-emerald-700">{formatCurrency(c.revenue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto rounded-xl border border-black/10">
                    <table className="w-full text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-[#000000] bg-[#F9FAFB]">
                        <tr>
                          <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">#</th>
                          <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Category', 'வகை')}</th>
                          <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Revenue', 'வருவாய்')}</th>
                          <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Qty Sold', 'விற்ற அளவு')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5">
                        {analytics.topCategories.map((c, i) => (
                          <tr key={c.name} className="hover:bg-black/[0.03]">
                            <td className="px-4 py-2 text-[11px] text-[#9BAB9A] font-bold">{i + 1}</td>
                            <td className="px-4 py-2 font-bold text-[#000000]">{c.name}</td>
                            <td className="px-4 py-2 font-bold text-emerald-700">{formatCurrency(c.revenue)}</td>
                            <td className="px-4 py-2 text-[#000000]">{Math.round(c.qty)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                ) : (
                  <p className="text-center text-xs text-[#000000] py-6">{l('No data in selected period', 'தேர்ந்த காலத்தில் தரவு இல்லை')}</p>
                )}
              </div>
            )}

            {/* Coupons sub-tab */}
            {posAnalyticsTab === 'jewellery' && (
              <JewelleryReports orders={orders} dateFrom={analyticsDateFrom} dateTo={analyticsDateTo} />
            )}

            {posAnalyticsTab === 'coupons' && (
              <div className="space-y-6">
                {/* Key metrics row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Coupons Used', value: String(analytics.totalCouponOrders), icon: <ShoppingCart size={18} />, from: 'from-emerald-500 to-teal-600' },
                    { label: 'Total Discounts Given', value: formatCurrency(analytics.totalCouponDiscounts), icon: <RMIcon size={18} />, from: 'from-blue-500 to-indigo-600' },
                    { label: 'Usage Rate', value: `${analytics.couponUsageRate.toFixed(1)}%`, icon: <TrendingUp size={18} />, from: 'from-violet-500 to-purple-600' },
                    { label: 'Unique Coupons', value: String(analytics.topCoupons.length), icon: <Trophy size={18} />, from: 'from-amber-500 to-orange-600' },
                  ].map((card, i) => (
                    <div key={i} className={`relative overflow-hidden rounded-2xl p-5 shadow-lg border border-white/20 bg-gradient-to-br ${card.from}`}>
                      <div className="absolute inset-0 bg-gradient-to-tl from-white/30 via-white/10 to-transparent" />
                      <div className="relative z-10">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] uppercase font-bold text-white/80 tracking-wider">{card.label}</p>
                          <div className="w-9 h-9 rounded-xl bg-white/25 backdrop-blur-sm flex items-center justify-center text-white shadow-sm">{card.icon}</div>
                        </div>
                        <p className="text-sm sm:text-[22px] font-extrabold text-white drop-shadow-sm break-words">{card.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Coupon daily trend + Top coupons */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  <div className="xl:col-span-2 bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-[#000000] mb-4">Coupon Usage (Last 7 Days)</h3>
                    {analytics.couponDailyTrend.some(d => d.orders > 0) ? (
                      <div className="h-[256px] w-full min-w-0 relative">
                        <ResponsiveContainer width="100%" height={256} minWidth={0} minHeight={0}>
                          <BarChart data={analytics.couponDailyTrend}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F3F4F6" />
                            <XAxis dataKey="day" tick={{ fill: '#6B7280', fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                            <YAxis hide />
                            <Tooltip cursor={{ fill: '#F9FAFB' }} formatter={(value, name) => [value, name === 'orders' ? 'Orders' : 'Discounts']} />
                            <Bar dataKey="orders" fill="url(#couponGrad)" radius={[4, 4, 0, 0]} barSize={24} />
                            <defs>
                              <linearGradient id="couponGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10B981" />
                                <stop offset="100%" stopColor="#111111" />
                              </linearGradient>
                            </defs>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-center text-xs text-[#000000] py-12">No coupon usage in the last 7 days.</p>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-[#000000] mb-4">Top Coupons</h3>
                    <div className="space-y-3">
                      {analytics.topCoupons.slice(0, 8).map((coupon, i) => (
                        <div key={coupon.code} className="flex items-center justify-between gap-2 p-3 bg-white rounded-xl">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-[#9BAB9A]">{i + 1}</span>
                              <p className="text-xs font-bold text-[#000000] break-words">{coupon.code}</p>
                            </div>
                            <p className="text-[11px] text-[#000000] ml-5">{coupon.usage} order{coupon.usage > 1 ? 's' : ''}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-black text-emerald-700">{formatCurrency(coupon.discounts)}</p>
                            <p className="text-[10px] text-[#000000]">discounted</p>
                          </div>
                        </div>
                      ))}
                      {analytics.topCoupons.length === 0 && (
                        <p className="text-center text-xs text-[#000000] py-6">No coupon usage yet</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Coupon detail table */}
                {analytics.topCoupons.length > 0 && (
                  <div className="bg-white rounded-xl border border-black/10 p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-[#000000]">All Coupons Performance</h3>
                      <span className="text-[11px] font-bold text-[#10B981]">{analytics.topCoupons.length} coupons</span>
                    </div>
                    <div className="md:hidden rounded-xl border border-black/10 divide-y divide-black/5 overflow-hidden bg-white">
                      {analytics.topCoupons.map((coupon, i) => (
                        <div key={coupon.code} className="px-3 py-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#000000] break-words">#{i + 1} {coupon.code}</p>
                              <p className="text-[11px] text-[#000000] mt-0.5">
                                {coupon.usage} orders{' · '}Avg discount {coupon.usage > 0 ? formatCurrency(coupon.discounts / coupon.usage) : '-'}
                              </p>
                            </div>
                            <p className="shrink-0 text-xs font-black text-emerald-700">{formatCurrency(coupon.discounts)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden md:block overflow-x-auto rounded-xl border border-black/10">
                      <table className="w-full text-left text-xs">
                        <thead className="text-[10px] uppercase tracking-wider text-[#000000] bg-[#F9FAFB]">
                          <tr>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">#</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Code</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Orders</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Total Discount</th>
                            <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Avg Discount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {analytics.topCoupons.map((coupon, i) => (
                            <tr key={coupon.code} className="hover:bg-black/[0.03]">
                              <td className="px-4 py-2 text-[11px] text-[#9BAB9A] font-bold">{i + 1}</td>
                              <td className="px-4 py-2 font-bold text-[#000000]">{coupon.code}</td>
                              <td className="px-4 py-2 font-bold">{coupon.usage}</td>
                              <td className="px-4 py-2 font-bold text-emerald-700">{formatCurrency(coupon.discounts)}</td>
                              <td className="px-4 py-2 text-[#000000]">{coupon.usage > 0 ? formatCurrency(coupon.discounts / coupon.usage) : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── BILLING PANEL ── */}
        {tab === 'billing' && (
          <div>
            <Pos
              isEmbedded
              externalScannedCode={cartItemToInject}
              onCodeProcessed={() => setCartItemToInject(null)}
            />
          </div>
        )}

        {/* ── INVENTORY & BARCODES TAB ── */}
        {tab === 'inventory' && (
          <div>
            <InventoryTable />
          </div>
        )}

        {tab === 'advance_orders' && (
          <AdvanceOrders
            onOrderCompleted={(adv) => {
              if (adv) handleAdvanceOrderCompleted(adv)
              void loadData()
            }}
          />
        )}

        {tab === 'customer_events' && <BirthdayDashboard />}
        {tab === 'metal_rates' && <MetalRates />}
        {tab === 'purchases' && role === 'admin' && <Purchases />}
        {tab === 'schemes' && <Schemes />}
        {tab === 'sales_desk' && <SalesDesk onBillQuotation={(q) => { useNavigationStore.getState().setPendingQuotation(q); setTab('billing'); setCurrentTab('billing') }} />}

        {/* ── ORDER MANAGEMENT ── */}
        {tab === 'history' && (
          <div className="flex flex-col w-full pb-4">
            {/* Header panel */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
              <div className="shrink-0">
                <h2 className="text-[28px] font-black text-[#000000] tracking-tight">{l('Order History', 'ஆர்டர் வரலாறு')}</h2>
                <p className="text-xs text-[#000000] font-semibold mt-1">{l('Manage and track past invoices', 'பழைய பில்களை நிர்வகிக்கவும்')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                <div className="flex flex-wrap items-center bg-white border border-black/10 rounded-xl p-1 gap-1 max-w-full">
                  <span className="text-[9px] font-bold text-[#000000] uppercase tracking-wider px-2">Period:</span>
                  {([['', 'All Time'], ['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['year', 'This Year']] as const).map(([p, label]) => (
                    <button key={label} type="button" onClick={() => applyDatePreset(p || 'all')}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${datePreset === p ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000] hover:bg-black/5'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center border rounded-xl px-3 py-1.5 gap-2 shadow-sm bg-white border-black/10 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">From:</span>
                    <input type="date" value={search.dateFrom}
                      onChange={e => { setDatePreset('custom'); setSearch(s => ({ ...s, dateFrom: e.target.value })) }}
                      className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[118px]" />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#000000]">To:</span>
                    <input type="date" value={search.dateTo}
                      onChange={e => { setDatePreset('custom'); setSearch(s => ({ ...s, dateTo: e.target.value })) }}
                      className="text-xs font-bold bg-transparent border-none outline-none focus:ring-0 cursor-pointer text-[#000000] w-[118px]" />
                  </div>
                </div>
                <button type="button" onClick={() => exportCSV(filteredSearchResults)} disabled={filteredSearchResults.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 border-2 border-[var(--accent)] bg-transparent text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all duration-200 cursor-pointer shadow-sm disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
              </div>
            </div>
            <div>
              {/* Filters */}
              <form onSubmit={runSearch} className="bg-white border border-black/10 rounded-xl p-5 shadow-sm mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <label className="block">
                  <span className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2">Search Order ID</span>
                  <span className="relative block">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#000000]" />
                    <input className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm pl-9" placeholder="e.g. INV-..." value={search.invoiceNo} onChange={e => setSearch(s => ({ ...s, invoiceNo: e.target.value }))} />
                  </span>
                </label>
                <label className="block">
                  <span className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2">Customer Name</span>
                  <input className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm" placeholder="Search name..." value={search.customerName} onChange={e => setSearch(s => ({ ...s, customerName: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2">Customer Phone</span>
                  <input className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm" inputMode="tel" placeholder="Search phone..." value={search.phone} onChange={e => setSearch(s => ({ ...s, phone: e.target.value }))} />
                </label>
                <label className="block">
                  <span className="block text-[10px] font-bold text-[#000000] uppercase tracking-[0.15em] mb-2">Order Source</span>
                  <select className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm cursor-pointer" value={billTypeFilter} onChange={e => setBillTypeFilter(e.target.value as typeof billTypeFilter)}>
                    <option value="all">All Sources</option>
                    <option value="offline">Offline</option>
                    <option value="online">Online</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
                <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
              </form>
              {searchLoading && <p className="mb-2 text-[11px] font-semibold text-[#000000]">{l('Searching...', 'தேடுகிறது...')}</p>}
              <div className="md:hidden rounded-xl border border-black/10 divide-y divide-black/5 overflow-hidden bg-white">
                {filteredSearchResults.slice(0, 50).map(o => {
                  const billTypeLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                  const billTypeClass = normalizeOrderType(o.order_type) === 'manual_sale' ? 'bg-purple-50 text-purple-700' : normalizeOrderMode(o.order_mode) === 'online' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
                  const refNumber = (o as unknown as Record<string,unknown>).reference_number as string
                  const remarks = (o as unknown as Record<string,unknown>).remarks as string
                  return (
                    <div key={o.id} className="p-3 sm:p-4 space-y-2.5 bg-white">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#000000] break-words flex items-center gap-1.5 flex-wrap">
                            {o.customer_name || '—'}
                            {o.credit_status === 'paid' && (
                              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700 border border-amber-200">Credit Bill</span>
                            )}
                          </p>
                          <p className="text-[11px] text-[#000000] mt-0.5 break-words">
                            {formatInvoiceNo(o.invoice_no)}
                            {' · '}{o.phone || '—'}
                            {' · '}{new Date(getOrderHistoryDate(o)).toLocaleDateString('en-IN')}
                            {o.coupon_code ? ` · ${o.coupon_code}` : ''}
                            {o.discount_amount > 0 ? ` · -${formatCurrency(o.discount_amount)}` : ''}
                            {o.delivery_charge > 0 ? ` · Delivery ${formatCurrency(o.delivery_charge)}` : ''}
                            {refNumber ? ` · Ref ${refNumber}` : ''}
                            {remarks ? ` · ${remarks}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs font-black text-[#000000]">{formatCurrency(getOrderTotal(o))}</p>
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${billTypeClass}`}>{billTypeLabel}</span>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <div className="flex gap-2 w-full sm:flex-1">
                          <button onClick={() => handleShareViaWhatsApp(o)} title="Send on WhatsApp" aria-label="Send on WhatsApp" className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`}>
                            <WhatsAppIcon className="w-4 h-4" />
                          </button>
                          <button onClick={() => void openOrderInvoice(o, 'view')} title="View invoice" aria-label="View invoice" className={`${actionBtn} bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)]`}>
                            <DocIcon className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="flex gap-2 w-full sm:flex-1">
                        {role === 'admin' ? (
                          <select value={normalizeStatus(o.status)} disabled={normalizeStatus(o.status) === 'cancelled'} onChange={e => void updateOrderStatus(o.id, e.target.value)}
                            className={`min-h-[44px] flex-1 cursor-pointer rounded-xl border px-3 py-2 text-[12px] font-black outline-none ${statusTone(o.status)}`}>
                            <option value="pending">{l('Pending', 'நிலுவை')}</option>
                            <option value="completed">{l('Completed', 'முடிந்தது')}</option>
<option value="cancelled">{l('Cancelled', 'ரத்து')}</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center justify-center flex-1 min-h-[44px] px-3 py-2 rounded-xl text-[12px] font-black uppercase ${normalizeStatus(o.status) === 'cancelled' ? 'border border-black/10 bg-gray-100 text-gray-500' : normalizeStatus(o.status) === 'completed' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'}`}>
                            {normalizeStatus(o.status) === 'completed' ? l('Completed', 'முடிந்தது') : normalizeStatus(o.status) === 'cancelled' ? l('Cancelled', 'ரத்து') : l('Pending', 'நிலுவை')}
                          </span>
                        )}
                        {role === 'admin' && (
                          <button onClick={() => void deleteOrder(o.id, o.invoice_no)} title="Delete order" aria-label="Delete order" className={`${actionBtn} self-center bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {filteredSearchResults.length === 0 && (
                  <div className="rounded-xl border border-black/10 bg-white px-4 py-8 text-center text-[#000000]">{l('No matching bills', 'பில்கள் இல்லை')}</div>
                )}
              </div>
              <div className="hidden md:block overflow-x-auto rounded-xl border border-black/10 bg-white">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-white border-b border-black/10 select-none">
                      {['Order ID', 'Customer Name', 'Mobile Number', 'Source', 'Offers', 'Total Due', 'Date & Time', 'Status', 'Actions'].map(h => (
                        <th key={h} className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 bg-white">
                    {filteredSearchResults.slice(0, 50).map(o => {
                      const billTypeLabel = normalizeOrderType(o.order_type) === 'manual_sale' ? 'MANUAL' : normalizeOrderMode(o.order_mode) === 'online' ? 'ONLINE' : 'OFFLINE'
                      const billTypeClass = normalizeOrderType(o.order_type) === 'manual_sale' ? 'bg-purple-50 text-purple-700' : normalizeOrderMode(o.order_mode) === 'online' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
                      return (
                        <React.Fragment key={o.id}>
                        <tr key={o.id} className="hover:bg-black/[0.03] text-center">
                          <td className="whitespace-nowrap px-4 py-3 text-[11px] font-bold text-[#000000]">{formatInvoiceNo(o.invoice_no)}</td>
                          <td className="max-w-[100px] break-words px-4 py-3 text-[11px] font-semibold text-[#000000]">
                            {o.customer_name}
                            {o.credit_status === 'paid' && (
                              <span className="mt-1 block w-fit rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700 border border-amber-200">Credit Bill</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-[11px] text-[#000000]">
                            <span className="font-semibold text-[#000000]">{formatPhoneWithCountryCode(o.phone).code}</span>
                            <span className="ml-1">{formatPhoneWithCountryCode(o.phone).number}</span>
                          </td>
                          <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase ${billTypeClass}`}>{billTypeLabel}</span></td>
                          <td className="px-4 py-3 text-[10px] leading-relaxed">
                            {o.coupon_code || o.discount_amount > 0 || o.delivery_charge > 0 ? (
                              <div className="flex flex-col items-center gap-0.5">
                                {o.coupon_code && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">{o.coupon_code}</span>}
                                {o.discount_amount > 0 && <span className="whitespace-nowrap font-bold text-emerald-700">−{formatCurrency(o.discount_amount)}</span>}
                                {o.delivery_charge > 0 && <span className="whitespace-nowrap font-semibold text-[#000000]">+{formatCurrency(o.delivery_charge)} delivery</span>}
                              </div>
                            ) : <span className="text-[#9BAB9A]">—</span>}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-[11px] font-bold text-[#000000]">
                            {formatCurrency(getOrderTotal(o))}
                            {o.credit_status === 'outstanding' && (
                              <span className="mt-1 block rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-red-700">Credit Due</span>
                            )}
                            {o.credit_status === 'paid' && o.credit_paid_at && (
                              <span className="mt-1 block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-700">
                                Paid {new Date(o.credit_paid_at).toLocaleDateString('en-IN')}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-[11px] text-[#000000]">{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <div className="flex items-center justify-center gap-1.5">
                              {role === 'admin' ? (
                                <select value={normalizeStatus(o.status)} disabled={normalizeStatus(o.status) === 'cancelled'} onChange={e => void updateOrderStatus(o.id, e.target.value)}
                                  className={`cursor-pointer rounded border px-3 py-1 text-[10px] font-bold uppercase tracking-wider outline-none ${statusTone(o.status)}`}>
                                  <option value="pending">{l('Pending', 'நிலுவை')}</option>
                                  <option value="completed">{l('Completed', 'முடிந்தது')}</option>
<option value="cancelled">{l('Cancelled', 'ரத்து')}</option>
                                </select>
                              ) : (
                                <span className={`inline-flex items-center justify-center rounded border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${statusTone(o.status)}`}>
                                  {normalizeStatus(o.status) === 'completed' ? l('Completed', 'முடிந்தது') : normalizeStatus(o.status) === 'cancelled' ? l('Cancelled', 'ரத்து') : l('Pending', 'நிலுவை')}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <div className="flex flex-row items-center justify-end gap-1.5">
                              <button onClick={() => handleShareViaWhatsApp(o)} title="Send on WhatsApp" aria-label="Send on WhatsApp" className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`}>
                                <WhatsAppIcon className="w-4 h-4" />
                              </button>
                              <button onClick={() => void openOrderInvoice(o, 'view')} title="View invoice" aria-label="View invoice" className={`${actionBtn} bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)]`}>
                                <DocIcon className="w-4 h-4" />
                              </button>
                              <button onClick={() => setHistoryExpandedId(historyExpandedId === o.id ? null : o.id)} title="Order details" aria-label="Order details"
                                className={`${actionBtn} ${historyExpandedId === o.id ? 'bg-[#000000] text-white' : 'bg-black/5 hover:bg-black/10 text-[#000000]'}`}>
                                <EyeIcon className="w-4 h-4" />
                              </button>
                              {role === 'admin' && (
                                <button onClick={() => void deleteOrder(o.id, o.invoice_no)} title="Delete order" aria-label="Delete order" className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`}>
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {historyExpandedId === o.id && (
                          <tr className="bg-white border-b border-black/10">
                            <td colSpan={9} className="px-4 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-[#9BAB9A] tracking-wider mb-1">Reference No</p>
                                  <p className="font-semibold text-[#000000]">{(o as unknown as Record<string,unknown>).reference_number as string || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-[#9BAB9A] tracking-wider mb-1">Remarks</p>
                                  <p className="font-semibold text-[#000000] break-words">{(o as unknown as Record<string,unknown>).remarks as string || '—'}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-[#9BAB9A] tracking-wider mb-1">Customer</p>
                                  <p className="font-semibold text-[#000000]">{o.customer_name}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-bold uppercase text-[#9BAB9A] tracking-wider mb-1">Address</p>
                                  <p className="font-semibold text-[#000000] break-words">{o.address || '—'}</p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
                      )
                    })}
                    {filteredSearchResults.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-[#000000]">{l('No matching bills', 'பில்கள் இல்லை')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── COUPONS TAB ── */}
        {tab === 'coupons' && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-[22px] font-black text-[#000000] tracking-tight">{l('Coupon Management', 'கூப்பன் மேலாண்மை')}</h2>
                  <p className="max-w-2xl text-xs font-medium text-[#000000]/70">
                    {l('Create and manage discount codes. Applies to product subtotal only.', 'பொருட்களின் subtotal-க்கு மட்டும் கூப்பன் தள்ளுபடி பொருந்தும்.')}
                  </p>
                </div>
                <button
                  onClick={() => void loadCoupons()}
                  className="inline-flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3.5 py-2 text-xs font-bold text-[#000000] shadow-sm transition-colors hover:bg-black/5 cursor-pointer"
                >
                  <RefreshCw size={13} />
                  Refresh
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {([
                  ['Total Coupons', coupons.length, 'Configured promotional codes', <Tag key="t" className="w-3.5 h-3.5 text-[#000000]/60" />, 'bg-black/5', 'text-[#000000]'],
                  ['Active Coupons', coupons.filter(c => c.is_active).length, 'Live & ready at POS checkout', <CheckCircle2 key="c" className="w-3.5 h-3.5 text-[#059669]" />, 'bg-[#059669]/10', 'text-[#059669]'],
                  ['Total Redemptions', coupons.reduce((acc, c) => acc + (c.usage_count || 0), 0), 'Total customer discount usages', <Percent key="p" className="w-3.5 h-3.5 text-white" />, 'bg-[#111111]', 'text-[#000000]'],
                ] as const).map(([label, value, hint, icon, iconBg, valueColor]) => (
                  <div key={label} className="bg-white border border-black/10 rounded-xl p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">{label}</p>
                      <span className={`w-7 h-7 rounded-full ${iconBg} flex items-center justify-center shrink-0`}>{icon}</span>
                    </div>
                    <p className={`mt-2 text-2xl font-black ${valueColor}`}>{value}</p>
                    <p className="mt-1 text-[11px] font-medium text-[#000000]/60">{hint}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 bg-[#F9FAFB] border border-black/5 rounded-lg px-4 py-3 text-[11px] font-medium text-[#000000]">
                <Info className="w-3.5 h-3.5 shrink-0" />
                {l('Coupon discount applies to product subtotal only — delivery charges are excluded.', 'கூப்பன் தள்ளுபடி பொருட்களின் subtotal-க்கு மட்டும் பொருந்தும்.')}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
              <form onSubmit={saveCoupon} className="bg-white border border-black/10 rounded-xl p-5 shadow-sm space-y-4">
                <div className="flex items-start justify-between gap-3 pb-4 border-b border-black/5">
                  <div>
                    <span className="inline-block rounded-full bg-[#111111] px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">{editingCouponId !== null ? 'Edit mode' : 'New coupon'}</span>
                    <h3 className="mt-2 text-base font-black text-[#000000] tracking-tight">
                      {editingCouponId !== null ? l('Edit Coupon', 'கூப்பனை திருத்து') : l('Create Coupon', 'புதிய கூப்பன்')}
                    </h3>
                  </div>
                  {editingCouponId !== null && (
                    <button
                      type="button"
                      onClick={cancelEditCoupon}
                      className="rounded-full border border-[var(--accent-a30)] bg-[var(--accent-a10)] px-2.5 py-1 text-[11px] font-black text-[var(--accent)] transition-colors hover:bg-[var(--accent-a20)]"
                    >
                      Cancel
                    </button>
                  )}
                </div>

                {couponSaveError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
                    {couponSaveError}
                  </div>
                )}
                {couponSaveSuccess && (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700">
                    {couponSaveSuccess}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{l('Coupon Code', 'கூப்பன் குறியீடு')} *</label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 uppercase tracking-[0.12em] bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm"
                      placeholder="WELCOME10"
                      value={couponForm.code}
                      disabled={editingCouponId !== null}
                      onChange={e => { setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() })); setCouponSaveError(''); setCouponSaveSuccess('') }}
                    />
                    {editingCouponId === null && (
                      <button
                        type="button"
                        onClick={generateCouponCode}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#111111] px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-white transition-colors hover:bg-black cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-white/60" /> Generate
                      </button>
                    )}
                  </div>
                  {editingCouponId !== null && (
                    <p className="text-[10px] font-medium text-[#000000]">{l('Code cannot be changed when editing', 'திருத்தும்போது குறியீட்டை மாற்ற முடியாது')}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{l('Discount %', 'தள்ளுபடி %')} *</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm"
                      placeholder="10"
                      value={couponForm.percentage}
                      onChange={e => setCouponForm(f => ({ ...f, percentage: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{l('Min Order (INR)', 'குறைந்த ஆர்டர் (INR)')}</label>
                    <input
                      type="number"
                      min="0"
                      className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm"
                      placeholder="0 = no minimum"
                      value={couponForm.min_order_value}
                      onChange={e => setCouponForm(f => ({ ...f, min_order_value: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{l('Expiry Date', 'காலாவதி தேதி')}</label>
                    <input
                      type="date"
                      className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm"
                      value={couponForm.expiry_date}
                      onChange={e => setCouponForm(f => ({ ...f, expiry_date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{l('Usage Limit', 'பயன்பாட்டு வரம்பு')}</label>
                    <input
                      type="number"
                      min="1"
                      className="w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm"
                      placeholder="Unlimited"
                      value={couponForm.usage_limit}
                      onChange={e => setCouponForm(f => ({ ...f, usage_limit: e.target.value }))}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-3 bg-[#111111] hover:bg-black text-white rounded-lg font-black text-[11px] uppercase tracking-[0.1em] transition-all active:scale-[0.98] shadow-[0_4px_14px_rgba(0,0,0,0.25)] cursor-pointer inline-flex items-center justify-center gap-2"
                >
                  <Ticket className="w-3.5 h-3.5 text-white/60" />
                  {editingCouponId !== null ? l('Update Coupon', 'கூப்பனை புதுப்பி') : l('Create Coupon', 'கூப்பனை உருவாக்கு')}
                </button>
              </form>

              <div className="bg-white border border-black/10 rounded-xl p-5 shadow-sm">
                <div className="mb-4 pb-4 border-b border-black/5 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-base font-black text-[#000000] tracking-tight">
                    {l('All Coupons', 'அனைத்து கூப்பன்கள்')}
                    <span className="inline-flex min-w-[24px] justify-center rounded-full bg-[#111111] px-2 py-0.5 text-[10px] font-black text-white">{coupons.length}</span>
                  </h3>
                  <span className="rounded-full border border-black/10 bg-[#F9FAFB] px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#000000]">
                    {l('Admin only', 'அட்மின் மட்டும்')}
                  </span>
                </div>

                <div className="space-y-2 max-h-[30rem] overflow-y-auto pr-1">
                  {coupons.map((coupon) => {
                    const isExpired = coupon.expiry_date ? new Date(coupon.expiry_date) < new Date() : false
                    const isExhausted = coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit
                    const isEditing = editingCouponId === coupon.id
                    return (
                      <div
                        key={coupon.id}
                        className={`rounded-xl border p-3 shadow-sm transition-all ${
                          isEditing
                            ? 'border-[var(--accent)] bg-[#FFF8F3] ring-1 ring-[var(--accent-a15)]'
                            : 'border-[#F0E2C8] bg-white hover:border-[var(--accent)]'
                        }`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="break-words text-sm font-black uppercase tracking-[0.14em] text-[#000000]">{coupon.code}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${coupon.is_active ? 'bg-[#FCE7EA] text-[var(--accent)]' : 'bg-[#F8EDD9] text-[#9A6700]'}`}>
                                {coupon.is_active ? l('Active', 'செயலில்') : l('Inactive', 'செயலற்ற')}
                              </span>
                              {isExpired && (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-red-700">
                                  Expired
                                </span>
                              )}
                              {!isExpired && isExhausted && (
                                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-orange-700">
                                  Limit reached
                                </span>
                              )}
                            </div>

                            <p className="text-xs font-semibold text-[var(--accent)]">
                              {coupon.percentage}% off
                              {coupon.min_order_value > 0 && ` • min RM${coupon.min_order_value}`}
                            </p>

                            <p className="text-[11px] text-[#000000]">
                              Used {coupon.usage_count}{coupon.usage_limit ? `/${coupon.usage_limit}` : ''} times
                              {coupon.expiry_date ? ` • expires ${new Date(coupon.expiry_date).toLocaleDateString('en-IN')}` : ''}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              onClick={() => void toggleCoupon(coupon)}
                              className={`rounded-full px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
                                coupon.is_active ? 'bg-[#FCE7EA] text-[var(--accent)] hover:bg-[#F8D7DD]' : 'bg-[#F8EDD9] text-[#9A6700] hover:bg-[#F2E0B9]'
                              }`}
                            >
                              {coupon.is_active ? l('Active', 'செயலில்') : l('Off', 'ஆஃப்')}
                            </button>
                            <button
                              onClick={() => startEditCoupon(coupon)}
                              className="rounded-full border border-black/10 bg-white p-2 text-[var(--accent)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-dark)]"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => void deleteCoupon(coupon)}
                              className="rounded-full border border-[#DC2626]/30 bg-white p-2 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {coupons.length === 0 && (
                    <div className="rounded-xl bg-[#F9FAFB] py-12 text-center text-xs font-bold text-[#000000]/70">
                      {l('No coupons yet. Create your first coupon!', 'இன்னும் கூப்பன் இல்லை. முதல் கூப்பனை உருவாக்குங்கள்!')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}        {tab === 'users' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black text-[#000000] tracking-tight">{l('User Management', 'பயனர் மேலாண்மை')}</h2>
              <button onClick={() => void loadUsers()}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-[#F3F4F6] rounded-xl text-[13px] font-bold text-[#000000] hover:bg-black/[0.03] transition-colors shadow-sm">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#000000]" />
              <input
                className="w-full pl-11 pr-4 py-2.5 bg-white border border-black/10 rounded-lg text-sm font-semibold text-[#000000] placeholder:text-black/40 placeholder:font-normal focus:outline-none focus:border-[var(--accent)] transition-colors shadow-sm"
                placeholder={l('Search by name or email...', 'பெயர் அல்லது மின்னஞ்சலால் தேடுக...')}
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
            </div>

            {usersError && (
              <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-bold shadow-sm">
                <AlertCircle size={15} /> {usersError}
              </div>
            )}

            <div className="bg-white border border-black/10 rounded-xl shadow-sm overflow-hidden">
              {usersLoading ? (
                <div className="p-10 text-center text-xs font-bold text-[#000000]">{l('Loading users...', 'பயனர்கள் ஏற்றுகிறது...')}</div>
              ) : (
                <>
                <div className="md:hidden divide-y divide-black/5">
                  {allUsers
                    .filter(u => {
                      if (!userSearch.trim()) return true
                      const q = userSearch.toLowerCase()
                      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                    })
                    .map(u => (
                      <div key={u.id} className="px-4 py-3 space-y-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-[#000000] text-xs break-words">{u.name || '-'}</p>
                            <p className="text-[11px] text-[#000000] mt-0.5 break-words">
                              {[u.email, u.mobile, u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : null].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <span className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${
                            u.role === 'admin'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-black/[0.03] text-[#4B5563]'
                          }`}>
                            {u.role === 'admin' ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                            {u.role === 'admin' ? l('Admin', 'நிர்வாகி') : l('Customer', 'வாடிக்கையாளர்')}
                          </span>
                        </div>
                        <div>
                          {u.id === user?.id ? (
                            <span className="text-xs text-[#000000] font-bold uppercase tracking-wider">{l('You', 'நீங்கள்')}</span>
                          ) : (
                            <button
                              onClick={() => void toggleUserRole(u)}
                              disabled={roleUpdating === u.id}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-colors disabled:opacity-50 ${
                                u.role === 'admin'
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                                  : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                              }`}
                            >
                              {u.role === 'admin' ? <><ShieldOff size={12} /> Remove Admin</> : <><ShieldCheck size={12} /> {l('Make Admin', 'நிர்வாகி ஆக்கு')}</>}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  {allUsers.length === 0 && !usersLoading && (
                    <p className="p-10 text-center text-sm font-bold text-[#000000] bg-white">{l('No users found.', 'பயனர் இல்லை.')}</p>
                  )}
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-white border-b border-black/10 uppercase tracking-widest text-[10px] text-[#000000]">
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Name', 'பெயர்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Email', 'மின்னஞ்சல்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Mobile', 'மொபைல்')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{l('Joined', 'சேர்ந்த தேதி')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">{l('Role', 'பங்கு')}</th>
                        <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">{l('Action', 'நடவடிக்கை')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5">
                      {allUsers
                        .filter(u => {
                          if (!userSearch.trim()) return true
                          const q = userSearch.toLowerCase()
                          return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
                        })
                        .map(u => (
                          <tr key={u.id} className="hover:bg-black/[0.03] transition-colors">
                            <td className="px-4 py-4 font-bold text-[#000000]">{u.name || '-'}</td>
                            <td className="px-4 py-4 text-[#000000]">{u.email || '-'}</td>
                            <td className="px-4 py-4 text-[#000000]">{u.mobile || '-'}</td>
                            <td className="px-4 py-4 text-[#000000] text-xs">
                              {u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '-'}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider ${
                                u.role === 'admin'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-black/[0.03] text-[#4B5563]'
                              }`}>
                                {u.role === 'admin' ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                                {u.role === 'admin' ? l('Admin', 'நிர்வாகி') : l('Customer', 'வாடிக்கையாளர்')}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              {u.id === user?.id ? (
                                <span className="text-xs text-[#000000] font-bold uppercase tracking-wider">{l('You', 'நீங்கள்')}</span>
                              ) : (
                                <button
                                  onClick={() => void toggleUserRole(u)}
                                  disabled={roleUpdating === u.id}
                                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-colors disabled:opacity-50 ${
                                    u.role === 'admin'
                                      ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                                      : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                                  }`}
                                >
                                  {u.role === 'admin' ? <><ShieldOff size={12} /> Remove Admin</> : <><ShieldCheck size={12} /> {l('Make Admin', 'நிர்வாகி ஆக்கு')}</>}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {allUsers.length === 0 && !usersLoading && (
                    <p className="p-10 text-center text-sm font-bold text-[#000000] bg-white">{l('No users found.', 'பயனர் இல்லை.')}</p>
                  )}
                </div>
                </>
              )}
            </div>

            <p className="text-xs text-[#000000] font-bold">
              - {l('Role changes take effect upon next login.', 'பங்கு மாற்றம் அடுத்த முறை உள்நுழைந்தால் நடைமுறைக்கு வரும்.')}
            </p>
          </div>
        )}

        {/* ── EXPENSES TAB ── */}
        {tab === 'expenses' && (
          <ExpensesView />
        )}
        {/* ── OUTSTANDING CREDITS TAB ── */}
        {tab === 'outstanding_credits' && (
          <OutstandingCreditsView
            orders={outstandingCreditOrders}
            historyOrders={creditHistoryOrders}
            onSettled={handleCreditSettled}
            onDueDateChanged={handleCreditDueDateChanged}
            onView={(o) => setInvoicePreviewOrder(o)}
            onPrint={(o) => setPrintOrder(o)}
            onDownload={(o) => void openOrderInvoice(o, 'download')}
            onShare={(o) => {
              // Settled bills get a "payment received, thank you" message, not a payment reminder
              const message = o.credit_status === 'paid'
                ? buildCreditPaidWhatsAppMessage({
                    customerName: o.customer_name,
                    invoiceNumber: o.invoice_no,
                    amount: Number(o.total || 0),
                    paidAt: o.credit_paid_at || null,
                  })
                : buildCreditReminderWhatsAppMessage({
                customerName: o.customer_name,
                invoiceNumber: o.invoice_no,
                amount: Number(o.total || 0),
                dueDate: o.credit_due_date || null,
                daysOverdue: toDaysOverdue(o.credit_due_date || null),
              })
              window.open(toWhatsAppUrl(o.phone, message), '_blank', 'noopener,noreferrer')
            }}
            onDelete={(o) => void deleteOrder(o.id, o.invoice_no)}
          />
        )}
        {/* ── STORE SETTINGS TAB ── */}
        {tab === 'settings' && (
          <StoreSettingsView onAddProduct={() => setTab('inventory')} />
        )}
        </div>
        {/* Footer */}
        <footer className="mt-auto pt-10 pb-2 border-t border-black/10 flex flex-col md:flex-row justify-between items-center text-[10px] text-[#000000] font-semibold uppercase tracking-wider gap-4 print:hidden">
          <div>© {new Date().getFullYear()} All Rights Reserved. {shopName}.</div>
          <div>
            Powered By{' '}
            <a href="https://www.cenexasystems.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline font-bold transition-all">Cenexa Systems</a>{' '}
            @2026
          </div>
          <div className="italic text-[#9a8c86] font-bold tracking-[0.15em] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full"></span>
            {shopName}
          </div>
        </footer>
      </main>


      {invoicePreviewOrder && (() => {
        const preview = getOrderWhatsAppPreview(invoicePreviewOrder)
        if (!preview) return null

        return (
          <DocumentPreviewModal
            title={`Invoice Preview • #${formatInvoiceNo(invoicePreviewOrder.invoice_no || invoicePreviewOrder.id)}`}
            onClose={() => setInvoicePreviewOrder(null)}
            onOpenFull={() => navigate(`/invoice/${encodeURIComponent(formatInvoiceNo(invoicePreviewOrder.invoice_no || invoicePreviewOrder.id))}`)}
          >
                  <Invoice
                    invoiceNo={formatInvoiceNo(invoicePreviewOrder.invoice_no || invoicePreviewOrder.id)}
                    date={invoicePreviewOrder.created_at}
                    customerName={invoicePreviewOrder.customer_name}
                    phone={invoicePreviewOrder.phone}
                    address={invoicePreviewOrder.address}
                    items={preview.items as unknown as import('../components/Invoice').InvoiceItem[]}
                    subtotal={preview.subtotal}
                    shipping={invoicePreviewOrder.delivery_charge}
                    deliveryCharge={invoicePreviewOrder.delivery_charge}
                    discountAmount={invoicePreviewOrder.discount_amount}
                    manualDiscountAmount={invoicePreviewOrder.manual_discount_amount}
                    gstAmount={invoicePreviewOrder.total_gst}
                    paymentMode={formatPaymentMode(invoicePreviewOrder.payment_mode || invoicePreviewOrder.payment_method, invoicePreviewOrder.split_details) || undefined}
                    isCredit={invoicePreviewOrder.credit_status === 'outstanding' || invoicePreviewOrder.credit_status === 'paid'}
                    creditDueDate={invoicePreviewOrder.credit_status === 'outstanding' ? invoicePreviewOrder.credit_due_date : undefined}
                    creditPaidAt={invoicePreviewOrder.credit_status === 'paid' ? invoicePreviewOrder.credit_paid_at : undefined}
                    schemeNumber={invoicePreviewOrder.scheme_number}
                    schemeDiscount={invoicePreviewOrder.scheme_discount || 0}
                    schemeAmountUsed={invoicePreviewOrder.scheme_amount_used || 0}
                    schemeBalanceAfter={invoicePreviewOrder.scheme_balance_after}
                    advanceAmountUsed={invoicePreviewOrder.advance_amount_used || 0}
                    exchangeAmount={invoicePreviewOrder.exchange_amount || 0}
                    customerGstin={invoicePreviewOrder.customer_gstin}
                    customerPan={invoicePreviewOrder.customer_pan}
                    splitDetails={invoicePreviewOrder.split_details}
                    schemeGramsUsed={invoicePreviewOrder.scheme_grams_used}
                    schemeGoldRate={invoicePreviewOrder.scheme_gold_rate}
                    total={invoicePreviewOrder.total}
                    status={invoicePreviewOrder.status}
                    channel={normalizeOrderMode(invoicePreviewOrder.order_mode)}
                  />
          </DocumentPreviewModal>
        )
      })()}

      {printOrder && (
        <PrintSettingsModal
          onClose={() => setPrintOrder(null)}
          onPrint={(prefs) => prefs.paper === 'thermal'
            ? handlePrintReceipt(printOrder, thermalWidth(prefs))
            : navigate(`/invoice/${encodeURIComponent(formatInvoiceNo(printOrder.invoice_no || printOrder.id))}?print=${prefs.size}`)}
        />
      )}

      {/* Global Barcode Navigation Dialog */}
      <BarcodeRedirectDialog onNavigateToBilling={handleNavigateToBillingFromDialog} />
    </div>
  )
}
