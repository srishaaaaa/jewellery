import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Plus, Search, Users } from 'lucide-react'
import { customerService, maskAadhaar, type CustomerRecord } from '../../services/customerService'
import { formatPhoneDisplay } from '../../lib/phone'
import { CustomerFormModal } from './CustomerFormModal'
import JewelleryCustomerProfile from './JewelleryCustomerProfile'

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const byName = (a: CustomerRecord, b: CustomerRecord) => a.name.localeCompare(b.name)

/** Every saved customer with their details; open one to see their full profile. */
export default function CustomersView() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<CustomerRecord | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    customerService.fetchAll().then(setCustomers).catch(() => undefined).finally(() => setLoading(false))
  }, [])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    const digits = q.replace(/\D/g, '')
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q)
      || (digits && c.phone.includes(digits))
      || (c.email || '').toLowerCase().includes(q)
      || c.address.toLowerCase().includes(q)
      || (c.pan || '').toLowerCase().includes(q))
  }, [customers, search])

  const upsert = (saved: CustomerRecord) => setCustomers((rows) => [...rows.filter((r) => r.id !== saved.id), saved].sort(byName))

  if (selected) {
    return (
      <JewelleryCustomerProfile
        customer={selected}
        onBack={() => setSelected(null)}
        onSaved={(saved) => { upsert(saved); setSelected(saved) }}
        onDeleted={(id) => { setCustomers((rows) => rows.filter((r) => r.id !== id)); setSelected(null) }}
      />
    )
  }

  return (
    <div className="space-y-4">
      {adding && (
        <CustomerFormModal customer={null} onClose={() => setAdding(false)}
          onSaved={(saved) => { upsert(saved); setAdding(false); setSelected(saved) }} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-3 bg-[var(--accent-a10)] text-[var(--accent-dark)]"><Users size={20} /></div>
          <div>
            <h2 className="text-xl font-black text-[#000000]">Customers</h2>
            <p className="text-xs font-semibold text-[#000000]">{loading ? 'Loading…' : `${customers.length} saved customer${customers.length === 1 ? '' : 's'}`}</p>
          </div>
        </div>
        <button type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white hover:opacity-90 cursor-pointer">
          <Plus size={16} /> Add Customer
        </button>
      </div>

      <label className="relative block">
        <Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17} />
        <input
          className="w-full h-11 rounded-xl border border-black/10 bg-white pl-10 pr-3 text-sm font-semibold text-[#000000] outline-none focus:border-[var(--accent)] shadow-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, mobile, email, address or PAN"
        />
      </label>

      {!loading && matches.length === 0 ? (
        <div className="rounded-xl border border-black/10 bg-white p-10 text-center text-sm font-semibold text-[#000000] shadow-sm">
          {customers.length === 0 ? 'No customers saved yet. They are added automatically when you bill them, or use Add Customer.' : 'No customers match your search.'}
        </div>
      ) : <>
        {/* Phones: one card per customer */}
        <div className="space-y-2 md:hidden">
          {matches.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelected(c)}
              className="w-full flex items-center gap-3 rounded-xl border border-black/10 bg-white p-3 text-left shadow-sm hover:bg-black/[0.02] cursor-pointer">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-[#000000] break-words">{c.name || 'Customer'}</p>
                <p className="text-xs font-semibold text-[#000000]">{formatPhoneDisplay(c.phone) || c.phone}</p>
                {c.address && <p className="text-xs text-[#000000] break-words">{c.address}</p>}
              </div>
              <ChevronRight size={18} className="shrink-0 text-[#9CA3AF]" />
            </button>
          ))}
        </div>

        {/* Larger screens: full table */}
        <div className="hidden md:block rounded-xl border border-black/10 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F9FAFB]">
              <tr>
                {['Name', 'Mobile', 'Email', 'Address', 'Birthday', 'Anniversary', 'PAN', 'Aadhaar', 'Offers'].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-bold text-[#000000] uppercase tracking-widest whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {matches.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c)} className="cursor-pointer hover:bg-[#FFF9E6] align-top">
                  <td className="px-4 py-2.5 font-black text-[#000000]">{c.name || 'Customer'}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#000000] whitespace-nowrap">{formatPhoneDisplay(c.phone) || c.phone}</td>
                  <td className="px-4 py-2.5 text-[#000000] break-all">{c.email || '—'}</td>
                  <td className="px-4 py-2.5 text-[#000000] min-w-[160px]">{c.address || '—'}</td>
                  <td className="px-4 py-2.5 text-[#000000] whitespace-nowrap">{fmtDate(c.birthday) || '—'}</td>
                  <td className="px-4 py-2.5 text-[#000000] whitespace-nowrap">{fmtDate(c.anniversary) || '—'}</td>
                  <td className="px-4 py-2.5 text-[#000000] whitespace-nowrap">{c.pan || '—'}</td>
                  <td className="px-4 py-2.5 text-[#000000] whitespace-nowrap">{maskAadhaar(c.aadhaar) || '—'}</td>
                  <td className="px-4 py-2.5 text-[#000000] whitespace-nowrap">{c.allowOffers === false ? 'No' : 'Yes'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  )
}
