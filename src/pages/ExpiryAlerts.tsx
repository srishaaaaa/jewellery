import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CalendarPlus, CalendarX2, Check, ChevronDown, ChevronUp, Download, Pencil, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'
import { useAdminAuthStore, useProductStore, useSettingsStore } from '../store/store'
import { formatCurrency } from '../lib/retail'
import { supabase } from '../lib/supabase'
import { getErrorMessage } from '../lib/errorMessage'
import { inventoryService } from '../services/inventoryService'
import { getPresetRange } from '../lib/dateRanges'
import { csvDate, toCsv } from '../lib/csv'

type StatusFilter = 'expired' | 'soon' | 'all'
type DatePreset = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom'

export default function ExpiryAlerts() {
  const { products, fetchProducts } = useProductStore()
  const alertDays = useSettingsStore(s => s.settings?.expiryAlertDays ?? 30)
  const role = useAdminAuthStore(state => state.role)
  const isAdmin = role === 'admin'
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('expired')
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkSearch, setBulkSearch] = useState('')
  const [pendingMfgDates, setPendingMfgDates] = useState<Record<string, string>>({})
  const [pendingExpiryDates, setPendingExpiryDates] = useState<Record<string, string>>({})
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [bulkError, setBulkError] = useState('')
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [rowEditMfg, setRowEditMfg] = useState('')
  const [rowEditExpiry, setRowEditExpiry] = useState('')
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [rowError, setRowError] = useState('')

  // Force a fresh fetch every time this screen is opened — products get their
  // expiry/mfg dates edited elsewhere (Inventory, the bulk panel below), and
  // the store's 5-minute fetch cache would otherwise show a stale snapshot
  // here right after such an edit.
  useEffect(() => { void fetchProducts(true) }, [fetchProducts])

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

  const untracked = useMemo(() => {
    return products
      .filter(p => p.isActive !== false)
      .filter(p => (p.category || '').trim().toLowerCase() !== 'unregistered')
      .filter(p => !p.expiryDate || !p.mfgDate)
      .filter(p =>
        p.name.toLowerCase().includes(bulkSearch.toLowerCase()) ||
        (p.category || '').toLowerCase().includes(bulkSearch.toLowerCase())
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, bulkSearch])

  const pendingCount = new Set([...Object.keys(pendingMfgDates), ...Object.keys(pendingExpiryDates)]).size

  const saveDates = async (productId: string | number, dates: { mfg?: string; expiry?: string }) => {
    const key = String(productId)
    setBulkError('')
    setSavingIds(prev => new Set(prev).add(key))
    try {
      const payload: Record<string, string> = {}
      if (dates.mfg) payload.mfg_date = dates.mfg
      if (dates.expiry) payload.expiry_date = dates.expiry
      const { error } = await supabase.from('products').update(payload).eq('id', productId)
      if (error) throw error
      setPendingMfgDates(prev => { const next = { ...prev }; delete next[key]; return next })
      setPendingExpiryDates(prev => { const next = { ...prev }; delete next[key]; return next })
    } catch (err) {
      setBulkError(getErrorMessage(err, 'Failed to save dates'))
    } finally {
      setSavingIds(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  const saveOne = async (productId: string | number, dates: { mfg?: string; expiry?: string }) => {
    await saveDates(productId, dates)
    await fetchProducts(true)
  }

  const saveAllPending = async () => {
    const ids = new Set([...Object.keys(pendingMfgDates), ...Object.keys(pendingExpiryDates)])
    if (ids.size === 0) return
    await Promise.all(
      Array.from(ids).map(id => saveDates(id, { mfg: pendingMfgDates[id], expiry: pendingExpiryDates[id] }))
    )
    await fetchProducts(true)
  }

  const startEditRow = (productId: string | number, mfgDate: string, expiryDate: string) => {
    setRowError('')
    setEditingRowId(String(productId))
    setRowEditMfg(mfgDate || '')
    setRowEditExpiry(expiryDate || '')
  }

  const cancelEditRow = () => {
    setEditingRowId(null)
    setRowEditMfg('')
    setRowEditExpiry('')
  }

  const saveEditRow = async (productId: string | number) => {
    if (!rowEditExpiry) {
      setRowError('Expiry date is required')
      return
    }
    await saveDates(productId, { mfg: rowEditMfg, expiry: rowEditExpiry })
    cancelEditRow()
    await fetchProducts(true)
  }

  const deleteProduct = async (productId: string | number, name: string) => {
    if (!window.confirm(`Delete "${name}" from the catalog & inventory? This can't be undone.`)) return
    const key = String(productId)
    setRowError('')
    setDeletingIds(prev => new Set(prev).add(key))
    try {
      await inventoryService.deleteInventoryItem(Number(productId))
      await fetchProducts(true)
    } catch (err) {
      setRowError(getErrorMessage(err, 'Failed to delete product'))
    } finally {
      setDeletingIds(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  const tracked = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const msPerDay = 24 * 60 * 60 * 1000
    return products
      .filter(p => p.isActive !== false)
      .filter(p => (p.category || '').trim().toLowerCase() !== 'unregistered')
      .filter(p => Boolean(p.expiryDate))
      .map(p => {
        const expiry = new Date(`${p.expiryDate}T00:00:00`)
        const daysLeft = Math.round((expiry.getTime() - today.getTime()) / msPerDay)
        return { ...p, daysLeft }
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
  }, [products])

  const expired = tracked.filter(p => p.daysLeft < 0)
  const soon = tracked.filter(p => p.daysLeft >= 0 && p.daysLeft <= alertDays)

  const filtered = (statusFilter === 'expired' ? expired : statusFilter === 'soon' ? soon : tracked)
    .filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.category || '').toLowerCase().includes(search.toLowerCase())
    )
    .filter(p => {
      if (!fromDate && !toDate) return true
      // Compare calendar dates (YYYY-MM-DD) so the first and last day are both included
      const expiry = String(p.expiryDate || '').slice(0, 10)
      if (fromDate && expiry < fromDate) return false
      if (toDate && expiry > toDate) return false
      return true
    })

  const exportCSV = () => {
    const header = ['Product', 'Category', 'Stock', 'Price (INR)', 'Mfg Date', 'Expiry Date', 'Status']
    const rows = filtered.map(p => [
      p.name,
      p.category || 'General',
      String(p.stockQuantity ?? p.stock ?? 0),
      Number(p.price || 0).toFixed(2),
      csvDate(p.mfgDate),
      csvDate(p.expiryDate),
      p.daysLeft < 0 ? `Expired ${Math.abs(p.daysLeft)} day(s) ago` : `Expires in ${p.daysLeft} day(s)`,
    ])
    const csv = toCsv([header, ...rows])
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expiry-alerts_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cards = [
    ['Expired Items', expired.length, CalendarX2, 'text-red-700 bg-red-50'],
    ['Expiring Soon', soon.length, CalendarClock, 'text-amber-700 bg-amber-50'],
  ] as const

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-emerald-600">Batches that need attention</p>
          <h2 className="text-2xl font-black text-[#273126]">Expiry Alerts</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Flagging items within {alertDays} days of their expiry date.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setBulkOpen(o => !o)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold cursor-pointer ${
              bulkOpen ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[#ECE9E2] bg-white text-[#273126]'
            }`}
          >
            <CalendarPlus size={16} /> Set Mfg / Expiry Dates
            {untracked.length > 0 && !bulkOpen && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-black">
                {untracked.length}
              </span>
            )}
            {bulkOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button
            onClick={exportCSV}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 rounded-xl border border-[#ECE9E2] bg-white px-4 py-2.5 text-sm font-bold text-[#273126] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Download size={16} /> Export CSV
          </button>
          <button onClick={() => void fetchProducts(true)} className="rounded-xl border border-[#ECE9E2] bg-white p-3 text-[#647064] cursor-pointer" title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
      </div>

      {bulkOpen && (
        <div className="rounded-2xl border border-[var(--accent-a30)] bg-[#FBFAF6] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-black text-[#273126]">Set Manufacture &amp; Expiry Dates for Existing Products</h3>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {untracked.length === 0
                  ? 'Every active product already has both dates set.'
                  : `${untracked.length} product${untracked.length === 1 ? '' : 's'} still missing a date.`}
              </p>
            </div>
            {pendingCount > 0 && (
              <button
                onClick={() => void saveAllPending()}
                disabled={savingIds.size > 0}
                className="flex items-center gap-2 rounded-xl bg-[#0A0A0A] px-4 py-2 text-sm font-black text-white hover:bg-[var(--accent)] disabled:opacity-50 cursor-pointer"
              >
                <Save size={15} /> Save All ({pendingCount})
              </button>
            )}
          </div>

          {bulkError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{bulkError}</div>
          )}

          <label className="relative block mb-3">
            <Search className="absolute left-3 top-3 text-[#9CA3AF]" size={15} />
            <input
              className="w-full h-10 rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-3 text-xs font-semibold text-[#273126] outline-none focus:border-[var(--accent)]"
              value={bulkSearch}
              onChange={e => setBulkSearch(e.target.value)}
              placeholder="Search products without an expiry date"
            />
          </label>

          <div className="max-h-[360px] overflow-y-auto rounded-xl border border-[#ECE9E2] bg-white divide-y divide-[#F0EEE9]">
            {untracked.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#6B7280]">Nothing left to date.</p>
            ) : (
              untracked.map(p => {
                const key = String(p.id)
                const isSaving = savingIds.has(key)
                const mfgVal = pendingMfgDates[key] ?? (p.mfgDate || '')
                const expiryVal = pendingExpiryDates[key] ?? (p.expiryDate || '')
                const hasPending = Boolean(pendingMfgDates[key] || pendingExpiryDates[key])
                return (
                  <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#273126] break-words">{p.name}</p>
                      <p className="text-[10px] text-[#9CA3AF]">{p.category || 'General'}</p>
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#9CA3AF] mb-0.5">Mfg</label>
                      <input
                        type="date"
                        value={mfgVal}
                        disabled={Boolean(p.mfgDate)}
                        onChange={e => setPendingMfgDates(prev => ({ ...prev, [key]: e.target.value }))}
                        className="h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-bold text-[#273126] outline-none focus:border-[var(--accent)] disabled:bg-gray-100 disabled:text-gray-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-bold text-[#9CA3AF] mb-0.5">Expiry</label>
                      <input
                        type="date"
                        value={expiryVal}
                        disabled={Boolean(p.expiryDate)}
                        onChange={e => setPendingExpiryDates(prev => ({ ...prev, [key]: e.target.value }))}
                        className="h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-bold text-[#273126] outline-none focus:border-[var(--accent)] disabled:bg-gray-100 disabled:text-gray-400"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => hasPending && void saveOne(p.id, { mfg: pendingMfgDates[key], expiry: pendingExpiryDates[key] })}
                      disabled={!hasPending || isSaving}
                      className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-black text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer self-end"
                    >
                      {isSaving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />} Save
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map(([label, value, Icon, color]) => (
          <div key={label} className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wide text-[#879086]">{label}</p>
                <p className="mt-2 text-2xl font-black text-[#273126]">{value}</p>
              </div>
              <div className={`rounded-xl p-3 ${color}`}><Icon size={21} /></div>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm space-y-3">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17} />
            <input
              className="w-full h-11 rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-3 text-sm font-semibold text-[#273126] outline-none focus:border-[var(--accent)]"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search product or category"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {([
              ['expired', `Expired (${expired.length})`],
              ['soon', `Expiring Soon (${soon.length})`],
              ['all', `All Tracked (${tracked.length})`],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setStatusFilter(value)}
                className={`rounded-lg px-3 py-2 text-xs font-black ${statusFilter === value ? 'bg-[var(--accent-dark)] text-white' : 'bg-[#F5F3F7] text-[#626B61]'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-[#E5E7EB] pt-3">
          <p className="text-xs font-bold text-[#6B7280] mb-2">Filter by Expiry Date</p>
          <div className="flex flex-wrap gap-2 mb-3">
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
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${datePreset === value ? 'bg-emerald-100 text-emerald-700' : 'bg-[#F5F3F7] text-[#626B61] hover:bg-[#E5E3ED]'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[10px] font-bold text-[#6B7280] mb-1">From Date</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => { setFromDate(e.target.value); setDatePreset('custom') }}
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#273126] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#6B7280] mb-1">To Date</label>
              <input
                type="date"
                value={toDate}
                onChange={e => { setToDate(e.target.value); setDatePreset('custom') }}
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#273126] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
        </div>
      </div>

      {rowError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{rowError}</div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[#ECE9E2] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
              <tr>
                {['#', 'Product', 'Category', 'Stock', 'Price', 'Mfg Date', 'Expiry Date', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0EEE9]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#6B7280]">
                    {tracked.length === 0 ? (
                      <>
                        No products have an expiry date set yet.{' '}
                        <button type="button" onClick={() => setBulkOpen(true)} className="font-bold text-[var(--accent)] hover:underline cursor-pointer">
                          Set expiry dates now
                        </button>
                      </>
                    ) : 'No items match these filters.'}
                  </td>
                </tr>
              ) : (
                filtered.map((p, idx) => {
                  const isExpired = p.daysLeft < 0
                  const isSoon = !isExpired && p.daysLeft <= alertDays
                  const rowKey = String(p.id)
                  const isEditing = editingRowId === rowKey
                  const isSavingRow = savingIds.has(rowKey)
                  const isDeleting = deletingIds.has(rowKey)
                  return (
                    <tr key={p.id} className="hover:bg-emerald-50/30 transition-colors">
                      <td className="px-4 py-3.5 align-middle text-[#9CA3AF]">{idx + 1}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 align-middle font-bold text-[#273126]">{p.name}</td>
                      <td className="px-4 py-3.5 align-middle text-[#6B7280] whitespace-nowrap">{p.category || 'General'}</td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap">{p.stockQuantity ?? p.stock ?? 0}</td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap">{formatCurrency(p.price || 0)}</td>
                      {isEditing ? (
                        <>
                          <td className="px-4 py-2 align-middle whitespace-nowrap">
                            <input
                              type="date"
                              value={rowEditMfg}
                              onChange={e => setRowEditMfg(e.target.value)}
                              className="h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-bold text-[#273126] outline-none focus:border-[var(--accent)]"
                            />
                          </td>
                          <td className="px-4 py-2 align-middle whitespace-nowrap">
                            <input
                              type="date"
                              value={rowEditExpiry}
                              onChange={e => setRowEditExpiry(e.target.value)}
                              className="h-9 rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-bold text-[#273126] outline-none focus:border-[var(--accent)]"
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3.5 align-middle text-[#6B7280] whitespace-nowrap">
                            {p.mfgDate ? new Date(`${p.mfgDate}T00:00:00`).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="px-4 py-3.5 align-middle whitespace-nowrap">{new Date(`${p.expiryDate}T00:00:00`).toLocaleDateString('en-IN')}</td>
                        </>
                      )}
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                        <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-black ${
                          isExpired ? 'bg-red-100 text-red-700' : isSoon ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {isExpired ? `Expired ${Math.abs(p.daysLeft)}d ago` : `Expires in ${p.daysLeft}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 align-middle whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void saveEditRow(p.id)}
                              disabled={isSavingRow}
                              className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-black text-white disabled:opacity-50 cursor-pointer"
                              title="Save"
                            >
                              {isSavingRow ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditRow}
                              disabled={isSavingRow}
                              className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-black text-gray-500 hover:bg-gray-50 cursor-pointer"
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEditRow(p.id, p.mfgDate || '', p.expiryDate || '')}
                              className="flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 text-gray-500 hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[#EAF6EC] transition-all cursor-pointer"
                              title={`Edit "${p.name}"`}
                            >
                              <Pencil size={13} />
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => void deleteProduct(p.id, p.name)}
                                disabled={isDeleting}
                                className="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer disabled:opacity-50"
                                title={`Delete "${p.name}"`}
                              >
                                {isDeleting ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
