import React, { useEffect, useMemo, useState } from 'react'
import { Banknote, CheckCircle2, AlertTriangle, IndianRupee, Printer, Download, Trash2, History } from 'lucide-react'
import { DocIcon, WhatsAppIcon, actionBtn } from '../ActionIcons'
import { creditService, toDaysOverdue } from '../../services/creditService'
import { formatCurrency, formatInvoiceNo } from '../../lib/retail'
import { useSound } from '../../context/SoundContext'
import { formatDateDDMMYYYY } from '../../lib/dateFormat'
import type { DashboardOrder } from '../../pages/Dashboard'
import { getPresetRange, toLocalDateStr } from '../../lib/dateRanges'
import { csvDate, csvPhone, downloadCsv } from '../../lib/csv'
import { FilterCard, FilterField, PeriodBar } from '../filters/PageFilters'
import { filterInput } from '../filters/filterStyles'
import { QrCode } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { paymentLinkUrl } from '../../lib/upi'
import { toWhatsAppUrl } from '../../lib/phone'
import { useSettingsStore } from '../../store/store'
import { ModalPortal } from '../ModalPortal'
import { PaymentModePicker } from '../PaymentModePicker'
import { paymentModeLabel, splitError, splitSummary, type PaymentMode, type SplitAmounts } from '../../lib/paymentModes'

export interface OutstandingCreditsViewProps {
  orders: DashboardOrder[]
  historyOrders: DashboardOrder[]
  onSettled: (orderId: string, paidAt: string) => void
  onDueDateChanged: (orderId: string, newDate: string) => void
  onView: (order: DashboardOrder) => void
  onPrint: (order: DashboardOrder) => void
  onDownload: (order: DashboardOrder) => void
  onShare: (order: DashboardOrder) => void
  onDelete: (order: DashboardOrder) => void
}

type CreditQuery = { invoice: string; name: string; phone: string }
const matchesSearch = (order: DashboardOrder, q: CreditQuery) => {
  const has = (value: string | null | undefined, needle: string) => !needle.trim() || String(value || '').toLowerCase().includes(needle.trim().toLowerCase())
  return has(formatInvoiceNo(order.invoice_no), q.invoice) && has(order.customer_name, q.name) && has(order.phone, q.phone)
}

