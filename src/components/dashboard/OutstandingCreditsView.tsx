import React, { useMemo, useState } from 'react'
import { Wallet, CheckCircle2, AlertTriangle, IndianRupee, Eye, Printer, Download, MessageCircle, Trash2, Search, History } from 'lucide-react'
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
    <div className="flex items-center justify-center gap-1">
      <button type="button" onClick={() => onView(order)} className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors" title="View Invoice">
        <Eye size={14} />
      </button>
      <button type="button" onClick={() => onPrint(order)} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors" title="Print Receipt">
        <Printer size={14} />
      </button>
      <button type="button" onClick={() => onDownload(order)} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors" title="Download Invoice">
        <Download size={14} />
      </button>
      <button type="button" onClick={() => onShare(order)} className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors" title="Invoice & Share">
        <MessageCircle size={14} />
      </button>
      <button type="button" onClick={() => onDelete(order)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors" title="Delete Order">
        <Trash2 size={14} />
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
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="bg-white border border-[#B7E1BE] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3">
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-[#0A0A0A] text-[var(--accent)] flex items-center justify-center font-black shrink-0">
            <Wallet size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-gray-500">Outstanding Invoices</div>
            <div className="text-[15px] sm:text-xl font-black text-black break-words">{items.length}</div>
          </div>
        </div>

        <div className="bg-white border border-[#B7E1BE] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3">
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center font-black shrink-0">
            <IndianRupee size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-gray-500">Total Outstanding</div>
            <div className="text-[14px] sm:text-lg font-black text-emerald-700 break-words">{formatCurrency(totalOutstanding)}</div>
          </div>
        </div>

        <div className="bg-white border border-[#B7E1BE] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3 col-span-2 sm:col-span-1">
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-red-50 text-red-700 border border-red-200 flex items-center justify-center font-black shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-gray-500">Overdue ({overdueItems.length})</div>
            <div className="text-[14px] sm:text-lg font-black text-red-700 break-words">{formatCurrency(totalOverdue)}</div>
          </div>
        </div>

        {/* Paid Credits Summary Card */}
        <div className="bg-white border border-[#B7E1BE] rounded-2xl p-3 sm:p-4 shadow-sm flex items-center gap-2.5 sm:gap-3">
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-green-50 text-green-700 border border-green-200 flex items-center justify-center font-black shrink-0">
            <CheckCircle2 size={20} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-gray-500">Paid Credits</div>
            <div className="text-[14px] sm:text-lg font-black text-green-700 break-words">
              {/* Count from history tab - paid orders */}
              {filteredHistory.filter((o) => (o as any).credit_status === 'paid').length}
            </div>
          </div>
        </div>
      </div>

      {/* Tab switcher + Search + Filters */}
      <div className="space-y-4 border-b border-[#E7E7E7] pb-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex gap-6">
            {([
              { id: 'outstanding' as const, label: 'OUTSTANDING', count: items.length },
              { id: 'history' as const, label: 'HISTORY', count: filteredHistory.length },
            ]).map(({ id, label, count }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`pb-2 md:pb-4 text-left text-[13px] font-bold tracking-wide transition-colors relative whitespace-nowrap ${
                  activeTab === id ? 'text-[#0A0A0A]' : 'text-[#6B7280] hover:text-[#111111]'
                }`}
              >
                {label} <span className="text-[11px] font-semibold text-gray-400">({count})</span>
                {activeTab === id && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#0A0A0A] rounded-t-md" />}
              </button>
            ))}
          </div>

          <div className="relative w-full md:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice, customer, phone..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-[#FBFAF6] text-xs font-semibold text-gray-800 outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-gray-500">Filter by Sale Date</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {([
              ['today', 'Today'],
              ['week', 'This Week'],
              ['month', 'This Month'],
              ['year', 'This Year'],
              ['all', 'All'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => applyDatePreset(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${datePreset === value ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => { setFromDate(e.target.value); setDatePreset('custom') }}
                className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-800 outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={e => { setToDate(e.target.value); setDatePreset('custom') }}
                className="w-full h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-800 outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Outstanding Table */}
      {activeTab === 'outstanding' && (
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
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
                      <p className="font-black text-gray-900 text-[13px]">{order.customer_name}</p>
                      <p className="text-[11px] text-gray-400 font-medium mt-0.5">{formatInvoiceNo(order.invoice_no)} · {order.phone}</p>
                    </div>
                    <p className="font-black text-gray-900 text-[13px] shrink-0">{formatCurrency(order.total)}</p>
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
                          : 'bg-gray-50 text-gray-600 border-gray-200'
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
                      className="px-3 py-1.5 rounded-lg bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-[11px] font-black hover:bg-[#1A1A1A] transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
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
            <table className="w-full min-w-[760px] text-left text-xs whitespace-nowrap">
              <thead className="bg-[#FBFAF6] border-b border-gray-200 text-xs font-bold text-gray-700">
                <tr>
                  <th className="p-3.5">Invoice</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Sale Date</th>
                  <th className="p-3.5">Due Date</th>
                  <th className="p-3.5 text-right">Amount</th>
                  <th className="p-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((order) => {
                  const isOverdue = order.daysOverdue > 0
                  const isDueToday = order.daysOverdue === 0
                  return (
                    <tr key={order.id} className="hover:bg-[#FBFAF6] transition-colors">
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
                                : 'bg-gray-50 text-gray-600 border-gray-200'
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
                            className="ml-1 px-3 py-1.5 rounded-lg bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-[11px] font-black hover:bg-[#1A1A1A] transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
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
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-gray-200 bg-[#FBFAF6]">
          <History size={15} className="text-gray-500" />
          <div>
            <h2 className="text-sm font-black text-[#0A0A0A]">Credit Bills History</h2>
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
                    <p className="font-black text-gray-900 text-[13px]">{order.customer_name}</p>
                    <p className="text-[11px] text-gray-400 font-medium mt-0.5">{formatInvoiceNo(order.invoice_no)} · {order.phone}</p>
                  </div>
                  <p className="font-black text-gray-900 text-[13px] shrink-0">{formatCurrency(order.total)}</p>
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
            <table className="w-full min-w-[680px] text-left text-xs whitespace-nowrap">
              <thead className="bg-[#FBFAF6] border-b border-gray-200 text-xs font-bold text-gray-700">
                <tr>
                  <th className="p-3.5">Invoice</th>
                  <th className="p-3.5">Customer</th>
                  <th className="p-3.5">Sale Date</th>
                  <th className="p-3.5">Paid On</th>
                  <th className="p-3.5 text-right">Amount</th>
                  <th className="p-3.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredHistory.map((order) => (
                  <tr key={order.id} className="hover:bg-[#FBFAF6] transition-colors">
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
