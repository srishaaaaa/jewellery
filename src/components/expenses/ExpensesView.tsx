import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, Coins, Download, Edit2, List, PiggyBank, Plus, Receipt, Search, Tag, Trash2, Wallet } from 'lucide-react'
import {
  expenseService,
  exportExpensesToCSV,
  type ExpenseCategory,
  type ExpenseRecord,
} from '../../services/expenseService'
import { ExpenseCategoriesView } from './ExpenseCategoriesView'
import { getPresetRange, toLocalDateStr } from '../../lib/dateRanges'
import { getErrorMessage } from '../../lib/errorMessage'

type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom'
const PERIODS: [PeriodKey, string][] = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year'], ['all', 'All'], ['custom', 'Custom']]
const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK TRANSFER']
const CUSTOM = '__custom__'

const label = 'block text-[10px] font-bold uppercase tracking-wider text-[#000000] mb-1'
const field = 'w-full bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[var(--accent)] placeholder:text-black/30'
const money = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Expense Tracker in the IGMOLS layout: period filter, summary cards, add form, category split, log. */
export const ExpensesView: React.FC = () => {
  const [view, setView] = useState<'expenses' | 'categories'>('expenses')
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(false)

  const [period, setPeriod] = useState<PeriodKey>('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  // Add / edit form
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => toLocalDateStr(new Date()))
  const [categoryId, setCategoryId] = useState<string>('')
  const [customCategory, setCustomCategory] = useState('')
  const [paymentMode, setPaymentMode] = useState('CASH')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const range = useMemo(() => {
    if (period === 'all') return { from: '', to: '' }
    if (period === 'custom') return { from: startDate, to: endDate }
    return getPresetRange(period)
  }, [period, startDate, endDate])

  const loadCategories = useCallback(async () => {
    try { setCategories(await expenseService.getCategories()) } catch (err) { console.warn('Failed to load categories:', err) }
  }, [])

  const loadExpenses = useCallback(async () => {
    setLoading(true)
    try {
      setExpenses(await expenseService.getExpenses({ fromDate: range.from || undefined, toDate: range.to || undefined }))
    } catch (err) {
      console.error('Failed to load expenses:', err)
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to])

  useEffect(() => { void loadCategories() }, [loadCategories])
  useEffect(() => { void loadExpenses() }, [loadExpenses])
  useEffect(() => { if (!categoryId && categories[0]) setCategoryId(String(categories[0].id)) }, [categories, categoryId])

  const stats = useMemo(() => {
    const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const byCategory = new Map<string, number>()
    for (const e of expenses) byCategory.set(e.category_name || 'Other', (byCategory.get(e.category_name || 'Other') || 0) + Number(e.amount || 0))
    const categoryBreakdown = [...byCategory.entries()].map(([category, amt]) => ({ category, amount: amt })).sort((a, b) => b.amount - a.amount)
    const q = search.trim().toLowerCase()
    const filtered = expenses.filter(e =>
      (categoryFilter === 'ALL' || e.category_name === categoryFilter) &&
      (!q || [e.description, e.category_name, e.payment_mode, String(e.amount)].join(' ').toLowerCase().includes(q)))
    return { total, count: expenses.length, topCategory: categoryBreakdown[0]?.category || 'None', categoryBreakdown, allCategories: [...byCategory.keys()].sort(), filtered }
  }, [expenses, categoryFilter, search])

  const resetForm = () => {
    setEditingId(null); setTitle(''); setAmount(''); setDate(toLocalDateStr(new Date()))
    setCustomCategory(''); setPaymentMode('CASH'); setNotes(''); setFormError('')
    if (categories[0]) setCategoryId(String(categories[0].id))
  }

  const startEdit = (e: ExpenseRecord) => {
    const [what, ...rest] = (e.description || '').split(' — ')
    setEditingId(e.id); setTitle(what || ''); setNotes(rest.join(' — ')); setAmount(String(e.amount))
    setDate(e.expense_date); setCategoryId(e.category_id != null ? String(e.category_id) : (categories[0] ? String(categories[0].id) : ''))
    setPaymentMode((e.payment_mode || 'cash').toUpperCase()); setFormError('')
    document.getElementById('expense-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const saveExpense = async () => {
    const value = parseFloat(amount)
    if (!title.trim()) { setFormError('Enter what the expense was for.'); return }
    if (!Number.isFinite(value) || value <= 0) { setFormError('Enter an amount above ₹0.'); return }
    setSaving(true); setFormError('')
    try {
      let category = categories.find(c => String(c.id) === categoryId) || null
      if (categoryId === CUSTOM) {
        if (!customCategory.trim()) { setFormError('Enter the custom category name.'); setSaving(false); return }
        category = await expenseService.createCategory(customCategory.trim())
        await loadCategories()
      }
      const description = notes.trim() ? `${title.trim()} — ${notes.trim()}` : title.trim()
      const payload = { expense_date: date, category_id: category ? category.id : null, category_name: category?.name || 'Other', amount: value, description }
      if (editingId) await expenseService.updateExpense(editingId, payload)
      else await expenseService.createExpense({ ...payload, payment_mode: paymentMode.toLowerCase(), recorded_by_name: 'Admin' })
      resetForm()
      await loadExpenses()
    } catch (err) {
      setFormError(getErrorMessage(err, 'Could not save the expense.'))
    } finally {
      setSaving(false)
    }
  }

  const deleteExpense = async (id: string) => {
    if (!window.confirm('Delete this expense record?')) return
    try {
      await expenseService.deleteExpense(id)
      setExpenses(prev => prev.filter(e => e.id !== id))
      if (editingId === id) resetForm()
    } catch (err) {
      console.error('Failed to delete expense:', err)
      alert('Could not delete expense record')
    }
  }

  return (
    <div className="flex-1 flex flex-col w-full pb-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
        <div>
          <h2 className="text-[28px] font-black text-[#000000] tracking-tight flex items-center gap-3">
            <Wallet className="w-7 h-7 text-[var(--accent)]" />
            Expense Tracker
          </h2>
          <p className="text-xs text-[#000000] font-semibold mt-1">
            Record what the shop spends. Expenses are offset against sales to show your real Net Profit on the dashboard.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === 'expenses' && (
            <div className="flex flex-wrap items-center gap-1.5 bg-[#FAFAFA] border border-black/10 rounded-xl p-1">
              {PERIODS.map(([key, text]) => (
                <button key={key} type="button" onClick={() => setPeriod(key)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${period === key ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[#000000] hover:bg-black/5'}`}>
                  {text}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setView(view === 'expenses' ? 'categories' : 'expenses')}
            className="flex items-center gap-1.5 px-3 py-2 border border-[var(--accent-a30)] text-[var(--accent)] hover:bg-[var(--accent-a5)] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer">
            {view === 'expenses' ? <><Tag className="w-3.5 h-3.5" /> Manage Categories</> : <><Receipt className="w-3.5 h-3.5" /> Back to Expenses</>}
          </button>
        </div>
      </div>

      {view === 'categories' ? (
        <ExpenseCategoriesView categories={categories} onCategoriesUpdated={() => { void loadCategories(); void loadExpenses() }} />
      ) : (
        <>
          {period === 'custom' && (
            <div className="flex flex-wrap items-end gap-3 mb-6 bg-white border border-black/10 rounded-xl p-4">
              <div>
                <label className={label}>From</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[var(--accent)]" />
              </div>
              <div>
                <label className={label}>To</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-sm text-[#000000] focus:outline-none focus:border-[var(--accent)]" />
              </div>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="rounded-xl p-5 shadow-sm text-white bg-gradient-to-br from-[var(--accent)] to-[color-mix(in_srgb,var(--accent)_55%,#000000)]">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/90">Total Expenses</span>
                <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center"><Coins className="w-4 h-4 text-white" /></div>
              </div>
              <div className="text-2xl font-black">{money(stats.total)}</div>
              <div className="text-[9px] text-white/80 font-semibold mt-1 uppercase tracking-wider">{period} period</div>
            </div>
            <div className="bg-white border border-black/10 rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">Entries</span>
                <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center"><Receipt className="w-4 h-4 text-[#9a8c86]" /></div>
              </div>
              <div className="text-2xl font-black text-[#000000]">{stats.count}</div>
              <div className="text-[9px] text-[#000000] font-semibold mt-1">Expenses recorded</div>
            </div>
            <div className="bg-white border border-black/10 rounded-xl p-5 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#000000]">Top Category</span>
                <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center"><Tag className="w-4 h-4 text-[#9a8c86]" /></div>
              </div>
              <div className="text-lg font-black text-[#000000] truncate">{stats.topCategory}</div>
              <div className="text-[9px] text-[#000000] font-semibold mt-1">Highest spend</div>
            </div>
          </div>

          {/* Add form + category breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
            <div id="expense-form" className={`lg:col-span-2 bg-white border rounded-xl p-5 shadow-sm h-fit scroll-mt-4 ${editingId ? 'border-[var(--accent)] ring-2 ring-[var(--accent-a15)]' : 'border-black/10'}`}>
              <h3 className="text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2 mb-4">
                <span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />
                {editingId ? 'Edit Expense' : 'Add Expense'}
              </h3>
              <div className="space-y-3">
                <div>
                  <label className={label}>What for?</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. October shop rent" className={field} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Amount (₹)</label>
                    <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} onWheel={e => e.currentTarget.blur()} placeholder="0.00" className={field} />
                  </div>
                  <div>
                    <label className={label}>Date</label>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
                  </div>
                </div>
                <div>
                  <label className={label}>Category</label>
                  <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={`${field} cursor-pointer`}>
                    {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                    <option value={CUSTOM}>+ Custom category…</option>
                  </select>
                </div>
                {categoryId === CUSTOM && (
                  <div>
                    <label className={label}>Custom category name</label>
                    <input type="text" value={customCategory} onChange={e => setCustomCategory(e.target.value)} placeholder="e.g. Festival decorations" className={field} />
                  </div>
                )}
                <div>
                  <label className={label}>Paid via</label>
                  <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} disabled={Boolean(editingId)} className={`${field} cursor-pointer disabled:opacity-60`}>
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Notes (optional)</label>
                  <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Reference / supplier / bill no." className={field} />
                </div>
                {formError && <p className="text-[11px] font-bold text-[#DC2626]">{formError}</p>}
                <button type="button" onClick={() => void saveExpense()} disabled={saving}
                  className="w-full mt-1 bg-[var(--accent)] hover:bg-[#27272A] disabled:opacity-60 text-white py-3 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] flex items-center justify-center gap-2 transition-transform active:scale-[0.98] shadow-sm cursor-pointer">
                  {editingId ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {saving ? 'Saving…' : editingId ? 'Update Expense' : 'Add Expense'}
                </button>
                {editingId && (
                  <button type="button" onClick={resetForm} disabled={saving}
                    className="w-full bg-black/5 hover:bg-black/10 text-[#000000] py-2.5 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] cursor-pointer transition-colors">
                    Cancel Edit
                  </button>
                )}
              </div>
            </div>

            <div className="lg:col-span-3 bg-white border border-black/10 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2 mb-4">
                <span className="w-1.5 h-6 bg-[var(--accent)] rounded-full" />
                Spend by Category
              </h3>
              {stats.categoryBreakdown.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-14 h-14 rounded-full bg-black/5 flex items-center justify-center mx-auto mb-4"><PiggyBank className="w-7 h-7 text-[#9a8c86]" /></div>
                  <p className="text-sm font-bold text-[#000000]">No expenses in this period yet.</p>
                  <p className="text-xs font-semibold text-[#000000]/60 mt-1">Add your first expense to see the breakdown.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.categoryBreakdown.map(row => {
                    const max = stats.categoryBreakdown[0].amount || 1
                    const pct = stats.total ? (row.amount / stats.total) * 100 : 0
                    return (
                      <div key={row.category}>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-[#000000] flex items-center gap-1.5"><Tag className="w-3 h-3 text-[#9a8c86]" />{row.category}</span>
                          <span className="text-xs font-black text-[#000000]">
                            {money(row.amount)}
                            <span className="text-[10px] font-bold text-[#000000]/50 ml-1.5">{pct.toFixed(0)}%</span>
                          </span>
                        </div>
                        <div className="h-2.5 bg-black/5 rounded-full overflow-hidden">
                          <div className="h-full bg-[var(--accent-dark)] rounded-full transition-all duration-700" style={{ width: `${(row.amount / max) * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Expense log */}
          <div className="bg-white border border-black/10 rounded-xl shadow-sm overflow-hidden">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 border-b border-black/10">
              <h3 className="text-sm font-black text-[#000000] uppercase tracking-wider flex items-center gap-2">
                <List className="w-4 h-4 text-[var(--accent)]" />
                Expense Log
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                  className="bg-[#FAFAFA] border border-black/10 rounded-lg px-3 py-2 text-xs font-bold text-[#000000] focus:outline-none focus:border-[var(--accent)] cursor-pointer">
                  <option value="ALL">All categories</option>
                  {stats.allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-black/30 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search expenses…"
                    className="bg-[#FAFAFA] border border-black/10 rounded-lg pl-8 pr-3 py-2 text-xs text-[#000000] focus:outline-none focus:border-[var(--accent)] placeholder:text-black/30 w-44" />
                </div>
                <button type="button" onClick={() => exportExpensesToCSV(stats.filtered)} disabled={stats.filtered.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 border border-black/10 rounded-lg text-[10px] font-bold uppercase tracking-wider text-[#000000] hover:bg-black/5 transition-colors cursor-pointer disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-12 text-center text-xs font-bold text-[#000000]/60">Loading expenses…</div>
            ) : stats.filtered.length === 0 ? (
              <div className="py-12 text-center">
                <div className="w-14 h-14 rounded-full bg-black/5 flex items-center justify-center mx-auto mb-4"><Wallet className="w-7 h-7 text-[#9a8c86]" /></div>
                <p className="text-sm font-bold text-[#000000]">No expenses found.</p>
                <p className="text-xs font-semibold text-[#000000]/60 mt-1">Try a different period or add a new expense.</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#FAFAFA] border-b border-black/10 select-none">
                  <tr>
                    {['Date', 'Expense', 'Category', 'Paid via'].map(h => (
                      <th key={h} className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider">{h}</th>
                    ))}
                    <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-right">Amount</th>
                    <th className="p-3 text-[10px] font-black text-[#000000] uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.filtered.map(e => (
                    <tr key={e.id} className="border-b border-black/5 hover:bg-[#FAFAFA] transition-colors">
                      <td className="p-3 text-xs font-semibold text-[#000000]">{new Date(`${e.expense_date}T00:00:00`).toLocaleDateString('en-IN')}</td>
                      <td className="p-3 text-xs font-bold text-[#000000] break-words">{e.description || '—'}</td>
                      <td className="p-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-black/5 text-[10px] font-bold text-[#000000]"><Tag className="w-3 h-3" />{e.category_name}</span>
                      </td>
                      <td className="p-3 text-[10px] font-bold uppercase tracking-wider text-[#000000]">{e.payment_mode || 'cash'}</td>
                      <td className="p-3 text-sm font-black text-[var(--accent)] text-right">{money(e.amount)}</td>
                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button type="button" onClick={() => startEdit(e)} title="Edit" className="flex items-center justify-center w-8 h-8 bg-black/5 hover:bg-black/10 text-[#000000] rounded-md transition-colors cursor-pointer"><Edit2 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => void deleteExpense(e.id)} title="Delete" className="flex items-center justify-center w-8 h-8 bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626] rounded-md transition-colors cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
