import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Download, Eye, FileText, MessageCircle, PackageCheck, Printer, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { getErrorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/retail'
import { invoicePdfFile } from '../lib/invoicePdf'
import { printThermalReceipt } from '../lib/thermalPrint'
import { buildAdvanceDepositWhatsAppMessage, buildProfessionalWhatsAppMessage, publicInvoiceUrl } from '../lib/whatsappMessage'
import { toWhatsAppUrl } from '../lib/phone'
import { ModalPortal } from '../components/ModalPortal'
import { advanceReceiptPdf, downloadFile, printAdvanceReceipt } from '../lib/advanceReceipt'
import { useAdminAuthStore, useProductStore } from '../store/store'
import {
  addAdvanceEvent, completeAdvanceOrder, createAdvanceOrder, deleteAdvanceOrder, getAdvanceOrderHistory, listAdvanceOrders, updateAdvanceStatus,
  type AdvanceOrder, type AdvancePayment, type AdvancePaymentMethod, type AdvanceStatus, type AdvanceTimeline,
} from '../services/advanceOrderService'
import { isInPreset } from '../lib/dateRanges'

// Custom Malaysian Ringgit icon
const RMIcon = ({ size = 20, className = '' }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-label="Malaysian Ringgit">
    <rect x="2" y="2" width="20" height="20" rx="4" />
    <text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="bold" stroke="none" fill="currentColor" fontFamily="Arial, sans-serif">₹</text>
  </svg>
)

type DateFilter = 'all' | 'today' | 'week' | 'month'
type StatusFilter = 'all' | 'pending' | 'ready' | 'completed' | 'cancelled'

const STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending_deposit: 'Pending Deposit', ready_for_delivery: 'Ready for Delivery', waiting_final_payment: 'Waiting for Final Payment', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_STYLES: Record<AdvanceStatus, string> = {
  pending_deposit: 'bg-amber-50 text-amber-700 border-amber-200', ready_for_delivery: 'bg-blue-50 text-blue-700 border-blue-200',
  waiting_final_payment: 'bg-emerald-50 text-emerald-700 border-emerald-200', completed: 'bg-emerald-50 text-emerald-700 border-emerald-200', cancelled: 'bg-red-50 text-red-700 border-red-200',
}
const initialForm = { customerName: '', phone: '', address: '', productName: '', category: '', description: '', totalAmount: '', depositAmount: '', expectedDeliveryDate: '', status: 'pending_deposit' as AdvanceStatus, remarks: '', reference_number: '', paymentMethod: 'cash' as AdvancePaymentMethod }

type AdvanceOrdersProps = {
  onOrderCompleted?: (order?: AdvanceOrder) => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-[#6B7280]">{label}</span>{children}</label> }
const inputClass = 'w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-sm text-[#273126] outline-none transition focus:border-[var(--accent-dark)] focus:ring-2 focus:ring-emerald-100'

export default function AdvanceOrders({ onOrderCompleted }: AdvanceOrdersProps = {}) {
  const role = useAdminAuthStore(state => state.role)
  const products = useProductStore(state => state.products)
  const [orders, setOrders] = useState<AdvanceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [selected, setSelected] = useState<AdvanceOrder | null>(null)
  const [timeline, setTimeline] = useState<AdvanceTimeline[]>([])
  const [payments, setPayments] = useState<AdvancePayment[]>([])
  const [paymentOrder, setPaymentOrder] = useState<AdvanceOrder | null>(null)
  const [paymentForm, setPaymentForm] = useState({ method: 'cash' as AdvancePaymentMethod, remarks: '' })
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; percentage: number } | null>(null)
  const [couponError, setCouponError] = useState('')
  const [availableCoupons, setAvailableCoupons] = useState<{ code: string; percentage: number }[]>([])
  const [manualDiscount, setManualDiscount] = useState('')
  const [manualDiscountType, setManualDiscountType] = useState<'rm' | '%'>('rm')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setOrders(await listAdvanceOrders()) } catch (err) { setError(getErrorMessage(err, 'Unable to load advance orders')) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Fetch active coupons for the payment modal
  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.from('coupons').select('code, percentage').eq('is_active', true)
      .then(({ data }) => { if (data) setAvailableCoupons(data as { code: string; percentage: number }[]) })
  }, [])

  const applyCoupon = () => {
    const code = couponInput.trim().toUpperCase()
    const found = availableCoupons.find(c => c.code.toUpperCase() === code)
    if (!found) { setCouponError('Invalid or inactive coupon code.'); return }
    setAppliedCoupon(found)
    setCouponError('')
  }

  const removeCoupon = () => { setAppliedCoupon(null); setCouponInput(''); setCouponError('') }

  const openDetails = async (order: AdvanceOrder) => {
    setSelected(order); setTimeline([]); setPayments([])
    try { const history = await getAdvanceOrderHistory(order.id); setTimeline(history.timeline); setPayments(history.payments) } catch (err) { setError(getErrorMessage(err, 'Unable to load order details')) }
  }

  const analytics = useMemo(() => ({
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending_deposit' || o.status === 'waiting_final_payment').length,
    deposits: orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.deposit_amount, 0),
    outstanding: orders.filter(o => !['completed', 'cancelled'].includes(o.status)).reduce((sum, o) => sum + o.remaining_balance, 0),
    ready: orders.filter(o => o.status === 'ready_for_delivery').length,
    completed: orders.filter(o => o.status === 'completed').length,
  }), [orders])

  const filtered = useMemo(() => orders.filter(order => {
    const query = search.trim().toLowerCase()
    const searchable = [order.deposit_id, order.customer_name, order.phone, order.product_name, STATUS_LABELS[order.status]].join(' ').toLowerCase()
    if (query && !searchable.includes(query)) return false
    if (statusFilter === 'pending' && !['pending_deposit', 'waiting_final_payment'].includes(order.status)) return false
    if (statusFilter === 'ready' && order.status !== 'ready_for_delivery') return false
    if (statusFilter === 'completed' && order.status !== 'completed') return false
    if (statusFilter === 'cancelled' && order.status !== 'cancelled') return false
    if (dateFilter !== 'all') {
      // Week = Monday–Sunday, Month = 1st–last day (shared ranges)
      if (!isInPreset(order.created_at, dateFilter)) return false
    }
    return true
  }), [orders, search, statusFilter, dateFilter])

  const create = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('')
    const total = Number(form.totalAmount); const deposit = Number(form.depositAmount)
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(deposit) || deposit <= 0 || deposit >= total) { setError('Deposit must be greater than RM0 and less than the total order amount.'); setSaving(false); return }
    try {
      const created = await createAdvanceOrder({ ...form, totalAmount: total, depositAmount: deposit, referenceNumber: form.reference_number, createdByName: role || 'Staff', products: [{ name: form.productName, category: form.category, description: form.description, quantity: 1, base_price: total, line_total: total, unit: 'piece', unit_type: 'unit', source: 'advance_order' }] })
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
    if (status === 'completed') { setPaymentOrder(order); return }
    try { const updated = await updateAdvanceStatus(order.id, status); setOrders(rows => rows.map(row => row.id === order.id ? updated : row)); if (selected?.id === order.id) void openDetails(updated) } catch (err) { setError(getErrorMessage(err, 'Unable to update status')) }
  }

  const handleDeleteOrder = async (order: AdvanceOrder) => {
    if (!window.confirm(`Delete advance order ${order.deposit_id} for ${order.customer_name}? This cannot be undone.`)) return
    try {
      await deleteAdvanceOrder(order.id)
      setOrders(rows => rows.filter(row => row.id !== order.id))
      if (selected?.id === order.id) setSelected(null)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete advance order'))
    }
  }

  const receivePayment = async (event: FormEvent) => {
    event.preventDefault(); if (!paymentOrder) return; setSaving(true); setError('')
    try {
      const couponDiscount = appliedCoupon ? Math.round(paymentOrder.remaining_balance * (appliedCoupon.percentage / 100) * 100) / 100 : 0
      const manualDiscountNum = Math.max(0, Number(manualDiscount) || 0)
      const manualDisc = manualDiscountType === '%'
        ? Math.round(paymentOrder.remaining_balance * (manualDiscountNum / 100) * 100) / 100
        : manualDiscountNum
      const finalAmount = Math.max(0, paymentOrder.remaining_balance - couponDiscount - manualDisc)
      const parts = [paymentForm.remarks]
      if (appliedCoupon) parts.push(`Coupon: ${appliedCoupon.code} (-${appliedCoupon.percentage}%) = -INR ${couponDiscount.toFixed(2)}`)
      if (manualDisc > 0) parts.push(`Manual Discount: ${manualDiscountType === '%' ? manualDiscountNum + '%' : '₹' + manualDiscountNum.toFixed(2)} = -INR ${manualDisc.toFixed(2)}`)
      const remarksWithCoupon = parts.filter(Boolean).join(' | ')
      const result = await completeAdvanceOrder(
        paymentOrder.id, 
        paymentForm.method, 
        finalAmount,
        appliedCoupon?.code || null,
        appliedCoupon?.percentage || 0,
        manualDisc,
        remarksWithCoupon
      )
      const completed: AdvanceOrder = { ...paymentOrder, status: 'completed', remaining_balance: finalAmount, completed_at: result.completed_at, completed_order_id: result.order_id, invoice_number: result.invoice_no, final_payment_method: paymentForm.method }
      setOrders(rows => rows.map(row => row.id === completed.id ? completed : row)); onOrderCompleted?.(completed); setPaymentOrder(null); setPaymentForm({ method: 'cash', remarks: '' }); setAppliedCoupon(null); setCouponInput(''); setCouponError(''); setManualDiscount(''); setManualDiscountType('rm'); setNotice(`${result.invoice_no} generated once. The full ${formatCurrency(completed.total_amount)} is now recognized as revenue.`)

      // Redirect to WhatsApp with final invoice URL + Instagram + Feedback form
      whatsappInvoice(completed)
    } catch (err) { setError(getErrorMessage(err, 'Unable to complete payment')) } finally { setSaving(false) }
  }

  const productRows = (order: AdvanceOrder) => order.products.length ? order.products : [{ name: order.product_name, quantity: 1, base_price: order.total_amount, line_total: order.total_amount, unit: 'piece', unit_type: 'unit' }]
  const invoiceFile = (order: AdvanceOrder) => invoicePdfFile({ invoiceNo: order.invoice_number || order.deposit_id, date: order.completed_at || new Date().toISOString(), customerName: order.customer_name, phone: order.phone, address: order.address, items: productRows(order), subtotal: order.total_amount, shipping: 0, total: order.total_amount, paymentMode: order.final_payment_method || 'Paid' })
  const printFinal = (order: AdvanceOrder) => printThermalReceipt({ invoiceNo: order.invoice_number || order.deposit_id, date: order.completed_at || new Date().toISOString(), customerName: order.customer_name, phone: order.phone, items: productRows(order).map(item => ({ name: String(item.name || 'Product'), qty: Number(item.quantity || 1), unit: String(item.unit || 'piece'), price: Number(item.base_price || 0), line_total: Number(item.line_total || 0) })), subtotal: order.total_amount, shipping: 0, total: order.total_amount })
  
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

  const addEvent = async (order: AdvanceOrder, eventType: string, label: string) => {
    try { await addAdvanceEvent(order.id, eventType, label); await openDetails(order); setNotice(`${label} added to ${order.deposit_id}.`) } catch (err) { setError(getErrorMessage(err, 'Unable to add timeline event')) }
  }

  const cards = [
    ['Total Deposits', analytics.total, FileText, 'text-emerald-700 bg-emerald-50'], ['Pending Deposit Orders', analytics.pending, Clock3, 'text-amber-700 bg-amber-50'],
    ['Total Deposit Amount', formatCurrency(analytics.deposits), RMIcon, 'text-fuchsia-700 bg-fuchsia-50'], ['Outstanding Balance', formatCurrency(analytics.outstanding), RMIcon, 'text-red-700 bg-red-50'],
    ['Ready For Collection', analytics.ready, PackageCheck, 'text-blue-700 bg-blue-50'], ['Completed Deposit Orders', analytics.completed, CheckCircle2, 'text-emerald-700 bg-emerald-50'],
  ] as const

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-emerald-600">Separate from sales</p><h2 className="text-2xl font-black text-[#273126]">Advance Orders</h2><p className="mt-1 text-sm text-[#6B7280]">Deposits never count as revenue. Full order value is recognized only after final payment.</p></div><div className="flex gap-2"><button onClick={() => void load()} className="rounded-xl border bg-white p-3 text-[#647064]" title="Refresh"><RefreshCw size={18}/></button></div></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value, Icon, color]) => <div key={label} className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-[11px] font-black uppercase tracking-wide text-[#879086]">{label}</p><p className="mt-2 text-[17px] sm:text-2xl font-black text-[#273126] break-words">{value}</p></div><div className={`rounded-xl p-3 ${color}`}><Icon size={21}/></div></div></div>)}</div>
    <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]"><label className="relative"><Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17}/><input className={`${inputClass} pl-10`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Deposit ID, customer, phone, product or status"/></label><div className="flex flex-wrap gap-2">{(['all','pending','ready','completed','cancelled'] as StatusFilter[]).map(value => <button key={value} onClick={() => setStatusFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-black capitalize ${statusFilter === value ? 'bg-[var(--accent-dark)] text-white' : 'bg-[#F5F3F7] text-[#626B61]'}`}>{value}</button>)}</div><select className={inputClass} value={dateFilter} onChange={e => setDateFilter(e.target.value as DateFilter)}><option value="all">All Dates</option><option value="today">Today</option><option value="week">This Week</option><option value="month">This Month</option></select></div></div>
    <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm flex flex-col">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
            <tr>
              {['Deposit ID / Created','Customer','Product','Total / Deposit / Balance','Delivery','Status','Actions'].map(h => (
                <th key={h} className="px-4 py-3.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0EEE9]">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#6B7280]">Loading advance orders...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-[#6B7280]">No advance orders match these filters.</td></tr>
            ) : (
              filtered.map(order => (
                <tr key={order.id} className="hover:bg-emerald-50/30 transition-colors">
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <p className="font-black text-emerald-700">{order.deposit_id}</p>
                    <p className="text-[11px] text-[#8B9389]">
                      {new Date(order.created_at).toLocaleDateString('en-IN')} • {new Date(order.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <p className="font-bold text-[#273126]">{order.customer_name}</p>
                    <p className="text-xs text-[#727970]">{order.phone}</p>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <p className="font-semibold text-[#273126]">{order.product_name}</p>
                    <p className="text-xs text-[#858C83]">{order.category || 'Uncategorised'}</p>
                  </td>
                  <td className="px-4 py-3.5 text-xs align-middle whitespace-nowrap">
                    <p className="text-gray-700">Total: <b>{formatCurrency(order.total_amount)}</b></p>
                    <p className="text-emerald-700">Paid: <b>{formatCurrency(order.deposit_amount)}</b></p>
                    <p className="text-red-600 font-bold">Balance: <b>{formatCurrency(order.remaining_balance)}</b></p>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                      <CalendarDays size={14} className="text-gray-400 shrink-0" />
                      <span>{new Date(`${order.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN')}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <select
                      value={order.status}
                      onChange={e => void changeStatus(order, e.target.value as AdvanceStatus)}
                      className={`rounded-xl border px-2.5 py-1.5 text-xs font-black outline-none shadow-xs transition-colors cursor-pointer ${STATUS_STYLES[order.status]}`}
                    >
                      <option value="pending_deposit">Pending Deposit</option>
                      <option value="waiting_final_payment">Waiting for Final Payment</option>
                      <option value="completed">Completed (receive payment)</option>
                      <option value="ready_for_delivery">Ready to Collect</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </td>
                  <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {/* Receive Balance Button (if balance is due) */}
                      {order.status !== 'completed' && order.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => setPaymentOrder(order)}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-black shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                          title="Receive Remaining Balance"
                        >
                          <span>Receive Balance</span>
                        </button>
                      )}

                      {/* View Details Icon */}
                      <button
                        type="button"
                        onClick={() => void openDetails(order)}
                        className="w-8 h-8 rounded-lg bg-[#F4F2F6] hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="View Details"
                      >
                        <Eye size={15}/>
                      </button>

                      {/* Print Receipt / Invoice */}
                      <button
                        type="button"
                        onClick={() => order.status === 'completed' ? printFinal(order) : printAdvanceReceipt(order)}
                        className="w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title={order.status === 'completed' ? "Print Final Receipt" : "Print Advance Receipt"}
                      >
                        <Printer size={15}/>
                      </button>

                      {/* Download PDF Receipt / Invoice */}
                      <button
                        type="button"
                        onClick={() => downloadFile(order.status === 'completed' ? invoiceFile(order) : advanceReceiptPdf(order))}
                        className="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title={order.status === 'completed' ? "Download PDF Invoice" : "Download PDF Receipt"}
                      >
                        <Download size={15}/>
                      </button>

                      {/* WhatsApp Share */}
                      <button
                        type="button"
                        onClick={() => order.status === 'completed' ? whatsappInvoice(order) : whatsappDepositReceipt(order)}
                        className="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title={order.status === 'completed' ? "Share Final Invoice via WhatsApp" : "Share Advance Receipt via WhatsApp"}
                      >
                        <MessageCircle size={15}/>
                      </button>

                      {/* Delete Order */}
                      <button
                        type="button"
                        onClick={() => void handleDeleteOrder(order)}
                        className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                        title="Delete Order"
                      >
                        <Trash2 size={15}/>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>

    {createOpen && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-4"><form onSubmit={create} className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-center justify-between"><div><h3 className="text-xl font-black">Create Advance Order</h3><p className="text-xs text-amber-700">Creates an advance receipt only - no revenue or final invoice.</p></div><button type="button" onClick={() => setCreateOpen(false)}><X/></button></div><div className="grid gap-4 md:grid-cols-2"><Field label="Customer Name *"><input required className={inputClass} value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/></Field><Field label="Phone Number *"><input required className={inputClass} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></Field><Field label="Address"><textarea className={inputClass} value={form.address} onChange={e=>setForm({...form,address:e.target.value})}/></Field><Field label="Product Name *"><input required list="advance-products" className={inputClass} value={form.productName} onChange={e=>{const product=products.find(p=>p.name===e.target.value);setForm({...form,productName:e.target.value,category:product?.category||form.category})}}/><datalist id="advance-products">{products.map(p=><option key={p.id} value={p.name}/>)}</datalist></Field><Field label="Category"><input className={inputClass} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></Field><Field label="Description"><textarea className={inputClass} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field><Field label="Total Order Amount *"><input required min="0.01" step="0.01" type="number" className={inputClass} value={form.totalAmount} onChange={e=>setForm({...form,totalAmount:e.target.value})}/></Field><Field label="Deposit Amount Received *"><input required min="0" step="0.01" type="number" className={inputClass} value={form.depositAmount} onChange={e=>setForm({...form,depositAmount:e.target.value})}/></Field><Field label="Remaining Balance (automatic)"><div className="rounded-xl bg-emerald-50 px-4 py-3 font-black text-emerald-800">{formatCurrency(Math.max(0, Number(form.totalAmount||0)-Number(form.depositAmount||0)))}</div></Field><Field label="Deposit Payment Method"><select className={inputClass} value={form.paymentMethod} onChange={e=>setForm({...form,paymentMethod:e.target.value as AdvancePaymentMethod})}><option value="cash">Cash</option><option value="upi">QR</option><option value="card">Card</option></select></Field><Field label="Expected Delivery Date *"><input required type="date" className={inputClass} value={form.expectedDeliveryDate} onChange={e=>setForm({...form,expectedDeliveryDate:e.target.value})}/></Field><Field label="Order Status"><select disabled className={inputClass} value="pending_deposit"><option value="pending_deposit">Pending Deposit</option></select></Field>      <div className="md:col-span-2"><Field label="Reference Number"><input className={inputClass} value={form.reference_number} onChange={e=>setForm({...form,reference_number:e.target.value})} placeholder="e.g. PO-001, booking ref (optional)"/></Field></div><div className="md:col-span-2"><Field label="Remarks"><textarea className={inputClass} value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})} placeholder="e.g. special instructions, colour, size notes"/></Field></div></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={()=>setCreateOpen(false)} className="rounded-xl border px-5 py-2.5 font-bold">Cancel</button><button disabled={saving} className="rounded-xl bg-[var(--accent-dark)] px-5 py-2.5 font-black text-white disabled:opacity-50">{saving?'Creating...':'Create & Save Advance Receipt'}</button></div></form></div></ModalPortal>}

    {paymentOrder && <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/55 p-3 sm:p-4"><form onSubmit={receivePayment} className="flex w-full max-w-md max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl"><div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5"><div><p className="text-xs font-black uppercase tracking-wider text-emerald-600">{paymentOrder.deposit_id}</p><h3 className="text-xl font-black text-[#273126]">Receive Remaining Payment</h3></div><button type="button" onClick={()=>setPaymentOrder(null)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20}/></button></div><div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6"><div className="mb-4 rounded-2xl bg-emerald-50 py-3 sm:py-5 text-center">{(() => { const couponDisc = appliedCoupon ? Math.round(paymentOrder.remaining_balance * (appliedCoupon.percentage / 100) * 100) / 100 : 0; const manualNum = Math.max(0, Number(manualDiscount) || 0); const manualDisc = manualDiscountType === '%' ? Math.round(paymentOrder.remaining_balance * (manualNum / 100) * 100) / 100 : manualNum; const finalAmt = Math.max(0, paymentOrder.remaining_balance - couponDisc - manualDisc); return (<><p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Remaining Amount</p><p className={`mt-1 font-black text-emerald-800 ${(couponDisc > 0 || manualDisc > 0) ? 'text-xl line-through opacity-60' : 'text-3xl sm:text-4xl'}`}>{formatCurrency(paymentOrder.remaining_balance)}</p>{(couponDisc > 0 || manualDisc > 0) && (<><div className="mt-2 space-y-0.5 text-xs text-emerald-700">{couponDisc > 0 && <p>Coupon {appliedCoupon!.code} ({appliedCoupon!.percentage}%): -{formatCurrency(couponDisc)}</p>}{manualDisc > 0 && <p>Manual Discount: -{formatCurrency(manualDisc)}</p>}</div><p className="mt-2 text-2xl sm:text-3xl font-black text-emerald-950">You Pay: {formatCurrency(finalAmt)}</p></>)}</>)})()}</div><div className="space-y-3 sm:space-y-4"><Field label="Coupon Code (Optional)"><div className="flex gap-2">{appliedCoupon ? (<div className="flex flex-1 items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-black text-emerald-700"><span>{appliedCoupon.code} — {appliedCoupon.percentage}% OFF</span><button type="button" onClick={removeCoupon} className="ml-2 text-red-500 hover:text-red-700"><X size={14}/></button></div>) : (<><input list="adv-coupon-list" className={`${inputClass} flex-1`} value={couponInput} onChange={e=>{setCouponInput(e.target.value.toUpperCase());setCouponError('')}} placeholder="Enter code" /><datalist id="adv-coupon-list">{availableCoupons.map(c=><option key={c.code} value={c.code}/>)}</datalist><button type="button" onClick={applyCoupon} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-700">Apply</button></>)}</div>{couponError && <p className="mt-1 text-xs font-semibold text-red-600">{couponError}</p>}</Field><Field label="Manual Discount"><div className="flex gap-2 items-center"><select value={manualDiscountType} onChange={e=>setManualDiscountType(e.target.value as 'rm'|'%')} className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm font-black text-[#273126] outline-none focus:border-[var(--accent-dark)] focus:ring-2 focus:ring-emerald-100"><option value="rm">₹</option><option value="%">%</option></select><input type="number" min="0" step="0.01" className={`${inputClass} flex-1`} value={manualDiscount} onChange={e=>setManualDiscount(e.target.value)} placeholder="0" /></div></Field><Field label="Payment Method"><select className={inputClass} value={paymentForm.method} onChange={e=>setPaymentForm({...paymentForm,method:e.target.value as AdvancePaymentMethod})}><option value="cash">Cash</option><option value="upi">QR</option><option value="card">Card</option></select></Field><Field label="Payment Notes"><textarea className={inputClass} value={paymentForm.remarks} onChange={e=>setPaymentForm({...paymentForm,remarks:e.target.value})} rows={2} placeholder="Notes about this payment (optional)"/></Field><p className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">Confirmation marks the order Completed, creates one official invoice, and recognizes the full {formatCurrency(paymentOrder.total_amount)} as revenue.</p></div></div><div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3 sm:px-6"><button disabled={saving} className="w-full rounded-xl bg-emerald-600 py-3 sm:py-3.5 font-black text-white shadow-lg shadow-emerald-600/30 transition-transform active:scale-95 disabled:opacity-50">{saving?'Processing...':'Confirm Final Payment'}</button></div></form></div></ModalPortal>}

    {selected && <ModalPortal><div className="fixed inset-0 z-[997] flex justify-end bg-black/45"><div className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-black text-emerald-600">{selected.deposit_id}</p><h3 className="text-2xl font-black">Order Details</h3></div><div className="flex items-center gap-2"><button onClick={()=>void handleDeleteOrder(selected)} title="Delete Order" className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center transition-colors cursor-pointer"><Trash2 size={15}/></button><button onClick={()=>setSelected(null)}><X/></button></div></div><div className="mt-5 grid grid-cols-2 gap-3">{[['Customer',selected.customer_name],['Phone',selected.phone],['Address',selected.address||'-'],['Product',selected.product_name],['Category',selected.category||'-'],['Total',formatCurrency(selected.total_amount)],['Deposit Paid',formatCurrency(selected.deposit_amount)],['Remaining Balance',formatCurrency(selected.remaining_balance)],['Delivery Date',new Date(`${selected.expected_delivery_date}T00:00:00`).toLocaleDateString('en-IN')],['Created Date',new Date(selected.created_at).toLocaleDateString('en-IN')],['Created Time',new Date(selected.created_at).toLocaleTimeString('en-IN')],['Created By',selected.created_by_name||'-'],['Current Status',STATUS_LABELS[selected.status]],['Invoice Number',selected.invoice_number||'Not generated'],['Reference No',selected.reference_number||'—']].map(([k,v])=><div key={k} className="rounded-xl bg-[#F8F7F4] p-3"><p className="text-[10px] font-black uppercase text-[#858C83]">{k}</p><p className="mt-1 break-words text-sm font-bold">{v}</p></div>)}</div>{selected.remarks&&<div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="text-[10px] font-black uppercase text-emerald-500">Remarks</p><p className="mt-1 text-sm text-[#273126]">{selected.remarks}</p></div>}{selected.description&&<div className="mt-3 rounded-xl border p-3"><p className="text-[10px] font-black uppercase text-[#858C83]">Description</p><p className="text-sm">{selected.description}</p></div>}<div className="mt-6"><h4 className="font-black">Quick Timeline Updates</h4><div className="mt-2 flex flex-wrap gap-2">{[['tailoring_started','Order Prepared'],['tailoring_completed','Ready for Pickup'],['customer_contacted','Customer Contacted'],['delivered','Delivered']].map(([type,label])=><button key={type} onClick={()=>void addEvent(selected,type,label)} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-black text-emerald-700">+ {label}</button>)}</div></div><div className="mt-6"><h4 className="font-black">Payment History</h4><div className="mt-2 space-y-2">{payments.map(payment=><div key={payment.id} className="flex justify-between rounded-xl bg-emerald-50 p-3 text-sm"><span className="font-bold capitalize">{payment.payment_type} - {payment.payment_method}</span><span className="font-black">{formatCurrency(Number(payment.amount))}</span></div>)}</div></div><div className="mt-6"><h4 className="font-black">Order Timeline</h4><div className="mt-3 border-l-2 border-emerald-200 pl-4">{timeline.map(event=><div key={event.id} className="relative pb-5 before:absolute before:-left-[21px] before:top-1 before:h-3 before:w-3 before:rounded-full before:bg-emerald-600"><p className="text-sm font-black">{event.label}</p><p className="text-xs text-[#81887F]">{new Date(event.created_at).toLocaleString('en-IN')}</p>{event.remarks&&<p className="mt-1 text-xs">{event.remarks}</p>}</div>)}</div></div></div></div></ModalPortal>}
  </div>
}
