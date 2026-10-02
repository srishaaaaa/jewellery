import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { BRAND_MONOGRAM } from '../lib/brand'
import { getPresetRange, toLocalDateStr } from '../lib/dateRanges'
import { csvDate, toCsv } from '../lib/csv'

export interface ExpenseRecord {
  id: string
  expense_date: string // YYYY-MM-DD
  category_id: number | null
  category_name: string
  amount: number
  description: string
  payment_mode?: string
  recorded_by_name?: string
  created_at: string
  updated_at?: string
}

export interface ExpenseCategory {
  id: number
  name: string
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface ExpenseSummaryMetrics {
  today: number
  this_week: number
  this_month: number
  this_year: number
  total_all_time: number
}

export interface ExpenseFilterPayload {
  fromDate?: string
  toDate?: string
  categoryId?: number | string
}

const STORAGE_EXPENSES_KEY = 'mahalashmi_stores_expenses_records_v1'
const STORAGE_CATEGORIES_KEY = 'mahalashmi_stores_expense_categories_v1'

// Default starter categories
export const DEFAULT_EXPENSE_CATEGORIES: string[] = [
  'Maintenance',
  'Marketing',
  'Other',
  'Rent',
  'Salaries',
  'Supplies',
]

// Track remote schema availability to prevent continuous 404 network spam
let remoteExpensesAvailable: boolean | null = null
let remoteCategoriesAvailable: boolean | null = null

const loadLocalExpenses = (): ExpenseRecord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_EXPENSES_KEY)
    return raw ? (JSON.parse(raw) as ExpenseRecord[]) : []
  } catch {
    return []
  }
}

const saveLocalExpenses = (records: ExpenseRecord[]) => {
  try {
    localStorage.setItem(STORAGE_EXPENSES_KEY, JSON.stringify(records))
  } catch (err) {
    console.warn('Failed to save expenses to localStorage:', err)
  }
}

const loadLocalCategories = (): ExpenseCategory[] => {
  try {
    const raw = localStorage.getItem(STORAGE_CATEGORIES_KEY)
    if (raw) return JSON.parse(raw) as ExpenseCategory[]
  } catch {
    // fallback
  }
  const defaults = DEFAULT_EXPENSE_CATEGORIES.map((name, idx) => ({
    id: idx + 1,
    name,
    is_active: true,
  }))
  saveLocalCategories(defaults)
  return defaults
}

const saveLocalCategories = (cats: ExpenseCategory[]) => {
  try {
    localStorage.setItem(STORAGE_CATEGORIES_KEY, JSON.stringify(cats))
  } catch (err) {
    console.warn('Failed to save categories to localStorage:', err)
  }
}

function calculateMetricsFromList(expenses: ExpenseRecord[]): ExpenseSummaryMetrics {
  // Whole periods: week Monday–Sunday, month 1st–last day, year 1 Jan–31 Dec
  const todayStr = toLocalDateStr(new Date())
  const week = getPresetRange('week')
  const month = getPresetRange('month')
  const year = getPresetRange('year')

  let today = 0
  let this_week = 0
  let this_month = 0
  let this_year = 0
  let total_all_time = 0

  for (const exp of expenses) {
    const amt = Number(exp.amount) || 0
    total_all_time += amt
    if (exp.expense_date === todayStr) today += amt
    if (exp.expense_date >= week.from && exp.expense_date <= week.to) this_week += amt
    if (exp.expense_date >= month.from && exp.expense_date <= month.to) this_month += amt
    if (exp.expense_date >= year.from && exp.expense_date <= year.to) this_year += amt
  }

  return { today, this_week, this_month, this_year, total_all_time }
}

