import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  CheckCircle2, Download, FileText, Hammer, MessageCircle, Plus, Printer, Receipt, RefreshCw, RotateCcw, Scale, Search, Trash2, Wallet, X, XCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errorMessage'
import { formatCurrency, formatInvoiceNo, formatPaymentMode, normalizeStructuredOrderItem, COUNTER_PAYMENT_METHODS } from '../lib/retail'
import { normalizePhone, toWhatsAppUrl, formatPhoneDisplay } from '../lib/phone'
import { csvDate, csvPhone, downloadCsv } from '../lib/csv'
import { calculateNetWeight, calculateOldGoldValue, formatWeight, GOLD_PURITIES, metalLabel, normalizeMetalType, readJewellerySnapshot, STANDARD_PURITY, suggestOldGoldRate } from '../lib/jewellery'
import { useMetalRateStore } from '../store/metalRateStore'
import { ModalPortal } from '../components/ModalPortal'
import { useAdminAuthStore, useSettingsStore } from '../store/store'
import { invoicePdfFile } from '../lib/invoicePdf'
import { printDeskReceipt } from '../lib/deskReceipt'
import { auditService } from '../services/auditService'
import { deleteDeskRecord, type DeskTable,
  advanceService, oldGoldService, quotationService, repairService, returnService, REPAIR_STATUS_LABELS,
  type CustomerAdvance, type OldGoldRecord, type Quotation, type Repair, type RepairStatus, type ReturnLine, type SalesReturn,
} from '../services/salesDeskService'

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-[#6B7280]">{label}</span>{children}</label> }
const inputClass = 'w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-sm text-[#273126] outline-none transition focus:border-[var(--accent-dark)] focus:ring-2 focus:ring-[var(--accent-a10)]'

type DeskTab = 'quotations' | 'returns' | 'old_gold' | 'advances' | 'repairs'
const TABS: Array<{ key: DeskTab; label: string; icon: typeof FileText }> = [
  { key: 'quotations', label: 'Quotations', icon: FileText },
  { key: 'returns', label: 'Returns & Exchanges', icon: RotateCcw },
  { key: 'old_gold', label: 'Old Gold Exchange', icon: Scale },
  { key: 'advances', label: 'Advances', icon: Wallet },
  { key: 'repairs', label: 'Repairs', icon: Hammer },
]

const fmtDate = (iso: string | null | undefined, withTime = false) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (isNaN(d.getTime())) return '—'
  return withTime
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const shopName = () => useSettingsStore.getState().settings?.name || 'our store'
const sendWhatsApp = (phone: string, text: string) => window.open(toWhatsAppUrl(phone, text), '_blank', 'noopener,noreferrer')

const TH = 'px-4 py-3.5 whitespace-nowrap'
const thead = (cols: string[]) => (
  <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
    <tr>{cols.map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
  </thead>
)
const emptyRow = (cols: number, text: string) => <tr><td colSpan={cols} className="px-4 py-12 text-center text-[#6B7280]">{text}</td></tr>
const iconBtn = 'w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0'

export default function SalesDesk({ onBillQuotation }: { onBillQuotation?: (quotation: Quotation) => void } = {}) {
  const role = useAdminAuthStore((s) => s.role)
  const isAdmin = role === 'admin'
  const [tab, setTab] = useState<DeskTab>('quotations')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [returns, setReturns] = useState<SalesReturn[]>([])
  const [oldGold, setOldGold] = useState<OldGoldRecord[]>([])
  const [advances, setAdvances] = useState<CustomerAdvance[]>([])
  const [repairs, setRepairs] = useState<Repair[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (tab === 'quotations') setQuotations(await quotationService.list())
      if (tab === 'returns') setReturns(await returnService.list())
      if (tab === 'old_gold') setOldGold(await oldGoldService.list())
      if (tab === 'advances') setAdvances(await advanceService.list())
      if (tab === 'repairs') setRepairs(await repairService.list())
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load'))
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setSearch(''); setNotice('') }, [tab])

  const q = search.trim().toLowerCase()
  const matches = (...vals: Array<string | null | undefined>) => !q || vals.some((v) => String(v || '').toLowerCase().includes(q))

  // ── Quotations ───────────────────────────────────────────────────────────
  const quotationPdf = (qt: Quotation) => {
    const file = invoicePdfFile({
      documentTitle: 'QUOTATION', invoiceNo: qt.quotationNumber, date: qt.createdAt, customerName: qt.customerName, phone: qt.phone,
      address: qt.validUntil ? `Valid until ${fmtDate(qt.validUntil)}` : '', items: qt.items, subtotal: qt.subtotal, shipping: 0,
      manualDiscountAmount: qt.discount, gstAmount: qt.gst, total: qt.total, paymentMode: 'Estimate',
    })
    const url = URL.createObjectURL(file)
    const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const quotationWhatsApp = (qt: Quotation) => {
    const lines = qt.items.map((raw) => {
      const it = normalizeStructuredOrderItem(raw)
      const j = it.jewellery
      return `• ${it.name} (x${it.quantity}) - ₹ ${it.line_total.toFixed(2)}${j ? `\n   ${metalLabel(j.metal_type, j.purity)}${j.net_weight ? ` · Net ${formatWeight(j.net_weight)}` : ''}${j.rate_per_gram ? ` @ ₹ ${j.rate_per_gram}/g` : ''}` : ''}`
    }).join('\n')
    sendWhatsApp(qt.phone, `💎 *Quotation — ${shopName()}*\n\nDear ${qt.customerName || 'Customer'},\n\n📌 *Quotation No:* ${qt.quotationNumber}\n📅 *Date:* ${fmtDate(qt.createdAt)}${qt.validUntil ? `\n⏳ *Valid until:* ${fmtDate(qt.validUntil)}` : ''}\n\n${lines}\n\n💰 *Estimated Total:* ₹ ${qt.total.toFixed(2)}\n\nPrices are at today's metal rate and may change with the rate. This is not an invoice.`)
  }
  // Admin only: permanently remove a record from one of the lists below.
  const deleteRecord = async (table: DeskTable, id: string, number: string, what: string, warning = '') => {
    if (!isAdmin) return
    if (!window.confirm(`Delete ${what} ${number}? This cannot be undone.${warning ? `\n\n${warning}` : ''}`)) return
    try {
      await deleteDeskRecord(table, id)
      void auditService.log({ action: 'record_deleted', entityType: table, entityId: number, note: what })
      const drop = <T extends { id: string }>(rows: T[]) => rows.filter((r) => r.id !== id)
      if (table === 'quotations') setQuotations(drop)
      if (table === 'sales_returns') setReturns(drop)
      if (table === 'old_gold_exchanges') setOldGold(drop)
      if (table === 'customer_advances') setAdvances(drop)
      if (table === 'repairs') setRepairs(drop)
      setNotice(`${number} deleted.`)
    } catch (err) { setError(getErrorMessage(err, 'Unable to delete')) }
  }
  const deleteBtn = (onClick: () => void) => (
    <button className={`${iconBtn} bg-red-50 text-red-600 hover:bg-red-100`} title="Delete" onClick={onClick}><Trash2 size={15} /></button>
  )

  const setQuotationStatus = async (qt: Quotation, status: Quotation['status']) => {
    try {
      await quotationService.setStatus(qt.id, status)
      setQuotations((rows) => rows.map((r) => (r.id === qt.id ? { ...r, status } : r)))
    } catch (err) { setError(getErrorMessage(err, 'Unable to update quotation')) }
  }

  // ── Returns & exchanges ──────────────────────────────────────────────────
  type ReturnOrder = { id: string; invoiceNo: string; customerName: string; phone: string; createdAt: string; total: number; items: ReturnType<typeof normalizeStructuredOrderItem>[] }
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnLookup, setReturnLookup] = useState('')
  const [returnOrders, setReturnOrders] = useState<ReturnOrder[]>([])
  const [returnOrder, setReturnOrder] = useState<ReturnOrder | null>(null)
  const [alreadyReturned, setAlreadyReturned] = useState<Record<number, number>>({})
  // Refunds already recorded on the chosen invoice (pending or approved); null until checked.
  const [alreadyRefunded, setAlreadyRefunded] = useState<number | null>(null)
  const [returnQty, setReturnQty] = useState<Record<number, string>>({})
  const [returnAmount, setReturnAmount] = useState('')
  const [returnType, setReturnType] = useState<'refund' | 'exchange'>('refund')
  const [returnMethod, setReturnMethod] = useState<string>('cash')
  const [returnReason, setReturnReason] = useState('')

  const openReturn = () => {
    setReturnOpen(true); setReturnLookup(''); setReturnOrders([]); setReturnOrder(null); setReturnQty({}); setReturnAmount('')
    setReturnType('refund'); setReturnMethod('cash'); setReturnReason(''); setModalError('')
  }
  const findInvoice = async () => {
    // Characters that would break the search filter are dropped.
    const raw = returnLookup.trim().replace(/[,()%*\\]/g, '')
    if (!raw) return
    setModalError('')
    const digits = raw.replace(/\D/g, '')
    const { data, error: qErr } = await supabase.from('orders')
      .select('id, invoice_no, customer_name, phone, created_at, items, status, total')
      .or(`invoice_no.ilike.%${raw}%${digits && digits !== raw ? `,invoice_no.ilike.%${digits}%` : ''}${digits.length >= 6 ? `,phone.ilike.%${digits}%` : ''}`)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(10)
    if (qErr) { setModalError(qErr.message); return }
    const found = (data || []).map((o) => ({
      id: String(o.id), invoiceNo: String(o.invoice_no), customerName: String(o.customer_name || ''), phone: String(o.phone || ''), createdAt: String(o.created_at), total: Number(o.total) || 0,
      items: (Array.isArray(o.items) ? o.items : []).map((it: Record<string, unknown>) => normalizeStructuredOrderItem(it)),
    }))
    setReturnOrders(found)
    if (!found.length) setModalError('No invoice found for that number or phone.')
    if (found.length === 1) void chooseReturnOrder(found[0])
  }
  const chooseReturnOrder = async (o: ReturnOrder) => {
    setReturnOrder(o)
    setReturnQty({})
    setAlreadyReturned({})
    setAlreadyRefunded(null)
    try {
      const prev = (await returnService.listForOrder(o.id)).filter((r) => r.status !== 'rejected')
      const counts: Record<number, number> = {}
      prev.forEach((r) => r.items.forEach((l) => { counts[l.line] = (counts[l.line] || 0) + Number(l.quantity || 0) }))
      setAlreadyReturned(counts)
      setAlreadyRefunded(prev.reduce((sum, r) => sum + r.refundAmount, 0))
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to check earlier returns'))
    }
  }
  const returnLines: ReturnLine[] = useMemo(() => {
    if (!returnOrder) return []
    return returnOrder.items.flatMap((it, idx) => {
      const qty = Number(returnQty[idx] || 0)
      if (!(qty > 0)) return []
      const unit = it.quantity > 0 ? it.line_total / it.quantity : it.line_total
      return [{
        line: idx, name: it.name, quantity: qty, soldQuantity: it.quantity, lineTotal: it.line_total,
        amount: Math.round(unit * qty * 100) / 100, product_id: it.product_id, variant_id: it.variant_id,
        is_manual: it.source === 'manual', jewellery: it.jewellery || null,
      }]
    })
  }, [returnOrder, returnQty])
  const defaultReturnAmount = returnLines.reduce((s, l) => s + l.amount, 0)

  const submitReturn = async (event: FormEvent) => {
    event.preventDefault()
    if (!returnOrder) return
    if (alreadyRefunded === null) { setModalError('Earlier returns on this invoice could not be checked. Choose the invoice again.'); return }
    if (!returnLines.length) { setModalError('Enter the quantity being returned for at least one item.'); return }
    for (const l of returnLines) {
      const left = l.soldQuantity - (alreadyReturned[l.line] || 0)
      if (l.quantity > left) { setModalError(`${l.name}: only ${left} left to return on this invoice.`); return }
    }
    const amount = returnAmount.trim() === ''
      ? Math.min(defaultReturnAmount, Math.max(0, Math.round((returnOrder.total - alreadyRefunded) * 100) / 100))
      : Number(returnAmount)
    if (!Number.isFinite(amount) || amount < 0) { setModalError('Enter a valid refund / exchange amount.'); return }
    // Never refund more than the customer paid on this invoice, less earlier returns.
    const refundable = Math.max(0, Math.round((returnOrder.total - alreadyRefunded) * 100) / 100)
    if (amount > refundable + 0.009) { setModalError(`The most that can be refunded on this invoice is ${formatCurrency(refundable)} (bill total ${formatCurrency(returnOrder.total)}${alreadyRefunded > 0 ? `, ${formatCurrency(alreadyRefunded)} already returned` : ''}).`); return }
    if (!returnReason.trim()) { setModalError('Enter the reason for the return.'); return }
    setSaving(true)
    setModalError('')
    try {
      let created = await returnService.create({
        orderId: returnOrder.id, invoiceNo: returnOrder.invoiceNo, customerName: returnOrder.customerName, phone: returnOrder.phone,
        items: returnLines, returnType, reason: returnReason, refundAmount: amount, refundMethod: returnMethod,
      })
      void auditService.log({ action: 'return_created', entityType: 'sales_return', entityId: created.returnNumber, newValue: { invoice: returnOrder.invoiceNo, type: returnType, amount }, note: returnReason })
      if (isAdmin) {
        created = await returnService.approve(created.id)
        void auditService.log({ action: 'return_approved', entityType: 'sales_return', entityId: created.returnNumber, newValue: { amount: created.refundAmount, type: created.returnType } })
      }
      setReturns((rows) => [created, ...rows])
      setReturnOpen(false)
      setNotice(isAdmin
        ? `${created.returnNumber} recorded and approved.${created.returnType === 'exchange' ? ` ${formatCurrency(created.refundAmount)} added as exchange credit — apply it on the new bill (Advances).` : ''}`
        : `${created.returnNumber} recorded. Waiting for admin approval.`)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to record the return'))
    } finally {
      setSaving(false)
    }
  }
  const decideReturn = async (r: SalesReturn, approve: boolean) => {
    if (!window.confirm(`${approve ? 'Approve' : 'Reject'} return ${r.returnNumber} for ${formatCurrency(r.refundAmount)}?`)) return
    try {
      const updated = approve ? await returnService.approve(r.id) : await returnService.reject(r.id)
      void auditService.log({ action: approve ? 'return_approved' : 'return_rejected', entityType: 'sales_return', entityId: r.returnNumber, newValue: { amount: r.refundAmount, type: r.returnType } })
      setReturns((rows) => rows.map((x) => (x.id === r.id ? updated : x)))
    } catch (err) { setError(getErrorMessage(err, 'Unable to update the return')) }
  }
  const printReturn = (r: SalesReturn) => printDeskReceipt({
    title: r.returnType === 'exchange' ? 'Exchange Slip' : 'Return Slip', number: r.returnNumber, date: fmtDate(r.createdAt, true),
    customerName: r.customerName, phone: r.phone,
    rows: [['Original Invoice', formatInvoiceNo(r.invoiceNo)], ...r.items.map((l): [string, string] => {
      const j = readJewellerySnapshot(l.jewellery)
      return [`${l.name} × ${l.quantity}`, `${formatCurrency(l.amount)}${j ? ` (${formatWeight(j.net_weight)} @ ${formatCurrency(j.rate_per_gram)}/g)` : ''}`]
    }), ['Reason', r.reason], ['Status', r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Pending approval']],
    totals: [[r.returnType === 'exchange' ? 'Exchange Credit' : `Refund (${formatPaymentMode(r.refundMethod)})`, formatCurrency(r.refundAmount)]],
    footer: 'The original invoice remains unchanged.',
  })

  // ── Old gold ─────────────────────────────────────────────────────────────
  // Billing = taken as part-payment on a bill (recorded from the Billing Panel).
  // Counter = bought here without a bill: paid out now, or kept as store credit (an advance).
  const rates = useMetalRateStore((s) => s.rates)
  const [ogFilter, setOgFilter] = useState<'all' | 'billing' | 'counter'>('all')
  const emptyOldGold = { phone: '', name: '', description: '', metalType: 'gold', purity: '22K', testedPurity: '', grossWeight: '', stoneWeight: '', meltingDeduction: '', exchangeRate: '', otherDeduction: '', settlement: 'paid' as 'paid' | 'credit', payoutMethod: 'cash' }
  const [ogOpen, setOgOpen] = useState(false)
  const [ogForm, setOgForm] = useState(emptyOldGold)
  const ogSuggestedRate = suggestOldGoldRate(ogForm.metalType, ogForm.purity, Number(ogForm.testedPurity), rates)
  const ogNet = calculateNetWeight(Number(ogForm.grossWeight) || 0, Number(ogForm.stoneWeight) || 0)
  const ogRate = ogForm.exchangeRate.trim() === '' ? ogSuggestedRate : Number(ogForm.exchangeRate) || 0
  const ogPreview = calculateOldGoldValue({ netWeight: ogNet, meltingDeductionPercent: Number(ogForm.meltingDeduction) || 0, exchangeRate: ogRate, otherDeduction: Number(ogForm.otherDeduction) || 0 })
  const ogSourceCounts = { all: oldGold.length, billing: oldGold.filter((x) => x.source === 'billing').length, counter: oldGold.filter((x) => x.source === 'counter').length }
  const visibleOldGold = oldGold.filter((x) => (ogFilter === 'all' || x.source === ogFilter) && matches(x.exchangeNumber, x.invoiceNo, x.customerName, x.phone))

  const printOldGold = (x: OldGoldRecord, creditReceipt?: string) => printDeskReceipt({
    title: x.source === 'counter' ? 'Old Gold Purchase' : 'Old Gold Exchange', number: x.exchangeNumber, date: fmtDate(x.createdAt, true),
    customerName: x.customerName, phone: x.phone,
    rows: [
      ...(x.invoiceNo ? [['Against Invoice', formatInvoiceNo(x.invoiceNo)] as [string, string]] : []),
      ['Metal', `${metalLabel(normalizeMetalType(x.metalType), x.purity)}${x.testedPurity != null ? ` (tested ${x.testedPurity}%)` : ''}`],
      ...(x.description ? [['Item', x.description] as [string, string]] : []),
      ['Gross / Stone', `${formatWeight(x.grossWeight)} / ${formatWeight(x.stoneWeight)}`], ['Net Weight', formatWeight(x.netWeight)],
      ['Melting Loss', `${x.meltingDeductionPercent}%`], ['Rate', `${formatCurrency(x.exchangeRate)}/g`],
      ...(x.otherDeduction ? [['Other Deduction', formatCurrency(x.otherDeduction)] as [string, string]] : []),
    ],
    totals: [[x.source === 'billing' ? 'Adjusted on bill' : x.settlement === 'credit' ? `Store credit${creditReceipt ? ` (${creditReceipt})` : ''}` : `Paid (${formatPaymentMode(x.payoutMethod)})`, formatCurrency(x.netValue)]],
    footer: x.source === 'billing' ? 'Value adjusted against the invoice above.' : x.settlement === 'credit' ? 'Credit is adjusted against your next purchase.' : 'Old gold purchased by the store.',
  })
  const submitOldGold = async (event: FormEvent) => {
    event.preventDefault()
    const phone = normalizePhone(ogForm.phone)
    if (!phone) { setModalError('Enter a valid mobile number.'); return }
    if (ogNet <= 0) { setModalError('Enter the old gold weight.'); return }
    if (ogRate <= 0) { setModalError('Enter the exchange rate (no metal rate set for today).'); return }
    if (ogPreview.value <= 0) { setModalError('The old gold value must be more than zero.'); return }
    setSaving(true)
    setModalError('')
    try {
      const { exchange, advance } = await oldGoldService.recordCounter({
        description: ogForm.description.trim(), metalType: ogForm.metalType, purity: ogForm.metalType === 'gold' ? ogForm.purity : STANDARD_PURITY,
        testedPurity: ogForm.testedPurity.trim() === '' ? null : Number(ogForm.testedPurity),
        grossWeight: Number(ogForm.grossWeight) || 0, stoneWeight: Number(ogForm.stoneWeight) || 0,
        meltingDeductionPercent: Number(ogForm.meltingDeduction) || 0, exchangeRate: ogRate, otherDeduction: Number(ogForm.otherDeduction) || 0,
      }, { customerName: ogForm.name, phone }, ogForm.settlement, ogForm.payoutMethod)
      void auditService.log({ action: 'old_gold_purchased', entityType: 'old_gold_exchange', entityId: exchange.exchangeNumber, newValue: { value: exchange.netValue, settlement: exchange.settlement, credit: advance?.receiptNumber } })
      setOldGold((rows) => [exchange, ...rows])
      setOgOpen(false)
      setNotice(advance
        ? `${exchange.exchangeNumber} recorded. ${formatCurrency(exchange.netValue)} added as store credit ${advance.receiptNumber} — apply it on the customer's next bill (Advances).`
        : `${exchange.exchangeNumber} recorded. Pay the customer ${formatCurrency(exchange.netValue)} by ${formatPaymentMode(exchange.payoutMethod)}.`)
      printOldGold(exchange, advance?.receiptNumber)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to record the old gold purchase'))
    } finally {
      setSaving(false)
    }
  }

  // ── Advances ─────────────────────────────────────────────────────────────
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [advanceForm, setAdvanceForm] = useState({ phone: '', name: '', amount: '', method: 'cash', purpose: '', notes: '' })
  const [advanceCreated, setAdvanceCreated] = useState<CustomerAdvance | null>(null)
  const submitAdvance = async (event: FormEvent) => {
    event.preventDefault()
    const phone = normalizePhone(advanceForm.phone)
    const amount = Number(advanceForm.amount)
    if (!phone) { setModalError('Enter a valid mobile number.'); return }
    if (!Number.isFinite(amount) || amount <= 0) { setModalError('Enter the advance amount.'); return }
    setSaving(true)
    setModalError('')
    try {
      const created = await advanceService.create({ customerName: advanceForm.name, phone, amount, paymentMethod: advanceForm.method, purpose: advanceForm.purpose, notes: advanceForm.notes })
      setAdvances((rows) => [created, ...rows])
      setAdvanceOpen(false)
      setAdvanceCreated(created)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to save the advance'))
    } finally {
      setSaving(false)
    }
  }
  const printAdvance = (a: CustomerAdvance) => printDeskReceipt({
    title: a.source === 'exchange' ? 'Exchange Credit' : a.source === 'old_gold' ? 'Old Gold Credit' : 'Advance Receipt', number: a.receiptNumber, date: fmtDate(a.createdAt, true),
    customerName: a.customerName, phone: a.phone,
    rows: [['Purpose', a.purpose || '—'], ['Payment', formatPaymentMode(a.paymentMethod)], ['Used on bills', formatCurrency(a.amountUsed)]],
    totals: [['Amount', formatCurrency(a.amount)], ['Balance', formatCurrency(a.balance)]],
    footer: 'Adjusted against your next purchase. Not a tax invoice.',
  })
  const whatsappAdvance = (a: CustomerAdvance) => sendWhatsApp(a.phone,
    `💰 *Advance Received — ${shopName()}*\n\nDear ${a.customerName || 'Customer'},\n\n🧾 *Receipt No:* ${a.receiptNumber}\n💵 *Amount:* ₹ ${a.amount.toFixed(2)} (${formatPaymentMode(a.paymentMethod)})\n${a.purpose ? `📌 *Purpose:* ${a.purpose}\n` : ''}📊 *Balance available:* ₹ ${a.balance.toFixed(2)}\n\nThis amount will be adjusted against your purchase. Thank you!`)
  const cancelAdvance = async (a: CustomerAdvance) => {
    const reason = window.prompt(`Cancel advance ${a.receiptNumber} (${formatCurrency(a.amount)})? Enter the reason (e.g. refunded to customer):`)
    if (!reason) return
    try {
      const updated = await advanceService.cancel(a.id, reason)
      void auditService.log({ action: 'advance_cancelled', entityType: 'customer_advance', entityId: a.receiptNumber, oldValue: { amount: a.amount }, note: reason })
      setAdvances((rows) => rows.map((x) => (x.id === a.id ? updated : x)))
    } catch (err) { setError(getErrorMessage(err, 'Unable to cancel the advance')) }
  }

  // ── Repairs ──────────────────────────────────────────────────────────────
  const emptyRepair = { phone: '', name: '', itemName: '', description: '', metalType: 'gold', weight: '', expectedDate: '', charge: '', advance: '', notes: '', assignedTo: '', invoiceNo: '' }
  const [repairOpen, setRepairOpen] = useState(false)
  const [repairForm, setRepairForm] = useState(emptyRepair)
  const [repairEdit, setRepairEdit] = useState<Repair | null>(null)
  const [repairEditForm, setRepairEditForm] = useState({ charge: '', advance: '', expectedDate: '', assignedTo: '' })
  const submitRepair = async (event: FormEvent) => {
    event.preventDefault()
    const phone = normalizePhone(repairForm.phone)
    if (!phone) { setModalError('Enter a valid mobile number.'); return }
    if (!repairForm.itemName.trim()) { setModalError('Enter the item being repaired.'); return }
    const charge = Number(repairForm.charge) || 0
    const advance = Number(repairForm.advance) || 0
    if (charge < 0 || advance < 0) { setModalError('Amounts cannot be negative.'); return }
    setSaving(true)
    setModalError('')
    try {
      const created = await repairService.create({
        customerName: repairForm.name, phone, itemName: repairForm.itemName, description: repairForm.description, metalType: repairForm.metalType,
        weight: Number(repairForm.weight) || 0, expectedDate: repairForm.expectedDate || null, repairCharge: charge, advancePaid: advance, notes: repairForm.notes,
        assignedTo: repairForm.assignedTo, invoiceNo: repairForm.invoiceNo,
      })
      setRepairs((rows) => [created, ...rows])
      setRepairOpen(false)
      setNotice(`${created.repairNumber} received for ${created.customerName || created.phone}.`)
      printRepair(created)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to save the repair'))
    } finally {
      setSaving(false)
    }
  }
  const updateRepair = async (r: Repair, patch: Parameters<typeof repairService.update>[1]) => {
    try {
      const updated = await repairService.update(r.id, patch)
      setRepairs((rows) => rows.map((x) => (x.id === r.id ? updated : x)))
      return updated
    } catch (err) { setError(getErrorMessage(err, 'Unable to update the repair')); return null }
  }
  const submitRepairEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!repairEdit) return
    const updated = await updateRepair(repairEdit, {
      repairCharge: Math.max(0, Number(repairEditForm.charge) || 0), advancePaid: Math.max(0, Number(repairEditForm.advance) || 0),
      expectedDate: repairEditForm.expectedDate || null, assignedTo: repairEditForm.assignedTo,
    })
    if (updated) setRepairEdit(null)
  }
  const printRepair = (r: Repair) => printDeskReceipt({
    title: 'Repair Receipt', number: r.repairNumber, date: fmtDate(r.receivedDate), customerName: r.customerName, phone: r.phone,
    rows: [['Item', r.itemName], ...(r.weight ? [['Weight', formatWeight(r.weight)] as [string, string]] : []), ['Work', r.description || '—'],
      ...(r.invoiceNo ? [['Bought on', formatInvoiceNo(r.invoiceNo)] as [string, string]] : []),
      ['Expected', fmtDate(r.expectedDate)], ['Status', REPAIR_STATUS_LABELS[r.status]]],
    totals: [['Repair Charge', formatCurrency(r.repairCharge)], ['Advance', formatCurrency(r.advancePaid)], ['Balance', formatCurrency(r.balance)]],
    footer: 'Please bring this receipt when collecting your item.',
  })
  const whatsappRepair = (r: Repair) => sendWhatsApp(r.phone, r.status === 'ready'
    ? `✅ *Repair Ready — ${shopName()}*\n\nDear ${r.customerName || 'Customer'}, your ${r.itemName} (${r.repairNumber}) is ready for collection.\n💰 *Balance to pay:* ₹ ${r.balance.toFixed(2)}\n\nThank you!`
    : `🔧 *Repair Received — ${shopName()}*\n\nDear ${r.customerName || 'Customer'},\n\n🧾 *Repair No:* ${r.repairNumber}\n💍 *Item:* ${r.itemName}${r.weight ? ` (${formatWeight(r.weight)})` : ''}\n📅 *Expected:* ${fmtDate(r.expectedDate)}\n💰 *Charge:* ₹ ${r.repairCharge.toFixed(2)} · Advance ₹ ${r.advancePaid.toFixed(2)} · Balance ₹ ${r.balance.toFixed(2)}\n\nWe will message you when it is ready.`)

  // ── Export ───────────────────────────────────────────────────────────────
  const exportCsv = () => {
    const d = new Date().toISOString().slice(0, 10)
    if (tab === 'quotations') downloadCsv(`quotations_${d}.csv`, [['No', 'Date', 'Customer', 'Phone', 'Items', 'Total (INR)', 'Valid Until', 'Status'],
      ...quotations.map((x) => [x.quotationNumber, csvDate(x.createdAt), x.customerName, csvPhone(x.phone), x.items.length, x.total.toFixed(2), csvDate(x.validUntil), x.status])])
    if (tab === 'returns') downloadCsv(`returns_${d}.csv`, [['No', 'Date', 'Invoice', 'Customer', 'Type', 'Amount (INR)', 'Reason', 'Status', 'By', 'Approved By'],
      ...returns.map((x) => [x.returnNumber, csvDate(x.createdAt, true), formatInvoiceNo(x.invoiceNo), x.customerName, x.returnType, x.refundAmount.toFixed(2), x.reason, x.status, x.createdBy, x.approvedBy])])
    if (tab === 'old_gold') downloadCsv(`old_gold_${d}.csv`, [['No', 'Date', 'Source', 'Settlement', 'Invoice', 'Customer', 'Metal', 'Purity', 'Tested %', 'Gross (g)', 'Stone (g)', 'Net (g)', 'Melting %', 'Rate / g', 'Deduction', 'Value (INR)'],
      ...visibleOldGold.map((x) => [x.exchangeNumber, csvDate(x.createdAt, true), x.source === 'billing' ? 'Billing exchange' : 'Counter purchase',
        x.source === 'billing' ? 'On bill' : x.settlement === 'credit' ? 'Store credit' : `Paid ${formatPaymentMode(x.payoutMethod)}`, x.invoiceNo ? formatInvoiceNo(x.invoiceNo) : '', x.customerName, x.metalType, x.purity, x.testedPurity ?? '', x.grossWeight, x.stoneWeight, x.netWeight, x.meltingDeductionPercent, x.exchangeRate, x.otherDeduction, x.netValue.toFixed(2)])])
    if (tab === 'advances') downloadCsv(`advances_${d}.csv`, [['Receipt', 'Date', 'Customer', 'Phone', 'Amount', 'Used', 'Balance', 'Method', 'Purpose', 'Status'],
      ...advances.map((x) => [x.receiptNumber, csvDate(x.createdAt), x.customerName, csvPhone(x.phone), x.amount.toFixed(2), x.amountUsed.toFixed(2), x.balance.toFixed(2), formatPaymentMode(x.paymentMethod), x.purpose, x.status])])
    if (tab === 'repairs') downloadCsv(`repairs_${d}.csv`, [['No', 'Received', 'Customer', 'Phone', 'Item', 'Original Invoice', 'Assigned To', 'Expected', 'Charge', 'Advance', 'Balance', 'Status'],
      ...repairs.map((x) => [x.repairNumber, csvDate(x.receivedDate), x.customerName, csvPhone(x.phone), x.itemName, x.invoiceNo ? formatInvoiceNo(x.invoiceNo) : '', x.assignedTo, csvDate(x.expectedDate), x.repairCharge.toFixed(2), x.advancePaid.toFixed(2), x.balance.toFixed(2), REPAIR_STATUS_LABELS[x.status]])])
  }

  const statusChip = (text: string, tone: 'green' | 'amber' | 'red' | 'gray' | 'blue') => {
    const cls = { green: 'bg-emerald-50 text-emerald-700 border-emerald-200', amber: 'bg-amber-50 text-amber-800 border-amber-200', red: 'bg-red-50 text-red-700 border-red-200', gray: 'bg-gray-100 text-gray-600 border-gray-200', blue: 'bg-blue-50 text-blue-700 border-blue-200' }[tone]
    return <span className={`inline-block rounded-xl border px-2.5 py-1 text-xs font-black ${cls}`}>{text}</span>
  }

  const newButton = tab === 'returns' ? { label: 'New Return / Exchange', onClick: openReturn }
    : tab === 'advances' ? { label: 'New Advance', onClick: () => { setAdvanceForm({ phone: '', name: '', amount: '', method: 'cash', purpose: '', notes: '' }); setModalError(''); setAdvanceOpen(true) } }
      : tab === 'old_gold' ? { label: 'New Old Gold Purchase', onClick: () => { setOgForm(emptyOldGold); setModalError(''); setOgOpen(true) } }
      : tab === 'repairs' ? { label: 'New Repair', onClick: () => { setRepairForm(emptyRepair); setModalError(''); setRepairOpen(true) } }
        : null

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[.18em] text-[var(--accent-dark)]">Counter services</p>
        <h2 className="text-2xl font-black text-[#273126]">Sales Desk</h2>
        <p className="mt-1 text-sm text-[#6B7280]">Quotations, returns and exchanges, old gold, customer advances and repairs. Original invoices are never changed.</p>
      </div>
      <div className="flex gap-2">
        {newButton && (
          <button onClick={newButton.onClick} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-black text-white hover:opacity-90 cursor-pointer">
            <Plus size={16} /> {newButton.label}
          </button>
        )}
        <button onClick={() => void load()} className="rounded-xl border bg-white p-3 text-[#647064] cursor-pointer" title="Refresh">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>

    <div className="flex gap-2 border-b border-[#E5E7EB] overflow-x-auto hide-scrollbar">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => setTab(key)}
          className={`flex items-center gap-1.5 px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${tab === key ? 'text-[var(--accent-dark)] border-b-2 border-[var(--accent-dark)]' : 'text-[#6B7280] hover:text-[#111111]'}`}>
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

    <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="relative"><Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17} /><input className={`${inputClass} pl-10`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, customer, phone or invoice" /></label>
        <button onClick={exportCsv} className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-200 cursor-pointer">
          <Download size={13} /> Export CSV
        </button>
      </div>
      {tab === 'quotations' && <p className="mt-2 text-[11px] font-semibold text-[#6B7280]">Create a quotation from the Billing Panel with "Save as Quotation". It uses today's metal rate and is not an invoice. Use the bill button to load it into the Billing Panel: quoted prices are kept until it expires.</p>}
      {tab === 'old_gold' && <>
        <div className="mt-3 flex flex-wrap gap-2">
          {([['all', 'All'], ['billing', 'Billing exchange'], ['counter', 'Counter purchase']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setOgFilter(key)}
              className={`rounded-xl px-3 py-1.5 text-xs font-black transition-colors cursor-pointer ${ogFilter === key ? 'bg-[var(--accent-dark)] text-white' : 'bg-[#F3F2EE] text-[#6B7280] hover:text-[#111111]'}`}>
              {label} <span className="opacity-70">({ogSourceCounts[key]})</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] font-semibold text-[#6B7280]"><b>Billing exchange</b>: old gold taken as part-payment in the Billing Panel, linked to that invoice. <b>Counter purchase</b>: old gold bought here without a bill, paid to the customer or kept as store credit.</p>
      </>}
      {tab === 'returns' && !isAdmin && <p className="mt-2 text-[11px] font-semibold text-[#6B7280]">Returns recorded by staff wait for admin approval before stock and refunds are updated.</p>}
    </div>

    <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm flex flex-col">
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-left text-sm whitespace-nowrap">
          {tab === 'quotations' && <>
            {thead(['Quotation', 'Customer', 'Items', 'Total', 'Valid Until', 'Status', 'Actions'])}
            <tbody className="divide-y divide-[#F0EEE9]">
              {loading ? emptyRow(7, 'Loading…') : quotations.filter((x) => matches(x.quotationNumber, x.customerName, x.phone)).length === 0 ? emptyRow(7, 'No quotations yet.')
                : quotations.filter((x) => matches(x.quotationNumber, x.customerName, x.phone)).map((x) => (
                  <tr key={x.id} className="hover:bg-[var(--accent-a5)] transition-colors">
                    <td className="px-4 py-3.5"><p className="font-black text-[var(--accent-dark)]">{x.quotationNumber}</p><p className="text-[11px] text-[#8B9389]">{fmtDate(x.createdAt, true)} • {x.createdBy}</p></td>
                    <td className="px-4 py-3.5"><p className="font-bold text-[#273126]">{x.customerName || '—'}</p><p className="text-xs text-[#727970]">{x.phone}</p></td>
                    <td className="px-4 py-3.5 text-xs">{x.items.slice(0, 2).map((raw, i) => <p key={i}>{normalizeStructuredOrderItem(raw).name}</p>)}{x.items.length > 2 && <p className="text-[#858C83]">+{x.items.length - 2} more</p>}</td>
                    <td className="px-4 py-3.5 font-black">{formatCurrency(x.total)}</td>
                    <td className="px-4 py-3.5 text-xs">{fmtDate(x.validUntil)}</td>
                    <td className="px-4 py-3.5">{statusChip(x.status === 'open' ? 'Open' : x.status === 'converted' ? 'Billed' : 'Cancelled', x.status === 'open' ? 'blue' : x.status === 'converted' ? 'green' : 'gray')}</td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">
                      <button className={`${iconBtn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} title="Download PDF" onClick={() => quotationPdf(x)}><Download size={15} /></button>
                      {x.phone && <button className={`${iconBtn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} title="Send on WhatsApp" onClick={() => quotationWhatsApp(x)}><MessageCircle size={15} /></button>}
                      {x.status === 'open' && onBillQuotation && <button className={`${iconBtn} bg-[#0A0A0A] text-[var(--accent)] hover:bg-[#1A1A1A]`} title={x.validUntil && x.validUntil < new Date().toISOString().slice(0, 10) ? 'Bill now (expired: priced at today\'s rate)' : 'Bill now at the quoted prices'} onClick={() => onBillQuotation(x)}><Receipt size={15} /></button>}
                      {x.status === 'open' && <button className={`${iconBtn} bg-[var(--accent-a10)] text-[var(--accent-dark)] hover:bg-[var(--accent-a20)]`} title="Mark as billed" onClick={() => void setQuotationStatus(x, 'converted')}><CheckCircle2 size={15} /></button>}
                      {x.status === 'open' && <button className={`${iconBtn} bg-red-50 text-red-600 hover:bg-red-100`} title="Cancel quotation" onClick={() => void setQuotationStatus(x, 'cancelled')}><XCircle size={15} /></button>}
                      {isAdmin && deleteBtn(() => void deleteRecord('quotations', x.id, x.quotationNumber, 'quotation'))}
                    </div></td>
                  </tr>
                ))}
            </tbody>
          </>}

          {tab === 'returns' && <>
            {thead(['Return', 'Invoice / Customer', 'Items', 'Type', 'Amount', 'Status', 'Actions'])}
            <tbody className="divide-y divide-[#F0EEE9]">
              {loading ? emptyRow(7, 'Loading…') : returns.filter((x) => matches(x.returnNumber, x.invoiceNo, x.customerName, x.phone)).length === 0 ? emptyRow(7, 'No returns or exchanges yet.')
                : returns.filter((x) => matches(x.returnNumber, x.invoiceNo, x.customerName, x.phone)).map((x) => (
                  <tr key={x.id} className="hover:bg-[var(--accent-a5)] transition-colors">
                    <td className="px-4 py-3.5"><p className="font-black text-[var(--accent-dark)]">{x.returnNumber}</p><p className="text-[11px] text-[#8B9389]">{fmtDate(x.createdAt, true)} • {x.createdBy}</p></td>
                    <td className="px-4 py-3.5"><p className="font-bold text-[#273126]">{formatInvoiceNo(x.invoiceNo)}</p><p className="text-xs text-[#727970]">{x.customerName} {x.phone && `• ${x.phone}`}</p></td>
                    <td className="px-4 py-3.5 text-xs">{x.items.map((l, i) => <p key={i}>{l.name} × {l.quantity}</p>)}<p className="text-[#858C83] whitespace-normal max-w-[220px]">{x.reason}</p></td>
                    <td className="px-4 py-3.5 text-xs font-bold">{x.returnType === 'exchange' ? 'Exchange (credit)' : `Refund · ${formatPaymentMode(x.refundMethod)}`}</td>
                    <td className="px-4 py-3.5 font-black">{formatCurrency(x.refundAmount)}</td>
                    <td className="px-4 py-3.5">{statusChip(x.status === 'approved' ? 'Approved' : x.status === 'rejected' ? 'Rejected' : 'Pending approval', x.status === 'approved' ? 'green' : x.status === 'rejected' ? 'gray' : 'amber')}{x.approvedBy && <p className="mt-1 text-[10px] text-[#858C83]">by {x.approvedBy}</p>}</td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">
                      <button className={`${iconBtn} bg-amber-50 text-amber-700 hover:bg-amber-100`} title="Print slip" onClick={() => printReturn(x)}><Printer size={15} /></button>
                      {isAdmin && x.status === 'pending' && <>
                        <button className={`${iconBtn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} title="Approve" onClick={() => void decideReturn(x, true)}><CheckCircle2 size={15} /></button>
                        <button className={`${iconBtn} bg-red-50 text-red-600 hover:bg-red-100`} title="Reject" onClick={() => void decideReturn(x, false)}><XCircle size={15} /></button>
                      </>}
                      {isAdmin && x.status !== 'approved' && deleteBtn(() => void deleteRecord('sales_returns', x.id, x.returnNumber, 'return'))}
                    </div></td>
                  </tr>
                ))}
            </tbody>
          </>}

          {tab === 'old_gold' && <>
            {thead(['Exchange', 'Source', 'Customer', 'Metal', 'Weight', 'Rate', 'Deductions', 'Value', 'Actions'])}
            <tbody className="divide-y divide-[#F0EEE9]">
              {loading ? emptyRow(9, 'Loading…') : visibleOldGold.length === 0 ? emptyRow(9, ogFilter === 'counter' ? 'No counter purchases yet.' : ogFilter === 'billing' ? 'No old gold taken on bills yet.' : 'No old gold taken yet.')
                : visibleOldGold.map((x) => (
                  <tr key={x.id} className="hover:bg-[var(--accent-a5)] transition-colors">
                    <td className="px-4 py-3.5"><p className="font-black text-[var(--accent-dark)]">{x.exchangeNumber}</p><p className="text-[11px] text-[#8B9389]">{fmtDate(x.createdAt, true)} • {x.createdBy}</p></td>
                    <td className="px-4 py-3.5">{x.source === 'billing'
                      ? <>{statusChip('Billing exchange', 'blue')}<p className="mt-1 text-[11px] font-bold text-[#273126]">{x.invoiceNo ? formatInvoiceNo(x.invoiceNo) : '—'}</p></>
                      : <>{statusChip('Counter purchase', 'amber')}<p className="mt-1 text-[11px] font-bold text-[#273126]">{x.settlement === 'credit' ? 'Store credit' : x.settlement === 'paid' ? `Paid · ${formatPaymentMode(x.payoutMethod)}` : '—'}</p></>}</td>
                    <td className="px-4 py-3.5"><p className="font-bold text-[#273126]">{x.customerName || '—'}</p><p className="text-xs text-[#727970]">{x.phone}</p></td>
                    <td className="px-4 py-3.5 text-xs"><p className="font-bold">{metalLabel(normalizeMetalType(x.metalType), x.purity)}</p>{x.testedPurity != null && <p className="text-[#858C83]">Tested {x.testedPurity}%</p>}{x.description && <p className="text-[#858C83]">{x.description}</p>}</td>
                    <td className="px-4 py-3.5 text-xs">Gross {formatWeight(x.grossWeight)}<br />Stone {formatWeight(x.stoneWeight)}<br /><b>Net {formatWeight(x.netWeight)}</b></td>
                    <td className="px-4 py-3.5 text-xs">{formatCurrency(x.exchangeRate)}/g</td>
                    <td className="px-4 py-3.5 text-xs">Melting {x.meltingDeductionPercent}%<br />Other {formatCurrency(x.otherDeduction)}</td>
                    <td className="px-4 py-3.5 font-black">{formatCurrency(x.netValue)}</td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">
                      <button className={`${iconBtn} bg-amber-50 text-amber-700 hover:bg-amber-100`} title="Print slip" onClick={() => printOldGold(x)}><Printer size={15} /></button>
                      {isAdmin && (x.source === 'billing'
                        ? <span className="text-[10px] font-semibold text-[#8B9389]" title="Part-payment on a bill: delete the bill to remove it">On bill</span>
                        : deleteBtn(() => void deleteRecord('old_gold_exchanges', x.id, x.exchangeNumber, 'old gold purchase', x.settlement === 'credit' ? 'Its store credit is removed too (not allowed once the credit is used on a bill).' : '')))}
                    </div></td>
                  </tr>
                ))}
            </tbody>
          </>}

          {tab === 'advances' && <>
            {thead(['Receipt', 'Customer', 'Purpose', 'Amount', 'Used / Balance', 'Status', 'Actions'])}
            <tbody className="divide-y divide-[#F0EEE9]">
              {loading ? emptyRow(7, 'Loading…') : advances.filter((x) => matches(x.receiptNumber, x.customerName, x.phone, x.purpose)).length === 0 ? emptyRow(7, 'No advances yet.')
                : advances.filter((x) => matches(x.receiptNumber, x.customerName, x.phone, x.purpose)).map((x) => (
                  <tr key={x.id} className="hover:bg-[var(--accent-a5)] transition-colors">
                    <td className="px-4 py-3.5"><p className="font-black text-[var(--accent-dark)]">{x.receiptNumber}</p><p className="text-[11px] text-[#8B9389]">{fmtDate(x.createdAt, true)} • {x.createdBy}</p></td>
                    <td className="px-4 py-3.5"><p className="font-bold text-[#273126]">{x.customerName || '—'}</p><p className="text-xs text-[#727970]">{x.phone}</p></td>
                    <td className="px-4 py-3.5 text-xs whitespace-normal max-w-[220px]">{x.purpose || '—'}{x.source === 'exchange' && <p className="text-[#858C83]">From return {x.sourceRef}</p>}{x.source === 'old_gold' && <p className="text-[#858C83]">From old gold {x.sourceRef}</p>}</td>
                    <td className="px-4 py-3.5 font-black">{formatCurrency(x.amount)}<p className="text-[11px] font-semibold text-[#858C83]">{formatPaymentMode(x.paymentMethod)}</p></td>
                    <td className="px-4 py-3.5 text-xs"><p>Used {formatCurrency(x.amountUsed)}</p><p className="font-black text-emerald-700">Balance {formatCurrency(x.balance)}</p></td>
                    <td className="px-4 py-3.5">{statusChip(x.status === 'active' ? 'Available' : x.status === 'used' ? 'Fully used' : 'Cancelled', x.status === 'active' ? 'green' : 'gray')}</td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">
                      <button className={`${iconBtn} bg-amber-50 text-amber-700 hover:bg-amber-100`} title="Print receipt" onClick={() => printAdvance(x)}><Printer size={15} /></button>
                      <button className={`${iconBtn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} title="Send on WhatsApp" onClick={() => whatsappAdvance(x)}><MessageCircle size={15} /></button>
                      {isAdmin && x.status === 'active' && x.amountUsed === 0 && <button className={`${iconBtn} bg-red-50 text-red-600 hover:bg-red-100`} title="Cancel / refund advance" onClick={() => void cancelAdvance(x)}><XCircle size={15} /></button>}
                      {isAdmin && x.amountUsed === 0 && x.source !== 'old_gold' && deleteBtn(() => void deleteRecord('customer_advances', x.id, x.receiptNumber, 'advance', x.status === 'active' ? 'Only delete an advance entered by mistake. To give money back, use Cancel / refund instead.' : ''))}
                    </div></td>
                  </tr>
                ))}
            </tbody>
          </>}

          {tab === 'repairs' && <>
            {thead(['Repair', 'Customer', 'Item', 'Expected', 'Charge / Balance', 'Status', 'Actions'])}
            <tbody className="divide-y divide-[#F0EEE9]">
              {loading ? emptyRow(7, 'Loading…') : repairs.filter((x) => matches(x.repairNumber, x.customerName, x.phone, x.itemName, x.invoiceNo, x.assignedTo)).length === 0 ? emptyRow(7, 'No repairs yet.')
                : repairs.filter((x) => matches(x.repairNumber, x.customerName, x.phone, x.itemName, x.invoiceNo, x.assignedTo)).map((x) => (
                  <tr key={x.id} className="hover:bg-[var(--accent-a5)] transition-colors">
                    <td className="px-4 py-3.5"><p className="font-black text-[var(--accent-dark)]">{x.repairNumber}</p><p className="text-[11px] text-[#8B9389]">Received {fmtDate(x.receivedDate)}</p></td>
                    <td className="px-4 py-3.5"><p className="font-bold text-[#273126]">{x.customerName || '—'}</p><p className="text-xs text-[#727970]">{x.phone}</p></td>
                    <td className="px-4 py-3.5 text-xs whitespace-normal max-w-[220px]"><p className="font-bold">{x.itemName}{x.weight ? ` • ${formatWeight(x.weight)}` : ''}</p><p className="text-[#858C83]">{x.description}</p>{(x.assignedTo || x.invoiceNo) && <p className="text-[11px] text-[#858C83]">{x.assignedTo && `With ${x.assignedTo}`}{x.assignedTo && x.invoiceNo && ' • '}{x.invoiceNo && `Bill ${formatInvoiceNo(x.invoiceNo)}`}</p>}</td>
                    <td className={`px-4 py-3.5 text-xs ${x.expectedDate && x.expectedDate < new Date().toISOString().slice(0, 10) && x.status !== 'delivered' ? 'font-black text-red-600' : ''}`}>{fmtDate(x.expectedDate)}</td>
                    <td className="px-4 py-3.5 text-xs"><p>{formatCurrency(x.repairCharge)} • Adv {formatCurrency(x.advancePaid)}</p><p className="font-black">Balance {formatCurrency(x.balance)}</p></td>
                    <td className="px-4 py-3.5">
                      <select value={x.status} onChange={(e) => void updateRepair(x, { status: e.target.value as RepairStatus })}
                        className="rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-black outline-none cursor-pointer">
                        {(Object.keys(REPAIR_STATUS_LABELS) as RepairStatus[]).map((k) => <option key={k} value={k}>{REPAIR_STATUS_LABELS[k]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">
                      <button className={`${iconBtn} bg-[var(--accent-a10)] text-[var(--accent-dark)] hover:bg-[var(--accent-a20)]`} title="Update charges" onClick={() => { setRepairEdit(x); setRepairEditForm({ charge: String(x.repairCharge), advance: String(x.advancePaid), expectedDate: x.expectedDate || '', assignedTo: x.assignedTo }); setModalError('') }}><Wallet size={15} /></button>
                      <button className={`${iconBtn} bg-amber-50 text-amber-700 hover:bg-amber-100`} title="Print receipt" onClick={() => printRepair(x)}><Printer size={15} /></button>
                      <button className={`${iconBtn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} title="Send on WhatsApp" onClick={() => whatsappRepair(x)}><MessageCircle size={15} /></button>
                      {isAdmin && deleteBtn(() => void deleteRecord('repairs', x.id, x.repairNumber, 'repair'))}
                    </div></td>
                  </tr>
                ))}
            </tbody>
          </>}
        </table>
      </div>
    </div>

    {/* ── New return / exchange ── */}
    {returnOpen && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitReturn} className="flex w-full max-w-2xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><h3 className="text-xl font-black text-[#273126]">Return / Exchange</h3><p className="text-xs text-[#6B7280]">Linked to the original invoice, which stays unchanged.</p></div>
          <button type="button" onClick={() => setReturnOpen(false)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
          {modalError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          <div className="flex gap-2">
            <input className={inputClass} value={returnLookup} onChange={(e) => setReturnLookup(e.target.value)} placeholder="Invoice number or customer phone"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void findInvoice() } }} />
            <button type="button" onClick={() => void findInvoice()} className="rounded-xl bg-[#0A0A0A] px-4 text-sm font-black text-[var(--accent)]">Find</button>
          </div>
          {returnOrders.length > 1 && !returnOrder && (
            <div className="space-y-1.5">{returnOrders.map((o) => (
              <button type="button" key={o.id} onClick={() => void chooseReturnOrder(o)} className="w-full flex justify-between rounded-xl border border-gray-200 px-3 py-2 text-left text-sm hover:border-[var(--accent)]">
                <span className="font-bold">{formatInvoiceNo(o.invoiceNo)} • {o.customerName}</span><span className="text-xs text-[#6B7280]">{fmtDate(o.createdAt)}</span>
              </button>
            ))}</div>
          )}
          {returnOrder && <>
            <div className="rounded-xl bg-[#F8F7F4] p-3 text-sm"><b>{formatInvoiceNo(returnOrder.invoiceNo)}</b> • {returnOrder.customerName} • {formatPhoneDisplay(returnOrder.phone)} • {fmtDate(returnOrder.createdAt)}</div>
            <div className="space-y-2">
              {returnOrder.items.map((it, idx) => {
                const left = it.quantity - (alreadyReturned[idx] || 0)
                return (
                  <div key={idx} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-2.5">
                    <div className="min-w-0 text-sm">
                      <p className="font-bold break-words">{it.name}</p>
                      <p className="text-[11px] text-[#6B7280]">Sold {it.quantity} • {formatCurrency(it.line_total)}{it.jewellery ? ` • ${metalLabel(it.jewellery.metal_type, it.jewellery.purity)} ${formatWeight(it.jewellery.net_weight)} @ ${formatCurrency(it.jewellery.rate_per_gram)}/g` : ''}{alreadyReturned[idx] ? ` • ${alreadyReturned[idx]} already returned` : ''}</p>
                    </div>
                    <input type="number" min="0" max={left} step="1" disabled={left <= 0} className="w-20 rounded-xl border border-[#E5E7EB] px-2 py-2 text-sm text-right" placeholder="0"
                      value={returnQty[idx] || ''} onChange={(e) => setReturnQty((m) => ({ ...m, [idx]: e.target.value }))} aria-label={`Quantity of ${it.name} to return`} />
                  </div>
                )
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type">
                <select className={inputClass} value={returnType} onChange={(e) => setReturnType(e.target.value as 'refund' | 'exchange')}>
                  <option value="refund">Return — refund the customer</option>
                  <option value="exchange">Exchange — credit for new jewellery</option>
                </select>
              </Field>
              {returnType === 'refund' ? (
                <Field label="Refund method">
                  <select className={inputClass} value={returnMethod} onChange={(e) => setReturnMethod(e.target.value)}>
                    {COUNTER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{formatPaymentMode(m)}</option>)}
                  </select>
                </Field>
              ) : <div className="rounded-xl bg-[var(--accent-a10)] p-3 text-[11px] font-bold text-[var(--accent-dark)]">The value becomes exchange credit (an advance) for this customer. Apply it on the new bill — any difference is paid or refunded there.</div>}
              <Field label={`Amount (₹) — items total ${formatCurrency(defaultReturnAmount)}`}>
                <input type="number" min="0" step="0.01" className={inputClass} value={returnAmount} onChange={(e) => setReturnAmount(e.target.value)} placeholder={defaultReturnAmount.toFixed(2)} />
              </Field>
              <Field label="Reason *"><input className={inputClass} value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="e.g. Size issue, customer exchange" /></Field>
            </div>
            {!isAdmin && <p className="rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">This will be sent for admin approval before stock and the refund / credit are updated.</p>}
          </>}
        </div>
        <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setReturnOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving || !returnOrder} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : isAdmin ? 'Record & Approve' : 'Send for Approval'}</button>
        </div>
      </form>
    </div></ModalPortal>}

    {/* ── New counter old gold purchase ── */}
    {ogOpen && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitOldGold} className="flex w-full max-w-2xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><p className="text-[11px] font-black uppercase tracking-[.16em] text-[var(--accent-dark)]">Counter purchase · no bill</p><h3 className="text-xl font-black text-[#273126]">Buy Old Gold</h3><p className="text-xs text-[#6B7280]">Old gold given as part-payment on a bill is added in the Billing Panel instead.</p></div>
          <button type="button" onClick={() => setOgOpen(false)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 grid gap-4 sm:grid-cols-2">
          {modalError && <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          <Field label="Mobile Number *"><input required className={inputClass} value={ogForm.phone} onChange={(e) => setOgForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Customer Name"><input className={inputClass} value={ogForm.name} onChange={(e) => setOgForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <div className="sm:col-span-2"><Field label="Description"><input className={inputClass} value={ogForm.description} onChange={(e) => setOgForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Old chain, 2 bangles" /></Field></div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Metal">
              <select className={inputClass} value={ogForm.metalType} onChange={(e) => setOgForm((f) => ({ ...f, metalType: e.target.value }))}>
                <option value="gold">Gold</option><option value="silver">Silver</option><option value="platinum">Platinum</option>
              </select>
            </Field>
            <Field label="Stated purity">
              {ogForm.metalType === 'gold'
                ? <select className={inputClass} value={ogForm.purity} onChange={(e) => setOgForm((f) => ({ ...f, purity: e.target.value }))}>{GOLD_PURITIES.map((pu) => <option key={pu} value={pu}>{pu}</option>)}</select>
                : <div className={`${inputClass} bg-gray-50 text-gray-500`}>Standard</div>}
            </Field>
          </div>
          <Field label="Tested purity (%)"><input type="number" min="0" max="100" step="0.01" className={inputClass} value={ogForm.testedPurity} onChange={(e) => setOgForm((f) => ({ ...f, testedPurity: e.target.value }))} placeholder="e.g. 91.6" /></Field>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <Field label="Gross wt (g) *"><input required type="number" min="0" step="0.001" className={inputClass} value={ogForm.grossWeight} onChange={(e) => setOgForm((f) => ({ ...f, grossWeight: e.target.value }))} /></Field>
            <Field label="Stone wt (g)"><input type="number" min="0" step="0.001" className={inputClass} value={ogForm.stoneWeight} onChange={(e) => setOgForm((f) => ({ ...f, stoneWeight: e.target.value }))} /></Field>
            <Field label="Net wt (g)"><div className={`${inputClass} bg-gray-50 font-bold`}>{ogNet.toFixed(3)}</div></Field>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <Field label="Melting (%)"><input type="number" min="0" max="100" step="0.01" className={inputClass} value={ogForm.meltingDeduction} onChange={(e) => setOgForm((f) => ({ ...f, meltingDeduction: e.target.value }))} placeholder="0" /></Field>
            <Field label="Rate (₹/g)"><input type="number" min="0" step="0.01" className={inputClass} value={ogForm.exchangeRate} onChange={(e) => setOgForm((f) => ({ ...f, exchangeRate: e.target.value }))} placeholder={ogSuggestedRate ? String(ogSuggestedRate) : 'Rate'} /></Field>
            <Field label="Other ded. (₹)"><input type="number" min="0" step="0.01" className={inputClass} value={ogForm.otherDeduction} onChange={(e) => setOgForm((f) => ({ ...f, otherDeduction: e.target.value }))} placeholder="0" /></Field>
          </div>
          <div className="sm:col-span-2 rounded-2xl bg-[var(--accent-a10)] p-3 text-[12px] font-bold text-[#374151] space-y-0.5">
            <div className="flex justify-between"><span>Weight after melting loss</span><span>{ogPreview.effectiveWeight.toFixed(3)} g</span></div>
            <div className="flex justify-between"><span>@ {formatCurrency(ogRate)}/g{ogForm.exchangeRate.trim() === '' && ogSuggestedRate ? " (today's rate)" : ''}</span><span>{formatCurrency(ogPreview.grossValue)}</span></div>
            <div className="flex justify-between text-[14px] font-black text-[#111111] pt-1 border-t border-[var(--accent-a30)]"><span>Value to customer</span><span>{formatCurrency(ogPreview.value)}</span></div>
          </div>
          <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
            {([['paid', 'Pay the customer now', 'Cash / UPI / bank paid out today'], ['credit', 'Keep as store credit', 'Becomes an advance used on a later bill']] as const).map(([key, title, sub]) => (
              <button type="button" key={key} onClick={() => setOgForm((f) => ({ ...f, settlement: key }))}
                className={`rounded-xl border-2 p-3 text-left transition-colors ${ogForm.settlement === key ? 'border-[var(--accent-dark)] bg-[var(--accent-a5)]' : 'border-[#E5E7EB]'}`}>
                <p className="text-sm font-black text-[#273126]">{title}</p><p className="text-[11px] text-[#6B7280]">{sub}</p>
              </button>
            ))}
          </div>
          {ogForm.settlement === 'paid' && <Field label="Paid by">
            <select className={inputClass} value={ogForm.payoutMethod} onChange={(e) => setOgForm((f) => ({ ...f, payoutMethod: e.target.value }))}>
              {COUNTER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{formatPaymentMode(m)}</option>)}
            </select>
          </Field>}
        </div>
        <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setOgOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save & Print Slip'}</button>
        </div>
      </form>
    </div></ModalPortal>}

    {/* ── New advance ── */}
    {advanceOpen && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitAdvance} className="flex w-full max-w-lg max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><h3 className="text-xl font-black text-[#273126]">New Advance</h3><p className="text-xs text-[#6B7280]">Customer money held for a later purchase. Adjusted in billing.</p></div>
          <button type="button" onClick={() => setAdvanceOpen(false)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 grid gap-4 sm:grid-cols-2">
          {modalError && <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          <Field label="Mobile Number *"><input required className={inputClass} value={advanceForm.phone} onChange={(e) => setAdvanceForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Customer Name"><input className={inputClass} value={advanceForm.name} onChange={(e) => setAdvanceForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Amount (₹) *"><input required type="number" min="1" step="0.01" className={inputClass} value={advanceForm.amount} onChange={(e) => setAdvanceForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
          <Field label="Payment Method">
            <select className={inputClass} value={advanceForm.method} onChange={(e) => setAdvanceForm((f) => ({ ...f, method: e.target.value }))}>
              {COUNTER_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{formatPaymentMode(m)}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2"><Field label="Purpose"><input className={inputClass} value={advanceForm.purpose} onChange={(e) => setAdvanceForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Wedding necklace, gold booking" /></Field></div>
          <div className="sm:col-span-2"><Field label="Notes"><input className={inputClass} value={advanceForm.notes} onChange={(e) => setAdvanceForm((f) => ({ ...f, notes: e.target.value }))} /></Field></div>
        </div>
        <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setAdvanceOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save Advance'}</button>
        </div>
      </form>
    </div></ModalPortal>}

    {advanceCreated && <ModalPortal><div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
        <p className="mt-4 text-[11px] font-black uppercase tracking-[.16em] text-emerald-600">Advance received</p>
        <h3 className="mt-1 text-2xl font-black text-[#111111]">{advanceCreated.receiptNumber}</h3>
        <p className="mt-2 text-sm text-[#6B7280]">{formatCurrency(advanceCreated.amount)} from {advanceCreated.customerName || advanceCreated.phone}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={() => printAdvance(advanceCreated)} className="rounded-xl border border-emerald-200 py-3 text-sm font-black text-emerald-700"><Printer size={16} className="mr-1 inline" />Print Receipt</button>
          <button onClick={() => whatsappAdvance(advanceCreated)} className="rounded-xl bg-[#25D366] py-3 text-sm font-black text-white"><MessageCircle size={16} className="mr-1 inline -mt-0.5" />WhatsApp</button>
        </div>
        <button onClick={() => setAdvanceCreated(null)} className="mt-3 w-full rounded-xl bg-[#111111] py-3 text-sm font-black text-white">Done</button>
      </div>
    </div></ModalPortal>}

    {/* ── New repair ── */}
    {repairOpen && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitRepair} className="flex w-full max-w-2xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><h3 className="text-xl font-black text-[#273126]">New Repair</h3><p className="text-xs text-[#6B7280]">A repair receipt prints when you save.</p></div>
          <button type="button" onClick={() => setRepairOpen(false)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 grid gap-4 sm:grid-cols-2">
          {modalError && <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          <Field label="Mobile Number *"><input required className={inputClass} value={repairForm.phone} onChange={(e) => setRepairForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
          <Field label="Customer Name"><input className={inputClass} value={repairForm.name} onChange={(e) => setRepairForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label="Item *"><input required className={inputClass} value={repairForm.itemName} onChange={(e) => setRepairForm((f) => ({ ...f, itemName: e.target.value }))} placeholder="e.g. Gold chain" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Metal">
              <select className={inputClass} value={repairForm.metalType} onChange={(e) => setRepairForm((f) => ({ ...f, metalType: e.target.value }))}>
                <option value="gold">Gold</option><option value="silver">Silver</option><option value="platinum">Platinum</option><option value="other">Other</option>
              </select>
            </Field>
            <Field label="Weight (g)"><input type="number" min="0" step="0.001" className={inputClass} value={repairForm.weight} onChange={(e) => setRepairForm((f) => ({ ...f, weight: e.target.value }))} /></Field>
          </div>
          <div className="sm:col-span-2"><Field label="Work to be done"><input className={inputClass} value={repairForm.description} onChange={(e) => setRepairForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Clasp broken, re-solder" /></Field></div>
          <Field label="Expected Date"><input type="date" className={inputClass} value={repairForm.expectedDate} onChange={(e) => setRepairForm((f) => ({ ...f, expectedDate: e.target.value }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Charge (₹)"><input type="number" min="0" step="0.01" className={inputClass} value={repairForm.charge} onChange={(e) => setRepairForm((f) => ({ ...f, charge: e.target.value }))} /></Field>
            <Field label="Advance (₹)"><input type="number" min="0" step="0.01" className={inputClass} value={repairForm.advance} onChange={(e) => setRepairForm((f) => ({ ...f, advance: e.target.value }))} /></Field>
          </div>
          <Field label="Assigned To"><input className={inputClass} value={repairForm.assignedTo} onChange={(e) => setRepairForm((f) => ({ ...f, assignedTo: e.target.value }))} placeholder="Staff / goldsmith name" /></Field>
          <Field label="Original Invoice"><input className={inputClass} value={repairForm.invoiceNo} onChange={(e) => setRepairForm((f) => ({ ...f, invoiceNo: e.target.value }))} placeholder="If bought here, e.g. INV10000025" /></Field>
          <div className="sm:col-span-2"><Field label="Notes"><input className={inputClass} value={repairForm.notes} onChange={(e) => setRepairForm((f) => ({ ...f, notes: e.target.value }))} /></Field></div>
        </div>
        <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setRepairOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save & Print Receipt'}</button>
        </div>
      </form>
    </div></ModalPortal>}

    {repairEdit && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitRepairEdit} className="w-full max-w-md rounded-2xl sm:rounded-3xl bg-white p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between"><div><p className="text-xs font-black text-[var(--accent-dark)]">{repairEdit.repairNumber}</p><h3 className="text-xl font-black text-[#273126]">Update Repair</h3></div><button type="button" onClick={() => setRepairEdit(null)}><X size={20} /></button></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Charge (₹)"><input type="number" min="0" step="0.01" className={inputClass} value={repairEditForm.charge} onChange={(e) => setRepairEditForm((f) => ({ ...f, charge: e.target.value }))} /></Field>
          <Field label="Advance paid (₹)"><input type="number" min="0" step="0.01" className={inputClass} value={repairEditForm.advance} onChange={(e) => setRepairEditForm((f) => ({ ...f, advance: e.target.value }))} /></Field>
          <div className="col-span-2"><Field label="Expected Date"><input type="date" className={inputClass} value={repairEditForm.expectedDate} onChange={(e) => setRepairEditForm((f) => ({ ...f, expectedDate: e.target.value }))} /></Field></div>
          <div className="col-span-2"><Field label="Assigned To"><input className={inputClass} value={repairEditForm.assignedTo} onChange={(e) => setRepairEditForm((f) => ({ ...f, assignedTo: e.target.value }))} placeholder="Staff / goldsmith name" /></Field></div>
        </div>
        <button className="w-full rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white">Save</button>
      </form>
    </div></ModalPortal>}
  </div>
}