function ActionButtons({ order, onView, onPrint, onDownload, onShare, onDelete, onPayLink }: {
  order: DashboardOrder
  onView: (order: DashboardOrder) => void
  onPrint: (order: DashboardOrder) => void
  onDownload: (order: DashboardOrder) => void
  onShare: (order: DashboardOrder) => void
  onDelete: (order: DashboardOrder) => void
  onPayLink?: (order: DashboardOrder) => void
}) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <button type="button" onClick={() => onShare(order)} className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`} title="Send on WhatsApp">
        <WhatsAppIcon className="w-4 h-4" />
      </button>
      {onPayLink && (
        <button type="button" onClick={() => onPayLink(order)} className={`${actionBtn} bg-[#2563EB]/10 hover:bg-[#2563EB]/20 text-[#2563EB]`} title="Send UPI payment link on WhatsApp">
          <QrCode className="w-4 h-4" />
        </button>
      )}
      <button type="button" onClick={() => onView(order)} className={`${actionBtn} bg-[var(--accent-a10)] hover:bg-[var(--accent-a20)] text-[var(--accent)]`} title="View invoice">
        <DocIcon className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => onPrint(order)} className={`${actionBtn} bg-black/5 hover:bg-black/10 text-[#000000]`} title="Print receipt">
        <Printer className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => onDownload(order)} className={`${actionBtn} bg-black/5 hover:bg-black/10 text-[#000000]`} title="Download invoice PDF">
        <Download className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => onDelete(order)} className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`} title="Delete order">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

type DatePreset = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom'

export const OutstandingCreditsView: React.FC<OutstandingCreditsViewProps> = ({
  orders, historyOrders, onSettled, onDueDateChanged, onView, onPrint, onDownload, onShare, onDelete,
}) => {
  const { play } = useSound()
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const [savingDueDateId, setSavingDueDateId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CreditQuery>({ invoice: '', name: '', phone: '' })
  const [search, setSearch] = useState<CreditQuery>({ invoice: '', name: '', phone: '' })
  const searching = Boolean(search.invoice.trim() || search.name.trim() || search.phone.trim())
  const [activeTab, setActiveTab] = useState<'outstanding' | 'history'>('outstanding')
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const applyDatePreset = (preset: DatePreset) => {
    if (preset === 'today' || preset === 'week' || preset === 'month' || preset === 'year') {
      const { from, to } = getPresetRange(preset)
      setFromDate(from)
      setToDate(to)
    } else {
      setFromDate('')
      setToDate('')
    }
    setDatePreset(preset)
  }

  const items = useMemo(
    () => orders
      .filter(o => matchesSearch(o, search))
      .filter(o => {
        if (!fromDate && !toDate) return true
        // Compare local calendar dates (YYYY-MM-DD), so a bill made on the start day is included
        const saleDay = toLocalDateStr(new Date(o.created_at))
        if (fromDate && saleDay < fromDate) return false
        if (toDate && saleDay > toDate) return false
        return true
      })
      .map(o => ({ ...o, daysOverdue: toDaysOverdue(o.credit_due_date || null) })),
    [orders, search, fromDate, toDate]
  )
  const filteredHistory = useMemo(() =>
    historyOrders
      .filter(o => matchesSearch(o, search))
      .filter(o => {
        if (!fromDate && !toDate) return true
        // Compare local calendar dates (YYYY-MM-DD), so a bill made on the start day is included
        const saleDay = toLocalDateStr(new Date(o.created_at))
        if (fromDate && saleDay < fromDate) return false
        if (toDate && saleDay > toDate) return false
        return true
      }),
    [historyOrders, search, fromDate, toDate]
  )

  // Mark paid: ask how the customer paid (any mode, or mixed with the split)
  // Part payments confirmed from UPI claims (separate query: the column comes with the portal database update)
  const [paidById, setPaidById] = useState<Record<string, number>>({})
  useEffect(() => {
    let live = true
    supabase.from('orders').select('id, credit_paid_amount').eq('credit_status', 'outstanding').gt('credit_paid_amount', 0)
      .then(({ data }) => { if (live && data) setPaidById(Object.fromEntries(data.map((r) => [String(r.id), Number(r.credit_paid_amount) || 0]))) })
    return () => { live = false }
  }, [orders])
  const balanceOf = (o: DashboardOrder) => Math.max(0, Number(o.total) - (paidById[o.id] || 0))
  const sendPayLink = async (o: DashboardOrder) => {
    const { data, error } = await supabase.rpc('create_payment_link', { p_order_id: o.id, p_by: 'Admin' })
    if (error) { alert(/upi|UPI/.test(error.message) ? 'Add the shop UPI ID in Settings → Guests Paying by UPI first.' : /create_payment_link/.test(error.message) ? 'Payment links need the database update: run supabase/migrations/customer_portal.sql.' : error.message); return }
    const link = data as { token: string; amount: number }
    const msg = `Dear ${o.customer_name || 'Customer'}, your invoice ${formatInvoiceNo(o.invoice_no)} has an outstanding balance of ${formatCurrency(link.amount)}. You can complete your payment using the secure UPI payment link below:\n${paymentLinkUrl(link.token)}\n\nThank you!\n- ${useSettingsStore.getState().settings?.name || ''}`
    window.open(toWhatsAppUrl(o.phone, msg), '_blank', 'noopener,noreferrer')
  }
  const [settleFor, setSettleFor] = useState<DashboardOrder | null>(null)
  const [settleMode, setSettleMode] = useState<PaymentMode>('cash')
  const [settleSplit, setSettleSplit] = useState<SplitAmounts>({})
  const [settleError, setSettleError] = useState('')
  const [settleAmount, setSettleAmount] = useState('')
  const [settleNote, setSettleNote] = useState('')
  const [settleHistory, setSettleHistory] = useState<Awaited<ReturnType<typeof creditService.payments>>>([])
  const [notice, setNotice] = useState('')
  const handleMarkAsPaid = async (order: DashboardOrder) => {
    setSettleFor(order); setSettleMode('cash'); setSettleSplit({}); setSettleError(''); setSettleNote('')
    setSettleAmount(String(balanceOf(order)))
    setSettleHistory([])
    void creditService.payments(order.id).then(setSettleHistory)
  }
  const confirmSettle = async () => {
    const order = settleFor
    if (!order) return
    const balance = balanceOf(order)
    const amount = Math.round((Number(settleAmount) || 0) * 100) / 100
    if (!(amount > 0)) { setSettleError('Enter the amount received now.'); return }
    if (amount > balance) { setSettleError(`The amount is more than the balance of ${formatCurrency(balance)}.`); return }
    const err = splitError(settleMode, settleSplit, amount)
    if (err) { setSettleError(err); return }
    setSettlingId(order.id); setSettleError('')
    try {
      const note = [settleMode === 'mixed' ? `Split: ${splitSummary(settleSplit)}` : '', settleNote.trim()].filter(Boolean).join(' • ')
      const r = await creditService.recordPayment(order.id, amount, settleMode, note, amount === balance)
      play('success')
      setSettleFor(null)
      if (r.fullyPaid) {
        onSettled(order.id, new Date().toISOString())
        setNotice(`${formatInvoiceNo(order.invoice_no)} is fully paid.`)
      } else {
        setPaidById((m) => ({ ...m, [order.id]: Math.round((Number(order.total) - r.balance) * 100) / 100 }))
        setNotice(`${formatCurrency(amount)} recorded on ${formatInvoiceNo(order.invoice_no)}. Balance ${formatCurrency(r.balance)} still to collect.`)
      }
    } catch (err) {
      console.error('Failed to record the credit payment:', err)
      play('error')
      setSettleError(err instanceof Error ? err.message.replace(/^.*?:\s(?=The amount)/, '') : 'Could not save the payment. Please try again.')
    } finally {
      setSettlingId(null)
    }
  }

  const handleDueDateChange = async (order: DashboardOrder, newDate: string) => {
    if (!newDate || newDate === order.credit_due_date) return
    setSavingDueDateId(order.id)
    try {
      await creditService.updateDueDate(order.id, newDate)
      onDueDateChanged(order.id, newDate)
    } catch (err) {
      console.error('Failed to update due date:', err)
      alert('Failed to update the due date. Please try again.')
    } finally {
      setSavingDueDateId(null)
    }
  }

  const exportCsv = () => {
    const rows = activeTab === 'outstanding' ? items : filteredHistory
    downloadCsv(`credits-${activeTab}-${toLocalDateStr(new Date())}.csv`, [
      ['Invoice No', 'Customer', 'Phone', 'Bill Date', 'Due Date', 'Amount', 'Status', 'Paid On'],
      ...rows.map(o => [formatInvoiceNo(o.invoice_no), o.customer_name, csvPhone(o.phone), csvDate(o.created_at), o.credit_due_date || '', Number(o.total || 0).toFixed(2), o.credit_status === 'paid' ? 'Paid' : 'Outstanding', o.credit_paid_at ? csvDate(o.credit_paid_at) : '']),
    ])
  }

  // Part payments already taken are not owed any more.
  const totalOutstanding = items.reduce((sum, o) => sum + balanceOf(o), 0)
  const overdueItems = items.filter((o) => o.daysOverdue > 0)
  const totalOverdue = overdueItems.reduce((sum, o) => sum + balanceOf(o), 0)

  return (
    <div className="flex-1 flex flex-col w-full pb-8 space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <h2 className="text-[28px] font-black text-[#000000] tracking-tight flex items-center gap-3">
            <Banknote className="w-7 h-7 text-[var(--accent)]" />
            Outstanding Credits
          </h2>
          <p className="text-xs text-[#000000] font-semibold mt-1">
            Credit sales still to be collected. Record each payment as it comes in: part now, the rest later.
          </p>
          {notice && <p role="status" className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}
        </div>
        <PeriodBar
          preset={datePreset}
          from={fromDate}
          to={toDate}
          onPreset={applyDatePreset}
          onFrom={v => { setFromDate(v); setDatePreset('custom') }}
          onTo={v => { setToDate(v); setDatePreset('custom') }}
          onExport={exportCsv}
          exportDisabled={(activeTab === 'outstanding' ? items.length : filteredHistory.length) === 0}
        />
      </div>

      <FilterCard
        tabs={[
          { id: 'outstanding' as const, label: 'Outstanding', count: items.length },
          { id: 'history' as const, label: 'History', count: filteredHistory.length },
        ]}
        activeTab={activeTab}
        onTab={setActiveTab}
        onSearch={() => setSearch(draft)}
      >
        <FilterField label="Search Invoice No" search>
          <input className={`${filterInput} pl-9`} placeholder="e.g. INV-..." value={draft.invoice} onChange={e => setDraft(d => ({ ...d, invoice: e.target.value }))} />
        </FilterField>
        <FilterField label="Customer Name">
          <input className={filterInput} placeholder="Search name..." value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        </FilterField>
        <FilterField label="Customer Phone">
          <input className={filterInput} inputMode="tel" placeholder="Search phone..." value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} />
        </FilterField>
      </FilterCard>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl p-5 shadow-sm text-white bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_55%,#000000)]">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/90">Total Outstanding</span>
            <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center"><IndianRupee className="w-4 h-4 text-white" /></div>
          </div>
          <div className="text-2xl font-black">{formatCurrency(totalOutstanding)}</div>
          <div className="text-[9px] text-white/80 font-semibold mt-1 uppercase tracking-wider">{items.length} invoice{items.length === 1 ? '' : 's'} to collect</div>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">Overdue</span>
            <div className="w-8 h-8 rounded-full bg-[#DC2626]/10 flex items-center justify-center"><AlertTriangle className="w-4 h-4 text-[#DC2626]" /></div>
          </div>
          <div className="text-2xl font-black text-[#DC2626]">{formatCurrency(totalOverdue)}</div>
          <div className="text-[9px] text-[#000000] font-semibold mt-1">{overdueItems.length} bill{overdueItems.length === 1 ? '' : 's'} past the due date</div>
        </div>
        <div className="bg-white border border-black/10 rounded-xl p-5 shadow-sm">
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">Paid Credits</span>
            <div className="w-8 h-8 rounded-full bg-[#16A34A]/10 flex items-center justify-center"><CheckCircle2 className="w-4 h-4 text-[#16A34A]" /></div>
          </div>
          <div className="text-2xl font-black text-[#000000]">{filteredHistory.filter((o) => o.credit_status === 'paid').length}</div>
          <div className="text-[9px] text-[#000000] font-semibold mt-1">Credit bills settled</div>
        </div>
      </div>

      {/* Outstanding Table */}
      {activeTab === 'outstanding' && (
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden shadow-sm">
        {items.length === 0 ? (
          <div className="p-16 text-center text-gray-400 font-bold text-xs">
            {searching ? 'No outstanding credit sales match your search.' : "No outstanding credit sales. Everything's settled!"}
          </div>
        ) : (
          <>
          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-gray-100">
            {items.map((order) => {
              const isOverdue = order.daysOverdue > 0
              const isDueToday = order.daysOverdue === 0
              return (
                <div key={order.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 text-xs">{order.customer_name}</p>
                      <p className="text-[11px] text-gray-400 font-medium mt-0.5">{formatInvoiceNo(order.invoice_no)} · {order.phone}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-black text-gray-900 text-xs">{formatCurrency(order.total)}</p>
                      {paidById[order.id] > 0 && <p className="text-[10px] font-bold text-emerald-700">Paid {formatCurrency(paidById[order.id])}</p>}
                      {paidById[order.id] > 0 && <p className="text-[10px] font-black text-red-600">Due {formatCurrency(balanceOf(order))}</p>}
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="text-[10px] font-bold text-gray-500">Sale: {formatDateDDMMYYYY(order.created_at)}</span>
                    <input
                      type="date"
                      value={order.credit_due_date || ''}
                      disabled={savingDueDateId === order.id}
                      onChange={(e) => void handleDueDateChange(order, e.target.value)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-black border cursor-pointer outline-none disabled:opacity-50 ${
                        isOverdue
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : isDueToday
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-gray-50 text-gray-600 border-black/10'
                      }`}
                    />
                    {(isOverdue || isDueToday) && (
                      <span className={`text-[10px] font-black ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                        {isOverdue ? `${order.daysOverdue}d overdue` : 'due today'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <ActionButtons order={order} onView={onView} onPrint={onPrint} onDownload={onDownload} onShare={onShare} onDelete={onDelete} onPayLink={(o) => void sendPayLink(o)} />
                    <button
                      type="button"
                      onClick={() => void handleMarkAsPaid(order)}
                      disabled={settlingId === order.id}
                      className="px-3 py-1.5 rounded-lg bg-[#0A0A0A] border border-[var(--accent)] text-white text-[11px] font-black hover:bg-[#1A1A1A] transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 size={13} /> {settlingId === order.id ? 'Saving...' : 'Record Payment'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-black/10 text-xs font-bold text-gray-700 bg-[#F9FAFB]">
                <tr>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Invoice</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Customer</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Sale Date</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Due Date</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">Amount</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((order) => {
                  const isOverdue = order.daysOverdue > 0
                  const isDueToday = order.daysOverdue === 0
                  return (
                    <tr key={order.id} className="hover:bg-black/[0.03] transition-colors">
                      <td className="p-3.5 font-mono font-bold text-gray-800">{formatInvoiceNo(order.invoice_no)}</td>
                      <td className="p-3.5">
                        <div className="font-black text-gray-900">{order.customer_name}</div>
                        <div className="text-[10px] text-gray-400 font-medium">{order.phone}</div>
                      </td>
                      <td className="p-3.5 text-gray-600 font-semibold">
                        {formatDateDDMMYYYY(order.created_at)}
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={order.credit_due_date || ''}
                            disabled={savingDueDateId === order.id}
                            onChange={(e) => void handleDueDateChange(order, e.target.value)}
                            className={`px-2.5 py-1 rounded-full text-xs font-black border cursor-pointer outline-none disabled:opacity-50 ${
                              isOverdue
                                ? 'bg-red-50 text-red-700 border-red-200'
                                : isDueToday
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-gray-50 text-gray-600 border-black/10'
                            }`}
                          />
                          {(isOverdue || isDueToday) && (
                            <span className={`text-[10px] font-black ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                              {isOverdue ? `${order.daysOverdue}d overdue` : 'today'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 text-right font-black text-gray-900">
                        {formatCurrency(order.total)}
                        {paidById[order.id] > 0 && <span className="block text-[10px] font-bold text-emerald-700">Paid {formatCurrency(paidById[order.id])}</span>}
                        {paidById[order.id] > 0 && <span className="block text-[10px] font-black text-red-600">Due {formatCurrency(balanceOf(order))}</span>}
                      </td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-center gap-1">
                          <ActionButtons order={order} onView={onView} onPrint={onPrint} onDownload={onDownload} onShare={onShare} onDelete={onDelete} onPayLink={(o) => void sendPayLink(o)} />
                          <button
                            type="button"
                            onClick={() => void handleMarkAsPaid(order)}
                            disabled={settlingId === order.id}
                            className="ml-1 px-3 py-1.5 rounded-lg bg-[#0A0A0A] border border-[var(--accent)] text-white text-[11px] font-black hover:bg-[#1A1A1A] transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <CheckCircle2 size={13} /> {settlingId === order.id ? 'Saving...' : 'Record Payment'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      )}

      {/* Credit Bills History */}
      {activeTab === 'history' && (
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-black/10 bg-white">
          <History size={15} className="text-gray-500" />
          <div>
            <h3 className="text-sm font-black text-[#000000] uppercase tracking-wider">Credit Bills History</h3>
            <p className="text-[11px] font-semibold text-gray-500">Credit sales that have already been settled</p>
          </div>
        </div>
        {filteredHistory.length === 0 ? (
          <div className="p-16 text-center text-gray-400 font-bold text-xs">
            {searching ? 'No settled credit sales match your search.' : 'No credit sales have been settled yet.'}
          </div>
        ) : (
          <>
          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-gray-100">
            {filteredHistory.map((order) => (
              <div key={order.id} className="p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black text-gray-900 text-xs">{order.customer_name}</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">{formatInvoiceNo(order.invoice_no)} · {order.phone}</p>
                  </div>
                  <p className="font-black text-gray-900 text-xs shrink-0">{formatCurrency(order.total)}</p>
                </div>
                <div className="flex items-center flex-wrap gap-2">
                  <span className="text-[10px] font-bold text-gray-500">Sale: {formatDateDDMMYYYY(order.created_at)}</span>
                  <span className="inline-block px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Paid {order.credit_paid_at ? formatDateDDMMYYYY(order.credit_paid_at) : '—'}
                  </span>
                </div>
                <div className="pt-1">
                  <ActionButtons order={order} onView={onView} onPrint={onPrint} onDownload={onDownload} onShare={onShare} onDelete={onDelete} />
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-black/10 text-xs font-bold text-gray-700 bg-[#F9FAFB]">
                <tr>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Invoice</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Customer</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Sale Date</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-left">Paid On</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-right">Amount</th>
                  <th className="p-4 text-[10px] font-bold text-[#000000] uppercase tracking-widest text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredHistory.map((order) => (
                  <tr key={order.id} className="hover:bg-black/[0.03] transition-colors">
                    <td className="p-3.5 font-mono font-bold text-gray-800">{formatInvoiceNo(order.invoice_no)}</td>
                    <td className="p-3.5">
                      <div className="font-black text-gray-900">{order.customer_name}</div>
                      <div className="text-[10px] text-gray-400 font-medium">{order.phone}</div>
                    </td>
                    <td className="p-3.5 text-gray-600 font-semibold">
                      {formatDateDDMMYYYY(order.created_at)}
                    </td>
                    <td className="p-3.5">
                      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {order.credit_paid_at ? formatDateDDMMYYYY(order.credit_paid_at) : '—'}
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-black text-gray-900">{formatCurrency(order.total)}</td>
                    <td className="p-3.5">
                      <ActionButtons order={order} onView={onView} onPrint={onPrint} onDownload={onDownload} onShare={onShare} onDelete={onDelete} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      )}

      {settleFor && (
        <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettleFor(null) }}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="bg-[#1C1C1C] px-5 py-4">
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Record Payment • {formatInvoiceNo(settleFor.invoice_no)}</h3>
              <p className="text-[11px] font-semibold text-white/70">{settleFor.customer_name}</p>
            </div>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {([['Bill Total', Number(settleFor.total), 'text-[#000000]'], ['Paid So Far', paidById[settleFor.id] || 0, 'text-emerald-700'], ['Balance', balanceOf(settleFor), 'text-red-600']] as const).map(([l, v, tone]) => (
                  <div key={l} className="rounded-xl border border-black/10 bg-[#FAFAFA] px-2 py-2.5">
                    <p className="text-[9px] font-black uppercase tracking-wider text-[#000000]/60">{l}</p>
                    <p className={`mt-0.5 text-sm font-black ${tone}`}>{formatCurrency(v)}</p>
                  </div>
                ))}
              </div>
              {settleError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{settleError}</div>}
              <div>
                <label htmlFor="credit-pay-amount" className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/70">Amount Received Now (₹)</label>
                <input id="credit-pay-amount" type="number" inputMode="decimal" min={0} step="0.01" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)}
                  className="w-full rounded-xl border border-black/15 px-3 py-2.5 text-base font-black outline-none focus:border-black" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {[['Full Balance', balanceOf(settleFor)], ['Half', Math.round(balanceOf(settleFor) / 2 * 100) / 100]].map(([l, v]) => (
                    <button key={String(l)} type="button" onClick={() => setSettleAmount(String(v))} className="rounded-lg border border-black/15 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider hover:bg-black/5 cursor-pointer">{l}</button>
                  ))}
                </div>
                {(() => {
                  const left = Math.round((balanceOf(settleFor) - (Number(settleAmount) || 0)) * 100) / 100
                  return Number(settleAmount) > 0 && left >= 0 && (
                    <p className={`mt-2 text-[11px] font-bold ${left > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {left > 0 ? `Part payment: ${formatCurrency(left)} will still be due, and the bill stays in Outstanding Credits.` : 'This clears the bill. It moves to settled credits.'}
                    </p>
                  )
                })()}
              </div>
              <PaymentModePicker label="Paid by" mode={settleMode} onMode={setSettleMode} split={settleSplit} onSplit={setSettleSplit} total={Number(settleAmount) || 0} />
              <div>
                <label htmlFor="credit-pay-note" className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/70">Note (optional)</label>
                <input id="credit-pay-note" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} placeholder="e.g. cheque number, promised rest by Friday"
                  className="w-full rounded-xl border border-black/15 px-3 py-2.5 text-sm font-semibold outline-none focus:border-black" />
              </div>
              {settleHistory.length > 0 && (
                <div className="rounded-xl border border-black/10">
                  <p className="border-b border-black/10 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[#000000]/70">Payments So Far</p>
                  {settleHistory.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      <span className="min-w-0"><b>{formatDateDDMMYYYY(p.created_at)}</b> • {paymentModeLabel(p.payment_method)}{p.reference ? <span className="block truncate text-[10px] text-[#000000]/60">{p.reference}</span> : null}</span>
                      <b className="shrink-0">{formatCurrency(p.amount)}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-black/10 bg-[#FAFAFA] px-5 py-4">
              <button type="button" onClick={() => setSettleFor(null)} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-black/60 hover:bg-black/5 cursor-pointer">Cancel</button>
              <button type="button" disabled={settlingId === settleFor.id} onClick={() => void confirmSettle()} className="rounded-xl bg-[#111111] px-6 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:bg-black disabled:opacity-50 cursor-pointer">
                {settlingId === settleFor.id ? 'Saving…' : Math.round((Number(settleAmount) || 0) * 100) / 100 >= balanceOf(settleFor) ? 'Record & Mark Paid' : 'Record Part Payment'}
              </button>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
