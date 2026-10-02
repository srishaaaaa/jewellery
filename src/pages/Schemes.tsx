import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock3, Download, Eye, Gem, MessageCircle, PiggyBank,
  Plus, Printer, RefreshCw, Search, Settings, Trophy, Wallet, X,
} from 'lucide-react'
import { getErrorMessage } from '../lib/errorMessage'
import { formatCurrency } from '../lib/retail'
import { csvDate, csvPhone, downloadCsv } from '../lib/csv'
import { normalizePhone, toWhatsAppUrl } from '../lib/phone'
import { ModalPortal } from '../components/ModalPortal'
import { useAdminAuthStore, useSettingsStore } from '../store/store'
import { auditService } from '../services/auditService'
import { customerService, type CustomerRecord } from '../services/customerService'
import { schemeService, type SchemeInstallment, type SchemeRedemption } from '../services/schemeService'
import { buildSchemeInstallmentWhatsAppMessage } from '../lib/whatsappMessage'
import { paymentMethodLabel, printSchemeReceipt, totalsAfterInstallment } from '../lib/schemeReceipt'
import {
  BENEFIT_TYPE_LABELS,
  FREQUENCY_LABELS,
  FREQUENCY_PERIOD,
  SCHEME_FREQUENCIES,
  SCHEME_STATUS_LABELS,
  INSTALLMENT_STATUS_LABELS,
  installmentDisplayStatus,
  installmentDueBreakdown,
  defaultMaturityDate,
  monthsBetween,
  deriveSchemeStatus,
  describeSchemeBenefit,
  installmentsDueCount,
  localIsoDate,
  normalizeSchemeRules,
  schemeBalance,
  schemeRemaining,
  schemeTarget,
  validateSchemeInput,
  type BenefitUnit,
  type JewelleryScheme,
  type SchemeBenefitType,
  type SchemeFrequency,
  type SchemeRules,
  type SchemeType,
  type SchemeStatus,
} from '../lib/jewellery'

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[11px] font-black uppercase tracking-wide text-[#6B7280]">{label}</span>{children}</label> }
const inputClass = 'w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-sm text-[#273126] outline-none transition focus:border-[var(--accent-dark)] focus:ring-2 focus:ring-emerald-100'

const STATUS_STYLES: Record<SchemeStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  payment_due: 'bg-red-50 text-red-700 border-red-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
  matured: 'bg-amber-50 text-amber-800 border-amber-200',
  redeemed: 'bg-gray-100 text-gray-700 border-gray-200',
  cancelled: 'bg-gray-50 text-gray-400 border-gray-200',
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const PAYMENT_METHODS = ['cash', 'qr', 'card'] as const
type PaymentMethod = typeof PAYMENT_METHODS[number]

type CreateForm = {
  /** Scheme type the terms come from ('' = custom terms, admin only) */
  typeId: string
  frequency: SchemeFrequency
  phone: string
  customerName: string
  schemeName: string
  monthlyAmount: string
  totalInstallments: string
  durationMonths: string
  durationTouched: boolean
  startDate: string
  maturityDate: string
  maturityTouched: boolean
  benefitType: SchemeBenefitType
  makingBenefitValue: string
  makingBenefitUnit: BenefitUnit
  wastageBenefitValue: string
  wastageBenefitUnit: BenefitUnit
  notes: string
}

/** "₹5,000 / month", "₹100 / day", "₹50,000 one-time deposit". */
const installmentLabel = (s: Pick<JewelleryScheme, 'frequency' | 'monthlyAmount'>) =>
  s.frequency === 'one_time' ? `${formatCurrency(s.monthlyAmount)} one-time` : `${formatCurrency(s.monthlyAmount)} / ${FREQUENCY_PERIOD[s.frequency]}`

/** Default number of installments when a plan is picked. */
const DEFAULT_INSTALLMENTS: Record<SchemeFrequency, number> = { monthly: 11, weekly: 52, daily: 365, one_time: 1 }

const redemptionLabel = (s: JewelleryScheme) => {
  if (s.status === 'redeemed') return 'Redeemed'
  if (s.amountRedeemed > 0) return `Partly redeemed (${formatCurrency(s.amountRedeemed)})`
  if (s.benefitUsed) return 'Benefit used'
  return 'Not redeemed'
}

export default function Schemes() {
  const role = useAdminAuthStore((s) => s.role)
  const adminId = useAdminAuthStore((s) => s.adminId)
  const isAdmin = role === 'admin'
  const staffCanCustomise = useSettingsStore((st) => st.settings?.posPermissions.staffCanCustomiseSchemes) ?? false
  /** Staff without the permission enrol customers only on admin-defined scheme types, with fixed terms. */
  const termsLocked = !isAdmin && !staffCanCustomise
  const staffName = `${isAdmin ? 'Admin' : 'Staff'}${adminId ? ` (${adminId})` : ''}`
  const today = localIsoDate()

  const [schemes, setSchemes] = useState<JewelleryScheme[]>([])
  const [rules, setRules] = useState<SchemeRules>(() => normalizeSchemeRules(null))
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState<'schemes' | 'payments'>('schemes')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SchemeStatus | 'all'>('all')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  // Create
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CreateForm | null>(null)

  // Collect installment
  const [collectScheme, setCollectScheme] = useState<JewelleryScheme | null>(null)
  const [collectInstallments, setCollectInstallments] = useState<SchemeInstallment[]>([])
  const [collectMethod, setCollectMethod] = useState<PaymentMethod>('cash')
  const [collectNotes, setCollectNotes] = useState('')
  const [receipt, setReceipt] = useState<{ scheme: JewelleryScheme; installment: SchemeInstallment } | null>(null)

  // Details
  const [detail, setDetail] = useState<JewelleryScheme | null>(null)
  const [detailInstallments, setDetailInstallments] = useState<SchemeInstallment[]>([])
  const [detailRedemptions, setDetailRedemptions] = useState<SchemeRedemption[]>([])
  const [detailAction, setDetailAction] = useState<'cancel' | 'transfer' | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [transferForm, setTransferForm] = useState({ phone: '', name: '' })

  // Rules
  const [rulesOpen, setRulesOpen] = useState(false)
  const [rulesForm, setRulesForm] = useState<SchemeRules>(rules)

  // Payment history
  const [payments, setPayments] = useState<SchemeInstallment[]>([])
  const [paymentsLoading, setPaymentsLoading] = useState(false)
  const [paymentsFrom, setPaymentsFrom] = useState('')
  const [paymentsTo, setPaymentsTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, loadedRules] = await Promise.all([schemeService.list(), schemeService.fetchRules()])
      setSchemes(list)
      setRules(loadedRules)
      setError('')
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load schemes'))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true)
    try {
      setPayments(await schemeService.fetchPayments({ from: paymentsFrom, to: paymentsTo }))
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load payment history'))
    } finally {
      setPaymentsLoading(false)
    }
  }, [paymentsFrom, paymentsTo])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (view === 'payments') void loadPayments() }, [view, loadPayments])
  useEffect(() => { customerService.fetchAll().then(setCustomers).catch(() => undefined) }, [])

  const schemesById = useMemo(() => new Map(schemes.map((s) => [s.id, s])), [schemes])

  const stats = useMemo(() => {
    let active = 0, completed = 0, matured = 0, redeemed = 0, dueToday = 0, overdue = 0, pending = 0, collected = 0
    for (const s of schemes) {
      const status = deriveSchemeStatus(s, today)
      if (status === 'active' || status === 'payment_due') active++
      if (status === 'completed') completed++
      if (status === 'matured') matured++
      if (status === 'redeemed') redeemed++
      if (s.status !== 'cancelled') collected += s.totalPaid
      const due = installmentDueBreakdown(s, today)
      dueToday += due.dueToday
      overdue += due.overdue
      pending += installmentsDueCount(s, today) * s.monthlyAmount
    }
    return { active, completed, matured, redeemed, dueToday, overdue, pending, collected }
  }, [schemes, today])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return schemes.filter((s) => {
      if (statusFilter !== 'all' && deriveSchemeStatus(s, today) !== statusFilter) return false
      if (!q) return true
      return s.schemeNumber.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q)
        || s.phone.includes(q) || s.schemeName.toLowerCase().includes(q)
    })
  }, [schemes, search, statusFilter, today])

  const replaceScheme = (updated: JewelleryScheme) => {
    setSchemes((rows) => rows.map((row) => (row.id === updated.id ? updated : row)))
    setDetail((d) => (d && d.id === updated.id ? updated : d))
  }

  // ── Create ──────────────────────────────────────────────────────────────
  const activeTypes = rules.types.filter((t) => t.active)

  /** Form values for a scheme type (its terms are copied onto the customer's scheme). */
  const formFromType = (t: SchemeType, base: CreateForm): CreateForm => ({
    ...base,
    typeId: t.id, frequency: t.frequency, schemeName: t.name, monthlyAmount: String(t.amount),
    totalInstallments: String(t.installments), durationMonths: String(t.durationMonths), durationTouched: true, maturityTouched: false,
    maturityDate: defaultMaturityDate(base.startDate, t.frequency, t.installments, t.durationMonths),
    benefitType: t.benefitType, makingBenefitValue: String(t.makingBenefitValue), makingBenefitUnit: t.makingBenefitUnit,
    wastageBenefitValue: String(t.wastageBenefitValue), wastageBenefitUnit: t.wastageBenefitUnit,
  })

  const openCreate = () => {
    if (termsLocked && !activeTypes.length) {
      setError('No scheme types are set up yet. Ask the admin to add one (Schema → Rules → Scheme Types).')
      return
    }
    const installments = Math.min(Math.max(DEFAULT_INSTALLMENTS.monthly, rules.minInstallments), rules.maxInstallments)
    const blank: CreateForm = {
      typeId: '',
      frequency: 'monthly',
      phone: '', customerName: '', schemeName: 'Gold Savings Scheme', monthlyAmount: '',
      totalInstallments: String(installments), durationMonths: String(installments), durationTouched: false,
      startDate: today, maturityDate: defaultMaturityDate(today, 'monthly', installments, installments), maturityTouched: false,
      benefitType: rules.defaultBenefitType,
      makingBenefitValue: String(rules.defaultMakingBenefitValue), makingBenefitUnit: rules.defaultMakingBenefitUnit,
      wastageBenefitValue: String(rules.defaultWastageBenefitValue), wastageBenefitUnit: rules.defaultWastageBenefitUnit,
      notes: '',
    }
    setForm(activeTypes.length ? formFromType(activeTypes[0], blank) : blank)
    setModalError('')
    setCreateOpen(true)
  }

  const pickType = (typeId: string) => {
    setForm((f) => {
      if (!f) return f
      const t = activeTypes.find((x) => x.id === typeId)
      return t ? formFromType(t, f) : { ...f, typeId: '' }
    })
  }

  const updateForm = (patch: Partial<CreateForm>) => {
    setForm((f) => {
      if (!f) return f
      const next = { ...f, ...patch }
      if (patch.frequency && patch.frequency !== f.frequency) {
        // Sensible defaults for the newly picked plan
        const inst = DEFAULT_INSTALLMENTS[patch.frequency]
        next.totalInstallments = String(inst)
        next.durationMonths = String(patch.frequency === 'one_time' ? 12 : inst)
        next.durationTouched = false
        next.schemeName = patch.frequency === 'one_time' ? 'One-time Deposit Scheme' : `${FREQUENCY_LABELS[patch.frequency]} Scheme`
      }
      if ('totalInstallments' in patch && !next.durationTouched && next.frequency === 'monthly') next.durationMonths = patch.totalInstallments || ''
      if (!next.maturityTouched && ('frequency' in patch || 'totalInstallments' in patch || 'durationMonths' in patch || 'startDate' in patch)) {
        const months = Number(next.durationMonths) || 0
        const inst = Number(next.totalInstallments) || 0
        if (/^\d{4}-\d{2}-\d{2}$/.test(next.startDate) && (months > 0 || inst > 0)) {
          next.maturityDate = defaultMaturityDate(next.startDate, next.frequency, inst, months)
        }
      }
      return next
    })
  }

  const lookupCustomer = async () => {
    if (!form) return
    const phone = normalizePhone(form.phone)
    if (!phone) return
    const found = customers.find((c) => c.phone === phone) || await customerService.findByPhone(phone)
    setForm((f) => (f ? { ...f, phone, customerName: f.customerName.trim() || found?.name || f.customerName } : f))
  }

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return
    const phone = normalizePhone(form.phone)
    if (!phone) { setModalError('Enter a valid Indian mobile number for the customer.'); return }
    if (termsLocked && !activeTypes.some((t) => t.id === form.typeId)) { setModalError('Choose a scheme type.'); return }
    const totalInstallments = form.frequency === 'one_time' ? 1 : Number(form.totalInstallments)
    const input = {
      frequency: form.frequency,
      customerName: form.customerName,
      phone,
      schemeName: form.schemeName,
      monthlyAmount: Number(form.monthlyAmount),
      totalInstallments,
      // Daily / weekly plans: duration is simply the months from start to maturity.
      durationMonths: form.frequency === 'daily' || form.frequency === 'weekly'
        ? monthsBetween(form.startDate, form.maturityDate)
        : Number(form.durationMonths),
      startDate: form.startDate,
      maturityDate: form.maturityDate,
      benefitType: form.benefitType,
      makingBenefitValue: Number(form.makingBenefitValue) || 0,
      makingBenefitUnit: form.makingBenefitUnit,
      wastageBenefitValue: Number(form.wastageBenefitValue) || 0,
      wastageBenefitUnit: form.wastageBenefitUnit,
    }
    // Admin-defined scheme types are not held to the general amount / installment limits.
    const invalid = validateSchemeInput(input, form.typeId ? { ...rules, minMonthlyAmount: 0, maxMonthlyAmount: 0, minInstallments: 1, maxInstallments: 1000 } : rules)
    if (invalid) { setModalError(invalid); return }
    setSaving(true)
    setModalError('')
    try {
      const created = await schemeService.create({ ...input, createdBy: staffName, notes: form.notes })
      setSchemes((rows) => [created, ...rows])
      setCreateOpen(false)
      setNotice(`Scheme ${created.schemeNumber} created for ${created.customerName || created.phone}. Collect the first installment to start it.`)
      customerService.fetchAll().then(setCustomers).catch(() => undefined)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to create scheme'))
    } finally {
      setSaving(false)
    }
  }

  // ── Collect installment ─────────────────────────────────────────────────
  const openCollect = async (scheme: JewelleryScheme) => {
    setCollectScheme(scheme)
    setCollectMethod('cash')
    setCollectNotes('')
    setModalError('')
    setCollectInstallments([])
    try {
      setCollectInstallments(await schemeService.fetchInstallments(scheme.id))
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to load installments'))
    }
  }

  const nextInstallment = collectInstallments.find((i) => i.status === 'pending') || null
  const previousPayments = collectInstallments.filter((i) => i.status === 'paid')

  const submitCollect = async (event: FormEvent) => {
    event.preventDefault()
    if (!collectScheme) return
    setSaving(true)
    setModalError('')
    try {
      const result = await schemeService.recordInstallment(collectScheme.id, collectMethod, staffName, collectNotes)
      replaceScheme(result.scheme)
      setCollectScheme(null)
      setReceipt(result)
      if (view === 'payments') void loadPayments()
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to record the installment'))
    } finally {
      setSaving(false)
    }
  }

  const whatsappReceipt = (scheme: JewelleryScheme, installment: SchemeInstallment, totals = { totalPaid: scheme.totalPaid, remaining: schemeRemaining(scheme), nextDueDate: scheme.nextDueDate }) => {
    const message = buildSchemeInstallmentWhatsAppMessage({
      customerName: scheme.customerName,
      schemeNumber: scheme.schemeNumber,
      schemeName: scheme.schemeName,
      receiptNumber: installment.receiptNumber || '',
      installmentNumber: installment.installmentNumber,
      totalInstallments: scheme.totalInstallments,
      amount: installment.amountPaid,
      paymentMethod: installment.paymentMethod || undefined,
      paidAt: installment.paymentDate || new Date().toISOString(),
      totalPaid: totals.totalPaid,
      remainingAmount: totals.remaining,
      nextDueDate: totals.nextDueDate,
    })
    window.open(toWhatsAppUrl(scheme.phone, message), '_blank', 'noopener,noreferrer')
  }

  // ── Details ─────────────────────────────────────────────────────────────
  const openDetail = async (scheme: JewelleryScheme) => {
    setDetail(scheme)
    setDetailAction(null)
    setModalError('')
    setDetailInstallments([])
    setDetailRedemptions([])
    try {
      const [inst, red] = await Promise.all([schemeService.fetchInstallments(scheme.id), schemeService.fetchRedemptions(scheme.id)])
      setDetailInstallments(inst)
      setDetailRedemptions(red)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to load scheme details'))
    }
  }

  const reprintFromHistory = async (payment: SchemeInstallment, mode: 'print' | 'whatsapp') => {
    const scheme = schemesById.get(payment.schemeId)
    if (!scheme) return
    try {
      const inst = await schemeService.fetchInstallments(scheme.id)
      const totals = totalsAfterInstallment(scheme, inst, payment)
      if (mode === 'print') printSchemeReceipt(scheme, payment, totals)
      else whatsappReceipt(scheme, payment, totals)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to load the receipt'))
    }
  }

  const deleteScheme = async () => {
    if (!detail || !isAdmin) return
    if (!window.confirm(`Delete scheme ${detail.schemeNumber} of ${detail.customerName || detail.phone}? This cannot be undone.`)) return
    setSaving(true)
    try {
      await schemeService.remove(detail.id)
      void auditService.log({ action: 'scheme_deleted', entityType: 'scheme', entityId: detail.schemeNumber, oldValue: { customer: detail.customerName, phone: detail.phone, plan: detail.schemeName, amount: detail.monthlyAmount } })
      setSchemes((rows) => rows.filter((row) => row.id !== detail.id))
      setDetail(null)
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete the scheme'))
      setDetail(null)
    } finally {
      setSaving(false)
    }
  }

  const submitCancel = async () => {
    if (!detail) return
    if (!cancelReason.trim()) { setModalError('Enter the reason for cancelling.'); return }
    if (!window.confirm(`Cancel scheme ${detail.schemeNumber}? No further installments can be collected.`)) return
    setSaving(true)
    setModalError('')
    try {
      const updated = await schemeService.cancel(detail.id, cancelReason.trim(), staffName)
      replaceScheme(updated)
      setDetailAction(null)
      void auditService.log({ action: 'scheme_cancelled', entityType: 'scheme', entityId: updated.schemeNumber, oldValue: { status: detail.status, total_paid: detail.totalPaid }, newValue: { status: 'cancelled' }, note: cancelReason.trim() })
      setNotice(`Scheme ${updated.schemeNumber} cancelled.`)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to cancel the scheme'))
    } finally {
      setSaving(false)
    }
  }

  const submitTransfer = async () => {
    if (!detail) return
    const phone = normalizePhone(transferForm.phone)
    if (!phone) { setModalError('Enter a valid mobile number for the new customer.'); return }
    if (phone === detail.phone) { setModalError('The scheme already belongs to this customer.'); return }
    setSaving(true)
    setModalError('')
    try {
      const updated = await schemeService.transfer(detail.id, phone, transferForm.name.trim(), staffName)
      replaceScheme(updated)
      setDetailAction(null)
      void auditService.log({ action: 'scheme_transferred', entityType: 'scheme', entityId: updated.schemeNumber, oldValue: { customer: detail.customerName, phone: detail.phone }, newValue: { customer: updated.customerName, phone: updated.phone } })
      setNotice(`Scheme ${updated.schemeNumber} transferred to ${updated.customerName || updated.phone}.`)
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to transfer the scheme'))
    } finally {
      setSaving(false)
    }
  }

  // ── Rules ───────────────────────────────────────────────────────────────
  const saveRules = async (event: FormEvent) => {
    event.preventDefault()
    const next = normalizeSchemeRules(rulesForm)
    if (next.minInstallments > next.maxInstallments) { setModalError('Minimum installments cannot be more than the maximum.'); return }
    if (next.maxMonthlyAmount > 0 && next.minMonthlyAmount > next.maxMonthlyAmount) { setModalError('Minimum monthly amount cannot be more than the maximum.'); return }
    const badType = next.types.find((t) => t.amount <= 0 || (t.frequency === 'one_time' ? t.installments !== 1 : t.installments < 1))
    if (badType) { setModalError(`Scheme type "${badType.name}": enter the amount (and 1 installment for a one-time deposit).`); return }
    setSaving(true)
    setModalError('')
    try {
      await schemeService.saveRules(next)
      void auditService.log({ action: 'scheme_rules_changed', entityType: 'scheme_rules', oldValue: { types: rules.types.length, min_installments: rules.minInstallments, max_installments: rules.maxInstallments, partial: rules.allowPartialRedemption, require_maturity: rules.requireMaturityForRedemption, expiry_months: rules.expiryMonths }, newValue: { types: next.types.length, min_installments: next.minInstallments, max_installments: next.maxInstallments, partial: next.allowPartialRedemption, require_maturity: next.requireMaturityForRedemption, expiry_months: next.expiryMonths } })
      setRules(next)
      setRulesOpen(false)
      setNotice('Scheme rules saved.')
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to save scheme rules'))
    } finally {
      setSaving(false)
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────
  const exportSchemes = () => downloadCsv(`schemes_${today}.csv`, [
    ['Scheme ID', 'Scheme', 'Plan', 'Customer', 'Phone', 'Start Date', 'Maturity Date', 'Installment (INR)', 'Installments', 'Paid Installments', 'Total Paid (INR)', 'Remaining (INR)', 'Balance Available (INR)', 'Next Due', 'Status', 'Benefit', 'Redemption'],
    ...filtered.map((s) => [
      s.schemeNumber, s.schemeName, FREQUENCY_LABELS[s.frequency], s.customerName, csvPhone(s.phone), csvDate(s.startDate), csvDate(s.maturityDate),
      s.monthlyAmount.toFixed(2), s.totalInstallments, s.installmentsPaid, s.totalPaid.toFixed(2), schemeRemaining(s).toFixed(2),
      schemeBalance(s).toFixed(2), csvDate(s.nextDueDate), SCHEME_STATUS_LABELS[deriveSchemeStatus(s, today)],
      describeSchemeBenefit(s, (n) => `Rs.${n}`), redemptionLabel(s),
    ]),
  ])

  const exportPayments = () => downloadCsv(`scheme_payments_${today}.csv`, [
    ['Date', 'Receipt No', 'Scheme ID', 'Customer', 'Phone', 'Installment', 'Amount (INR)', 'Method', 'Received By', 'Notes'],
    ...payments.map((p) => {
      const s = schemesById.get(p.schemeId)
      return [csvDate(p.paymentDate, true), p.receiptNumber, s?.schemeNumber, s?.customerName, csvPhone(s?.phone), p.installmentNumber, p.amountPaid.toFixed(2), paymentMethodLabel(p.paymentMethod), p.createdBy, p.notes]
    }),
  ])

  const cards = [
    ['Active Schemes', stats.active, PiggyBank, 'text-emerald-700 bg-emerald-50'],
    ['Total Amount Collected', formatCurrency(stats.collected), Wallet, 'text-fuchsia-700 bg-fuchsia-50'],
    ['Installments Due Today', stats.dueToday, Clock3, 'text-orange-700 bg-orange-50'],
    ['Overdue Installments', stats.overdue, AlertTriangle, 'text-red-700 bg-red-50'],
    ['Pending Payments', formatCurrency(stats.pending), Wallet, 'text-orange-700 bg-orange-50'],
    ['Completed Schemes', stats.completed, CheckCircle2, 'text-blue-700 bg-blue-50'],
    ['Matured Schemes', stats.matured, Trophy, 'text-amber-700 bg-amber-50'],
    ['Redeemed Schemes', stats.redeemed, Gem, 'text-slate-700 bg-slate-100'],
  ] as const

  const createTarget = form ? (Number(form.monthlyAmount) || 0) * (form.frequency === 'one_time' ? 1 : (Number(form.totalInstallments) || 0)) : 0

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-black uppercase tracking-[.18em] text-emerald-600">Jewellery savings scheme</p>
        <h2 className="text-2xl font-black text-[#273126]">Schema</h2>
        <p className="mt-1 text-sm text-[#6B7280]">Daily, weekly or monthly savings and one-time deposits that customers redeem against a jewellery purchase with a making / wastage benefit.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={openCreate} className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-black text-white hover:opacity-90 cursor-pointer">
          <Plus size={16} /> New Scheme
        </button>
        {isAdmin && (
          <button onClick={() => { setRulesForm(rules); setModalError(''); setRulesOpen(true) }} className="rounded-xl border bg-white p-3 text-[#647064] cursor-pointer" title="Scheme Rules">
            <Settings size={18} />
          </button>
        )}
        <button onClick={() => { void load(); if (view === 'payments') void loadPayments() }} className="rounded-xl border bg-white p-3 text-[#647064] cursor-pointer" title="Refresh">
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>

    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value, Icon, color]) => (
        <div key={label} className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-wide text-[#879086]">{label}</p>
              <p className="mt-2 text-[17px] sm:text-2xl font-black text-[#273126] break-words">{value}</p>
            </div>
            <div className={`rounded-xl p-3 ${color}`}><Icon size={21} /></div>
          </div>
        </div>
      ))}
    </div>

    <div className="flex gap-2 border-b border-[#E5E7EB]">
      {([['schemes', 'Schemes'], ['payments', 'Payment History']] as const).map(([key, label]) => (
        <button key={key} onClick={() => setView(key)}
          className={`px-4 py-3 font-bold text-sm transition-colors ${view === key ? 'text-[var(--accent-dark)] border-b-2 border-[var(--accent-dark)]' : 'text-[#6B7280] hover:text-[#111111]'}`}>
          {label}
        </button>
      ))}
    </div>

    {view === 'schemes' ? <>
      <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <label className="relative"><Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17} /><input className={`${inputClass} pl-10`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search scheme ID, customer, phone or scheme name" /></label>
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'payment_due', 'completed', 'matured', 'redeemed', 'cancelled'] as const).map((value) => (
              <button key={value} onClick={() => setStatusFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-black ${statusFilter === value ? 'bg-[var(--accent-dark)] text-white' : 'bg-[#F5F3F7] text-[#626B61]'}`}>
                {value === 'all' ? 'All' : SCHEME_STATUS_LABELS[value]}
              </button>
            ))}
          </div>
          <button onClick={exportSchemes} disabled={!filtered.length} className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 cursor-pointer">
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm flex flex-col">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
              <tr>
                {['Scheme ID / Start', 'Customer', 'Installment / Paid', 'Paid / Remaining', 'Next Due / Maturity', 'Benefit', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9]">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[#6B7280]">Loading schemes...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[#6B7280]">{schemes.length ? 'No schemes match these filters.' : 'No schemes yet. Click "New Scheme" to enrol a customer.'}</td></tr>
              ) : filtered.map((s) => {
                const status = deriveSchemeStatus(s, today)
                const canCollect = s.status === 'active'
                return (
                  <tr key={s.id} className="hover:bg-emerald-50/30 transition-colors">
                    <td className="px-4 py-3.5 align-middle">
                      <p className="font-black text-emerald-700">{s.schemeNumber}</p>
                      <p className="text-[11px] text-[#8B9389]">{FREQUENCY_LABELS[s.frequency]} • {fmtDate(s.startDate)}</p>
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <p className="font-bold text-[#273126]">{s.customerName || '—'}</p>
                      <p className="text-xs text-[#727970]">{s.phone}</p>
                    </td>
                    <td className="px-4 py-3.5 align-middle text-xs">
                      <p className="font-bold text-[#273126]">{installmentLabel(s)}</p>
                      <p className="text-[#858C83]">{s.installmentsPaid} of {s.totalInstallments} paid</p>
                    </td>
                    <td className="px-4 py-3.5 align-middle text-xs">
                      <p className="text-emerald-700">Paid: <b>{formatCurrency(s.totalPaid)}</b></p>
                      <p className="text-red-600">Remaining: <b>{formatCurrency(schemeRemaining(s))}</b></p>
                    </td>
                    <td className="px-4 py-3.5 align-middle text-xs">
                      <div className="flex items-center gap-1.5 font-semibold text-gray-700"><CalendarDays size={14} className="text-gray-400 shrink-0" /><span>{s.nextDueDate ? fmtDate(s.nextDueDate) : '—'}</span></div>
                      <p className="text-[#858C83] mt-0.5">Matures {fmtDate(s.maturityDate)}</p>
                    </td>
                    <td className="px-4 py-3.5 align-middle text-xs">
                      <p className="font-bold text-[#273126]">{describeSchemeBenefit(s, formatCurrency)}</p>
                      <p className="text-[#858C83]">{redemptionLabel(s)}</p>
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <span className={`inline-block rounded-xl border px-2.5 py-1.5 text-xs font-black ${STATUS_STYLES[status]}`}>{SCHEME_STATUS_LABELS[status]}</span>
                    </td>
                    <td className="px-4 py-3.5 align-middle">
                      <div className="flex items-center gap-1.5">
                        {canCollect && (
                          <button type="button" onClick={() => void openCollect(s)} className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 text-xs font-black shadow-xs transition-all active:scale-95 cursor-pointer whitespace-nowrap" title="Collect Installment">
                            Collect
                          </button>
                        )}
                        <button type="button" onClick={() => void openDetail(s)} className="w-8 h-8 rounded-lg bg-[#F4F2F6] hover:bg-emerald-100 text-emerald-700 flex items-center justify-center transition-colors cursor-pointer shrink-0" title="View Details">
                          <Eye size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </> : <>
      <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input type="date" className={inputClass} value={paymentsFrom} onChange={(e) => setPaymentsFrom(e.target.value)} aria-label="From date" />
          <input type="date" className={inputClass} value={paymentsTo} onChange={(e) => setPaymentsTo(e.target.value)} aria-label="To date" />
          <button onClick={exportPayments} disabled={!payments.length} className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40 cursor-pointer">
            <Download size={13} /> Export CSV
          </button>
        </div>
      </div>
      <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm flex flex-col">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
              <tr>{['Date', 'Receipt No', 'Scheme / Customer', 'Installment', 'Amount', 'Method', 'Received By', 'Notes', 'Receipt'].map((h) => <th key={h} className="px-4 py-3.5 whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9]">
              {paymentsLoading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[#6B7280]">Loading payments...</td></tr>
              ) : payments.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[#6B7280]">No installment payments in this period.</td></tr>
              ) : payments.map((p) => {
                const s = schemesById.get(p.schemeId)
                return (
                  <tr key={p.id} className="hover:bg-emerald-50/30 transition-colors">
                    <td className="px-4 py-3.5 text-xs font-semibold text-[#273126]">{p.paymentDate ? new Date(p.paymentDate).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-4 py-3.5 font-black text-emerald-700">{p.receiptNumber}</td>
                    <td className="px-4 py-3.5"><p className="font-bold text-[#273126]">{s?.schemeNumber || '—'}</p><p className="text-xs text-[#727970]">{s?.customerName || ''} {s?.phone ? `• ${s.phone}` : ''}</p></td>
                    <td className="px-4 py-3.5 text-xs font-bold">{p.installmentNumber}{s ? ` of ${s.totalInstallments}` : ''}</td>
                    <td className="px-4 py-3.5 font-black text-[#273126]">{formatCurrency(p.amountPaid)}</td>
                    <td className="px-4 py-3.5 text-xs">{paymentMethodLabel(p.paymentMethod)}</td>
                    <td className="px-4 py-3.5 text-xs text-[#6B7280]">{p.createdBy || '—'}</td>
                    <td className="px-4 py-3.5 text-xs text-[#6B7280] max-w-[200px] truncate" title={p.notes}>{p.notes || '—'}</td>
                    <td className="px-4 py-3.5">
                      {s && <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => void reprintFromHistory(p, 'print')} className="w-8 h-8 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 flex items-center justify-center cursor-pointer" title="Print Receipt"><Printer size={15} /></button>
                        <button type="button" onClick={() => void reprintFromHistory(p, 'whatsapp')} className="w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center cursor-pointer" title="Send Receipt on WhatsApp"><MessageCircle size={15} /></button>
                      </div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>}

    {/* ── Create scheme ── */}
    {createOpen && form && <ModalPortal><div className="fixed inset-0 z-[998] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitCreate} className="flex w-full max-w-3xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><h3 className="text-xl font-black text-[#273126]">Create Scheme</h3><p className="text-xs text-[#6B7280]">Installment rows are created automatically — collect each payment from the scheme list.</p></div>
          <button type="button" onClick={() => setCreateOpen(false)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {modalError && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-[#879086]">Customer</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Mobile Number *">
              <input required className={inputClass} list="scheme-customers" value={form.phone} onChange={(e) => updateForm({ phone: e.target.value })} onBlur={() => void lookupCustomer()} placeholder="Existing or new customer" />
              <datalist id="scheme-customers">{customers.map((c) => <option key={c.id} value={c.phone}>{c.name}</option>)}</datalist>
            </Field>
            <Field label="Customer Name"><input className={inputClass} value={form.customerName} onChange={(e) => updateForm({ customerName: e.target.value })} placeholder="Filled in for existing customers" /></Field>
          </div>
          <p className="mt-5 mb-2 text-[11px] font-black uppercase tracking-wide text-[#879086]">Scheme Details</p>
          {(activeTypes.length > 0 || termsLocked) && (
            <div className="mb-4">
              <Field label="Scheme Type *">
                <select className={inputClass} value={form.typeId} onChange={(e) => pickType(e.target.value)}>
                  {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name} — {formatCurrency(t.amount)} {t.frequency === 'one_time' ? 'one-time' : `/ ${FREQUENCY_PERIOD[t.frequency]} × ${t.installments}`}</option>)}
                  {!termsLocked && <option value="">Custom terms</option>}
                </select>
              </Field>
              {termsLocked && <p className="mt-1 text-[11px] font-semibold text-[#6B7280]">The terms come from the scheme type and cannot be changed here.</p>}
            </div>
          )}
          <fieldset disabled={termsLocked} className="contents">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Plan *">
              <select className={inputClass} value={form.frequency} onChange={(e) => updateForm({ frequency: e.target.value as SchemeFrequency })}>
                {SCHEME_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
              </select>
            </Field>
            <Field label="Scheme Name *"><input required className={inputClass} value={form.schemeName} onChange={(e) => updateForm({ schemeName: e.target.value })} /></Field>
            <Field label="Scheme Number"><div className="rounded-xl bg-[#F8F7F4] px-3.5 py-2.5 text-sm font-bold text-[#858C83]">Auto (SCH…)</div></Field>
            <Field label={form.frequency === 'one_time' ? 'Deposit Amount (₹) *' : `${form.frequency === 'daily' ? 'Daily' : form.frequency === 'weekly' ? 'Weekly' : 'Monthly'} Installment (₹) *`}>
              <input required type="number" min="1" step="0.01" className={inputClass} value={form.monthlyAmount} onChange={(e) => updateForm({ monthlyAmount: e.target.value })} placeholder={form.frequency === 'monthly' ? `Min ${rules.minMonthlyAmount}` : '0'} />
            </Field>
            {form.frequency !== 'one_time' && (
              <Field label={`Number of Installments (${FREQUENCY_PERIOD[form.frequency]}s) *`}>
                <input required type="number" min={form.frequency === 'monthly' ? rules.minInstallments : 1} max={form.frequency === 'monthly' ? rules.maxInstallments : 1000} step="1" className={inputClass} value={form.totalInstallments} onChange={(e) => updateForm({ totalInstallments: e.target.value })} />
              </Field>
            )}
            {(form.frequency === 'monthly' || form.frequency === 'one_time') && (
              <Field label={form.frequency === 'one_time' ? 'Deposit Term (months)' : 'Duration (months)'}>
                <input required type="number" min="1" step="1" className={inputClass} value={form.durationMonths} onChange={(e) => updateForm({ durationMonths: e.target.value, durationTouched: true })} />
              </Field>
            )}
          </div>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-3 mt-4">
            <Field label="Start Date *"><input required type="date" className={inputClass} value={form.startDate} onChange={(e) => updateForm({ startDate: e.target.value })} /></Field>
            <Field label="Maturity Date *"><input required type="date" className={inputClass} value={form.maturityDate} onChange={(e) => updateForm({ maturityDate: e.target.value, maturityTouched: true })} /></Field>
            <Field label={form.frequency === 'one_time' ? 'Deposit' : 'Total to be saved'}><div className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm font-black text-emerald-800">{formatCurrency(createTarget)}</div></Field>
          </div>
          <p className="mt-5 mb-2 text-[11px] font-black uppercase tracking-wide text-[#879086]">Benefit on redemption</p>
          <fieldset disabled={termsLocked} className="contents">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Benefit Type">
              <select className={inputClass} value={form.benefitType} onChange={(e) => updateForm({ benefitType: e.target.value as SchemeBenefitType })}>
                {(Object.keys(BENEFIT_TYPE_LABELS) as SchemeBenefitType[]).map((t) => <option key={t} value={t}>{BENEFIT_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            {form.benefitType !== 'wastage' && (
              <Field label="Making Charge Discount">
                <div className="flex gap-2">
                  <select className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm font-black text-[#273126] outline-none" value={form.makingBenefitUnit} onChange={(e) => updateForm({ makingBenefitUnit: e.target.value as BenefitUnit })}><option value="percent">%</option><option value="fixed">₹</option></select>
                  <input type="number" min="0" step="0.01" className={`${inputClass} flex-1`} value={form.makingBenefitValue} onChange={(e) => updateForm({ makingBenefitValue: e.target.value })} />
                </div>
              </Field>
            )}
            {form.benefitType !== 'making' && (
              <Field label="Wastage Discount">
                <div className="flex gap-2">
                  <select className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm font-black text-[#273126] outline-none" value={form.wastageBenefitUnit} onChange={(e) => updateForm({ wastageBenefitUnit: e.target.value as BenefitUnit })}><option value="percent">%</option><option value="fixed">₹</option></select>
                  <input type="number" min="0" step="0.01" className={`${inputClass} flex-1`} value={form.wastageBenefitValue} onChange={(e) => updateForm({ wastageBenefitValue: e.target.value })} />
                </div>
              </Field>
            )}
          </div>
          </fieldset>
          <div className="mt-4"><Field label="Notes"><input className={inputClass} value={form.notes} onChange={(e) => updateForm({ notes: e.target.value })} placeholder="Optional" /></Field></div>
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-[11px] font-semibold text-amber-800">
            The benefit only reduces making charges / wastage when the scheme is redeemed on a jewellery bill — never the metal value. These terms are saved with the customer's scheme; later changes to scheme types do not affect it.
          </p>
        </div>
        <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setCreateOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create Scheme'}</button>
        </div>
      </form>
    </div></ModalPortal>}

    {/* ── Collect installment ── */}
    {collectScheme && <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={submitCollect} className="flex w-full max-w-md max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><p className="text-xs font-black uppercase tracking-wider text-emerald-600">{collectScheme.schemeNumber} • {collectScheme.customerName || collectScheme.phone}</p><h3 className="text-xl font-black text-[#273126]">Collect Installment</h3></div>
          <button type="button" onClick={() => setCollectScheme(null)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
          {modalError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          {!nextInstallment ? (
            <p className="text-sm text-[#6B7280]">{collectInstallments.length ? 'All installments are paid.' : 'Loading installments…'}</p>
          ) : <>
            <div className="rounded-2xl bg-emerald-50 py-4 text-center">
              <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Installment {nextInstallment.installmentNumber} of {collectScheme.totalInstallments}</p>
              <p className="mt-1 text-3xl font-black text-emerald-800">{formatCurrency(nextInstallment.amountDue)}</p>
              <p className={`mt-1 text-xs font-bold ${nextInstallment.dueDate < today ? 'text-red-600' : 'text-emerald-700'}`}>Due {fmtDate(nextInstallment.dueDate)}{nextInstallment.dueDate < today ? ' (overdue)' : ''}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Previous Payments', String(previousPayments.length)], ['Total Paid', formatCurrency(collectScheme.totalPaid)], ['Remaining', `${collectScheme.totalInstallments - collectScheme.installmentsPaid} inst.`]].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-[#F8F7F4] p-2.5"><p className="text-[9px] font-black uppercase text-[#858C83]">{k}</p><p className="mt-0.5 text-sm font-black text-[#273126] break-words">{v}</p></div>
              ))}
            </div>
            <Field label="Payment Method">
              <div className="grid grid-cols-3 gap-1.5">
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" onClick={() => setCollectMethod(m)}
                    className={`py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 transition-colors ${collectMethod === m ? 'bg-[#0A0A0A] text-[var(--accent)] border-[#0A0A0A]' : 'bg-white text-[#374151] border-gray-200 hover:border-gray-300'}`}>
                    {paymentMethodLabel(m)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Notes"><input className={inputClass} value={collectNotes} onChange={(e) => setCollectNotes(e.target.value)} placeholder="Optional (e.g. UPI ref no.)" /></Field>
            {previousPayments.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-[#6B7280]">Previous payments</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {previousPayments.slice().reverse().map((p) => (
                    <div key={p.id} className="flex justify-between rounded-lg bg-[#F8F7F4] px-3 py-1.5 text-xs"><span className="font-bold">#{p.installmentNumber} • {fmtDate(p.paymentDate)} • {paymentMethodLabel(p.paymentMethod)}</span><span className="font-black">{formatCurrency(p.amountPaid)}</span></div>
                  ))}
                </div>
              </div>
            )}
          </>}
        </div>
        <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button disabled={saving || !nextInstallment} className="w-full rounded-xl bg-emerald-600 py-3 sm:py-3.5 font-black text-white shadow-lg shadow-emerald-600/30 transition-transform active:scale-95 disabled:opacity-50">
            {saving ? 'Processing...' : nextInstallment ? `Receive ${formatCurrency(nextInstallment.amountDue)}` : 'Nothing due'}
          </button>
        </div>
      </form>
    </div></ModalPortal>}

    {/* ── Receipt after payment ── */}
    {receipt && <ModalPortal><div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
        <p className="mt-4 text-[11px] font-black uppercase tracking-[.16em] text-emerald-600">Installment received</p>
        <h3 className="mt-1 text-2xl font-black text-[#111111]">{receipt.installment.receiptNumber}</h3>
        <p className="mt-2 text-sm text-[#6B7280]">
          {receipt.scheme.schemeNumber} · Installment {receipt.installment.installmentNumber} of {receipt.scheme.totalInstallments} · {formatCurrency(receipt.installment.amountPaid)}
        </p>
        <p className="mt-1 text-sm text-[#6B7280]">Total paid {formatCurrency(receipt.scheme.totalPaid)} · {receipt.scheme.nextDueDate ? `Next due ${fmtDate(receipt.scheme.nextDueDate)}` : `Scheme ${SCHEME_STATUS_LABELS[deriveSchemeStatus(receipt.scheme, today)].toLowerCase()}`}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={() => printSchemeReceipt(receipt.scheme, receipt.installment)} className="rounded-xl border border-emerald-200 py-3 text-sm font-black text-emerald-700"><Printer size={16} className="mr-1 inline" />Print Receipt</button>
          <button onClick={() => whatsappReceipt(receipt.scheme, receipt.installment)} className="rounded-xl bg-[#25D366] py-3 text-sm font-black text-white"><MessageCircle size={16} className="mr-1 inline -mt-0.5" />WhatsApp</button>
        </div>
        <button onClick={() => setReceipt(null)} className="mt-3 w-full rounded-xl bg-[#111111] py-3 text-sm font-black text-white">Done</button>
      </div>
    </div></ModalPortal>}

    {/* ── Details drawer ── */}
    {detail && <ModalPortal><div className="fixed inset-0 z-[997] flex justify-end bg-black/45">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 sm:p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div><p className="text-xs font-black text-emerald-600">{detail.schemeNumber}</p><h3 className="text-2xl font-black">{detail.schemeName}</h3></div>
          <button onClick={() => setDetail(null)}><X /></button>
        </div>
        {modalError && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            ['Customer', detail.customerName || '—'], ['Phone', detail.phone], ['Status', SCHEME_STATUS_LABELS[deriveSchemeStatus(detail, today)]],
            ['Start Date', fmtDate(detail.startDate)], ['Maturity Date', fmtDate(detail.maturityDate)], ['Next Due', fmtDate(detail.nextDueDate)],
            ['Plan', FREQUENCY_LABELS[detail.frequency]], ['Installment', installmentLabel(detail)], ['Installments', `${detail.installmentsPaid} of ${detail.totalInstallments} paid`],
            ['Total Paid', formatCurrency(detail.totalPaid)], ['Remaining', formatCurrency(schemeRemaining(detail))], ['Scheme Target', formatCurrency(schemeTarget(detail))],
            ['Benefit', describeSchemeBenefit(detail, formatCurrency)], ['Redemption', redemptionLabel(detail)], ['Balance Available', formatCurrency(schemeBalance(detail))],
          ].map(([k, v]) => <div key={k} className="rounded-xl bg-[#F8F7F4] p-3"><p className="text-[10px] font-black uppercase text-[#858C83]">{k}</p><p className="mt-1 break-words text-sm font-bold">{v}</p></div>)}
        </div>
        {detail.cancelReason && <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm"><b>Cancelled:</b> {detail.cancelReason}</div>}
        {detail.notes && <div className="mt-3 rounded-xl border p-3"><p className="text-[10px] font-black uppercase text-[#858C83]">Notes</p><p className="text-sm">{detail.notes}</p></div>}

        <div className="mt-6">
          <h4 className="font-black">Installments</h4>
          <div className="mt-2 overflow-x-auto rounded-xl border border-[#ECE9E2]">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]"><tr>{['#', 'Due', 'Amount', 'Status', 'Paid On', 'Method', 'Receipt', ''].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-[#F0EEE9]">
                {detailInstallments.map((i) => (
                  <tr key={i.id}>
                    <td className="px-3 py-2 font-bold">{i.installmentNumber}</td>
                    <td className={`px-3 py-2 ${installmentDisplayStatus(i, detail.status, today) === 'overdue' ? 'text-red-600 font-bold' : ''}`}>{fmtDate(i.dueDate)}</td>
                    <td className="px-3 py-2 font-bold">{formatCurrency(i.status === 'paid' ? i.amountPaid : i.amountDue)}</td>
                    <td className="px-3 py-2">{(() => {
                      const st = installmentDisplayStatus(i, detail.status, today)
                      const cls = { paid: 'bg-emerald-50 text-emerald-700', due: 'bg-amber-50 text-amber-800', overdue: 'bg-red-50 text-red-700', upcoming: 'bg-gray-100 text-gray-600', cancelled: 'bg-gray-50 text-gray-400' }[st]
                      return <span className={`rounded-lg px-2 py-0.5 text-[10px] font-black ${cls}`}>{INSTALLMENT_STATUS_LABELS[st]}</span>
                    })()}</td>
                    <td className="px-3 py-2">{fmtDate(i.paymentDate)}</td>
                    <td className="px-3 py-2">{i.status === 'paid' ? paymentMethodLabel(i.paymentMethod) : '—'}</td>
                    <td className="px-3 py-2 font-bold text-emerald-700">{i.receiptNumber || '—'}</td>
                    <td className="px-3 py-2">{i.status === 'paid' && (
                      <div className="flex gap-1">
                        <button onClick={() => printSchemeReceipt(detail, i, totalsAfterInstallment(detail, detailInstallments, i))} className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center" title="Print Receipt"><Printer size={13} /></button>
                        <button onClick={() => whatsappReceipt(detail, i, totalsAfterInstallment(detail, detailInstallments, i))} className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center" title="WhatsApp Receipt"><MessageCircle size={13} /></button>
                      </div>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6">
          <h4 className="font-black">Redemptions</h4>
          <div className="mt-2 space-y-2">
            {detailRedemptions.length === 0 ? <p className="text-sm text-[#6B7280]">Not redeemed yet.</p> : detailRedemptions.map((r) => (
              <div key={r.id} className={`flex flex-wrap justify-between gap-2 rounded-xl p-3 text-sm ${r.status === 'reversed' ? 'bg-gray-50 text-gray-400 line-through' : 'bg-emerald-50'}`}>
                <span className="font-bold">{fmtDate(r.redeemedAt)} • {r.invoiceNo || 'No invoice'}{r.benefitApplied > 0 ? ` • Benefit ${formatCurrency(r.benefitApplied)}` : ''}</span>
                <span className="font-black">{formatCurrency(r.amountUsed)} used • {formatCurrency(r.balanceAfter)} left</span>
              </div>
            ))}
          </div>
        </div>

        {detail.transferHistory.length > 0 && (
          <div className="mt-6">
            <h4 className="font-black">Transfers</h4>
            <div className="mt-2 space-y-1">
              {detail.transferHistory.map((t, idx) => (
                <p key={idx} className="rounded-xl bg-[#F8F7F4] p-2.5 text-xs">{fmtDate(String(t.at || ''))}: {String(t.from_name || '')} ({String(t.from_phone || '')}) → {String(t.to_name || '')} ({String(t.to_phone || '')}) by {String(t.by || '')}</p>
              ))}
            </div>
          </div>
        )}

        {isAdmin && detail.installmentsPaid === 0 && detail.totalPaid === 0 && detail.amountRedeemed === 0 && !detail.benefitUsed && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50/50 p-4">
            <p className="text-xs font-semibold text-red-700">No payments yet — this scheme can be deleted if it was created by mistake.</p>
            <button onClick={() => void deleteScheme()} disabled={saving} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">Delete scheme</button>
          </div>
        )}

        {isAdmin && detail.status !== 'cancelled' && detail.status !== 'redeemed' && (rules.allowCancellation || rules.allowTransfer) && (
          <div className="mt-6 rounded-2xl border border-[#ECE9E2] p-4">
            <h4 className="font-black">Admin Actions</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {rules.allowTransfer && <button onClick={() => { setDetailAction('transfer'); setTransferForm({ phone: '', name: '' }); setModalError('') }} className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-black text-emerald-700">Transfer to another customer</button>}
              {rules.allowCancellation && detail.amountRedeemed === 0 && <button onClick={() => { setDetailAction('cancel'); setCancelReason(''); setModalError('') }} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-600">Cancel scheme</button>}
            </div>
            {detailAction === 'transfer' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
                <Field label="New customer mobile"><input className={inputClass} list="scheme-customers-transfer" value={transferForm.phone} onChange={(e) => setTransferForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
                <datalist id="scheme-customers-transfer">{customers.map((c) => <option key={c.id} value={c.phone}>{c.name}</option>)}</datalist>
                <Field label="New customer name"><input className={inputClass} value={transferForm.name} onChange={(e) => setTransferForm((f) => ({ ...f, name: e.target.value }))} /></Field>
                <button disabled={saving} onClick={() => void submitTransfer()} className="rounded-xl bg-[var(--accent-dark)] px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">Transfer</button>
              </div>
            )}
            {detailAction === 'cancel' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] items-end">
                <Field label="Reason for cancelling"><input className={inputClass} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Customer request, amount refunded" /></Field>
                <button disabled={saving} onClick={() => void submitCancel()} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">Cancel Scheme</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div></ModalPortal>}

    {/* ── Rules (admin) ── */}
    {rulesOpen && <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <form onSubmit={saveRules} className="flex w-full max-w-2xl max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-2xl sm:rounded-3xl bg-white shadow-2xl">
        <div className="shrink-0 flex items-start justify-between border-b border-gray-100 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
          <div><h3 className="text-xl font-black text-[#273126] flex items-center gap-2"><Gem size={18} className="text-[var(--accent)]" /> Scheme Rules</h3><p className="text-xs text-[#6B7280]">Applied to new schemes and to redemptions at billing.</p></div>
          <button type="button" onClick={() => setRulesOpen(false)} className="shrink-0 text-[#858C83] hover:text-black"><X size={20} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
          {modalError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</div>}
          <div className="rounded-2xl border border-[#ECE9E2] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div><p className="text-sm font-black text-[#273126]">Scheme Types</p><p className="text-[11px] text-[#6B7280]">Plans offered to customers. Changing a type never changes schemes already created.</p></div>
              <button type="button" onClick={() => setRulesForm((r) => ({ ...r, types: [...r.types, { id: `type-${Date.now()}`, name: 'Monthly Gold Savings', frequency: 'monthly', amount: 5000, installments: 11, durationMonths: 11, benefitType: r.defaultBenefitType, makingBenefitValue: r.defaultMakingBenefitValue, makingBenefitUnit: r.defaultMakingBenefitUnit, wastageBenefitValue: r.defaultWastageBenefitValue, wastageBenefitUnit: r.defaultWastageBenefitUnit, active: true }] }))}
                className="shrink-0 rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-xs font-black text-[var(--accent)]"><Plus size={12} className="inline -mt-0.5" /> Add Type</button>
            </div>
            {rulesForm.types.length === 0 && <p className="text-[11px] font-semibold text-[#6B7280]">No scheme types yet. Without types, only the admin (or staff with permission) can enrol customers with custom terms.</p>}
            {rulesForm.types.map((t, idx) => {
              const setT = (patch: Partial<SchemeType>) => setRulesForm((r) => ({ ...r, types: r.types.map((x, i) => (i === idx ? { ...x, ...patch } : x)) }))
              return (
                <div key={t.id} className={`rounded-xl border p-3 space-y-2 ${t.active ? 'border-[#ECE9E2] bg-[#FBFAF6]' : 'border-dashed border-gray-300 bg-gray-50 opacity-70'}`}>
                  <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                    <input className={inputClass} value={t.name} onChange={(e) => setT({ name: e.target.value })} aria-label="Scheme type name" />
                    <select className={inputClass} value={t.frequency} onChange={(e) => { const f = e.target.value as SchemeFrequency; setT({ frequency: f, installments: f === 'one_time' ? 1 : DEFAULT_INSTALLMENTS[f], durationMonths: f === 'one_time' ? 12 : f === 'monthly' ? DEFAULT_INSTALLMENTS.monthly : 12 }) }} aria-label="Plan">
                      {SCHEME_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs font-bold text-[#273126] whitespace-nowrap"><input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={t.active} onChange={(e) => setT({ active: e.target.checked })} /> Active</label>
                  </div>
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                    <Field label={t.frequency === 'one_time' ? 'Deposit (₹)' : 'Installment (₹)'}><input type="number" min="1" className={inputClass} value={t.amount} onChange={(e) => setT({ amount: Number(e.target.value) })} /></Field>
                    <Field label="Installments"><input type="number" min="1" disabled={t.frequency === 'one_time'} className={inputClass} value={t.installments} onChange={(e) => setT({ installments: Number(e.target.value) })} /></Field>
                    <Field label="Duration (months)"><input type="number" min="1" className={inputClass} value={t.durationMonths} onChange={(e) => setT({ durationMonths: Number(e.target.value) })} /></Field>
                    <Field label="Benefit">
                      <select className={inputClass} value={t.benefitType} onChange={(e) => setT({ benefitType: e.target.value as SchemeBenefitType })}>
                        <option value="making">Making</option><option value="wastage">Wastage</option><option value="both">Both</option>
                      </select>
                    </Field>
                    {t.benefitType !== 'wastage' && <Field label="Making discount">
                      <div className="flex gap-1.5"><select className="rounded-xl border border-[#E5E7EB] bg-white px-2 text-sm font-black" value={t.makingBenefitUnit} onChange={(e) => setT({ makingBenefitUnit: e.target.value as BenefitUnit })}><option value="percent">%</option><option value="fixed">₹</option></select>
                      <input type="number" min="0" className={`${inputClass} flex-1`} value={t.makingBenefitValue} onChange={(e) => setT({ makingBenefitValue: Number(e.target.value) })} /></div>
                    </Field>}
                    {t.benefitType !== 'making' && <Field label="Wastage discount">
                      <div className="flex gap-1.5"><select className="rounded-xl border border-[#E5E7EB] bg-white px-2 text-sm font-black" value={t.wastageBenefitUnit} onChange={(e) => setT({ wastageBenefitUnit: e.target.value as BenefitUnit })}><option value="percent">%</option><option value="fixed">₹</option></select>
                      <input type="number" min="0" className={`${inputClass} flex-1`} value={t.wastageBenefitValue} onChange={(e) => setT({ wastageBenefitValue: Number(e.target.value) })} /></div>
                    </Field>}
                  </div>
                  <p className="text-[11px] font-bold text-[var(--accent-dark)]">Total commitment: {formatCurrency(t.amount * (t.frequency === 'one_time' ? 1 : t.installments))}</p>
                </div>
              )
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum installments (monthly plans)"><input type="number" min="1" className={inputClass} value={rulesForm.minInstallments} onChange={(e) => setRulesForm((r) => ({ ...r, minInstallments: Number(e.target.value) }))} /></Field>
            <Field label="Maximum installments (monthly plans)"><input type="number" min="1" className={inputClass} value={rulesForm.maxInstallments} onChange={(e) => setRulesForm((r) => ({ ...r, maxInstallments: Number(e.target.value) }))} /></Field>
            <Field label="Minimum monthly installment (₹)"><input type="number" min="0" className={inputClass} value={rulesForm.minMonthlyAmount} onChange={(e) => setRulesForm((r) => ({ ...r, minMonthlyAmount: Number(e.target.value) }))} /></Field>
            <Field label="Maximum monthly installment (₹, 0 = no limit)"><input type="number" min="0" className={inputClass} value={rulesForm.maxMonthlyAmount} onChange={(e) => setRulesForm((r) => ({ ...r, maxMonthlyAmount: Number(e.target.value) }))} /></Field>
            <Field label="Default benefit type">
              <select className={inputClass} value={rulesForm.defaultBenefitType} onChange={(e) => setRulesForm((r) => ({ ...r, defaultBenefitType: e.target.value as SchemeBenefitType }))}>
                {(Object.keys(BENEFIT_TYPE_LABELS) as SchemeBenefitType[]).map((t) => <option key={t} value={t}>{BENEFIT_TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Redemption expires (months after maturity, 0 = never)"><input type="number" min="0" className={inputClass} value={rulesForm.expiryMonths} onChange={(e) => setRulesForm((r) => ({ ...r, expiryMonths: Number(e.target.value) }))} /></Field>
            <Field label="Default making discount">
              <div className="flex gap-2">
                <select className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm font-black" value={rulesForm.defaultMakingBenefitUnit} onChange={(e) => setRulesForm((r) => ({ ...r, defaultMakingBenefitUnit: e.target.value as BenefitUnit }))}><option value="percent">%</option><option value="fixed">₹</option></select>
                <input type="number" min="0" className={`${inputClass} flex-1`} value={rulesForm.defaultMakingBenefitValue} onChange={(e) => setRulesForm((r) => ({ ...r, defaultMakingBenefitValue: Number(e.target.value) }))} />
              </div>
            </Field>
            <Field label="Default wastage discount">
              <div className="flex gap-2">
                <select className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm font-black" value={rulesForm.defaultWastageBenefitUnit} onChange={(e) => setRulesForm((r) => ({ ...r, defaultWastageBenefitUnit: e.target.value as BenefitUnit }))}><option value="percent">%</option><option value="fixed">₹</option></select>
                <input type="number" min="0" className={`${inputClass} flex-1`} value={rulesForm.defaultWastageBenefitValue} onChange={(e) => setRulesForm((r) => ({ ...r, defaultWastageBenefitValue: Number(e.target.value) }))} />
              </div>
            </Field>
          </div>
          <div className="space-y-2">
            {([
              ['requireMaturityForRedemption', 'Redeem only on or after the maturity date', 'Otherwise a scheme can be redeemed as soon as every installment is paid.'],
              ['allowPartialRedemption', 'Allow partial redemption', 'Use part of the balance on one bill and the rest later.'],
              ['allowCancellation', 'Allow cancelling a scheme', 'Admin can cancel a scheme that has not been redeemed.'],
              ['allowTransfer', 'Allow transfer to another customer', 'Admin can move a scheme to a different customer.'],
            ] as const).map(([key, label, hint]) => (
              <label key={key} className="flex items-start justify-between gap-3 rounded-xl border border-[#ECE9E2] p-3 cursor-pointer">
                <span><span className="block text-sm font-black text-[#273126]">{label}</span><span className="block text-[11px] text-[#6B7280]">{hint}</span></span>
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={rulesForm[key]} onChange={(e) => setRulesForm((r) => ({ ...r, [key]: e.target.checked }))} />
              </label>
            ))}
          </div>
        </div>
        <div className="shrink-0 flex gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={() => setRulesOpen(false)} className="flex-1 rounded-xl border py-3 text-sm font-black">Cancel</button>
          <button disabled={saving} className="flex-[1.5] rounded-xl bg-[var(--accent-dark)] py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save Rules'}</button>
        </div>
      </form>
    </div></ModalPortal>}
  </div>
}
