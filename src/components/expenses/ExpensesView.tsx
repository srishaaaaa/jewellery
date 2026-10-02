import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Download,
  Plus,
  Trash2,
  Edit2,
  Calendar,
  ChevronDown,
  SlidersHorizontal,
  Receipt,
  RefreshCw,
  TrendingDown,
  Layers,
  Search,
  X,
} from 'lucide-react'
import {
  expenseService,
  exportExpensesToCSV,
  type ExpenseCategory,
  type ExpenseRecord,
  type ExpenseSummaryMetrics,
} from '../../services/expenseService'
import { RecordExpenseModal } from './RecordExpenseModal'
import { ExpenseCategoriesView } from './ExpenseCategoriesView'
import { getPresetRange } from '../../lib/dateRanges'

export const ExpensesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'expenses' | 'categories'>('expenses')
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null)

  // Metrics
  const [metrics, setMetrics] = useState<ExpenseSummaryMetrics>({
    today: 0,
    this_week: 0,
    this_month: 0,
    this_year: 0,
    total_all_time: 0,
  })

  // Data & Categories
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(false)

  // Filters
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [activePreset, setActivePreset] = useState<'all' | 'today' | 'week' | 'month' | 'year'>('all')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const loadMetrics = useCallback(async () => {
    try {
      const data = await expenseService.getMetrics()
      setMetrics(data)
    } catch (err) {
      console.warn('Failed to load expense metrics:', err)
    }
  }, [])

  const loadCategories = useCallback(async () => {
    try {
      const cats = await expenseService.getCategories()
      setCategories(cats)
    } catch (err) {
      console.warn('Failed to load categories:', err)
    }
  }, [])

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const data = await expenseService.getExpenses({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
        categoryId: selectedCategoryId !== 'all' ? selectedCategoryId : undefined,
      })
      setExpenses(data)
    } catch (err) {
      console.error('Failed to load expenses:', err)
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate, selectedCategoryId])

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMetrics(), loadCategories(), loadExpenses()])
  }, [loadMetrics, loadCategories, loadExpenses])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  // Filter expenses list by search query
  const filteredExpenses = useMemo(() => {
    if (!searchQuery.trim()) return expenses
    const q = searchQuery.toLowerCase().trim()
    return expenses.filter(
      (e) =>
        e.description?.toLowerCase().includes(q) ||
        e.category_name?.toLowerCase().includes(q) ||
        e.payment_mode?.toLowerCase().includes(q) ||
        e.recorded_by_name?.toLowerCase().includes(q) ||
        String(e.amount).includes(q)
    )
  }, [expenses, searchQuery])

  // Handle Preset Clicks (Synchronizes FROM and TO dates)
  const applyDatePreset = (preset: 'all' | 'today' | 'week' | 'month' | 'year') => {
    setActivePreset(preset)
    if (preset === 'all') {
      setFromDate('')
      setToDate('')
    } else {
      const { from, to } = getPresetRange(preset)
      setFromDate(from)
      setToDate(to)
    }
  }

  const resetAllFilters = () => {
    setFromDate('')
    setToDate('')
    setActivePreset('all')
    setSelectedCategoryId('all')
    setSearchQuery('')
  }


  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('Delete this expense record?')) return
    try {
      await expenseService.deleteExpense(id)
      setExpenses((prev) => prev.filter((e) => e.id !== id))
      void loadMetrics()
    } catch (err) {
      console.error('Failed to delete expense:', err)
      alert('Could not delete expense record')
    }
  }

  const handleExpenseSaved = (savedExpense: ExpenseRecord) => {
    setExpenses((prev) => {
      const exists = prev.some((e) => e.id === savedExpense.id)
      return exists ? prev.map((e) => (e.id === savedExpense.id ? savedExpense : e)) : [savedExpense, ...prev]
    })
    setEditingExpense(null)
    void loadMetrics()
  }

  const formatCurrencyValue = (val: number) => {
    return `₹ ${Number(val || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Tab Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-[#0A0A0A] flex items-center gap-2.5">
            <Receipt size={24} className="text-[var(--accent)]" />
            Expense Tracker
          </h2>
          <p className="text-xs sm:text-sm text-gray-500 font-semibold mt-1">
            Monitor store overheads, operating costs, and categorized expenses
          </p>
        </div>

        {/* View Switch Pills */}
        <div className="self-start sm:self-auto flex items-center gap-1 bg-white p-1.5 rounded-full border border-[var(--accent-a50)] shadow-xs">
          {(['expenses', 'categories'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={`px-5 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeTab === t
                  ? 'bg-[#0A0A0A] text-[var(--accent)] shadow-sm'
                  : 'text-gray-700 hover:text-black'
              }`}
            >
              {t === 'expenses' ? 'Expenses' : 'Categories'}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'categories' ? (
        <ExpenseCategoriesView
          categories={categories}
          onCategoriesUpdated={() => {
            void loadCategories()
            void loadExpenses()
          }}
        />
      ) : (
        <div className="space-y-6">
          {/* 5 KPI Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {[
              { label: 'Today', value: metrics.today },
              { label: 'This Week', value: metrics.this_week },
              { label: 'This Month', value: metrics.this_month },
              { label: 'This Year', value: metrics.this_year },
              { label: 'Total All Time', value: metrics.total_all_time },
            ].map((kpi, idx) => (
              <div
                key={idx}
                className={`bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 min-h-[104px] shadow-xs flex flex-col justify-between hover:border-[var(--accent-a50)] transition-all ${idx === 4 ? 'col-span-2 sm:col-span-1' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs sm:text-[13px] font-semibold text-gray-600">{kpi.label}</span>
                  <div className="w-7 h-7 rounded-lg bg-[#FBFAF6] border border-[var(--accent-a50)] flex items-center justify-center text-[var(--accent)] shrink-0">
                    <TrendingDown size={14} />
                  </div>
                </div>
                <div className="mt-3 text-lg sm:text-xl font-black text-[#0A0A0A] tracking-tight">
                  {formatCurrencyValue(kpi.value)}
                </div>
              </div>
            ))}
          </div>

          {/* Filter Bar — one row: search · category · dates · filters · refresh · export · record */}
          <div className="bg-white border border-gray-200 rounded-3xl p-3.5 sm:p-5 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center gap-2.5">
              {/* Search */}
              <div className="relative flex-1 min-w-0">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search description, category, staff, amount..."
                  className="w-full h-11 pl-10 pr-9 rounded-xl border border-gray-200 bg-[#FAFAFA] text-xs sm:text-sm font-medium text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Category */}
                <div className="relative flex-1 sm:flex-none">
                  <select
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className="w-full sm:w-44 h-11 pl-3.5 pr-9 rounded-xl border border-gray-200 bg-white text-xs sm:text-sm font-bold text-gray-900 outline-none focus:border-[#0A0A0A] cursor-pointer appearance-none"
                  >
                    <option value="all">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>

                {/* Date preset */}
                <div className="relative flex-1 sm:flex-none">
                  <select
                    value={activePreset !== 'all' ? activePreset : fromDate || toDate ? 'custom' : 'all'}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === 'custom') setShowFilters(true)
                      else applyDatePreset(v as 'all' | 'today' | 'week' | 'month' | 'year')
                    }}
                    className="w-full sm:w-44 h-11 pl-3.5 pr-9 rounded-xl border border-gray-200 bg-white text-xs sm:text-sm font-bold text-gray-900 outline-none focus:border-[#0A0A0A] cursor-pointer appearance-none"
                  >
                    <option value="all">All Dates</option>
                    <option value="today">Today</option>
                    <option value="week">This Week</option>
                    <option value="month">This Month</option>
                    <option value="year">This Year</option>
                    <option value="custom">Custom Range…</option>
                  </select>
                  <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>

                {/* Filters popover: custom date range + reset */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowFilters((v) => !v)}
                    className={`h-11 px-4 rounded-xl border bg-white text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-2 cursor-pointer transition-colors ${showFilters || fromDate || toDate ? 'border-[#0A0A0A]' : 'border-gray-200 hover:border-gray-400'}`}
                  >
                    <SlidersHorizontal size={15} /> Filters <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                  </button>
                  {showFilters && (
                    <div className="absolute left-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white p-4 shadow-xl space-y-3">
                      <p className="text-[11px] font-black uppercase tracking-wider text-gray-500">Custom date range</p>
                      <label className="block">
                        <span className="block text-[11px] font-bold text-gray-600 mb-1">From</span>
                        <div className="relative">
                          <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => { setFromDate(e.target.value); setActivePreset('all') }}
                            className="w-full h-10 pl-9 pr-2.5 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                          />
                        </div>
                      </label>
                      <label className="block">
                        <span className="block text-[11px] font-bold text-gray-600 mb-1">To</span>
                        <div className="relative">
                          <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                          <input
                            type="date"
                            value={toDate}
                            onChange={(e) => { setToDate(e.target.value); setActivePreset('all') }}
                            className="w-full h-10 pl-9 pr-2.5 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A]"
                          />
                        </div>
                      </label>
                      <div className="flex gap-2 pt-1">
                        <button type="button" onClick={() => { resetAllFilters(); setShowFilters(false) }} className="flex-1 h-9 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-700 hover:bg-gray-100 cursor-pointer">
                          Reset all
                        </button>
                        <button type="button" onClick={() => setShowFilters(false)} className="flex-1 h-9 rounded-xl bg-[#0A0A0A] text-[var(--accent)] text-xs font-bold cursor-pointer">
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Refresh */}
                <button
                  type="button"
                  onClick={() => void refreshAll()}
                  title="Refresh Expenses"
                  className="h-11 w-11 rounded-xl border border-gray-200 bg-white flex items-center justify-center text-gray-600 hover:text-black hover:border-gray-400 transition-all cursor-pointer shrink-0"
                >
                  <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </button>

                {/* Export */}
                <button
                  type="button"
                  onClick={() => exportExpensesToCSV(filteredExpenses)}
                  disabled={filteredExpenses.length === 0}
                  className="h-11 px-4 rounded-xl border border-gray-200 bg-white text-xs sm:text-sm font-bold text-gray-800 hover:bg-gray-50 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-default"
                >
                  <Download size={15} /> Export CSV
                </button>

                {/* Record */}
                <button
                  type="button"
                  onClick={() => { setEditingExpense(null); setIsRecordModalOpen(true) }}
                  className="h-11 px-5 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-xs sm:text-sm font-bold hover:bg-[#1A1A1A] transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto"
                >
                  <Plus size={16} /> Record Expense
                </button>
              </div>
            </div>
          </div>

          {/* Expenses Table */}
          <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
            <div className="px-5 sm:px-6 py-5 border-b border-gray-100 bg-[#FAFAFA] flex items-center justify-between">
              <h4 className="text-sm font-bold text-gray-900">
                Expense Records ({filteredExpenses.length})
              </h4>
              {selectedCategoryId !== 'all' && (
                <span className="text-[11px] font-bold text-gray-500">
                  Filtered by Category:{' '}
                  <span className="text-gray-900">
                    {categories.find((c) => String(c.id) === String(selectedCategoryId))?.name || selectedCategoryId}
                  </span>
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-200 bg-[#FBFAF6]">
                    <th className="px-5 sm:px-6 py-4 text-xs font-bold text-gray-800">
                      Date
                    </th>
                    <th className="px-5 sm:px-6 py-4 text-xs font-bold text-gray-800">
                      Category
                    </th>
                    <th className="px-5 sm:px-6 py-4 text-xs font-bold text-gray-800">
                      Description
                    </th>
                    <th className="px-5 sm:px-6 py-4 text-xs font-bold text-gray-800 text-right">
                      Amount (₹)
                    </th>
                    <th className="px-5 sm:px-6 py-4 text-xs font-bold text-gray-800 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-gray-400 font-bold">
                        <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-[var(--accent)]" />
                        Loading expenses...
                      </td>
                    </tr>
                  ) : filteredExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-16 text-center text-gray-400 font-bold text-sm">
                        <Layers size={40} className="mx-auto mb-3 opacity-30" />
                        No expense records found matching the filters.
                      </td>
                    </tr>
                  ) : (
                    filteredExpenses.map((exp) => (
                      <tr key={exp.id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-5 py-3.5 font-bold text-gray-900 whitespace-nowrap">
                          {exp.expense_date}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#FBFAF6] text-[#0A0A0A] border border-[#B7E1BE]">
                            {exp.category_name}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-gray-700 max-w-[280px] break-words">
                          {exp.description || '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right font-black text-sm text-[#0A0A0A] whitespace-nowrap">
                          {formatCurrencyValue(exp.amount)}
                        </td>
                        <td className="px-5 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => { setEditingExpense(exp); setIsRecordModalOpen(true) }}
                              title="Edit record"
                              className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-amber-50 hover:text-amber-700 text-gray-500 inline-flex items-center justify-center transition-colors cursor-pointer"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteExpense(exp.id)}
                              title="Delete record"
                              className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-rose-50 hover:text-rose-600 text-gray-500 inline-flex items-center justify-center transition-colors cursor-pointer"
                            >
                              <Trash2 size={14} />
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

          {/* Record Expense Modal */}
          <RecordExpenseModal
            isOpen={isRecordModalOpen}
            onClose={() => { setIsRecordModalOpen(false); setEditingExpense(null) }}
            onSuccess={handleExpenseSaved}
            categories={categories}
            expenseToEdit={editingExpense}
          />
        </div>
      )}
    </div>
  )
}
