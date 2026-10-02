import { useEffect, useMemo, useState } from 'react'
import {
  Cake, Gift, Heart, MessageCircle, Pencil, Plus, RefreshCw, Search, Trash2, X, Eye,
} from 'lucide-react'
import { customerService, type CustomerRecord } from '../services/customerService'
import { getErrorMessage } from '../lib/errorMessage'
import { toWhatsAppUrl, formatPhoneDisplay } from '../lib/phone'
import { BRAND_EN } from '../lib/brand'
import { DateInputDDMMYYYY } from '../components/DateInputDDMMYYYY'
import { ModalPortal } from '../components/ModalPortal'

type FilterKey = 'all' | 'birthday' | 'anniversary' | 'today'
type DatePreset = 'thisMonth' | 'thisYear' | 'all' | 'custom'

function isTodayMonthDay(dateStr: string | null): boolean {
  if (!dateStr) return false
  const today = new Date()
  const d = new Date(`${dateStr}T00:00:00`)
  return d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
}

function isInMonthDay(dateStr: string | null, fromMonth: number | null, fromDay: number | null, toMonth: number | null, toDay: number | null): boolean {
  if (!dateStr) return false
  if (fromMonth === null || toMonth === null) return true
  const d = new Date(`${dateStr}T00:00:00`)
  const month = d.getMonth()
  const day = d.getDate()

  if (fromMonth <= toMonth) {
    if (month < fromMonth || month > toMonth) return false
    if (month === fromMonth && fromDay !== null && day < fromDay) return false
    if (month === toMonth && toDay !== null && day > toDay) return false
  } else {
    if (month < fromMonth && month > toMonth) return false
    if (month === fromMonth && fromDay !== null && day < fromDay) return false
    if (month === toMonth && toDay !== null && day > toDay) return false
  }
  return true
}

function isThisMonth(dateStr: string | null): boolean {
  if (!dateStr) return false
  const today = new Date()
  const d = new Date(`${dateStr}T00:00:00`)
  return d.getMonth() === today.getMonth()
}

