import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Box, Calendar, Check, Clock, Eye, FileText, IndianRupee, Plus, Printer, RefreshCw, Trash2, Wallet, X } from 'lucide-react'
import { customerService } from '../services/customerService'
import { getErrorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/retail'
import { printThermalReceipt } from '../lib/thermalPrint'
import { buildAdvanceDepositWhatsAppMessage, buildProfessionalWhatsAppMessage, publicInvoiceUrl } from '../lib/whatsappMessage'
import { toWhatsAppUrl } from '../lib/phone'
import { useNavigate } from 'react-router-dom'
import { ModalPortal } from '../components/ModalPortal'
import { DocumentPreviewModal } from '../components/invoice/InvoiceParts'
import { AdvanceReceiptSheet } from '../components/invoice/AdvanceReceiptSheet'
import { PaymentModePicker } from '../components/PaymentModePicker'
import { splitError, splitSummary, type PaymentMode, type SplitAmounts } from '../lib/paymentModes'
import { PrintSettingsModal } from '../components/invoice/PrintSettingsModal'
import { thermalWidth, type PrintPrefs } from '../lib/printPrefs'
import { DocIcon, WhatsAppIcon, actionBtn } from '../components/ActionIcons'
import { printAdvanceReceipt } from '../lib/advanceReceipt'
import { useAdminAuthStore, useProductStore } from '../store/store'
import { auditService } from '../services/auditService'
import {
  completeAdvanceOrder, createAdvanceOrder, deleteAdvanceOrder, listAdvanceOrders, updateAdvanceStatus,
  type AdvanceOrder, type AdvancePaymentMethod, type AdvanceStatus,
} from '../services/advanceOrderService'
import { isInPreset, toLocalDateStr } from '../lib/dateRanges'
import { csvDate, csvPhone, downloadCsv } from '../lib/csv'
import { FilterCard, FilterField, PeriodBar } from '../components/filters/PageFilters'
import { filterInput, periodRange } from '../components/filters/filterStyles'

type DateFilter = 'all' | 'today' | 'week' | 'month' | 'year' | 'custom'
type StatusFilter = 'all' | 'pending' | 'ready' | 'completed' | 'cancelled'

const STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending_deposit: 'Pending Deposit', ready_for_delivery: 'Ready for Delivery', waiting_final_payment: 'Waiting for Final Payment', completed: 'Completed', cancelled: 'Cancelled',
}
const initialForm = { customerName: '', phone: '', address: '', productName: '', category: '', description: '', totalAmount: '', depositAmount: '', expectedDeliveryDate: '', status: 'pending_deposit' as AdvanceStatus, remarks: '', reference_number: '', paymentMethod: 'cash' as AdvancePaymentMethod }

type AdvanceOrdersProps = {
  onOrderCompleted?: (order?: AdvanceOrder) => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{label}</span>{children}</label> }
const inputClass = 'w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm'

