import React, { useState, useEffect } from 'react'
import { X, Calendar, Tag, AlertCircle } from 'lucide-react'
import { expenseService, type ExpenseCategory, type ExpenseRecord } from '../../services/expenseService'
import { getErrorMessage } from '../../lib/errorMessage'
import { ModalPortal } from '../ModalPortal'
import { toLocalDateStr } from '../../lib/dateRanges'

interface RecordExpenseModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (expense: ExpenseRecord) => void
  categories: ExpenseCategory[]
  expenseToEdit?: ExpenseRecord | null
}

export const RecordExpenseModal: React.FC<RecordExpenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  categories,
  expenseToEdit,
}) => {
  const isEditing = Boolean(expenseToEdit)
  const [expenseDate, setExpenseDate] = useState(() => expenseToEdit?.expense_date || toLocalDateStr(new Date()))
  const [categoryId, setCategoryId] = useState<number | string>(() => expenseToEdit?.category_id ?? categories[0]?.id ?? '')
  const [amount, setAmount] = useState(() => expenseToEdit ? String(expenseToEdit.amount) : '')
  const [description, setDescription] = useState(() => expenseToEdit?.description || '')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setExpenseDate(expenseToEdit?.expense_date || toLocalDateStr(new Date()))
    setCategoryId(expenseToEdit?.category_id ?? categories[0]?.id ?? '')
    setAmount(expenseToEdit ? String(expenseToEdit.amount) : '')
    setDescription(expenseToEdit?.description || '')
    setErrorMsg('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, expenseToEdit])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('Please enter a valid positive amount.')
      return
    }

    const selectedCategory = categories.find((c) => String(c.id) === String(categoryId))
    const categoryName = selectedCategory ? selectedCategory.name : 'Other'

    setLoading(true)
    try {
      const saved = isEditing && expenseToEdit
        ? await expenseService.updateExpense(expenseToEdit.id, {
            expense_date: expenseDate,
            category_id: selectedCategory ? selectedCategory.id : null,
            category_name: categoryName,
            amount: numAmount,
            description: description.trim(),
          })
        : await expenseService.createExpense({
            expense_date: expenseDate,
            category_id: selectedCategory ? selectedCategory.id : null,
            category_name: categoryName,
            amount: numAmount,
            description: description.trim(),
            payment_mode: 'cash',
            recorded_by_name: 'Admin',
          })
      onSuccess(saved)
      onClose()
    } catch (err: unknown) {
      console.error('Failed to save expense:', err)
      const msg = getErrorMessage(err, 'An error occurred while saving expense')
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4 overflow-hidden animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl sm:rounded-3xl max-w-md w-full max-h-[92vh] border border-[#B7E1BE] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="shrink-0 px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-[#FBFAF6]">
          <div className="flex items-center gap-2">
            <Tag size={17} className="text-[var(--accent)]" />
            <h3 className="text-sm font-bold text-[#0A0A0A]">
              {isEditing ? 'Edit Expense' : 'Record Expense'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 cursor-pointer transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto min-h-0 flex-1 p-4 sm:p-6 space-y-4">
          {errorMsg && (
            <div className="flex items-center gap-2 text-xs font-bold text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-xl">
              <AlertCircle size={15} className="text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Date Picker */}
          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">
              Date <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="date"
                required
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="w-full h-11 px-3 pl-9 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white transition-all"
              />
              <Calendar size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* Category Dropdown */}
          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">
              Category <span className="text-red-500">*</span>
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full h-11 px-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-bold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white cursor-pointer transition-all touch-manipulation appearance-none relative z-20"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Amount (₹) */}
          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">
              Amount (₹) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-sm text-[#0A0A0A]">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-11 pl-8 pr-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-sm font-bold text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">
              Description / Notes
            </label>
            <textarea
              rows={3}
              placeholder="Optional details (e.g. Shop electric bill, store supplies)..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3 rounded-xl border border-gray-300 bg-[#FAFAFA] text-xs font-medium text-gray-900 outline-none focus:border-[#0A0A0A] focus:bg-white resize-none transition-all"
            />
          </div>

          {/* Modal Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-[1.5] h-11 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] text-[var(--accent)] text-xs font-bold hover:bg-[#1A1A1A] transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? 'Saving...' : isEditing ? 'Update Expense' : 'Save Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </ModalPortal>
  )
}