function formatMonthDay(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

const emptyForm = { name: '', phone: '', address: '', birthday: '', anniversary: '' }

export default function CustomerEvents() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const [fromMonth, setFromMonth] = useState<number | null>(null)
  const [fromDay, setFromDay] = useState<number | null>(null)
  const [toMonth, setToMonth] = useState<number | null>(null)
  const [toDay, setToDay] = useState<number | null>(null)

  const [modalMode, setModalMode] = useState<'add' | 'edit' | 'view' | null>(null)
  const [activeCustomer, setActiveCustomer] = useState<CustomerRecord | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [listError, setListError] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await customerService.fetchAll()
      setCustomers(data)
    } catch (err) {
      setListError(getErrorMessage(err, 'Failed to load customers'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const applyDatePreset = (preset: DatePreset) => {
    const today = new Date()
    switch (preset) {
      case 'thisMonth':
        const month = today.getMonth()
        setFromMonth(month)
        setFromDay(1)
        setToMonth(month)
        setToDay(31)
        break
      case 'thisYear':
        setFromMonth(0)
        setFromDay(1)
        setToMonth(11)
        setToDay(31)
        break
      default:
        setFromMonth(null)
        setFromDay(null)
        setToMonth(null)
        setToDay(null)
    }
    setDatePreset(preset)
  }

  const tracked = useMemo(() => customers.filter(c => c.birthday || c.anniversary), [customers])

  const stats = useMemo(() => {
    const birthdaysThisMonth = tracked.filter(c => isThisMonth(c.birthday)).length
    const anniversariesThisMonth = tracked.filter(c => isThisMonth(c.anniversary)).length
    const today = tracked.filter(c => isTodayMonthDay(c.birthday) || isTodayMonthDay(c.anniversary)).length
    return { total: tracked.length, birthdaysThisMonth, anniversariesThisMonth, today }
  }, [tracked])

  const filtered = useMemo(() => {
    return tracked
      .filter(c => {
        if (filter === 'birthday') return Boolean(c.birthday)
        if (filter === 'anniversary') return Boolean(c.anniversary)
        if (filter === 'today') return isTodayMonthDay(c.birthday) || isTodayMonthDay(c.anniversary)
        return true
      })
      .filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.toLowerCase().includes(search.toLowerCase())
      )
      .filter(c => {
        const birthMatches = !c.birthday || isInMonthDay(c.birthday, fromMonth, fromDay, toMonth, toDay)
        const annivMatches = !c.anniversary || isInMonthDay(c.anniversary, fromMonth, fromDay, toMonth, toDay)
        return birthMatches && annivMatches
      })
  }, [tracked, filter, search, fromMonth, fromDay, toMonth, toDay])

  const openAdd = () => {
    setActiveCustomer(null)
    setForm(emptyForm)
    setFormError('')
    setModalMode('add')
  }

  const openEdit = (c: CustomerRecord) => {
    setActiveCustomer(c)
    setForm({ name: c.name, phone: c.phone, address: c.address || '', birthday: c.birthday || '', anniversary: c.anniversary || '' })
    setFormError('')
    setModalMode('edit')
  }

  const openView = (c: CustomerRecord) => {
    setActiveCustomer(c)
    setModalMode('view')
  }

  const closeModal = () => {
    setModalMode(null)
    setActiveCustomer(null)
    setForm(emptyForm)
    setFormError('')
  }

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    const name = form.name.trim()
    const phone = form.phone.trim()
    if (!name) { setFormError('Name is required'); return }
    if (!phone) { setFormError('Phone number is required'); return }
    if (!form.birthday && !form.anniversary) { setFormError('Add at least a birthday or an anniversary date'); return }

    setSaving(true)
    try {
      const payload = {
        name,
        phone,
        address: form.address,
        birthday: form.birthday || null,
        anniversary: form.anniversary || null,
      }
      if (modalMode === 'edit' && activeCustomer) {
        await customerService.update(activeCustomer.id, payload)
      } else {
        await customerService.create(payload)
      }
      closeModal()
      await load()
    } catch (err) {
      setFormError(getErrorMessage(err, 'Failed to save customer'))
    } finally {
      setSaving(false)
    }
  }

  const deleteCustomer = async (c: CustomerRecord) => {
    if (!window.confirm(`Remove "${c.name || c.phone}" from customer records? This can't be undone.`)) return
    setListError('')
    setDeletingId(c.id)
    try {
      await customerService.remove(c.id)
      await load()
    } catch (err) {
      setListError(getErrorMessage(err, 'Failed to delete customer'))
    } finally {
      setDeletingId(null)
    }
  }

  const sendWishes = (c: CustomerRecord, occasion: 'birthday' | 'anniversary') => {
    const line = occasion === 'birthday' ? 'Happy Birthday' : 'Happy Anniversary'
    const message = `${line}, ${c.name}! 🎉 Wishing you a wonderful day from all of us at ${BRAND_EN}. Thank you for being our valued customer!`
    window.open(toWhatsAppUrl(c.phone, message), '_blank', 'noopener,noreferrer')
    // Also counts as dismissing today's login popup for this occasion.
    customerService.acknowledgeEvent(c.id, occasion).catch((err) => console.error('Failed to acknowledge customer event', err))
  }

  const cards = [
    ['Tracked Customers', stats.total, Gift, 'text-violet-700 bg-violet-50'],
    ['Birthdays This Month', stats.birthdaysThisMonth, Cake, 'text-pink-700 bg-pink-50'],
    ['Anniversaries This Month', stats.anniversariesThisMonth, Heart, 'text-rose-700 bg-rose-50'],
    ["Today's Celebrations", stats.today, Gift, 'text-emerald-700 bg-emerald-50'],
  ] as const

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[.18em] text-pink-600">Customer relationships</p>
          <h2 className="text-2xl font-black text-[#273126]">Birthdays &amp; Anniversaries</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Keep track of customer birthdays and anniversaries, and send them a wish when the day comes.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openAdd}
            className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-black text-white hover:opacity-90 cursor-pointer"
          >
            <Plus size={16} /> Add Customer
          </button>
          <button onClick={() => void load()} className="rounded-xl border border-[#ECE9E2] bg-white p-3 text-[#647064] cursor-pointer" title="Refresh">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {listError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{listError}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              placeholder="Search by name or phone"
            />
          </label>
        </div>

        <div className="border-t border-[#E5E7EB] pt-3">
          <p className="text-xs font-bold text-[#6B7280] mb-2">Filter by Date</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {([
              ['thisMonth', 'This Month'],
              ['thisYear', 'This Year'],
              ['all', 'All Months'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => applyDatePreset(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${datePreset === value ? 'bg-pink-100 text-pink-700' : 'bg-[#F5F3F7] text-[#626B61] hover:bg-[#E5E3ED]'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-[10px] font-bold text-[#6B7280] mb-1">From Month</label>
              <select
                value={fromMonth ?? ''}
                onChange={e => { setFromMonth(e.target.value === '' ? null : parseInt(e.target.value)); setDatePreset('custom') }}
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#273126] outline-none focus:border-[var(--accent)]"
              >
                <option value="">All Months</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {new Date(2024, i, 1).toLocaleDateString('en-IN', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#6B7280] mb-1">To Month</label>
              <select
                value={toMonth ?? ''}
                onChange={e => { setToMonth(e.target.value === '' ? null : parseInt(e.target.value)); setDatePreset('custom') }}
                className="w-full h-9 rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#273126] outline-none focus:border-[var(--accent)]"
              >
                <option value="">All Months</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {new Date(2024, i, 1).toLocaleDateString('en-IN', { month: 'long' })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Birthdays Section */}
      <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-4 sm:px-5 sm:py-5 border-b border-[#E5E7EB] bg-[#FBFAF6] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-pink-100 text-pink-600 flex items-center justify-center font-black">
            <Cake size={18} />
          </div>
          <div>
            <h3 className="font-black text-sm text-[#273126]">Birthdays</h3>
            <p className="text-[11px] font-semibold text-[#6B7280] mt-0.5">Upcoming customer birthdays</p>
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-[#6B7280]"><RefreshCw size={18} className="animate-spin inline" /></div>
        ) : filtered.filter(c => c.birthday).length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-[#6B7280]">
            {tracked.filter(c => c.birthday).length === 0 ? 'No birthdays saved yet.' : 'No birthdays match these filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-[#F8F7F4] border-t border-[#E5E7EB] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">#</th>
                  <th className="px-4 py-3 whitespace-nowrap">Name</th>
                  <th className="px-4 py-3 whitespace-nowrap">Phone</th>
                  <th className="px-4 py-3 whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9]">
                {filtered.filter(c => c.birthday).map((c, idx) => {
                  const isBirthdayToday = isTodayMonthDay(c.birthday)
                  return (
                    <tr key={c.id} className={`transition-colors ${isBirthdayToday ? 'bg-pink-50/60 hover:bg-pink-50' : 'hover:bg-emerald-50/30'}`}>
                      <td className="px-4 py-3.5 text-[#9CA3AF]">{idx + 1}</td>
                      <td className="px-4 py-3.5 font-bold text-[#273126]">{c.name || '—'}</td>
                      <td className="px-4 py-3.5 text-[#6B7280]">{formatPhoneDisplay(c.phone)}</td>
                      <td className="px-4 py-3.5">
                        <span className={isBirthdayToday ? 'inline-flex items-center gap-1 rounded-full bg-pink-100 px-2.5 py-1 text-[10px] font-black text-pink-700' : 'text-[#6B7280]'}>
                          {isBirthdayToday && <Cake size={11} />} {formatMonthDay(c.birthday)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {isBirthdayToday && (
                            <button
                              type="button"
                              onClick={() => sendWishes(c, 'birthday')}
                              className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1.5 text-[10px] font-black text-white cursor-pointer"
                            >
                              <MessageCircle size={11} /> Send
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openView(c)}
                            className="flex items-center justify-center w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[#EAF6EC] transition-all cursor-pointer"
                            title={`View "${c.name}"`}
                          >
                            <Eye size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="flex items-center justify-center w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[#EAF6EC] transition-all cursor-pointer"
                            title={`Edit "${c.name}"`}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteCustomer(c)}
                            disabled={deletingId === c.id}
                            className="flex items-center justify-center w-6 h-6 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer disabled:opacity-50"
                            title={`Delete "${c.name}"`}
                          >
                            {deletingId === c.id ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Anniversaries Section */}
      <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-4 sm:px-5 sm:py-5 border-b border-[#E5E7EB] bg-[#FBFAF6] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center font-black">
            <Heart size={18} />
          </div>
          <div>
            <h3 className="font-black text-sm text-[#273126]">Anniversaries</h3>
            <p className="text-[11px] font-semibold text-[#6B7280] mt-0.5">Upcoming customer anniversaries</p>
          </div>
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-[#6B7280]"><RefreshCw size={18} className="animate-spin inline" /></div>
        ) : filtered.filter(c => c.anniversary).length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-[#6B7280]">
            {tracked.filter(c => c.anniversary).length === 0 ? 'No anniversaries saved yet.' : 'No anniversaries match these filters.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-[#F8F7F4] border-t border-[#E5E7EB] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">#</th>
                  <th className="px-4 py-3 whitespace-nowrap">Name</th>
                  <th className="px-4 py-3 whitespace-nowrap">Phone</th>
                  <th className="px-4 py-3 whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0EEE9]">
                {filtered.filter(c => c.anniversary).map((c, idx) => {
                  const isAnniversaryToday = isTodayMonthDay(c.anniversary)
                  return (
                    <tr key={c.id} className={`transition-colors ${isAnniversaryToday ? 'bg-rose-50/60 hover:bg-rose-50' : 'hover:bg-emerald-50/30'}`}>
                      <td className="px-4 py-3.5 text-[#9CA3AF]">{idx + 1}</td>
                      <td className="px-4 py-3.5 font-bold text-[#273126]">{c.name || '—'}</td>
                      <td className="px-4 py-3.5 text-[#6B7280]">{formatPhoneDisplay(c.phone)}</td>
                      <td className="px-4 py-3.5">
                        <span className={isAnniversaryToday ? 'inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black text-rose-700' : 'text-[#6B7280]'}>
                          {isAnniversaryToday && <Heart size={11} />} {formatMonthDay(c.anniversary)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          {isAnniversaryToday && (
                            <button
                              type="button"
                              onClick={() => sendWishes(c, 'anniversary')}
                              className="flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1.5 text-[10px] font-black text-white cursor-pointer"
                            >
                              <MessageCircle size={11} /> Send
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openView(c)}
                            className="flex items-center justify-center w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[#EAF6EC] transition-all cursor-pointer"
                            title={`View "${c.name}"`}
                          >
                            <Eye size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(c)}
                            className="flex items-center justify-center w-6 h-6 rounded-lg border border-gray-200 text-gray-500 hover:text-[var(--accent)] hover:border-[var(--accent)] hover:bg-[#EAF6EC] transition-all cursor-pointer"
                            title={`Edit "${c.name}"`}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteCustomer(c)}
                            disabled={deletingId === c.id}
                            className="flex items-center justify-center w-6 h-6 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all cursor-pointer disabled:opacity-50"
                            title={`Delete "${c.name}"`}
                          >
                            {deletingId === c.id ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      {(modalMode === 'add' || modalMode === 'edit') && (
        <ModalPortal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-y-auto border border-pink-200 animate-in fade-in zoom-in-95">
            <div className="px-4 sm:px-5 py-3 border-b border-gray-200 flex items-center justify-between bg-[#FBFAF6] shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-600">
                  <Gift className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-sm text-[#111111]">
                  {modalMode === 'edit' ? 'Edit Customer' : 'Add Customer'}
                </h3>
              </div>
              <button type="button" onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors cursor-pointer" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={submitForm} className="p-4 sm:p-5 space-y-3.5 overflow-y-auto flex-1 text-xs">
              {formError && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">{formError}</div>
              )}

              <div>
                <label className="block font-bold text-[#374151] mb-1">Name *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Priya Sharma"
                  className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-semibold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white"
                />
              </div>

              <div>
                <label className="block font-bold text-[#374151] mb-1">Phone Number *</label>
                <input
                  type="tel"
                  required
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-bold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <DateInputDDMMYYYY
                    label="Birthday"
                    value={form.birthday}
                    onChange={v => setForm(f => ({ ...f, birthday: v }))}
                    placeholder="DD/MM/YYYY"
                    className="px-3 py-2 bg-[#FBFAF6] text-xs"
                  />
                </div>
                <div>
                  <DateInputDDMMYYYY
                    label="Anniversary"
                    value={form.anniversary}
                    onChange={v => setForm(f => ({ ...f, anniversary: v }))}
                    placeholder="DD/MM/YYYY"
                    className="px-3 py-2 bg-[#FBFAF6] text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-[#374151] mb-1">Address (Optional)</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="e.g. 12 Main Street"
                  className="w-full px-3 py-2 bg-[#FBFAF6] border border-gray-200 rounded-xl text-xs font-semibold text-[#111111] focus:outline-none focus:border-[#0A0A0A] focus:bg-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button type="button" onClick={closeModal} className="h-8 px-3 text-[11px] font-bold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 cursor-pointer">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-8 px-3.5 text-[11px] font-bold rounded-lg bg-[#0A0A0A] text-pink-400 border border-pink-400 hover:bg-[#1A1A1A] transition-all shadow-xs disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <span className="w-3 h-3 border-2 border-pink-400/30 border-t-pink-400 rounded-full animate-spin inline-block" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      {modalMode === 'edit' ? 'Save Changes' : 'Add Customer'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div></ModalPortal>
      )}

      {/* View Modal */}
      {modalMode === 'view' && activeCustomer && (
        <ModalPortal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-y-auto border border-pink-200 animate-in fade-in zoom-in-95">
            <div className="px-4 sm:px-5 py-3 border-b border-gray-200 flex items-center justify-between bg-[#FBFAF6]">
              <h3 className="font-bold text-sm text-[#111111] flex items-center gap-2">
                <Eye className="w-4 h-4 text-pink-600" /> Customer Details
              </h3>
              <button type="button" onClick={closeModal} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 cursor-pointer" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Name</p>
                <p className="text-sm font-bold text-[#111111]">{activeCustomer.name || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Phone</p>
                <p className="text-sm font-bold text-[#111111]">{formatPhoneDisplay(activeCustomer.phone) || activeCustomer.phone}</p>
              </div>
              {activeCustomer.address && (
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Address</p>
                  <p className="text-sm font-semibold text-[#111111] break-words">{activeCustomer.address}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Birthday</p>
                  <p className="text-sm font-bold text-[#111111]">{formatMonthDay(activeCustomer.birthday)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Anniversary</p>
                  <p className="text-sm font-bold text-[#111111]">{formatMonthDay(activeCustomer.anniversary)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => sendWishes(activeCustomer, activeCustomer.birthday ? 'birthday' : 'anniversary')}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-[11px] font-black text-white cursor-pointer"
                >
                  <MessageCircle size={13} /> Send Wishes
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(activeCustomer)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-[11px] font-black text-gray-700 hover:bg-gray-100 cursor-pointer"
                >
                  <Pencil size={13} /> Edit
                </button>
              </div>
            </div>
          </div>
        </div></ModalPortal>
      )}
    </div>
  )
}