export default function AdvanceOrders({ onOrderCompleted }: AdvanceOrdersProps = {}) {
  const role = useAdminAuthStore(state => state.role)
  const products = useProductStore(state => state.products)
  const fetchProducts = useProductStore(state => state.fetchProducts)
  useEffect(() => { void fetchProducts() }, [fetchProducts])
  /** The stock item an advance order is for: its stock is reduced when the order is completed. */
  const stockItemFor = (name: string, category: string) => {
    const key = name.trim().toLowerCase()
    if (!key) return null
    const matches = products.filter(p => p.isActive !== false && p.name.trim().toLowerCase() === key && p.category !== 'Unregistered')
    const product = matches.find(p => p.category === category) || matches[0]
    return product && !product.hasVariants ? product : null
  }
  const [orders, setOrders] = useState<AdvanceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(initialForm)
  const linkedStockItem = stockItemFor(form.productName, form.category)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ id: '', name: '', phone: '', product: '' })
  const [query, setQuery] = useState({ id: '', name: '', phone: '', product: '' })
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selected, setSelected] = useState<AdvanceOrder | null>(null)
  const [previewOrder, setPreviewOrder] = useState<AdvanceOrder | null>(null)
  const [printFor, setPrintFor] = useState<AdvanceOrder | null>(null)
  const navigate = useNavigate()
  const [paymentOrder, setPaymentOrder] = useState<AdvanceOrder | null>(null)
  const [payMode, setPayMode] = useState<PaymentMode>('cash')
  const [paySplit, setPaySplit] = useState<SplitAmounts>({})
  const [payError, setPayError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setOrders(await listAdvanceOrders()) } catch (err) { setError(getErrorMessage(err, 'Unable to load advance orders')) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const analytics = useMemo(() => {
    const open = orders.filter(o => !['completed', 'cancelled'].includes(o.status))
    const live = orders.filter(o => o.status !== 'cancelled')
    return {
      pending: orders.filter(o => o.status === 'pending_deposit' || o.status === 'waiting_final_payment').length,
      ready: orders.filter(o => o.status === 'ready_for_delivery').length,
      completed: orders.filter(o => o.status === 'completed').length,
      cancelled: orders.filter(o => o.status === 'cancelled').length,
      /** Balance still to collect on open orders */
      outstanding: open.reduce((sum, o) => sum + o.remaining_balance, 0),
      balanceDueCount: open.filter(o => o.remaining_balance > 0).length,
      /** Deposits already taken on orders that are still open */
      openDeposits: open.reduce((sum, o) => sum + o.deposit_amount, 0),
      openDepositCount: open.filter(o => o.deposit_amount > 0).length,
      /** Value of every advance order that is not cancelled */
      totalValue: live.reduce((sum, o) => sum + o.total_amount, 0),
      liveCount: live.length,
    }
  }, [orders])

  const filtered = useMemo(() => orders.filter(order => {
    const has = (value: string | null | undefined, needle: string) => !needle.trim() || String(value || '').toLowerCase().includes(needle.trim().toLowerCase())
    if (!has(order.deposit_id, query.id) || !has(order.customer_name, query.name) || !has(order.phone, query.phone)) return false
    if (query.product.trim() && !(order.products || []).some(item => has(String(item.name || ''), query.product)) && !has(order.product_name, query.product)) return false
    if (statusFilter === 'pending' && !['pending_deposit', 'waiting_final_payment'].includes(order.status)) return false
    if (statusFilter === 'ready' && order.status !== 'ready_for_delivery') return false
    if (statusFilter === 'completed' && order.status !== 'completed') return false
    if (statusFilter === 'cancelled' && order.status !== 'cancelled') return false
    if (dateFilter === 'custom') {
      const day = toLocalDateStr(new Date(order.created_at))
      if (fromDate && day < fromDate) return false
      if (toDate && day > toDate) return false
    } else if (dateFilter !== 'all') {
      // Week = Monday–Sunday, Month = 1st–last day (shared ranges)
      if (!isInPreset(order.created_at, dateFilter)) return false
    }
    return true
  }), [orders, query, statusFilter, dateFilter, fromDate, toDate])

  const exportCsv = () => downloadCsv(`advance-orders-${toLocalDateStr(new Date())}.csv`, [
    ['Deposit ID', 'Created', 'Customer', 'Phone', 'Product', 'Total', 'Paid', 'Balance', 'Delivery', 'Status', 'Invoice No'],
    ...filtered.map(o => [o.deposit_id, csvDate(o.created_at, true), o.customer_name, csvPhone(o.phone), o.product_name, o.total_amount.toFixed(2), o.deposit_amount.toFixed(2), (o.status === 'completed' ? 0 : o.remaining_balance).toFixed(2), o.expected_delivery_date || '', STATUS_LABELS[o.status], o.invoice_number || '']),
  ])

  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    const total = Number(form.totalAmount); const deposit = Number(form.depositAmount)
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(deposit) || deposit <= 0 || deposit >= total) { setError('Deposit must be greater than RM0 and less than the total order amount.'); setSaving(false); return }
    try {
      const created = await createAdvanceOrder({ ...form, totalAmount: total, depositAmount: deposit, referenceNumber: form.reference_number, createdByName: role || 'Staff', products: [{ ...(linkedStockItem ? { product_id: linkedStockItem.id } : {}), name: form.productName, category: form.category, description: form.description, quantity: 1, base_price: total, line_total: total, unit: 'piece', unit_type: 'unit', source: 'advance_order' }] })
      // New customers land in the Customers list (existing ones keep their details)
      void customerService.upsertFromSale({ phone: created.phone, name: created.customer_name, address: created.address }).catch(() => undefined)
      setOrders(current => [created, ...current]); setForm(initialForm); setCreateOpen(false); setNotice(`${created.deposit_id} created. Deposit is tracked separately and has not been added to revenue.`)

      // Redirect to WhatsApp with advance deposit receipt
      const advanceMsg = buildAdvanceDepositWhatsAppMessage({
        customerName: created.customer_name,
        depositId: created.deposit_id,
        productName: created.product_name,
        totalAmount: created.total_amount,
        depositAmount: created.deposit_amount,
        remainingBalance: created.remaining_balance,
        expectedDeliveryDate: created.expected_delivery_date,
        paymentMethod: form.paymentMethod,
      })
      window.open(toWhatsAppUrl(created.phone, advanceMsg), '_blank', 'noopener,noreferrer')
    } catch (err) { setError(getErrorMessage(err, 'Unable to create advance order')) } finally { setSaving(false) }
  }

  const changeStatus = async (order: AdvanceOrder, status: AdvanceStatus) => {
    if (status === 'completed') { openReceive(order); return }
    try { const updated = await updateAdvanceStatus(order.id, status); setOrders(rows => rows.map(row => row.id === order.id ? updated : row)); if (selected?.id === order.id) setSelected(updated) } catch (err) { setError(getErrorMessage(err, 'Unable to update status')) }
  }

  const handleDeleteOrder = async (order: AdvanceOrder) => {
    if (role !== 'admin') { setError('Only the admin can delete an advance order.'); return }
    if (!window.confirm(`Delete advance order ${order.deposit_id} for ${order.customer_name}?${order.completed_order_id ? `\n\nIts invoice ${order.invoice_number || ''} will also be deleted and the items put back in stock.` : ''}\n\nThis cannot be undone.`)) return
    try {
      await deleteAdvanceOrder(order.id)
      void auditService.log({ action: 'record_deleted', entityType: 'advance_order', entityId: order.deposit_id, oldValue: { customer: order.customer_name, phone: order.phone, total: order.total_amount, deposit: order.deposit_amount, invoice: order.invoice_number }, note: 'advance order' })
      if (order.completed_order_id) onOrderCompleted?.()
      setOrders(rows => rows.filter(row => row.id !== order.id))
      if (selected?.id === order.id) setSelected(null)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete advance order'))
    }
  }

  const openReceive = (order: AdvanceOrder) => { setPaymentOrder(order); setPayMode('cash'); setPaySplit({}); setPayError('') }

  const receivePayment = async (event: FormEvent) => {
    event.preventDefault(); if (!paymentOrder) return
    const amount = paymentOrder.remaining_balance
    const mixError = splitError(payMode, paySplit, amount)
    if (mixError) { setPayError(mixError); return }
    setSaving(true); setError(''); setPayError('')
    try {
      const remarks = payMode === 'mixed' ? `Split: ${splitSummary(paySplit)}` : ''
      const result = await completeAdvanceOrder(paymentOrder.id, payMode, amount, null, 0, 0, remarks)
      const completed: AdvanceOrder = { ...paymentOrder, status: 'completed', remaining_balance: amount, completed_at: result.completed_at, completed_order_id: result.order_id, invoice_number: result.invoice_no, final_payment_method: payMode }
      setOrders(rows => rows.map(row => row.id === completed.id ? completed : row)); onOrderCompleted?.(completed); setPaymentOrder(null)
      setNotice(`${result.invoice_no} generated once. The full ${formatCurrency(completed.total_amount)} is now recognized as revenue.`)

      // Redirect to WhatsApp with final invoice URL + Instagram + Feedback form
      whatsappInvoice(completed)
    } catch (err) { setPayError(getErrorMessage(err, 'Unable to complete payment')) } finally { setSaving(false) }
  }

  const productRows = (order: AdvanceOrder) => order.products.length ? order.products : [{ name: order.product_name, quantity: 1, base_price: order.total_amount, line_total: order.total_amount, unit: 'piece', unit_type: 'unit' }]
  const printFinal = (order: AdvanceOrder, paperWidth: 58 | 80 = 80) => printThermalReceipt({ paperWidth, invoiceNo: order.invoice_number || order.deposit_id, date: order.completed_at || new Date().toISOString(), customerName: order.customer_name, phone: order.phone, items: productRows(order).map(item => ({ name: String(item.name || 'Product'), qty: Number(item.quantity || 1), unit: String(item.unit || 'piece'), price: Number(item.base_price || 0), line_total: Number(item.line_total || 0) })), subtotal: order.total_amount, shipping: 0, total: order.total_amount })
  
  const whatsappDepositReceipt = (order: AdvanceOrder) => {
    const message = buildAdvanceDepositWhatsAppMessage({
      customerName: order.customer_name,
      depositId: order.deposit_id,
      productName: order.product_name,
      totalAmount: order.total_amount,
      depositAmount: order.deposit_amount,
      remainingBalance: order.remaining_balance,
      expectedDeliveryDate: order.expected_delivery_date,
    })
    window.open(toWhatsAppUrl(order.phone, message), '_blank', 'noopener,noreferrer')
  }

  const whatsappInvoice = (order: AdvanceOrder) => {
    const invNum = order.invoice_number || order.deposit_id
    const message = buildProfessionalWhatsAppMessage({
      customerName: order.customer_name,
      phone: order.phone,
      invoiceNumber: invNum,
      invoiceDate: order.created_at,
      items: [{
        name: order.product_name,
        qty: 1,
        unit: 'pcs',
        unitType: 'unit',
        rate: order.total_amount,
        lineTotal: order.total_amount,
      }],
      subtotal: order.total_amount,
      total: order.total_amount,
      invoiceUrl: publicInvoiceUrl(invNum),
    })
    window.open(toWhatsAppUrl(order.phone, message), '_blank', 'noopener,noreferrer')
  }

  const statusGroup = (status: AdvanceStatus): 'PENDING' | 'READY' | 'COMPLETED' | 'CANCELLED' =>
    status === 'ready_for_delivery' ? 'READY' : status === 'completed' ? 'COMPLETED' : status === 'cancelled' ? 'CANCELLED' : 'PENDING'
  const groupStyles = {
    PENDING: 'bg-[#FEF3C7] text-[#78350F] border-[#F59E0B]/30',
    READY: 'bg-[#DBEAFE] text-[#1E3A8A] border-[#2563EB]/30',
    COMPLETED: 'bg-[#DCFCE7] text-[#166534] border-[#16A34A]/30',
    CANCELLED: 'bg-[#FEE2E2] text-[#991B1B] border-[#DC2626]/30',
  } as const
  const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const showDate = (value: string | null | undefined) => value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString('en-IN') : '—'
  const isOpen = (order: AdvanceOrder) => order.status !== 'completed' && order.status !== 'cancelled'
  const toggleReady = (order: AdvanceOrder) => void changeStatus(order, order.status === 'ready_for_delivery' ? 'pending_deposit' : 'ready_for_delivery')
  const cancelOrder = (order: AdvanceOrder) => {
    if (!window.confirm(`Cancel advance order ${order.deposit_id} for ${order.customer_name}?`)) return
    void changeStatus(order, 'cancelled')
  }
  const printReceipt = (order: AdvanceOrder, prefs: PrintPrefs) => {
    if (prefs.paper === 'sheet') { navigate(`/advance/${encodeURIComponent(order.id)}?print=${prefs.size}`); return }
    const width = thermalWidth(prefs)
    if (order.status === 'completed') printFinal(order, width)
    else printAdvanceReceipt(order, width)
  }
  const shareReceipt = (order: AdvanceOrder) => order.status === 'completed' ? whatsappInvoice(order) : whatsappDepositReceipt(order)

  const columns = 'md:grid-cols-[1.1fr_1.3fr_1.5fr_1.5fr_0.9fr_1.1fr_1.4fr]'

  return <div className="flex-1 flex flex-col max-w-[1400px] mx-auto w-full pb-8 animate-in fade-in duration-300">
    {/* Header: title left; period, New Advance Order, refresh and dates right */}
    <div className="flex flex-col xl:flex-row justify-between items-start gap-4 mb-6">
      <div className="min-w-0">
        <h2 className="text-[28px] font-black text-[#000000] tracking-tight">Advance Orders</h2>
        <p className="text-xs text-[#000000] font-semibold mt-1">Partial-payment holds — revenue is recognized only when the balance is collected.</p>
      </div>
      <PeriodBar
        preset={dateFilter}
        from={dateFilter === 'custom' ? fromDate : periodRange(dateFilter).from}
        to={dateFilter === 'custom' ? toDate : periodRange(dateFilter).to}
        onPreset={p => { setDateFilter(p); setFromDate(''); setToDate('') }}
        onFrom={v => { setDateFilter('custom'); setFromDate(v) }}
        onTo={v => { setDateFilter('custom'); setToDate(v) }}
        onExport={exportCsv}
        exportDisabled={filtered.length === 0}
      >
        <button type="button" onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-[#0A0A0A] px-4 py-2 text-xs font-black uppercase tracking-wider text-white shadow-sm hover:bg-[#1A1A1A] cursor-pointer whitespace-nowrap">
          <Plus size={14} /> New Advance Order
        </button>
        <button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh"
          className="rounded-xl border border-black/10 bg-white p-2 text-[#000000] shadow-xs hover:bg-black/5 cursor-pointer">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </PeriodBar>
    </div>

    {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

    {/* Summary cards */}
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {([
        ['Pending Deposit Amount Received', money(analytics.openDeposits), `${analytics.openDepositCount} bill${analytics.openDepositCount === 1 ? '' : 's'} with pending deposits`, <IndianRupee key="d" className="w-3.5 h-3.5 text-emerald-700" />],
        ['Needed to Receive (Pending)', money(analytics.outstanding), `${analytics.balanceDueCount} bill${analytics.balanceDueCount === 1 ? '' : 's'} with balance due`, <Wallet key="r" className="w-3.5 h-3.5 text-orange-700" />],
        ['Total Advance Orders Value', money(analytics.totalValue), `${analytics.liveCount} total advance order${analytics.liveCount === 1 ? '' : 's'}`, <FileText key="v" className="w-3.5 h-3.5 text-fuchsia-700" />],
        ['Ready for Delivery', String(analytics.ready), 'Ready for customer pickup/delivery', <Box key="p" className="w-3.5 h-3.5 text-blue-700" />],
        ['Pending Orders', String(analytics.pending), 'Awaiting balance or confirmation', <Clock key="c" className="w-3.5 h-3.5 text-rose-700" />],
        ['Completed Deposits', String(analytics.completed), 'Balance collected and billed', <Check key="k" className="w-3.5 h-3.5 text-green-700" />],
      ] as const).map(([label, value, note, icon]) => (
        <div key={label} className="bg-white border border-black/10 rounded-xl px-3.5 py-3 shadow-xs flex flex-col min-w-0" title={note}>
          <div className="flex items-start gap-1.5 min-w-0">
            <span className="mt-px shrink-0">{icon}</span>
            <p className="text-[10px] font-black text-[#000000]/80 uppercase tracking-wide leading-snug min-w-0">{label}</p>
          </div>
          <p className="mt-2 text-xl font-black text-[#000000] leading-tight break-words">{value}</p>
          <p className="mt-auto pt-2 text-[10.5px] font-medium text-[#000000]/65 leading-snug">{note}</p>
        </div>
      ))}
    </div>

    <FilterCard
      tabs={(['all', 'pending', 'ready', 'completed', 'cancelled'] as StatusFilter[]).map(st => ({
        id: st,
        label: st === 'all' ? 'All' : st.charAt(0).toUpperCase() + st.slice(1),
        count: st === 'all' ? orders.length : st === 'pending' ? analytics.pending : st === 'ready' ? analytics.ready : st === 'completed' ? analytics.completed : analytics.cancelled,
      }))}
      activeTab={statusFilter}
      onTab={setStatusFilter}
      onSearch={() => setQuery(draft)}
    >
      <FilterField label="Search Deposit ID" search>
        <input className={`${filterInput} pl-9`} placeholder="e.g. DEP-..." value={draft.id} onChange={e => setDraft(d => ({ ...d, id: e.target.value }))} />
      </FilterField>
      <FilterField label="Customer Name">
        <input className={filterInput} placeholder="Search name..." value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
      </FilterField>
      <FilterField label="Customer Phone">
        <input className={filterInput} inputMode="tel" placeholder="Search phone..." value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} />
      </FilterField>
      <FilterField label="Product">
        <input className={filterInput} placeholder="Search product..." value={draft.product} onChange={e => setDraft(d => ({ ...d, product: e.target.value }))} />
      </FilterField>
    </FilterCard>

    {/* Rows */}
    <div className="bg-white border border-black/10 rounded-xl overflow-hidden">
      <div className={`hidden md:grid ${columns} gap-3 px-4 py-3 border-b border-black/10 text-[10px] font-black uppercase tracking-wider text-[var(--accent-dark)] bg-[#F9FAFB]`}>
        <span>Deposit ID</span>
        <span>Customer</span>
        <span>Product</span>
        <span>Total / Paid / Balance</span>
        <span>Delivery</span>
        <span>Status</span>
        <span className="text-right">Actions</span>
      </div>
      {loading ? (
        <div className="p-8 text-center text-xs font-bold text-[var(--accent-dark)]">Loading advance orders...</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-xs font-bold text-[var(--accent-dark)]">No advance orders match the current filters.</div>
      ) : filtered.map(order => {
        const group = statusGroup(order.status)
        const items = productRows(order)
        return (
          <div key={order.id} className={`grid grid-cols-1 ${columns} gap-3 px-4 py-3 border-b border-black/5 items-center text-xs hover:bg-[#FAFAFA]`}>
            <div>
              <p className="font-mono font-black text-[11px] text-black">{order.deposit_id}</p>
              <p className="text-[9px] font-bold text-[var(--accent-dark)]">{showDate(order.created_at)}</p>
            </div>
            <div>
              <p className="font-black text-black">{order.customer_name}</p>
              <p className="text-[10px] text-[var(--accent-dark)]">{order.phone}</p>
            </div>
            <div className="text-[11px]">
              {items.slice(0, 2).map((item, i) => (
                <p key={i} className="font-bold text-black truncate">{Number(item.quantity || 1)}× {String(item.name || order.product_name)}</p>
              ))}
              {items.length > 2 && <p className="text-[10px] text-[var(--accent-dark)]">+{items.length - 2} more</p>}
            </div>
            <div className="text-[11px]">
              <p className="font-bold text-black">Total: {money(order.total_amount)}</p>
              <p className="text-[#16A34A] font-bold">Paid: {money(order.deposit_amount)}</p>
              <p className="text-[#DC2626] font-bold">Balance: {money(order.status === 'completed' ? 0 : order.remaining_balance)}</p>
            </div>
            <div className="text-[11px] font-bold text-[var(--accent-dark)]">{showDate(order.expected_delivery_date)}</div>
            <div>
              <span className={`inline-block px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-wider border ${groupStyles[group]}`}>{group}</span>
              {isOpen(order) && (
                <button type="button" onClick={() => toggleReady(order)} className="block mt-1 text-[9px] font-black uppercase tracking-wider text-[#2563EB] hover:underline cursor-pointer">
                  Mark as {group === 'READY' ? 'Pending' : 'Ready'}
                </button>
              )}
            </div>
            <div className="flex items-center justify-end gap-1.5 flex-nowrap">
              <button type="button" onClick={() => shareReceipt(order)} title="Send on WhatsApp" className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`}>
                <WhatsAppIcon className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setPreviewOrder(order)} title={order.status === 'completed' ? 'Open advance order bill' : 'Open advance receipt'} className={`${actionBtn} bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)]`}>
                <DocIcon className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setSelected(order)} title="View details" className={`${actionBtn} bg-black/5 hover:bg-black/10 text-[#000000]`}>
                <Eye className="w-4 h-4" />
              </button>
              {isOpen(order) && (
                <button type="button" onClick={() => openReceive(order)} title="Receive balance" className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`}>
                  <IndianRupee className="w-4 h-4" />
                </button>
              )}
              {isOpen(order) && (
                <button type="button" onClick={() => cancelOrder(order)} title="Cancel" className={`${actionBtn} bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 text-[#D97706]`}>
                  <X className="w-4 h-4" />
                </button>
              )}
              {role === 'admin' && (
                <button type="button" onClick={() => void handleDeleteOrder(order)} title="Delete" className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>

    {createOpen && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-4"><form onSubmit={create} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><div><h3 className="text-xl font-black">Create Advance Order</h3><p className="text-xs text-amber-700">Creates an advance receipt only - no revenue or final invoice.</p></div><button type="button" onClick={() => setCreateOpen(false)}><X/></button></div><div className="grid gap-4 md:grid-cols-2"><Field label="Customer Name *"><input required className={inputClass} value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/></Field><Field label="Phone Number *"><input required className={inputClass} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field><Field label="Address"><textarea className={inputClass} value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field><Field label="Product Name *"><input required list="advance-products" className={inputClass} value={form.productName} onChange={e=>{const product=products.find(p=>p.name===e.target.value);setForm({...form,productName:e.target.value,category:product?.category||form.category})}}/><datalist id="advance-products">{products.filter(p=>p.category!=='Unregistered').map(p=><option key={p.id} value={p.name}/>)}</datalist>{form.productName.trim() && (linkedStockItem
        ? <p className="mt-1 text-[11px] font-bold text-emerald-700">Linked to stock ({linkedStockItem.stock} in stock) — 1 will be taken off when the order is completed.</p>
        : <p className="mt-1 text-[11px] font-semibold text-amber-700">Not a stock item — stock won't change. Pick an item from the list to link it, or use POS → Deposit Order for items with sizes or more than one item.</p>)}</Field><Field label="Category"><input className={inputClass} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></Field><Field label="Description"><textarea className={inputClass} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field><Field label="Total Order Amount *"><input required min="0.01" step="0.01" type="number" className={inputClass} value={form.totalAmount} onChange={e=>setForm({...form,totalAmount:e.target.value})}/></Field><Field label="Deposit Amount Received *"><input required min="0" step="0.01" type="number" className={inputClass} value={form.depositAmount} onChange={e=>setForm({...form,depositAmount:e.target.value})}/></Field><Field label="Remaining Balance (automatic)"><div className="rounded-xl bg-emerald-50 px-4 py-3 font-black text-emerald-800">{formatCurrency(Math.max(0, Number(form.totalAmount||0)-Number(form.depositAmount||0)))}</div></Field><Field label="Deposit Payment Method"><select className={inputClass} value={form.paymentMethod} onChange={e=>setForm({...form,paymentMethod:e.target.value as AdvancePaymentMethod})}><option value="cash">Cash</option><option value="upi">QR</option><option value="card">Card</option></select></Field><Field label="Expected Delivery Date *"><input required type="date" className={inputClass} value={form.expectedDeliveryDate} onChange={e=>setForm({...form,expectedDeliveryDate:e.target.value})}/></Field><Field label="Order Status"><select disabled className={inputClass} value="pending_deposit"><option value="pending_deposit">Pending Deposit</option></select></Field>      <div className="md:col-span-2"><Field label="Reference Number"><input className={inputClass} value={form.reference_number} onChange={e=>setForm({...form,reference_number:e.target.value})} placeholder="e.g. PO-001, booking ref (optional)"/></Field></div><div className="md:col-span-2"><Field label="Remarks"><textarea className={inputClass} value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})} placeholder="e.g. special instructions, colour, size notes"/></Field></div></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={()=>setCreateOpen(false)} className="rounded-xl border px-5 py-2.5 font-bold">Cancel</button><button disabled={saving} className="rounded-xl bg-[var(--accent-dark)] px-5 py-2.5 font-black text-white disabled:opacity-50">{saving?'Creating...':'Create & Save Advance Receipt'}</button></div></form></div></ModalPortal>}

    {paymentOrder && <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) setPaymentOrder(null) }}>
      <form onSubmit={receivePayment} className="flex w-full max-w-md max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-black/10 px-5 pt-5 pb-3">
          <div><p className="text-[11px] font-mono font-bold text-[var(--accent)]">{paymentOrder.deposit_id}</p><h3 className="text-lg font-black text-[#000000] tracking-tight">Receive Remaining Payment</h3></div>
          <button type="button" onClick={() => setPaymentOrder(null)} aria-label="Close" className="text-black hover:bg-black/5 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="rounded-xl bg-[#DCFCE7] border border-[#16A34A]/30 py-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#166534]">Remaining Amount</p>
            <p className="mt-1 text-3xl font-black text-[#166534]">{formatCurrency(paymentOrder.remaining_balance)}</p>
            <p className="mt-1 text-[11px] font-semibold text-[#166534]/80">{paymentOrder.customer_name} • Total {formatCurrency(paymentOrder.total_amount)} • Paid {formatCurrency(paymentOrder.deposit_amount)}</p>
          </div>
          <PaymentModePicker mode={payMode} onMode={setPayMode} split={paySplit} onSplit={setPaySplit} total={paymentOrder.remaining_balance} />
          {payError && <p className="text-xs font-bold text-[#DC2626]">{payError}</p>}
          <p className="rounded-lg bg-[#FEF3C7] border border-[#F59E0B]/30 p-2.5 text-[10px] font-bold text-[#78350F]">Confirmation marks the order Completed, creates one official invoice, and recognizes the full {formatCurrency(paymentOrder.total_amount)} as revenue.</p>
        </div>
        <div className="shrink-0 border-t border-black/10 bg-white px-5 py-3">
          <button disabled={saving} className="w-full py-3 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 bg-[#10B981] hover:bg-[#059669] text-white shadow-md transition-all disabled:opacity-60 cursor-pointer">
            {saving ? 'Processing…' : <><Check className="w-4 h-4" /> Confirm Final Payment</>}
          </button>
        </div>
      </form>
    </div></ModalPortal>}

    {printFor && (
      <PrintSettingsModal onClose={() => setPrintFor(null)} onPrint={(prefs) => printReceipt(printFor, prefs)} />
    )}

    {previewOrder && (
      <DocumentPreviewModal
        title={`${previewOrder.status === 'completed' ? 'Advance Bill' : 'Receipt'} Preview • #${previewOrder.deposit_id}`}
        onClose={() => setPreviewOrder(null)}
        onOpenFull={() => navigate(`/advance/${encodeURIComponent(previewOrder.id)}`)}
      >
        <AdvanceReceiptSheet order={previewOrder} />
      </DocumentPreviewModal>
    )}

    {selected && <ModalPortal>
      <div className="fixed inset-0 z-[997] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setSelected(null)}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-5 max-h-[92vh] overflow-y-auto animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center pb-3 border-b border-black/10">
            <div>
              <p className="text-[11px] font-mono font-bold text-[var(--accent)]">{selected.deposit_id}</p>
              <h3 className="text-lg font-black text-[#000000] tracking-tight">Advance Order Details</h3>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="text-black hover:bg-black/5 w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="bg-[#F9FAFB] border border-black/10 rounded-lg p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-dark)]">Customer</p>
              <p className="text-sm font-black text-black">{selected.customer_name}</p>
              <p className="text-[11px] font-bold text-[var(--accent-dark)]">{selected.phone}</p>
              {selected.address && <p className="text-[11px] text-[var(--accent-dark)] mt-0.5">{selected.address}</p>}
            </div>

            <div className="border border-black/10 rounded-lg divide-y divide-black/5">
              {productRows(selected).map((item, i) => {
                const qty = Number(item.quantity || 1)
                const price = Number(item.base_price || 0)
                return (
                  <div key={i} className="flex justify-between items-center p-2.5 text-xs">
                    <div>
                      <p className="font-bold text-black">{String(item.name || selected.product_name)}</p>
                      <p className="text-[10px] text-[var(--accent-dark)]">Qty: {qty} × {money(price)}</p>
                    </div>
                    <p className="font-black text-black">{money(Number(item.line_total ?? price * qty))}</p>
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-[#F4F4F5] border border-black/10 rounded-lg p-2.5">
                <p className="text-[9px] font-bold text-[var(--accent-dark)] uppercase tracking-wider">Total</p>
                <p className="text-sm font-black text-black">{money(selected.total_amount)}</p>
              </div>
              <div className="bg-[#DCFCE7] border border-[#16A34A]/30 rounded-lg p-2.5">
                <p className="text-[9px] font-bold text-[#166534] uppercase tracking-wider">Paid</p>
                <p className="text-sm font-black text-[#166534]">{money(selected.deposit_amount)}</p>
              </div>
              <div className="bg-[#FEE2E2] border border-[#DC2626]/30 rounded-lg p-2.5">
                <p className="text-[9px] font-bold text-[#991B1B] uppercase tracking-wider">Balance</p>
                <p className="text-sm font-black text-[#991B1B]">{money(selected.status === 'completed' ? 0 : selected.remaining_balance)}</p>
              </div>
            </div>

            {selected.expected_delivery_date && (
              <p className="text-[11px] font-bold text-[var(--accent-dark)]"><Calendar className="w-3 h-3 inline mr-1" />Delivery: {showDate(selected.expected_delivery_date)}</p>
            )}
            {selected.invoice_number && (
              <p className="text-[11px] font-bold text-[var(--accent-dark)]">Invoice: {selected.invoice_number}</p>
            )}
            {selected.remarks && (
              <div className="bg-[#FEF9C3] border border-[#EAB308]/30 rounded-lg p-2.5 text-[11px] text-[#78350F]">
                <span className="font-bold">Notes: </span>{selected.remarks}
              </div>
            )}

            <div className="pt-3 border-t border-black/10 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPrintFor(selected)}
                className="bg-white border border-gray-300 hover:bg-gray-50 text-black py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
                <Printer className="w-3.5 h-3.5 text-[var(--accent)]" />
                Print Receipt
              </button>
              <button type="button" onClick={() => shareReceipt(selected)}
                className="bg-[#10B981] hover:bg-[#059669] text-white py-2.5 px-3 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
                <WhatsAppIcon className="w-3.5 h-3.5" />
                Share Receipt
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>}
  </div>
}
