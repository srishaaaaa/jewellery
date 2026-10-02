import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Gem, PiggyBank, Receipt, Search, ShoppingBag, Trash2, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { customerService, type CustomerRecord } from '../../services/customerService'
import { auditService } from '../../services/auditService'
import { useAdminAuthStore } from '../../store/store'
import { schemeService } from '../../services/schemeService'
import { advanceService, oldGoldService, repairService, returnService, REPAIR_STATUS_LABELS, type CustomerAdvance, type OldGoldRecord, type Repair, type SalesReturn } from '../../services/salesDeskService'
import { formatPhoneDisplay } from '../../lib/phone'
import { formatCurrency, formatInvoiceNo, normalizeStructuredOrderItem, toNumber } from '../../lib/retail'
import {
  SCHEME_STATUS_LABELS,
  deriveSchemeStatus,
  formatWeight,
  installmentsDueCount,
  metalLabel,
  schemeBalance,
  schemeRemaining,
  type JewelleryScheme,
} from '../../lib/jewellery'

type ProfileOrder = {
  id: string
  invoiceNo: string
  createdAt: string
  total: number
  items: ReturnType<typeof normalizeStructuredOrderItem>[]
}

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Customer lookup with jewellery purchases, schemes and preferences. */
export default function JewelleryCustomerProfile() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<CustomerRecord | null>(null)
  const [orders, setOrders] = useState<ProfileOrder[]>([])
  const [schemes, setSchemes] = useState<JewelleryScheme[]>([])
  const [advances, setAdvances] = useState<CustomerAdvance[]>([])
  const [oldGold, setOldGold] = useState<OldGoldRecord[]>([])
  const [returns, setReturns] = useState<SalesReturn[]>([])
  const [repairs, setRepairs] = useState<Repair[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isAdmin = useAdminAuthStore((state) => state.role) === 'admin'

  // Removes the customer record only: their invoices, schemes and advances stay (they keep the name and phone).
  const deleteCustomer = async (c: CustomerRecord) => {
    if (!isAdmin) return
    if (!window.confirm(`Delete customer ${c.name || c.phone}? Their bills, schemes and advances are kept. This cannot be undone.`)) return
    try {
      await customerService.remove(c.id)
      void auditService.log({ action: 'customer_deleted', entityType: 'customer', entityId: c.phone, oldValue: { name: c.name, phone: c.phone, address: c.address } })
      setCustomers((rows) => rows.filter((row) => row.id !== c.id))
      setSelected(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete the customer')
    }
  }

  useEffect(() => { customerService.fetchAll().then(setCustomers).catch(() => undefined) }, [])

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers.slice(0, 30)
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q.replace(/\D/g, '') || q)).slice(0, 30)
  }, [customers, search])

  const openProfile = async (customer: CustomerRecord) => {
    setSelected(customer)
    setLoading(true)
    setError('')
    try {
      const [orderRes, schemeList] = await Promise.all([
        supabase.from('orders')
          .select('id, invoice_no, created_at, total, items, status')
          .eq('phone', customer.phone)
          .neq('order_type', 'online_request')
          .order('created_at', { ascending: false })
          .limit(200),
        schemeService.listByPhone(customer.phone),
      ])
      if (orderRes.error) throw orderRes.error
      setOrders((orderRes.data || []).filter((o) => o.status !== 'cancelled').map((o) => ({
        id: String(o.id),
        invoiceNo: String(o.invoice_no || ''),
        createdAt: String(o.created_at || ''),
        total: toNumber(o.total, 0),
        items: (Array.isArray(o.items) ? o.items : []).map((item: Record<string, unknown>) => normalizeStructuredOrderItem(item)),
      })))
      setSchemes(schemeList)
      // Sales Desk records (empty before the database update)
      const [adv, og, rep, ret] = await Promise.all([
        advanceService.listByPhone(customer.phone),
        oldGoldService.listByPhone(customer.phone),
        repairService.listByPhone(customer.phone),
        returnService.list().then((all) => all.filter((r) => r.phone === customer.phone)).catch(() => [] as SalesReturn[]),
      ])
      setAdvances(adv)
      setOldGold(og)
      setRepairs(rep)
      setReturns(ret)
    } catch (err) {
      setError((err as { message?: string })?.message || 'Unable to load the customer profile')
    } finally {
      setLoading(false)
    }
  }

  const profile = useMemo(() => {
    const jewelleryOrders = orders.filter((o) => o.items.some((i) => i.jewellery))
    const metalCounts = new Map<string, number>()
    const categoryCounts = new Map<string, number>()
    for (const o of jewelleryOrders) {
      for (const i of o.items) {
        if (!i.jewellery) continue
        const key = metalLabel(i.jewellery.metal_type, i.jewellery.purity)
        metalCounts.set(key, (metalCounts.get(key) || 0) + 1)
        if (i.category) categoryCounts.set(i.category, (categoryCounts.get(i.category) || 0) + 1)
      }
    }
    const top = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k)
    const open = schemes.filter((s) => s.status !== 'cancelled')
    return {
      jewelleryOrders,
      spent: jewelleryOrders.reduce((sum, o) => sum + o.total, 0),
      activeSchemes: open.filter((s) => ['active', 'payment_due'].includes(deriveSchemeStatus(s))).length,
      completedSchemes: open.filter((s) => ['completed', 'matured', 'redeemed'].includes(deriveSchemeStatus(s))).length,
      deposits: open.reduce((sum, s) => sum + s.totalPaid, 0),
      pendingInstallments: open.reduce((sum, s) => sum + (s.status === 'active' ? s.totalInstallments - s.installmentsPaid : 0), 0),
      overdueInstallments: open.reduce((sum, s) => sum + installmentsDueCount(s), 0),
      lastPurchase: orders[0]?.createdAt || null,
      preferences: [...top(metalCounts), ...top(categoryCounts)],
    }
  }, [orders, schemes])

  const cards = [
    ['Jewellery Purchases', `${profile.jewelleryOrders.length} • ${formatCurrency(profile.spent)}`, ShoppingBag, 'text-emerald-700 bg-emerald-50'],
    ['Active Schemes', profile.activeSchemes, PiggyBank, 'text-fuchsia-700 bg-fuchsia-50'],
    ['Completed Schemes', profile.completedSchemes, Gem, 'text-blue-700 bg-blue-50'],
    ['Total Scheme Deposits', formatCurrency(profile.deposits), Wallet, 'text-amber-700 bg-amber-50'],
    ['Pending Installments', `${profile.pendingInstallments}${profile.overdueInstallments ? ` (${profile.overdueInstallments} due)` : ''}`, Receipt, 'text-red-700 bg-red-50'],
    ['Last Purchase', fmtDate(profile.lastPurchase), CalendarDays, 'text-slate-700 bg-slate-100'],
    ['Advance Balance', formatCurrency(advances.filter((a) => a.status === 'active').reduce((sum, a) => sum + a.balance, 0)), Wallet, 'text-emerald-700 bg-emerald-50'],
    ['Repairs In Progress', repairs.filter((r) => r.status !== 'delivered' && r.status !== 'cancelled').length, Receipt, 'text-amber-700 bg-amber-50'],
  ] as const

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm space-y-3 h-fit">
        <label className="relative block">
          <Search className="absolute left-3 top-3 text-[#9CA3AF]" size={17} />
          <input
            className="w-full h-11 rounded-xl border border-[#E5E7EB] bg-white pl-10 pr-3 text-sm font-semibold text-[#273126] outline-none focus:border-[var(--accent)]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name or phone"
          />
        </label>
        <div className="max-h-[420px] overflow-y-auto divide-y divide-[#F0EEE9]">
          {matches.length === 0 ? (
            <p className="py-6 text-center text-xs font-bold text-[#6B7280]">No customers found.</p>
          ) : matches.map((c) => (
            <button key={c.id} type="button" onClick={() => void openProfile(c)}
              className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer ${selected?.id === c.id ? 'bg-[#FFF9E6]' : 'hover:bg-[#FBFAF6]'}`}>
              <p className="text-sm font-black text-[#273126] break-words">{c.name || 'Customer'}</p>
              <p className="text-xs text-[#6B7280]">{formatPhoneDisplay(c.phone) || c.phone}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 min-w-0">
        {!selected ? (
          <div className="rounded-2xl border border-[#ECE9E2] bg-white p-10 text-center text-sm font-semibold text-[#6B7280] shadow-sm">
            Select a customer to see their jewellery purchases and savings schemes.
          </div>
        ) : <>
          <div className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[.18em] text-emerald-600">Jewellery customer</p>
              {isAdmin && (
                <button type="button" onClick={() => void deleteCustomer(selected)} title="Delete customer"
                  className="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-black text-red-600 hover:bg-red-100 cursor-pointer">
                  <Trash2 size={13} /> Delete
                </button>
              )}
            </div>
            <h3 className="text-xl font-black text-[#273126] break-words">{selected.name || 'Customer'}</h3>
            <p className="text-sm text-[#6B7280]">{formatPhoneDisplay(selected.phone) || selected.phone}{selected.address ? ` • ${selected.address}` : ''}</p>
            {profile.preferences.length > 0 && (
              <p className="mt-2 text-xs font-bold text-[var(--accent-dark)]">Prefers: {profile.preferences.join(' • ')}</p>
            )}
          </div>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
          {loading ? (
            <div className="rounded-2xl border border-[#ECE9E2] bg-white p-10 text-center text-sm text-[#6B7280] shadow-sm">Loading profile…</div>
          ) : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map(([label, value, Icon, color]) => (
                <div key={label} className="rounded-2xl border border-[#ECE9E2] bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-wide text-[#879086]">{label}</p>
                      <p className="mt-2 text-[17px] font-black text-[#273126] break-words">{value}</p>
                    </div>
                    <div className={`rounded-xl p-3 shrink-0 ${color}`}><Icon size={20} /></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm">
              <h4 className="px-4 pt-4 text-sm font-black text-[#273126]">Savings Schemes</h4>
              <div className="overflow-x-auto p-4 pt-3">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
                    <tr>{['Scheme', 'Status', 'Paid', 'Remaining', 'Balance Available', 'Next Due'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EEE9]">
                    {schemes.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-[#6B7280]">No savings schemes.</td></tr>
                    ) : schemes.map((s) => (
                      <tr key={s.id}>
                        <td className="px-3 py-2.5"><p className="font-black text-emerald-700">{s.schemeNumber}</p><p className="text-[#858C83]">{s.schemeName}</p></td>
                        <td className="px-3 py-2.5 font-bold">{SCHEME_STATUS_LABELS[deriveSchemeStatus(s)]}</td>
                        <td className="px-3 py-2.5">{s.installmentsPaid}/{s.totalInstallments} • {formatCurrency(s.totalPaid)}</td>
                        <td className="px-3 py-2.5">{formatCurrency(schemeRemaining(s))}</td>
                        <td className="px-3 py-2.5 font-black">{formatCurrency(schemeBalance(s))}</td>
                        <td className="px-3 py-2.5">{fmtDate(s.nextDueDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm">
              <h4 className="px-4 pt-4 text-sm font-black text-[#273126]">Jewellery Purchases</h4>
              <div className="overflow-x-auto p-4 pt-3">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
                    <tr>{['Date', 'Invoice', 'Items', 'Total'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EEE9]">
                    {profile.jewelleryOrders.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-[#6B7280]">No jewellery purchases yet.</td></tr>
                    ) : profile.jewelleryOrders.map((o) => (
                      <tr key={o.id} className="align-top">
                        <td className="px-3 py-2.5">{fmtDate(o.createdAt)}</td>
                        <td className="px-3 py-2.5 font-bold text-emerald-700">{formatInvoiceNo(o.invoiceNo)}</td>
                        <td className="px-3 py-2.5 whitespace-normal min-w-[220px]">
                          {o.items.map((i, idx) => (
                            <p key={idx} className="text-[#273126]">
                              <span className="font-bold">{i.name}</span>
                              {i.jewellery ? <span className="text-[#6B7280]"> • {metalLabel(i.jewellery.metal_type, i.jewellery.purity)} • {formatWeight(i.jewellery.net_weight)}</span> : null}
                            </p>
                          ))}
                        </td>
                        <td className="px-3 py-2.5 font-black">{formatCurrency(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm">
              <h4 className="px-4 pt-4 text-sm font-black text-[#273126]">Advances</h4>
              <div className="overflow-x-auto p-4 pt-3">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
                    <tr>{['Receipt', 'Date', 'Purpose', 'Amount', 'Balance', 'Status'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EEE9]">
                    {advances.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-[#6B7280]">No advances.</td></tr>
                    ) : advances.map((a) => (
                      <tr key={a.id}>
                        <td className="px-3 py-2.5 font-bold text-[var(--accent-dark)]">{a.receiptNumber}</td>
                        <td className="px-3 py-2.5">{fmtDate(a.createdAt)}</td>
                        <td className="px-3 py-2.5">{a.purpose || (a.source === 'exchange' ? 'Exchange credit' : '—')}</td>
                        <td className="px-3 py-2.5">{formatCurrency(a.amount)}</td>
                        <td className="px-3 py-2.5 font-black">{formatCurrency(a.balance)}</td>
                        <td className="px-3 py-2.5">{a.status === 'active' ? 'Available' : a.status === 'used' ? 'Used' : 'Cancelled'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm">
              <h4 className="px-4 pt-4 text-sm font-black text-[#273126]">Exchanges & Returns</h4>
              <div className="overflow-x-auto p-4 pt-3">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
                    <tr>{['No', 'Date', 'Invoice', 'Details', 'Value'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EEE9]">
                    {oldGold.length + returns.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-[#6B7280]">No exchanges or returns.</td></tr>
                    ) : <>
                      {oldGold.map((g) => (
                        <tr key={g.id}>
                          <td className="px-3 py-2.5 font-bold text-[var(--accent-dark)]">{g.exchangeNumber}</td>
                          <td className="px-3 py-2.5">{fmtDate(g.createdAt)}</td>
                          <td className="px-3 py-2.5">{g.invoiceNo ? formatInvoiceNo(g.invoiceNo) : '—'}</td>
                          <td className="px-3 py-2.5">Old {g.metalType} {g.purity} • Net {formatWeight(g.netWeight)}</td>
                          <td className="px-3 py-2.5 font-black">{formatCurrency(g.netValue)}</td>
                        </tr>
                      ))}
                      {returns.map((r) => (
                        <tr key={r.id}>
                          <td className="px-3 py-2.5 font-bold text-[var(--accent-dark)]">{r.returnNumber}</td>
                          <td className="px-3 py-2.5">{fmtDate(r.createdAt)}</td>
                          <td className="px-3 py-2.5">{formatInvoiceNo(r.invoiceNo)}</td>
                          <td className="px-3 py-2.5">{r.returnType === 'exchange' ? 'Exchange' : 'Return'} • {r.items.map((l) => `${l.name} × ${l.quantity}`).join(', ')} • {r.status}</td>
                          <td className="px-3 py-2.5 font-black">{formatCurrency(r.refundAmount)}</td>
                        </tr>
                      ))}
                    </>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-[#ECE9E2] bg-white shadow-sm">
              <h4 className="px-4 pt-4 text-sm font-black text-[#273126]">Repairs</h4>
              <div className="overflow-x-auto p-4 pt-3">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead className="bg-[#F8F7F4] text-[10px] font-black uppercase tracking-wider text-[#737B72]">
                    <tr>{['Repair', 'Received', 'Item', 'Expected', 'Balance', 'Status'].map((h) => <th key={h} className="px-3 py-2.5">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0EEE9]">
                    {repairs.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-[#6B7280]">No repairs.</td></tr>
                    ) : repairs.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2.5 font-bold text-[var(--accent-dark)]">{r.repairNumber}</td>
                        <td className="px-3 py-2.5">{fmtDate(r.receivedDate)}</td>
                        <td className="px-3 py-2.5">{r.itemName}</td>
                        <td className="px-3 py-2.5">{fmtDate(r.expectedDate)}</td>
                        <td className="px-3 py-2.5 font-black">{formatCurrency(r.balance)}</td>
                        <td className="px-3 py-2.5">{REPAIR_STATUS_LABELS[r.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>}
        </>}
      </div>
    </div>
  )
}
