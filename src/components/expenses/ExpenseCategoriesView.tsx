import React, { useState } from 'react'
import { Plus, Trash2, Tag, AlertCircle, CheckCircle2 } from 'lucide-react'
import { expenseService, type ExpenseCategory } from '../../services/expenseService'
import { getErrorMessage } from '../../lib/errorMessage'

interface ExpenseCategoriesViewProps {
  categories: ExpenseCategory[]
  onCategoriesUpdated: () => void
}

export const ExpenseCategoriesView: React.FC<ExpenseCategoriesViewProps> = ({
  categories,
  onCategoriesUpdated,
}) => {
  const [newCatName, setNewCatName] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = newCatName.trim()
    if (!trimmed) return

    setLoading(true)
    setNotice(null)
    try {
      await expenseService.createCategory(trimmed)
      setNewCatName('')
      setNotice({ type: 'success', text: `Category "${trimmed}" created successfully!` })
      onCategoriesUpdated()
    } catch (err: unknown) {
      console.error('Failed to create category:', err)
      const msg = getErrorMessage(err, 'Could not create category')
      setNotice({ type: 'error', text: msg })
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCategory = async (cat: ExpenseCategory) => {
    if (!window.confirm(`Delete expense category "${cat.name}"? Historical expenses will remain intact.`)) {
      return
    }

    try {
      await expenseService.deleteCategory(cat.id)
      setNotice({ type: 'success', text: `Category "${cat.name}" deleted.` })
      onCategoriesUpdated()
    } catch (err: unknown) {
      console.error('Failed to delete category:', err)
      const msg = getErrorMessage(err, 'Could not delete category')
      setNotice({ type: 'error', text: msg })
    }
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div
          className={`flex items-center gap-2.5 p-4 rounded-2xl border text-xs font-bold ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle size={16} className="text-rose-600 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* 2-Column Grid matching reference UI */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* LEFT COLUMN: Add Category Card */}
        <div className="bg-white border border-gray-200 rounded-3xl p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
            <Tag size={16} className="text-[var(--accent)]" />
            <h4 className="text-xs font-bold text-gray-800">
              Add Category
            </h4>
          </div>

          <form onSubmit={handleAddCategory} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">
                Category Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Utility Bills, Packaging"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !newCatName.trim()}
              className="w-full h-11 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-xs font-bold hover:bg-[#1A1A1A] transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Plus size={14} /> {loading ? 'Adding...' : 'Add Category'}
            </button>
          </form>
        </div>

        {/* RIGHT COLUMN: Categories Table Card */}
        <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-xs">
          <div className="p-5 border-b border-gray-100 bg-[#FAFAFA] flex items-center justify-between">
            <h4 className="text-xs font-bold text-gray-800">
              Expense Categories ({categories.length})
            </h4>
          </div>

          <div className="md:hidden divide-y divide-gray-100">
            {categories.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-400 font-bold text-xs">
                No expense categories configured.
              </div>
            ) : (
              categories.map((cat) => (
                <div key={cat.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-[13px] break-words">{cat.name}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Active</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteCategory(cat)}
                    title={`Delete ${cat.name}`}
                    className="shrink-0 w-9 h-9 rounded-lg bg-gray-100 hover:bg-rose-50 hover:text-rose-600 text-gray-500 inline-flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-[#FBFAF6]">
                  <th className="px-5 py-3.5 text-[11px] font-bold text-gray-600">
                    Category Name
                  </th>
                  <th className="px-5 py-3.5 text-[11px] font-bold text-gray-600">
                    Status
                  </th>
                  <th className="px-5 py-3.5 text-[11px] font-bold text-gray-600 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs">
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-8 text-center text-gray-400 font-bold">
                      No expense categories configured.
                    </td>
                  </tr>
                ) : (
                  categories.map((cat) => (
                    <tr key={cat.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="px-5 py-3.5 font-bold text-gray-900">
                        {cat.name}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Active
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat)}
                          title={`Delete ${cat.name}`}
                          className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-rose-50 hover:text-rose-600 text-gray-500 inline-flex items-center justify-center transition-colors cursor-pointer"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
