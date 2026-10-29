import React, { useMemo, useState } from 'react'
import { Banknote, CheckCircle2, AlertTriangle, IndianRupee, Printer, Download, Trash2, Search, History } from 'lucide-react'
import { DocIcon, WhatsAppIcon, actionBtn } from '../ActionIcons'
import { creditService, toDaysOverdue } from '../../services/creditService'
import { formatCurrency, formatInvoiceNo } from '../../lib/retail'
import { useSound } from '../../context/SoundContext'
import { formatDateDDMMYYYY } from '../../lib/dateFormat'
import type { DashboardOrder } from '../../pages/Dashboard'
import { getPresetRange, toLocalDateStr } from '../../lib/dateRanges'

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

const matchesSearch = (order: DashboardOrder, query: string) => {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    (order.customer_name || '').toLowerCase().includes(q) ||
    (order.phone || '').toLowerCase().includes(q) ||
    formatInvoiceNo(order.invoice_no).toLowerCase().includes(q)
  )
}

function ActionButtons({ order, onView, onPrint, onDownload, onShare, onDelete }: {
  order: DashboardOrder
  onView: (order: DashboardOrder) => void
  onPrint: (order: DashboardOrder) => void
  onDownload: (order: DashboardOrder) => void
  onShare: (order: DashboardOrder) => void
  onDelete: (order: DashboardOrder) => void
}) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <button type="button" onClick={() => onShare(order)} className={`${actionBtn} bg-[#10B981]/10 hover:bg-[#10B981]/20 text-[#10B981]`} title="Send on WhatsApp">
        <WhatsAppIcon className="w-4 h-4" />
      </button>
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
  const [search, setSearch] = useState('')
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

  const handleMarkAsPaid = async (order: DashboardOrder) => {
    if (!window.confirm(`Mark ${formatCurrency(order.total)} from "${order.customer_name}" (${formatInvoiceNo(order.invoice_no)}) as paid?`)) {
      return
    }
    setSettlingId(order.id)
    try {
      await creditService.markAsPaid(order.id)
      play('success')
      onSettled(order.id, new Date().toISOString())
    } catch (err) {
      console.error('Failed to mark credit as paid:', err)
      play('error')
      alert('Failed to mark this credit sale as paid. Please try again.')
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

  const totalOutstanding = items.reduce((sum, o) => sum + Number(o.total || 0), 0)
  const overdueItems = items.filter((o) => o.daysOverdue > 0)
  const totalOverdue = overdueItems.reduce((sum, o) => sum + Number(o.total || 0), 0)

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
            Credit sales still to be collected. Mark a bill paid when the customer settles it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 bg-[#FAFAFA] border border-black/10 rounded-xl p-1">
          {([['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => applyDatePreset(value)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${datePreset === value ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000] hover:bg-black/5'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {datePreset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3 bg-white border border-black/10 rounded-xl p-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[var(--accent)]" />
          </div>
        </div>
      )}

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

      {/* Tabs + search */}
      <div className="bg-white border border-black/10 rounded-xl p-3 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
        <div className="flex gap-1.5">
          {([
            { id: 'outstanding' as const, label: 'Outstanding', count: items.length },
            { id: 'history' as const, label: 'History', count: filteredHistory.length },
          ]).map(({ id, label, count }) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${activeTab === id ? 'bg-[var(--accent)] text-white' : 'bg-[#F4F4F5] text-black hover:bg-black/10'}`}>
              {label} ({count})
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-black/30 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice, customer, phone…"
            className="w-full bg-[#FAFAFA] border border-black/10 rounded-lg pl-8 pr-3 py-2 text-xs text-[#000000] focus:outline-none focus:border-[var(--accent)] placeholder:text-black/30" />
        </div>
      </div>

      {/* Outstanding Table */}
      {activeTab === 'outstanding' && (
      <div className="bg-white border border-black/10 rounded-xl overflow-hidden shadow-sm">
        {items.length === 0 ? (
          <div className="p-16 text-center text-gray-400 font-bold text-xs">
            {search ? 'No outstanding credit sales match your search.' : "No outstanding credit sales. Everything's settled!"}
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
                    <p className="font-black text-gray-900 text-xs shrink-0">{formatCurrency(order.total)}</p>
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
                    <ActionButtons order={order} onView={onView} onPrint={onPrint} onDownload={onDownload} onShare={onShare} onDelete={onDelete} />
                    <button
                      type="button"
                      onClick={() => void handleMarkAsPaid(order)}
                      disabled={settlingId === order.id}
                      className="px-3 py-1.5 rounded-lg bg-[#0A0A0A] border border-[var(--accent)] text-white text-[11px] font-black hover:bg-[#1A1A1A] transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <CheckCircle2 size={13} /> {settlingId === order.id ? 'Saving...' : 'Mark as Paid'}
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
                      <td className="p-3.5 text-right font-black text-gray-900">{formatCurrency(order.total)}</td>
                      <td className="p-3.5">
                        <div className="flex items-center justify-center gap-1">
                          <ActionButtons order={order} onView={onView} onPrint={onPrint} onDownload={onDownload} onShare={onShare} onDelete={onDelete} />
                          <button
                            type="button"
                            onClick={() => void handleMarkAsPaid(order)}
                            disabled={settlingId === order.id}
                            className="ml-1 px-3 py-1.5 rounded-lg bg-[#0A0A0A] border border-[var(--accent)] text-white text-[11px] font-black hover:bg-[#1A1A1A] transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <CheckCircle2 size={13} /> {settlingId === order.id ? 'Saving...' : 'Mark as Paid'}
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
            {search ? 'No settled credit sales match your search.' : 'No credit sales have been settled yet.'}
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
    </div>
  )
}