export const expenseService = {
  // 1. Fetch KPI Metrics
  async getMetrics(): Promise<ExpenseSummaryMetrics> {
    if (isSupabaseConfigured && remoteExpensesAvailable !== false) {
      try {
        const { data, error } = await supabase.rpc('get_expense_summary_metrics', { p_current_date: toLocalDateStr(new Date()) })
        if (!error && data) {
          remoteExpensesAvailable = true
          return {
            today: Number(data.today) || 0,
            this_week: Number(data.this_week) || 0,
            this_month: Number(data.this_month) || 0,
            this_year: Number(data.this_year) || 0,
            total_all_time: Number(data.total_all_time) || 0,
          }
        }
        if (error && (error.code === 'PGRST202' || error.code === 'PGRST205' || error.message?.includes('not find'))) {
          // Table/RPC not in schema cache
          remoteExpensesAvailable = false
        }
      } catch {
        remoteExpensesAvailable = false
      }
    }

    // Direct local / remote list fallback
    const list = await this.getExpenses()
    return calculateMetricsFromList(list)
  },

  // 2. Fetch Expenses with Date Filtering
  async getExpenses(filters?: ExpenseFilterPayload): Promise<ExpenseRecord[]> {
    if (isSupabaseConfigured && remoteExpensesAvailable !== false) {
      try {
        let query = supabase
          .from('expenses')
          .select('*')
          .order('expense_date', { ascending: false })
          .order('created_at', { ascending: false })

        if (filters?.fromDate) {
          query = query.gte('expense_date', filters.fromDate)
        }
        if (filters?.toDate) {
          query = query.lte('expense_date', filters.toDate)
        }
        if (filters?.categoryId && filters.categoryId !== 'all') {
          const catNum = Number(filters.categoryId)
          if (!Number.isNaN(catNum) && catNum > 0) {
            query = query.eq('category_id', catNum)
          } else {
            query = query.ilike('category_name', String(filters.categoryId))
          }
        }

        const { data, error } = await query
        if (!error && data) {
          remoteExpensesAvailable = true
          // Update local backup
          if (!filters?.fromDate && !filters?.toDate && (!filters?.categoryId || filters.categoryId === 'all')) {
            saveLocalExpenses(data as ExpenseRecord[])
          }
          return data as ExpenseRecord[]
        }
        if (error && (error.code === 'PGRST205' || error.message?.includes('not find'))) {
          remoteExpensesAvailable = false
        }
      } catch {
        remoteExpensesAvailable = false
      }
    }

    // Local Storage Filter
    let local = loadLocalExpenses()
    if (filters?.fromDate) {
      local = local.filter((e) => e.expense_date >= filters.fromDate!)
    }
    if (filters?.toDate) {
      local = local.filter((e) => e.expense_date <= filters.toDate!)
    }
    if (filters?.categoryId && filters.categoryId !== 'all') {
      local = local.filter(
        (e) =>
          String(e.category_id) === String(filters.categoryId) ||
          e.category_name.toLowerCase() === String(filters.categoryId).toLowerCase()
      )
    }

    return local.sort((a, b) => new Date(b.expense_date).getTime() - new Date(a.expense_date).getTime())
  },

  // 3. Record a New Expense
  async createExpense(payload: {
    expense_date: string
    category_id: number | null
    category_name: string
    amount: number
    description?: string
    payment_mode?: string
    recorded_by_name?: string
  }): Promise<ExpenseRecord> {
    const newRecord: ExpenseRecord = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `exp_${Date.now()}`,
      expense_date: payload.expense_date,
      category_id: payload.category_id || null,
      category_name: payload.category_name.trim(),
      amount: Math.max(0.01, payload.amount),
      description: (payload.description || '').trim(),
      payment_mode: payload.payment_mode || 'cash',
      recorded_by_name: payload.recorded_by_name || 'Staff',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (isSupabaseConfigured && remoteExpensesAvailable !== false) {
      try {
        const { data, error } = await supabase
          .from('expenses')
          .insert({
            expense_date: newRecord.expense_date,
            category_id: newRecord.category_id,
            category_name: newRecord.category_name,
            amount: newRecord.amount,
            description: newRecord.description,
            payment_mode: newRecord.payment_mode,
            recorded_by_name: newRecord.recorded_by_name,
          })
          .select()
          .single()

        if (!error && data) {
          remoteExpensesAvailable = true
          const local = loadLocalExpenses()
          saveLocalExpenses([data as ExpenseRecord, ...local])
          return data as ExpenseRecord
        }
        if (error && (error.code === 'PGRST205' || error.message?.includes('not find'))) {
          remoteExpensesAvailable = false
        }
      } catch {
        remoteExpensesAvailable = false
      }
    }

    // Save to local storage
    const current = loadLocalExpenses()
    const updated = [newRecord, ...current]
    saveLocalExpenses(updated)
    return newRecord
  },

  // 4. Update an Expense
  async updateExpense(id: string, payload: {
    expense_date: string
    category_id: number | null
    category_name: string
    amount: number
    description?: string
  }): Promise<ExpenseRecord> {
    const patch = {
      expense_date: payload.expense_date,
      category_id: payload.category_id || null,
      category_name: payload.category_name.trim(),
      amount: Math.max(0.01, payload.amount),
      description: (payload.description || '').trim(),
      updated_at: new Date().toISOString(),
    }

    if (isSupabaseConfigured && remoteExpensesAvailable !== false) {
      try {
        const { data, error } = await supabase
          .from('expenses')
          .update(patch)
          .eq('id', id)
          .select()
          .single()

        if (!error && data) {
          remoteExpensesAvailable = true
          const local = loadLocalExpenses()
          saveLocalExpenses(local.map((e) => (e.id === id ? (data as ExpenseRecord) : e)))
          return data as ExpenseRecord
        }
        if (error && (error.code === 'PGRST205' || error.message?.includes('not find'))) {
          remoteExpensesAvailable = false
        }
      } catch {
        remoteExpensesAvailable = false
      }
    }

    const current = loadLocalExpenses()
    const existing = current.find((e) => e.id === id)
    if (!existing) throw new Error('Expense record not found')
    const updated: ExpenseRecord = { ...existing, ...patch }
    saveLocalExpenses(current.map((e) => (e.id === id ? updated : e)))
    return updated
  },

  // 4b. Delete an Expense
  async deleteExpense(id: string): Promise<void> {
    if (isSupabaseConfigured && remoteExpensesAvailable !== false) {
      try {
        const { error } = await supabase.from('expenses').delete().eq('id', id)
        if (!error) {
          remoteExpensesAvailable = true
        } else if (error.code === 'PGRST205' || error.message?.includes('not find')) {
          remoteExpensesAvailable = false
        }
      } catch {
        remoteExpensesAvailable = false
      }
    }

    const current = loadLocalExpenses()
    const filtered = current.filter((e) => e.id !== id)
    saveLocalExpenses(filtered)
  },

  // 5. Category Operations
  async getCategories(): Promise<ExpenseCategory[]> {
    if (isSupabaseConfigured && remoteCategoriesAvailable !== false) {
      try {
        const { data, error } = await supabase
          .from('expense_categories')
          .select('*')
          .order('name', { ascending: true })

        if (!error && data && data.length > 0) {
          remoteCategoriesAvailable = true
          saveLocalCategories(data as ExpenseCategory[])
          return data as ExpenseCategory[]
        }
        if (error && (error.code === 'PGRST205' || error.message?.includes('not find'))) {
          remoteCategoriesAvailable = false
        }
      } catch {
        remoteCategoriesAvailable = false
      }
    }

    return loadLocalCategories()
  },

  async createCategory(name: string): Promise<ExpenseCategory> {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Category name cannot be empty')

    if (isSupabaseConfigured && remoteCategoriesAvailable !== false) {
      try {
        const { data, error } = await supabase
          .from('expense_categories')
          .insert({ name: cleanName, is_active: true })
          .select()
          .single()

        if (!error && data) {
          remoteCategoriesAvailable = true
          const local = loadLocalCategories()
          saveLocalCategories([...local, data as ExpenseCategory])
          return data as ExpenseCategory
        }
        if (error && (error.code === 'PGRST205' || error.message?.includes('not find'))) {
          remoteCategoriesAvailable = false
        }
      } catch {
        remoteCategoriesAvailable = false
      }
    }

    const local = loadLocalCategories()
    const newCat: ExpenseCategory = {
      id: Date.now(),
      name: cleanName,
      is_active: true,
      created_at: new Date().toISOString(),
    }
    saveLocalCategories([...local, newCat])
    return newCat
  },

  async deleteCategory(id: number): Promise<void> {
    if (isSupabaseConfigured && remoteCategoriesAvailable !== false) {
      try {
        const { error } = await supabase
          .from('expense_categories')
          .delete()
          .eq('id', id)

        if (!error) {
          remoteCategoriesAvailable = true
        } else if (error.code === 'PGRST205' || error.message?.includes('not find')) {
          remoteCategoriesAvailable = false
        }
      } catch {
        remoteCategoriesAvailable = false
      }
    }

    const local = loadLocalCategories()
    const filtered = local.filter((c) => c.id !== id)
    saveLocalCategories(filtered)
  },
}

// 6. CSV Ledger Export Utility
export function exportExpensesToCSV(expenses: ExpenseRecord[]): void {
  const headers = ['Date', 'Category', 'Description', 'Amount (INR)', 'Recorded By']
  const rows = expenses.map((e) => [
    csvDate(e.expense_date),
    e.category_name || 'Uncategorized',
    e.description || '',
    Number(e.amount || 0).toFixed(2),
    e.recorded_by_name || 'Staff',
  ])

  const csvContent = toCsv([headers, ...rows])
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${BRAND_MONOGRAM}-Expenses-${toLocalDateStr(new Date())}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
