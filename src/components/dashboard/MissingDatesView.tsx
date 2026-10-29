import { useEffect, useMemo, useState } from 'react'
import { CalendarPlus, Search } from 'lucide-react'
import { customerService, type CustomerRecord } from '../../services/customerService'
import { formatPhoneDisplay } from '../../lib/phone'
import { CustomerFormModal } from './CustomerFormModal'

type Filter = 'both' | 'birthday' | 'anniversary' | 'any'

const FILTERS: Array<[Filter, string]> = [
  ['any', 'Any date missing'],
  ['both', 'No birthday & no anniversary'],
  ['birthday', 'No birthday'],
  ['anniversary', 'No anniversary'],
]

const missing = (c: CustomerRecord, f: Filter) =>
  f === 'both' ? !c.birthday && !c.anniversary
    : f === 'birthday' ? !c.birthday
      : f === 'anniversary' ? !c.anniversary
        : !c.birthday || !c.anniversary

/** Customers without a birthday or anniversary saved, so staff can ask and fill them in. */
export default function MissingDatesView() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('any')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<CustomerRecord | null>(null)

  useEffect(() => {
    customerService.fetchAll().then(setCustomers).catch(() => undefined).finally(() => setLoading(false))
  }, [])

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([f]) => [f, customers.filter((c) => missing(c, f)).length])) as Record<Filter, number>, [customers])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return customers
      .filter((c) => missing(c, filter))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (digits && c.phone.includes(digits)))
  }, [customers, filter, search])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--accent)]"></div>
      </div>
    )
  }

  const tag = (text: string) => (
    <span className="inline-block rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 whitespace-nowrap">{text}</span>
  )

  return (
    <div className="space-y-4">
      {editing && (
        <CustomerFormModal customer={editing} onClose={() => setEditing(null)}
          onSaved={(saved) => { setCustomers((list) => list.map((c) => (c.id === saved.id ? saved : c))); setEditing(null) }} />
      )}

      <div>
        <h2 className="text-[28px] font-black text-[#000000] tracking-tight">No Dates Saved</h2>
        <p className="text-sm text-[#000000]">Customers without a birthday or anniversary. Add their dates so they get wishes and offers.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors cursor-pointer ${filter === f ? 'bg-[#0A0A0A] text-white' : 'bg-white border border-black/10 text-[#000000] hover:bg-black/[0.03]'}`}>
            {label} ({counts[f]})
          </button>
        ))}
      </div>

      <label className="relative block">
        <Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17} />
        <input
          className="w-full h-11 rounded-xl border border-black/10 bg-white pl-10 pr-3 text-sm font-semibold text-[#000000] outline-none focus:border-[var(--accent)] shadow-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or mobile"
        />
      </label>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-black/10 bg-white p-10 text-center text-sm font-semibold text-[#000000] shadow-sm">
          {customers.length === 0 ? 'No customers saved yet.' : 'Everyone here has their dates saved.'}
        </div>
      ) : (
        <div className="rounded-xl border border-black/10 bg-white shadow-sm divide-y divide-black/5">
          {rows.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-[#000000] break-words">{c.name || 'Customer'}</p>
                <p className="text-xs font-semibold text-[#000000]">{formatPhoneDisplay(c.phone) || c.phone}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {!c.birthday && tag('No birthday')}
                {!c.anniversary && tag('No anniversary')}
              </div>
              <button type="button" onClick={() => setEditing(c)}
                className="flex items-center gap-1.5 rounded-lg bg-[#0A0A0A] px-3 py-1.5 text-[11px] font-black text-white hover:bg-[#1A1A1A] cursor-pointer">
                <CalendarPlus size={14} /> Add dates
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
