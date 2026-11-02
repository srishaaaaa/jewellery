import { looseStoneService, type MaterialCategory } from '../services/stoneRateService'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Edit2, Eye, IndianRupee, LayoutDashboard, Plus, Printer, RefreshCw, Trash2, Truck, Users, X } from 'lucide-react'
import { getErrorMessage } from '../lib/errorMessage'
import { formatCurrency, formatPaymentMode } from '../lib/retail'
import { csvDate, csvPhone, downloadCsv } from '../lib/csv'
import { formatWeight, GOLD_PURITIES, metalLabel, normalizeMetalType } from '../lib/jewellery'
import { useNavigate } from 'react-router-dom'
import { ModalPortal } from '../components/ModalPortal'
import { useAdminAuthStore, useProductStore, useSettingsStore } from '../store/store'
import { BRAND_EN } from '../lib/brand'
import { PaymentModePicker } from '../components/PaymentModePicker'
import { splitError, splitSummary, type PaymentMode, type SplitAmounts } from '../lib/paymentModes'
import { PrintSettingsModal } from '../components/invoice/PrintSettingsModal'
import { DocumentPreviewModal } from '../components/invoice/InvoiceParts'
import { PurchaseBillSheet } from '../components/invoice/PurchaseBillSheet'
import { DocIcon, EyeIcon, WhatsAppIcon, actionBtn } from '../components/ActionIcons'
import { PurchaseDashboard } from '../components/purchases/PurchaseDashboard'
import { FilterCard, FilterField, PeriodBar } from '../components/filters/PageFilters'
import { filterInput, inRange, periodRange, type PeriodPreset } from '../components/filters/filterStyles'
import { toWhatsAppUrl } from '../lib/phone'
import { thermalWidth } from '../lib/printPrefs'
import { printPurchaseThermal, sharePurchaseWhatsApp } from '../lib/purchaseDocs'
import { auditService } from '../services/auditService'
import {
  purchaseService, supplierService,
  type Purchase, type Supplier, type SupplierInput, type SupplierPayment,
} from '../services/purchaseService'

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{label}</span>{children}</label> }
const inputClass = 'w-full bg-white border border-black/10 focus:border-[var(--accent)] rounded-lg px-4 py-2.5 text-[#000000] text-sm font-semibold focus:outline-none transition-colors placeholder:text-black/40 placeholder:font-normal shadow-sm'
const cellInput = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-xs text-[#000000] outline-none focus:border-[var(--accent-dark)]'
const TH = 'px-4 py-3.5 whitespace-nowrap'
const thead = (cols: string[]) => (
  <thead className="text-[10px] font-bold uppercase tracking-widest text-[#000000] bg-[#F9FAFB]">
    <tr>{cols.map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
  </thead>
)
const emptyRow = (cols: number, text: string) => <tr><td colSpan={cols} className="px-4 py-12 text-center text-[#000000]">{text}</td></tr>
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
const today = () => new Date().toISOString().slice(0, 10)

type LineForm = { productId: string; description: string; metalType: string; purity: string; gross: string; stone: string; rate: string; making: string; other: string; stones: string; qty: string; amount: string }
const emptyLine = (): LineForm => ({ productId: '', description: '', metalType: 'gold', purity: '22K', gross: '', stone: '', rate: '', making: '', other: '', stones: '', qty: '1', amount: '' })
const n = (v: string) => Math.max(0, Number(v) || 0)
/** Purchase lines of loose stones are entered in carats and go into Loose Stones, never metal stock. */
const STONE_MATERIALS: Record<string, MaterialCategory> = { diamond: 'diamond', gemstone: 'gemstone', pearl: 'pearl', traditional: 'traditional' }
const isStoneLine = (l: { metalType: string }) => l.metalType in STONE_MATERIALS
/** Same rule as the database: weighed metal = net × rate + making + other, else the amount typed. */
const lineNet = (l: LineForm) => Math.max(0, Math.round((n(l.gross) - n(l.stone)) * 1000) / 1000)
const lineAmount = (l: LineForm) => (lineNet(l) > 0 && n(l.rate) > 0
  ? Math.round((lineNet(l) * n(l.rate) + n(l.making) + n(l.other)) * 100) / 100
  : Math.round(n(l.amount) * 100) / 100)

const emptySupplier: SupplierInput = { name: '', phone: '', gstin: '', address: '', notes: '' }

export default function Purchases() {
  const products = useProductStore((s) => s.products)
  const [tab, setTab] = useState<'dashboard' | 'purchases' | 'suppliers'>('dashboard')
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [payFilter, setPayFilter] = useState<'all' | 'owed' | 'paid'>('all')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [searchDraft, setSearchDraft] = useState('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modalError, setModalError] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, p] = await Promise.all([supplierService.list(), purchaseService.list()])
      setSuppliers(s)
      setPurchases(p)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load purchases'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers])
  const navigate = useNavigate()
  const owedBySupplier = useMemo(() => {
    const m = new Map<string, { total: number; due: number; count: number }>()
    for (const p of purchases) {
      const cur = m.get(p.supplierId) || { total: 0, due: 0, count: 0 }
      m.set(p.supplierId, { total: cur.total + p.totalAmount, due: cur.due + p.due, count: cur.count + 1 })
    }
    return m
  }, [purchases])
  const totals = useMemo(() => purchases.reduce((a, p) => ({ total: a.total + p.totalAmount, paid: a.paid + p.amountPaid, due: a.due + p.due }), { total: 0, paid: 0, due: 0 }), [purchases])

  const q = search.trim().toLowerCase()
  const matches = (...vals: Array<string | null | undefined>) => !q || vals.some((v) => String(v || '').toLowerCase().includes(q))
  const range = periodRange(period, periodFrom, periodTo)
  const visiblePurchases = purchases.filter((p) =>
    matches(p.purchaseNumber, p.supplierInvoiceNo, supplierById.get(p.supplierId)?.name, ...p.items.map((i) => i.description))
    && inRange(p.purchaseDate, range.from, range.to)
    && (payFilter === 'all' || (payFilter === 'owed' ? p.due > 0 : p.due <= 0))
    && (!supplierFilter || p.supplierId === supplierFilter))
  const visibleSuppliers = suppliers.filter((s) => matches(s.name, s.phone, s.gstin) && (activeFilter === 'all' || (activeFilter === 'active') === s.isActive))

  // ── Supplier form ──────────────────────────────────────────────────────────
  const [supplierEdit, setSupplierEdit] = useState<{ id?: string; form: SupplierInput } | null>(null)
  const submitSupplier = async (event: FormEvent) => {
    event.preventDefault()
    if (!supplierEdit) return
    if (!supplierEdit.form.name.trim()) { setModalError('Enter the supplier name.'); return }
    if (supplierEdit.form.gstin.trim() && !/^[0-9]{2}[A-Z0-9]{13}$/i.test(supplierEdit.form.gstin.trim())) { setModalError('GSTIN must be 15 characters, starting with the 2-digit state code.'); return }
    setSaving(true)
    setModalError('')
    try {
      const saved = await supplierService.save(supplierEdit.form, supplierEdit.id)
      setSuppliers((rows) => (supplierEdit.id ? rows.map((r) => (r.id === saved.id ? saved : r)) : [...rows, saved]).sort((a, b) => a.name.localeCompare(b.name)))
      void auditService.log({ action: supplierEdit.id ? 'supplier_updated' : 'supplier_created', entityType: 'supplier', entityId: saved.name })
      setSupplierEdit(null)
      setNotice(`Supplier ${saved.name} saved.`)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to save the supplier'))
    } finally {
      setSaving(false)
    }
  }
  const toggleSupplier = async (s: Supplier) => {
    try {
      await supplierService.setActive(s.id, !s.isActive)
      setSuppliers((rows) => rows.map((r) => (r.id === s.id ? { ...r, isActive: !s.isActive } : r)))
    } catch (err) { setError(getErrorMessage(err, 'Unable to update the supplier')) }
  }

  // ── New purchase ───────────────────────────────────────────────────────────
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [pForm, setPForm] = useState({ supplierId: '', invoiceNo: '', date: today(), dueDate: '', paid: '', method: 'bank', reference: '', notes: '', gstRate: '' })
  const [pSplit, setPSplit] = useState<SplitAmounts>({})
  const [lines, setLines] = useState<LineForm[]>([emptyLine()])
  const purchaseTaxable = Math.round(lines.reduce((s, l) => s + lineAmount(l), 0) * 100) / 100
  const purchaseGstRate = Math.min(100, Math.max(0, Number(pForm.gstRate) || 0))
  const purchaseGst = Math.round(purchaseTaxable * purchaseGstRate) / 100
  const purchaseTotal = Math.round((purchaseTaxable + purchaseGst) * 100) / 100
  const setLine = (idx: number, patch: Partial<LineForm>) => setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  const pickProduct = (idx: number, productId: string) => {
    const p = products.find((x) => String(x.id) === productId)
    setLine(idx, p ? {
      productId, description: p.name, metalType: p.metalType || 'other', purity: p.purity || '',
      gross: p.grossWeight ? String(p.grossWeight) : '', stone: p.stoneWeight ? String(p.stoneWeight) : '',
    } : { productId: '' })
  }
  const openPurchase = () => {
    setPForm({ supplierId: suppliers.find((s) => s.isActive)?.id || '', invoiceNo: '', date: today(), dueDate: '', paid: '', method: 'bank', reference: '', notes: '', gstRate: '' })
    setPSplit({})
    setLines([emptyLine()])
    setModalError('')
    setPurchaseOpen(true)
  }
  const submitPurchase = async (event: FormEvent) => {
    event.preventDefault()
    if (!pForm.supplierId) { setModalError('Choose the supplier (add one under Suppliers first).'); return }
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim() && !l.productId) { setModalError(`Line ${i + 1}: enter a description or pick a catalogue item.`); return }
      if (n(l.stone) > n(l.gross) && n(l.gross) > 0) { setModalError(`Line ${i + 1}: stone weight is more than the gross weight.`); return }
      if (!(n(l.qty) > 0)) { setModalError(`Line ${i + 1}: quantity must be more than zero.`); return }
      if (lineAmount(l) <= 0) { setModalError(`Line ${i + 1}: enter the weight and rate, or the amount.`); return }
    }
    const paid = n(pForm.paid)
    if (paid > purchaseTotal) { setModalError(`Amount paid is more than the total (${formatCurrency(purchaseTotal)}).`); return }
    if (paid > 0) { const se = splitError(pForm.method as PaymentMode, pSplit, paid); if (se) { setModalError(se); return } }
    const purchaseNotes = paid > 0 && pForm.method === 'mixed' ? [pForm.notes.trim(), `Split: ${splitSummary(pSplit)}`].filter(Boolean).join(' • ') : pForm.notes.trim()
    setSaving(true)
    setModalError('')
    try {
      const created = await purchaseService.create({
        supplierId: pForm.supplierId, supplierInvoiceNo: pForm.invoiceNo.trim(), purchaseDate: pForm.date || today(),
        items: lines.map((l) => ({
          product_id: l.productId || null, description: l.description.trim(), metal_type: l.metalType, purity: l.metalType === 'gold' ? l.purity : l.purity.trim(),
          gross_weight: n(l.gross), stone_weight: n(l.stone), rate: n(l.rate), making_cost: n(l.making), other_cost: n(l.other),
          stone_details: l.stones.trim(), quantity: n(l.qty), amount: lineAmount(l),
        })),
        amountPaid: paid, paymentMethod: pForm.method, reference: pForm.reference.trim(), notes: purchaseNotes, gstRate: purchaseGstRate,
      })
      let saved = created
      // Loose stones bought on this bill go into Loose Stones stock (one lot per line)
      const stoneLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => isStoneLine(l))
      let stoneNote = ''
      if (stoneLines.length) {
        const supplierName = supplierById.get(created.supplierId)?.name || ''
        const results = await Promise.allSettled(stoneLines.map(({ l, i }) => looseStoneService.create({
          stoneCode: `${created.purchaseNumber}-${i + 1}`, category: STONE_MATERIALS[l.metalType], name: l.description.trim() || (l.metalType === 'diamond' ? 'Diamond' : 'Stone'),
          variety: '', originType: l.metalType === 'diamond' ? 'natural' : '', specs: l.purity.trim() ? { quality: l.purity.trim() } : {}, isLot: n(l.qty) > 1,
          quantity: Math.round(n(l.qty)) || 1, carat: n(l.gross), costPrice: lineAmount(l), sellingPrice: 0, supplier: supplierName,
          purchaseDate: pForm.date || today(), lab: '', certificateNo: '', notes: [l.stones.trim(), `Purchase ${created.purchaseNumber}`].filter(Boolean).join(' · '),
        })))
        const failed = results.filter((r) => r.status === 'rejected').length
        stoneNote = failed ? ` ${failed} stone line${failed > 1 ? 's' : ''} could not be added to Loose Stones (run the database update, then add them in Inventory → Loose Stones).` : ` ${stoneLines.length} stone lot${stoneLines.length > 1 ? 's' : ''} added to Loose Stones.`
      }
      if (pForm.dueDate && created.due > 0) {
        try { saved = await purchaseService.setDueDate(created.id, pForm.dueDate) } catch (err) { setError(getErrorMessage(err, 'Purchase saved, but the due date could not be saved')) }
      }
      void auditService.log({ action: 'purchase_recorded', entityType: 'purchase', entityId: created.purchaseNumber, newValue: { supplier: supplierById.get(created.supplierId)?.name, total: created.totalAmount, paid: created.amountPaid } })
      setPurchases((rows) => [saved, ...rows])
      setPurchaseOpen(false)
      const restocked = created.items.filter((i) => i.product_id).length
      setNotice(`${created.purchaseNumber} recorded for ${formatCurrency(created.totalAmount)}${created.due > 0 ? `, ${formatCurrency(created.due)} still owed` : ''}.${restocked ? ` Stock added to ${restocked} catalogue item${restocked > 1 ? 's' : ''}.` : ''}${stoneNote}`)
      if (restocked) void useProductStore.getState().fetchProducts()
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to record the purchase'))
    } finally {
      setSaving(false)
    }
  }

  // ── Detail + pay ───────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<Purchase | null>(null)
  const [detailPayments, setDetailPayments] = useState<SupplierPayment[]>([])
  const isAdmin = useAdminAuthStore((s) => s.role) === 'admin'
  const deletePurchase = async (p: Purchase) => {
    if (!window.confirm(`Delete purchase ${p.purchaseNumber} (${formatCurrency(p.totalAmount)})?\n\nStock it added to catalogue items is taken back and its supplier payments are removed. Loose stones it added stay in Loose Stones. This cannot be undone.`)) return
    try {
      await purchaseService.remove(p.id)
      void auditService.log({ action: 'purchase_deleted', entityType: 'purchase', entityId: p.purchaseNumber, oldValue: { total: p.totalAmount, paid: p.amountPaid } })
      setPurchases((rows) => rows.filter((r) => r.id !== p.id))
      if (detail?.id === p.id) setDetail(null)
      setNotice(`${p.purchaseNumber} deleted.`)
      if (p.items.some((i) => i.product_id)) void useProductStore.getState().fetchProducts()
    } catch (err) { setError(getErrorMessage(err, 'Unable to delete the purchase')) }
  }
  const deletePayment = async (paymentId: string, amount: number) => {
    if (!window.confirm(`Delete this payment of ${formatCurrency(amount)}? The amount owed goes back up.`)) return
    try {
      const updated = await purchaseService.removePayment(paymentId)
      setDetailPayments((rows) => rows.filter((r) => r.id !== paymentId))
      if (updated) { setPurchases((rows) => rows.map((r) => (r.id === updated.id ? updated : r))); setDetail((d) => (d && d.id === updated.id ? updated : d)) }
      void auditService.log({ action: 'supplier_payment_deleted', entityType: 'purchase', entityId: updated?.purchaseNumber || paymentId, oldValue: { amount } })
    } catch (err) { setModalError(getErrorMessage(err, 'Unable to delete the payment')) }
  }
  const deleteSupplier = async (s: Supplier) => {
    if (!window.confirm(`Delete supplier ${s.name}? Only a supplier with no purchases can be deleted.`)) return
    try {
      await supplierService.remove(s.id)
      setSuppliers((rows) => rows.filter((r) => r.id !== s.id))
      setNotice(`${s.name} deleted.`)
    } catch (err) { setError(getErrorMessage(err, 'Unable to delete the supplier')) }
  }
  const [payForm, setPayForm] = useState({ amount: '', method: 'bank', reference: '' })
  const [payMode, setPayMode] = useState<PaymentMode>('bank')
  const [paySplit, setPaySplit] = useState<SplitAmounts>({})
  const [printOpen, setPrintOpen] = useState(false)
  const [billPreview, setBillPreview] = useState(false)
  const shopName = useSettingsStore(s => s.settings?.name) || BRAND_EN
  const openDetail = async (p: Purchase) => {
    setDetail(p)
    setDetailPayments([])
    setPayForm({ amount: p.due > 0 ? String(p.due) : '', method: 'bank', reference: '' })
    setPayMode('bank'); setPaySplit({}); setPrintOpen(false); setBillPreview(false)
    setModalError('')
    try { setDetailPayments(await purchaseService.payments(p.id)) } catch (err) { setModalError(getErrorMessage(err, 'Unable to load payments')) }
  }
  const submitPay = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail) return
    const amount = n(payForm.amount)
    if (!(amount > 0)) { setModalError('Enter the amount paid.'); return }
    if (amount > detail.due + 0.009) { setModalError(`Only ${formatCurrency(detail.due)} is still owed.`); return }
    setSaving(true)
    setModalError('')
    try {
      const mixError = splitError(payMode, paySplit, amount)
      if (mixError) { setModalError(mixError); setSaving(false); return }
      const updated = await purchaseService.pay(detail.id, amount, payMode, payForm.reference.trim(), payMode === 'mixed' ? `Split: ${splitSummary(paySplit)}` : '')
      void auditService.log({ action: 'supplier_paid', entityType: 'purchase', entityId: updated.purchaseNumber, newValue: { amount, method: payMode } })
      setPurchases((rows) => rows.map((r) => (r.id === updated.id ? updated : r)))
      setDetail(updated)
      setDetailPayments(await purchaseService.payments(updated.id))
      setPayForm({ amount: updated.due > 0 ? String(updated.due) : '', method: payForm.method, reference: '' })
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to record the payment'))
    } finally {
      setSaving(false)
    }
  }

  const exportCsv = () => {
    const d = today()
    if (tab === 'purchases') downloadCsv(`purchases_${d}.csv`, [['No', 'Date', 'Supplier', 'Supplier Invoice', 'Items', 'Net Weight (g)', 'Total (INR)', 'Paid (INR)', 'Owed (INR)', 'By'],
      ...visiblePurchases.map((p) => [p.purchaseNumber, csvDate(p.purchaseDate), supplierById.get(p.supplierId)?.name || '', p.supplierInvoiceNo, p.items.map((i) => i.description).join('; '),
        p.items.reduce((s, i) => s + i.net_weight * i.quantity, 0).toFixed(3), p.totalAmount.toFixed(2), p.amountPaid.toFixed(2), p.due.toFixed(2), p.createdBy])])
    else downloadCsv(`suppliers_${d}.csv`, [['Supplier', 'Phone', 'GSTIN', 'Address', 'Purchases', 'Total (INR)', 'Owed (INR)', 'Active'],
      ...visibleSuppliers.map((s) => { const o = owedBySupplier.get(s.id); return [s.name, csvPhone(s.phone), s.gstin, s.address, o?.count || 0, (o?.total || 0).toFixed(2), (o?.due || 0).toFixed(2), s.isActive ? 'Yes' : 'No'] })])
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-[28px] font-black text-[#000000] tracking-tight">Purchases & Suppliers</h2>
        <p className="mt-1 text-xs font-semibold text-[#000000]">Supplier bills with metal, purity, weight and rate. Linked catalogue items get the stock and cost price.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => (tab !== 'suppliers' ? openPurchase() : (setModalError(''), setSupplierEdit({ form: { ...emptySupplier } })))}
          className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:opacity-90 cursor-pointer">
          <Plus size={16} /> {tab !== 'suppliers' ? 'New Purchase' : 'New Supplier'}
        </button>
        <button onClick={() => void load()} className="rounded-xl border bg-white p-3 text-[#000000] cursor-pointer" title="Refresh"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </div>

    {tab !== 'dashboard' && <div className="grid gap-3 sm:grid-cols-3">
      {[['Total Purchased', totals.total], ['Paid to Suppliers', totals.paid], ['Still Owed', totals.due]].map(([label, value]) => (
        <div key={label} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">{label}</p>
          <p className={`mt-2 text-[17px] sm:text-2xl font-black break-words ${label === 'Still Owed' && Number(value) > 0 ? 'text-red-600' : 'text-[#000000]'}`}>{formatCurrency(Number(value))}</p>
        </div>
      ))}
    </div>}

    <div className="flex gap-2 border-b border-black/10 overflow-x-auto hide-scrollbar">
      {([['dashboard', 'Dashboard', LayoutDashboard], ['purchases', 'Purchases', Truck], ['suppliers', 'Suppliers', Users]] as const).map(([key, label, Icon]) => (
        <button key={key} onClick={() => { setTab(key); setSearch(''); setSearchDraft(''); setNotice('') }}
          className={`flex items-center gap-1.5 px-4 py-3 font-bold text-sm whitespace-nowrap transition-colors ${tab === key ? 'text-[var(--accent-dark)] border-b-2 border-[var(--accent-dark)]' : 'text-[#000000] hover:text-[#000000]'}`}>
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

    {tab === 'dashboard' ? (
      <PurchaseDashboard purchases={purchases} suppliers={suppliers} onOpen={(pu) => void openDetail(pu)} />
    ) : <>
    <div className="flex flex-col lg:flex-row lg:items-center justify-end gap-3">
      <PeriodBar
        preset={period}
        from={range.from}
        to={range.to}
        onPreset={setPeriod}
        onFrom={(v) => { setPeriodFrom(v); setPeriodTo(range.to); setPeriod('custom') }}
        onTo={(v) => { setPeriodTo(v); setPeriodFrom(range.from); setPeriod('custom') }}
        onExport={exportCsv}
      />
    </div>
    {tab === 'purchases' ? (
      <FilterCard
        tabs={[{ id: 'all' as const, label: 'All Purchases' }, { id: 'owed' as const, label: 'Balance Owed' }, { id: 'paid' as const, label: 'Paid' }]}
        activeTab={payFilter}
        onTab={setPayFilter}
        onSearch={() => setSearch(searchDraft)}
      >
        <FilterField label="Search Purchase / Bill / Item" search>
          <input className={`${filterInput} pl-9`} placeholder="e.g. PUR000001, bill no., chain…" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
        </FilterField>
        <FilterField label="Supplier">
          <select className={`${filterInput} cursor-pointer`} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">All Suppliers</option>
            {suppliers.map((su) => <option key={su.id} value={su.id}>{su.name}</option>)}
          </select>
        </FilterField>
      </FilterCard>
    ) : (
      <FilterCard
        tabs={[{ id: 'all' as const, label: 'All Suppliers' }, { id: 'active' as const, label: 'Active' }, { id: 'inactive' as const, label: 'Inactive' }]}
        activeTab={activeFilter}
        onTab={setActiveFilter}
        onSearch={() => setSearch(searchDraft)}
      >
        <FilterField label="Search Supplier / Phone / GSTIN" search>
          <input className={`${filterInput} pl-9`} placeholder="Search supplier…" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
        </FilterField>
      </FilterCard>
    )}

    <div className="rounded-xl border border-black/10 bg-white shadow-sm flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          {tab === 'purchases' ? <>
            {thead(['Purchase', 'Supplier', 'Items', 'Weight', 'Total', 'Paid / Owed', 'Actions'])}
            <tbody className="divide-y divide-black/5">
              {loading ? emptyRow(7, 'Loading…') : visiblePurchases.length === 0 ? emptyRow(7, purchases.length ? 'No purchases match.' : 'No purchases yet. Add a supplier, then click "New Purchase".')
                : visiblePurchases.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--accent-a5)] transition-colors">
                    <td className="px-4 py-3.5"><p className="font-black text-[var(--accent-dark)]">{p.purchaseNumber}</p><p className="text-[11px] text-[#000000]">{fmtDate(p.purchaseDate)} • {p.createdBy}</p></td>
                    <td className="px-4 py-3.5"><p className="font-bold text-[#000000]">{supplierById.get(p.supplierId)?.name || '—'}</p><p className="text-xs text-[#000000]">{p.supplierInvoiceNo ? `Bill ${p.supplierInvoiceNo}` : 'No bill no.'}</p></td>
                    <td className="px-4 py-3.5 text-xs">{p.items.slice(0, 2).map((i, k) => <p key={k}>{i.description || '—'}{i.quantity > 1 ? ` × ${i.quantity}` : ''}</p>)}{p.items.length > 2 && <p className="text-[#000000]">+{p.items.length - 2} more</p>}</td>
                    <td className="px-4 py-3.5 text-xs">{formatWeight(p.items.reduce((s, i) => s + i.net_weight * i.quantity, 0))} net</td>
                    <td className="px-4 py-3.5 font-black">{formatCurrency(p.totalAmount)}</td>
                    <td className="px-4 py-3.5 text-xs"><p className="text-emerald-700">Paid <b>{formatCurrency(p.amountPaid)}</b></p>{p.due > 0 ? <p className="text-red-600">Owed <b>{formatCurrency(p.due)}</b>{p.dueDate && <span className={`block text-[10px] font-bold ${p.dueDate < today() ? 'text-red-700' : 'text-[#000000]/60'}`}>Due {fmtDate(p.dueDate)}{p.dueDate < today() ? ' (overdue)' : ''}</span>}</p> : <p className="font-black text-emerald-700">Settled</p>}</td>
                    <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">
                      <button className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`} title="Send to supplier on WhatsApp" onClick={() => sharePurchaseWhatsApp(p, supplierById.get(p.supplierId), shopName, `${window.location.origin}/purchase/${p.id}`)}><WhatsAppIcon className="w-4 h-4" /></button>
                      <button className={`${actionBtn} bg-black/10 hover:bg-black/15 text-[#000000]`} title="View purchase bill" onClick={() => void openDetail(p).then(() => setBillPreview(true))}><DocIcon className="w-4 h-4" /></button>
                      <button className={`${actionBtn} bg-[#2563EB]/10 hover:bg-[#2563EB]/20 text-[#2563EB]`} title="Edit due date / record a payment" onClick={() => void openDetail(p)}><Edit2 className="w-4 h-4" /></button>
                      <button className={`${actionBtn} bg-black/5 hover:bg-black/10 text-[#000000]`} title="Purchase details" onClick={() => void openDetail(p)}><EyeIcon className="w-4 h-4" /></button>
                      <button className={`${actionBtn} bg-black/5 hover:bg-black/10 text-[#000000]`} title="Print" onClick={() => void openDetail(p).then(() => setPrintOpen(true))}><Printer className="w-4 h-4" /></button>
                      {p.due > 0 && <button className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`} title="Pay supplier" onClick={() => void openDetail(p)}><IndianRupee className="w-4 h-4" /></button>}
                      <button className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626] disabled:opacity-30 disabled:cursor-not-allowed`} disabled={!isAdmin} title={isAdmin ? 'Delete purchase' : 'Only the admin can delete'} onClick={() => void deletePurchase(p)}><Trash2 className="w-4 h-4" /></button>
                    </div></td>
                  </tr>
                ))}
            </tbody>
          </> : <>
            {thead(['Supplier', 'Contact', 'GSTIN', 'Purchases', 'Owed', 'Actions'])}
            <tbody className="divide-y divide-black/5">
              {loading ? emptyRow(6, 'Loading…') : visibleSuppliers.length === 0 ? emptyRow(6, suppliers.length ? 'No suppliers match.' : 'No suppliers yet. Click "New Supplier".')
                : visibleSuppliers.map((s) => {
                  const o = owedBySupplier.get(s.id)
                  return (
                    <tr key={s.id} className={`hover:bg-[var(--accent-a5)] transition-colors ${s.isActive ? '' : 'opacity-50'}`}>
                      <td className="px-4 py-3.5"><p className="font-black text-[#000000]">{s.name}</p>{!s.isActive && <p className="text-[11px] text-[#000000]">Inactive</p>}</td>
                      <td className="px-4 py-3.5 text-xs"><p>{s.phone || '—'}</p><p className="text-[#000000] whitespace-normal max-w-[220px]">{s.address}</p></td>
                      <td className="px-4 py-3.5 text-xs">{s.gstin || '—'}</td>
                      <td className="px-4 py-3.5 text-xs">{o?.count || 0} • {formatCurrency(o?.total || 0)}</td>
                      <td className={`px-4 py-3.5 font-black ${(o?.due || 0) > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatCurrency(o?.due || 0)}</td>
                      <td className="px-4 py-3.5"><div className="flex items-center gap-1.5">
                        <button className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981] disabled:opacity-30 disabled:cursor-not-allowed`} disabled={!s.phone} title={s.phone ? 'Chat on WhatsApp' : 'No phone number'} onClick={() => window.open(toWhatsAppUrl(s.phone, `Hello ${s.name},`), '_blank', 'noopener,noreferrer')}><WhatsAppIcon className="w-4 h-4" /></button>
                        <button className={`${actionBtn} bg-black/10 hover:bg-black/15 text-[#000000]`} title="Supplier statement (CSV)" onClick={() => downloadCsv(`supplier-${s.name.replace(/\W+/g, '-')}-${today()}`, [['Purchase', 'Date', 'Supplier bill', 'Total', 'Paid', 'Owed'], ...purchases.filter((pu) => pu.supplierId === s.id).map((pu) => [pu.purchaseNumber, pu.purchaseDate, pu.supplierInvoiceNo, pu.totalAmount, pu.amountPaid, pu.due])])}><DocIcon className="w-4 h-4" /></button>
                        <button className={`${actionBtn} bg-black/5 hover:bg-black/10 text-[#000000]`} title="View this supplier's purchases" onClick={() => { setSupplierFilter(s.id); setTab('purchases') }}><EyeIcon className="w-4 h-4" /></button>
                        <button className={`${actionBtn} bg-[#2563EB]/10 hover:bg-[#2563EB]/20 text-[#2563EB]`} title="Edit supplier" onClick={() => { setModalError(''); setSupplierEdit({ id: s.id, form: { name: s.name, phone: s.phone, gstin: s.gstin, address: s.address, notes: s.notes } }) }}><Edit2 className="w-4 h-4" /></button>
                        <button className={`${actionBtn} ${s.isActive ? 'bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 text-[#D97706]' : 'bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]'}`} title={s.isActive ? 'Deactivate supplier' : 'Activate supplier'} onClick={() => void toggleSupplier(s)}>{s.isActive ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}</button>
                        <button className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626] disabled:opacity-30 disabled:cursor-not-allowed`} disabled={!isAdmin} title={isAdmin ? 'Delete supplier' : 'Only the admin can delete'} onClick={() => void deleteSupplier(s)}><Trash2 className="w-4 h-4" /></button>
                      </div></td>
                    </tr>
                  )
                })}
            </tbody>
          </>}
        </table>
      </div>
    </div>
    </>}

    {/* ── Supplier form ── */}
    {supplierEdit && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitSupplier} className="flex w-full max-w-lg max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-xl sm:rounded-xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-black/10 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <h3 className="text-xl font-black text-[#000000]">{supplierEdit.id ? 'Edit Supplier' : 'New Supplier'}</h3>
          <button type="button" onClick={() => setSupplierEdit(null)} className="shrink-0 text-[#000000] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 grid gap-4 sm:grid-cols-2">
          {modalError && <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          {([['name', 'Supplier Name *'], ['phone', 'Phone'], ['gstin', 'GSTIN'], ['address', 'Address'], ['notes', 'Notes']] as const).map(([key, label]) => (
            <div key={key} className={key === 'address' || key === 'notes' ? 'sm:col-span-2' : ''}>
              <Field label={label}><input className={inputClass} value={supplierEdit.form[key]} onChange={(e) => setSupplierEdit((cur) => cur && { ...cur, form: { ...cur.form, [key]: e.target.value } })} /></Field>
            </div>
          ))}
        </div>
        <div className="shrink-0 flex gap-3 border-t border-black/10 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setSupplierEdit(null)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save Supplier'}</button>
        </div>
      </form>
    </div></ModalPortal>}

    {/* ── New purchase ── */}
    {purchaseOpen && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitPurchase} className="flex w-full max-w-5xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-xl sm:rounded-xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-black/10 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><h3 className="text-xl font-black text-[#000000]">New Purchase</h3><p className="text-xs text-[#000000]">Weighed metal is costed as net weight × rate + making + other. Linked catalogue items get the stock.</p></div>
          <button type="button" onClick={() => setPurchaseOpen(false)} className="shrink-0 text-[#000000] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
          {modalError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Supplier *">
              <select className={inputClass} value={pForm.supplierId} onChange={(e) => setPForm((f) => ({ ...f, supplierId: e.target.value }))}>
                <option value="">Choose…</option>
                {suppliers.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Supplier Bill No."><input className={inputClass} value={pForm.invoiceNo} onChange={(e) => setPForm((f) => ({ ...f, invoiceNo: e.target.value }))} /></Field>
            <Field label="Purchase Date"><input type="date" className={inputClass} value={pForm.date} onChange={(e) => setPForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Balance Due Date"><input type="date" className={inputClass} value={pForm.dueDate} min={pForm.date} onChange={(e) => setPForm((f) => ({ ...f, dueDate: e.target.value }))} /></Field>
          </div>

          <div className="space-y-3">
            {lines.map((l, idx) => (
              <div key={idx} className="rounded-xl border border-black/10 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#000000]">Line {idx + 1}</p>
                  {lines.length > 1 && <button type="button" onClick={() => setLines((cur) => cur.filter((_, i) => i !== idx))} className="text-xs font-black text-red-600">Remove</button>}
                </div>
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                  <label className="col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Catalogue item (adds stock)</span>
                    <select className={cellInput} value={l.productId} disabled={isStoneLine(l)} onChange={(e) => pickProduct(idx, e.target.value)}>
                      <option value="">Not linked</option>
                      {products.filter((p) => p.category !== 'Unregistered').map((p) => <option key={p.id} value={String(p.id)}>{p.name}{p.huid ? ` (${p.huid})` : p.sku ? ` (${p.sku})` : ''}</option>)}
                    </select>
                  </label>
                  <label className="col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Description</span><input className={cellInput} value={l.description} onChange={(e) => setLine(idx, { description: e.target.value })} placeholder="e.g. 22K chains, 24K bar" /></label>
                  <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Material</span>
                    <select className={cellInput} value={l.metalType} onChange={(e) => setLine(idx, { metalType: e.target.value, purity: e.target.value === 'gold' ? '22K' : '', ...(e.target.value in STONE_MATERIALS ? { productId: '', stone: '' } : {}) })}>
                      <optgroup label="Metal"><option value="gold">Gold</option><option value="silver">Silver</option><option value="platinum">Platinum</option><option value="other">Other</option></optgroup>
                      <optgroup label="Loose stones (to Loose Stones stock)"><option value="diamond">Diamonds</option><option value="gemstone">Gemstones</option><option value="pearl">Pearls</option><option value="traditional">Polki / Kundan / other</option></optgroup>
                    </select>
                  </label>
                  <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">{isStoneLine(l) ? 'Grade / quality' : 'Purity'}</span>
                    {l.metalType === 'gold'
                      ? <select className={cellInput} value={l.purity} onChange={(e) => setLine(idx, { purity: e.target.value })}>{GOLD_PURITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
                      : <input className={cellInput} value={l.purity} onChange={(e) => setLine(idx, { purity: e.target.value })} placeholder="e.g. 925" />}
                  </label>
                  <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">{isStoneLine(l) ? 'Total carat' : 'Gross (g)'}</span><input type="number" min="0" step="0.001" className={cellInput} value={l.gross} onChange={(e) => setLine(idx, { gross: e.target.value })} /></label>
                  {!isStoneLine(l) && <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Stone (g)</span><input type="number" min="0" step="0.001" className={cellInput} value={l.stone} onChange={(e) => setLine(idx, { stone: e.target.value })} /></label>}
                  <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">{isStoneLine(l) ? 'Rate ₹/carat' : 'Rate ₹/g (net)'}</span><input type="number" min="0" step="0.01" className={cellInput} value={l.rate} onChange={(e) => setLine(idx, { rate: e.target.value })} /></label>
                  <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Making ₹</span><input type="number" min="0" step="0.01" className={cellInput} value={l.making} onChange={(e) => setLine(idx, { making: e.target.value })} /></label>
                  <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Other cost ₹</span><input type="number" min="0" step="0.01" className={cellInput} value={l.other} onChange={(e) => setLine(idx, { other: e.target.value })} /></label>
                  <label><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Pieces</span><input type="number" min="1" step="1" className={cellInput} value={l.qty} onChange={(e) => setLine(idx, { qty: e.target.value })} /></label>
                  <label className="col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Stone details</span><input className={cellInput} value={l.stones} onChange={(e) => setLine(idx, { stones: e.target.value })} placeholder="e.g. 12 CZ, 0.30 ct diamond, cert. no." /></label>
                  {lineNet(l) > 0 && n(l.rate) > 0
                    ? <div className="col-span-2 self-end rounded-lg bg-white border px-2 py-1.5 text-xs font-bold text-[#000000]">Net {lineNet(l).toFixed(3)} g → <b>{formatCurrency(lineAmount(l))}</b></div>
                    : <label className="col-span-2"><span className="mb-1 block text-[10px] font-bold uppercase text-[#000000]">Amount ₹ (no weight/rate)</span><input type="number" min="0" step="0.01" className={cellInput} value={l.amount} onChange={(e) => setLine(idx, { amount: e.target.value })} /></label>}
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setLines((cur) => [...cur, emptyLine()])} className="text-xs font-black text-[var(--accent-dark)] hover:underline">+ Add another line</button>
          </div>

          <div className="grid gap-4 sm:grid-cols-4 items-end">
            <Field label="GST on bill %">
              <select className={inputClass} value={pForm.gstRate} onChange={(e) => setPForm((f) => ({ ...f, gstRate: e.target.value }))}>
                <option value="">No GST (non-GST bill)</option>
                {['3', '5', '12', '18'].map((r) => <option key={r} value={r}>{r}% (CGST {Number(r) / 2}% + SGST {Number(r) / 2}%)</option>)}
              </select>
            </Field>
            <div className="sm:col-span-3 rounded-xl bg-[var(--accent-a10)] p-3 text-xs font-semibold text-[#000000]">
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>Items <b>{formatCurrency(purchaseTaxable)}</b></span>
                {purchaseGst > 0 && <><span>CGST {purchaseGstRate / 2}% <b>{formatCurrency(purchaseGst / 2)}</b></span><span>SGST {purchaseGstRate / 2}% <b>{formatCurrency(purchaseGst - Math.round(purchaseGst * 50) / 100)}</b></span><span>Total GST {purchaseGstRate}% <b>{formatCurrency(purchaseGst)}</b></span></>}
              </div>
              <p className="mt-1 text-[10px] font-bold uppercase">Purchase total</p><p className="text-xl font-black">{formatCurrency(purchaseTotal)}</p>
            </div>
            <Field label="Paid now ₹"><input type="number" min="0" step="0.01" className={inputClass} value={pForm.paid} onChange={(e) => setPForm((f) => ({ ...f, paid: e.target.value }))} placeholder="0" /></Field>
            <Field label="Reference"><input className={inputClass} value={pForm.reference} onChange={(e) => setPForm((f) => ({ ...f, reference: e.target.value }))} placeholder="UTR / cheque no." /></Field>
            <div className="sm:col-span-4"><PaymentModePicker label="Paid by" mode={pForm.method as PaymentMode} onMode={(m) => setPForm((f) => ({ ...f, method: m }))} split={pSplit} onSplit={setPSplit} total={n(pForm.paid)} /></div>
          </div>
          <Field label="Notes"><input className={inputClass} value={pForm.notes} onChange={(e) => setPForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
        </div>
        <div className="shrink-0 flex gap-3 border-t border-black/10 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setPurchaseOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">{saving ? 'Saving…' : `Record Purchase (${formatCurrency(purchaseTotal)})`}</button>
        </div>
      </form>
    </div></ModalPortal>}

    {detail && printOpen && (
      <PrintSettingsModal
        onClose={() => setPrintOpen(false)}
        onPrint={(prefs) => prefs.paper === 'thermal' ? printPurchaseThermal(detail, supplierById.get(detail.supplierId), thermalWidth(prefs)) : navigate(`/purchase/${detail.id}?print=${prefs.size}`)}
      />
    )}
    {detail && billPreview && (
      <DocumentPreviewModal title={`Purchase Bill • #${detail.purchaseNumber}`} onClose={() => setBillPreview(false)} onOpenFull={() => navigate(`/purchase/${detail.id}`)}>
        <PurchaseBillSheet purchase={detail} supplier={supplierById.get(detail.supplierId)} payments={detailPayments} />
      </DocumentPreviewModal>
    )}

    {/* ── Purchase detail / pay supplier ── */}
    {detail && <ModalPortal><div className="fixed inset-0 z-[997] flex justify-end bg-black/45">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 sm:p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-black text-[var(--accent-dark)]">{detail.purchaseNumber} • {fmtDate(detail.purchaseDate)}</p><h3 className="text-2xl font-black">{supplierById.get(detail.supplierId)?.name || 'Supplier'}</h3>{detail.supplierInvoiceNo && <p className="text-xs text-[#000000]">Supplier bill {detail.supplierInvoiceNo}</p>}</div>
          <button onClick={() => setDetail(null)}><X /></button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => setPrintOpen(true)} className="flex items-center justify-center gap-2 rounded-xl border border-black/15 bg-white py-3 text-[11px] font-black uppercase tracking-wider text-[#000000] hover:bg-black/5 cursor-pointer"><Printer className="w-4 h-4 text-[var(--accent)]" /> Print</button>
          <button type="button" onClick={() => setBillPreview(true)} className="flex items-center justify-center gap-2 rounded-xl border border-black/15 bg-white py-3 text-[11px] font-black uppercase tracking-wider text-[#000000] hover:bg-black/5 cursor-pointer"><Eye className="w-4 h-4 text-[var(--accent)]" /> View Bill</button>
          <button type="button" onClick={() => sharePurchaseWhatsApp(detail, supplierById.get(detail.supplierId), shopName, `${window.location.origin}/purchase/${detail.id}`)} className="flex items-center justify-center gap-2 rounded-xl bg-[#10B981] hover:bg-[#059669] py-3 text-[11px] font-black uppercase tracking-wider text-white cursor-pointer"><WhatsAppIcon className="w-4 h-4" /> WhatsApp</button>
        </div>
        {modalError && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
        <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] font-bold uppercase tracking-widest text-[#000000] bg-[#F9FAFB]"><tr>{['Item', 'Metal', 'Gross / Stone / Net', 'Rate', 'Making + Other', 'Pcs', 'Amount'].map((h) => <th key={h} className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-black/5">
              {detail.items.map((i, k) => (
                <tr key={k}>
                  <td className="px-4 py-2"><p className="font-bold">{i.description || '—'}</p>{i.product_id && <p className="text-[10px] text-emerald-700">Stock added</p>}{i.stone_details && <p className="text-[10px] text-[#000000] whitespace-normal">{i.stone_details}</p>}</td>
                  <td className="px-4 py-2">{normalizeMetalType(i.metal_type) ? metalLabel(normalizeMetalType(i.metal_type), i.purity) : i.metal_type}</td>
                  <td className="px-4 py-2">{formatWeight(i.gross_weight)} / {formatWeight(i.stone_weight)} / <b>{formatWeight(i.net_weight)}</b></td>
                  <td className="px-4 py-2">{i.rate ? `${formatCurrency(i.rate)}/g` : '—'}</td>
                  <td className="px-4 py-2">{formatCurrency(i.making_cost + i.other_cost)}</td>
                  <td className="px-4 py-2">{i.quantity}</td>
                  <td className="px-4 py-2 font-black">{formatCurrency(i.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {[['Total', detail.totalAmount], ['Paid', detail.amountPaid], ['Owed', detail.due]].map(([k, v]) => <div key={k} className="rounded-xl bg-black/[0.03] p-3"><p className="text-[10px] font-bold uppercase text-[#000000]">{k}</p><p className={`mt-1 text-sm font-black ${k === 'Owed' && Number(v) > 0 ? 'text-red-600' : ''}`}>{formatCurrency(Number(v))}</p></div>)}
        </div>
        {detail.notes && <p className="mt-3 rounded-xl border p-3 text-sm">{detail.notes}</p>}
        {detail.due > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-black/10 p-3">
            <Field label="Balance due date">
              <input type="date" className={inputClass} value={detail.dueDate || ''} onChange={(e) => {
                const value = e.target.value
                purchaseService.setDueDate(detail.id, value || null)
                  .then((updated) => { setDetail(updated); setPurchases((rows) => rows.map((r) => (r.id === updated.id ? updated : r))) })
                  .catch((err) => setModalError(getErrorMessage(err, 'Unable to save the due date')))
              }} />
            </Field>
            <p className="pb-2 text-[11px] font-semibold text-[#000000]/60">{detail.dueDate ? (detail.dueDate < today() ? 'Overdue — pay the supplier.' : 'You will be reminded before this date.') : 'Set a date to get a reminder.'}</p>
          </div>
        )}

        {detail.due > 0 && (
          <form onSubmit={submitPay} className="mt-5 rounded-xl border border-black/10 p-4 space-y-3">
            <h4 className="font-black">Pay Supplier</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Amount ₹"><input type="number" min="0" step="0.01" className={inputClass} value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} /></Field>
              <Field label="Reference"><input className={inputClass} value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} placeholder="UTR / cheque no." /></Field>
            </div>
            <PaymentModePicker label="Paid by" mode={payMode} onMode={setPayMode} split={paySplit} onSplit={setPaySplit} total={n(payForm.amount)} />
            <button disabled={saving} className="w-full rounded-xl bg-[var(--accent-dark)] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">{saving ? 'Saving…' : 'Record Payment'}</button>
          </form>
        )}

        <div className="mt-6">
          <h4 className="font-black">Payments</h4>
          <div className="mt-2 space-y-2">
            {detailPayments.length === 0 ? <p className="text-sm text-[#000000]">No payments yet.</p> : detailPayments.map((pm) => (
              <div key={pm.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-emerald-50 p-3 text-sm">
                <span className="font-bold">{fmtDate(pm.paidAt)} • {formatPaymentMode(pm.paymentMethod)}{pm.reference ? ` • Ref ${pm.reference}` : ''} • {pm.createdBy}</span>
                <span className="flex items-center gap-2 font-black">{formatCurrency(pm.amount)}
                  {isAdmin && <button type="button" title="Delete this payment" onClick={() => void deletePayment(pm.id, pm.amount)} className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`}><Trash2 className="w-4 h-4" /></button>}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div></ModalPortal>}
  </div>
}
