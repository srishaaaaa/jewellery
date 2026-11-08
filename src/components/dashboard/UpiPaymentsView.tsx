import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Copy, Image as ImageIcon, QrCode, RefreshCw, UserPlus, XCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { paymentLinkUrl } from '../../lib/upi'
import { formatCurrency, formatInvoiceNo } from '../../lib/retail'
import { formatPhoneDisplay, toWhatsAppUrl } from '../../lib/phone'
import { csvDate, downloadCsv } from '../../lib/csv'
import { getErrorMessage } from '../../lib/errorMessage'
import { useAdminAuthStore, useSettingsStore } from '../../store/store'
import { WhatsAppIcon, actionBtn } from '../ActionIcons'
import { FilterCard, FilterField, PeriodBar } from '../filters/PageFilters'
import { filterInput, inRange, periodRange, type PeriodPreset } from '../filters/filterStyles'

type OrderRef = { invoice_no: string; customer_name: string; phone: string; total: number; credit_paid_amount: number; credit_status: string | null } | null
type Claim = {
  id: string; order_id: string; amount: number; utr: string; paid_at: string | null; screenshot_path: string; note: string
  status: 'pending' | 'verified' | 'rejected'; review_reason: string; reviewed_by: string | null; reviewed_at: string | null; created_at: string; orders: OrderRef
}
type LinkRow = { id: string; token: string; order_id: string; amount: number; created_by: string; created_at: string; expires_at: string; revoked_at: string | null; orders: OrderRef }
type RegRow = { id: string; phone: string; name: string; status: string; created_at: string }

const who = () => { const s = useAdminAuthStore.getState(); return s.staffName || (s.role === 'admin' ? 'Admin' : 'Staff') }

/** Admin: customers' "I've Paid" UPI claims (confirm only after checking the bank / UPI app), payment links, registration requests. */
export default function UpiPaymentsView() {
  const isAdmin = useAdminAuthStore((s) => s.role) === 'admin'
  const shopName = useSettingsStore((s) => s.settings?.name) || 'our shop'
  const [tab, setTab] = useState<'pending' | 'verified' | 'rejected' | 'links' | 'registrations'>('pending')
  const [claims, setClaims] = useState<Claim[]>([])
  const [links, setLinks] = useState<LinkRow[]>([])
  const [regs, setRegs] = useState<RegRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const range = periodRange(period, from, to)
  const [draft, setDraft] = useState('')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const order = 'orders(invoice_no, customer_name, phone, total, credit_paid_amount, credit_status), advance_orders(deposit_id, customer_name, phone, total_amount, deposit_amount, status)'
    const scheme = 'jewellery_schemes(scheme_number, customer_name, phone, total_paid, status)'
    // An advance order or a scheme shows like a bill in this screen (scheme: the next installment is the "balance").
    type Adv = { deposit_id: string; customer_name: string; phone: string; total_amount: number; deposit_amount: number; status: string }
    type Sch = { scheme_number: string; customer_name: string; phone: string; total_paid: number; status: string }
    const withDoc = <T,>(rows: unknown): T[] => ((rows || []) as Array<Record<string, unknown> & { advance_orders?: Adv | null; jewellery_schemes?: Sch | null; orders?: OrderRef }>).map((r) => {
      const a = r.advance_orders
      const s = r.jewellery_schemes
      return { ...r, orders: r.orders
        || (a ? { invoice_no: a.deposit_id, customer_name: a.customer_name, phone: a.phone, total: a.total_amount, credit_paid_amount: a.deposit_amount, credit_status: a.status === 'completed' || a.status === 'cancelled' ? 'paid' : 'outstanding' } : null)
        || (s ? { invoice_no: s.scheme_number, customer_name: s.customer_name, phone: s.phone, total: s.total_paid, credit_paid_amount: s.total_paid, credit_status: s.status === 'active' ? 'outstanding' : 'paid' } : null) } as unknown as T
    })
    const select = async (table: 'upi_payment_claims' | 'upi_payment_links', limit: number) => {
      const res = await supabase.from(table).select(`*, ${order}, ${scheme}`).order('created_at', { ascending: false }).limit(limit)
      // Before the database update there is no scheme column: load without it.
      return res.error && /scheme/i.test(res.error.message) ? supabase.from(table).select(`*, ${order}`).order('created_at', { ascending: false }).limit(limit) : res
    }
    const [c, l, r] = await Promise.all([
      select('upi_payment_claims', 1000),
      select('upi_payment_links', 500),
      supabase.from('customer_registration_requests').select('*').order('created_at', { ascending: false }).limit(300),
    ])
    if (c.error) setError(/upi_payment_claims/.test(c.error.message) ? 'UPI payments need the database update: run supabase/migrations/customer_portal.sql in the Supabase SQL Editor.' : c.error.message)
    else { setError(''); setClaims(withDoc<Claim>(c.data)) }
    if (!l.error) setLinks(withDoc<LinkRow>(l.data))
    if (!r.error) setRegs((r.data || []) as RegRow[])
    setLoading(false)
  }, [])
  useEffect(() => {
    let live = true
    const run = () => { if (live) void load() }
    run()
    const t = window.setInterval(run, 30000)
    return () => { live = false; window.clearInterval(t) }
  }, [load])

  const match = useCallback((o: OrderRef, extra = '') => !q || `${o?.invoice_no || ''} ${o?.customer_name || ''} ${o?.phone || ''} ${extra}`.toLowerCase().includes(q.toLowerCase()), [q])
  const shownClaims = useMemo(() => claims.filter((c) => (tab === c.status) && inRange(c.created_at.slice(0, 10), range.from, range.to) && match(c.orders, c.utr)), [claims, tab, range, match])
  const counts = { pending: claims.filter((c) => c.status === 'pending').length, verified: claims.filter((c) => c.status === 'verified').length, rejected: claims.filter((c) => c.status === 'rejected').length }

  const confirm = async (c: Claim) => {
    if (!window.confirm(`Confirm ${formatCurrency(c.amount)} from ${c.orders?.customer_name || 'the customer'} for ${formatInvoiceNo(c.orders?.invoice_no || '')}?\n\nOnly confirm after you have seen this payment in your UPI app or bank statement${c.utr ? ` (UTR ${c.utr})` : ''}.`)) return
    let utr = c.utr
    if (!utr) utr = (window.prompt('UPI transaction ID / UTR from your bank or UPI app (recommended, blocks double counting):') || '').trim()
    try {
      await supabase.rpc('verify_payment_claim', { p_claim_id: c.id, p_by: who(), p_utr: utr || null }).then(({ error: err }) => { if (err) throw err })
      setNotice(`${formatCurrency(c.amount)} recorded on ${formatInvoiceNo(c.orders?.invoice_no || '')}. The customer has been notified.`)
      void load()
    } catch (err) { setError(getErrorMessage(err, 'Unable to confirm the payment')) }
  }
  const reject = async (c: Claim) => {
    const reason = window.prompt('Why was the payment not found? (shown to the customer)', 'Payment not received in the shop account')
    if (!reason) return
    try {
      await supabase.rpc('reject_payment_claim', { p_claim_id: c.id, p_reason: reason, p_by: who() }).then(({ error: err }) => { if (err) throw err })
      setNotice('Claim marked as not received. The customer has been told.')
      void load()
    } catch (err) { setError(getErrorMessage(err, 'Unable to reject the claim')) }
  }
  const screenshot = async (path: string) => {
    const { data, error: err } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 600)
    if (err || !data?.signedUrl) { setError('Unable to open the screenshot.'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  const revoke = async (l: LinkRow) => {
    if (!window.confirm(`Cancel the payment link for ${formatInvoiceNo(l.orders?.invoice_no || '')}?`)) return
    const { error: err } = await supabase.rpc('revoke_payment_link', { p_link_id: l.id })
    if (err) setError(err.message); else void load()
  }
  const shareLink = (l: LinkRow) => {
    const o = l.orders
    const msg = `Dear ${o?.customer_name || 'Customer'}, your invoice ${formatInvoiceNo(o?.invoice_no || '')} has an outstanding balance of ${formatCurrency(l.amount)}. You can complete your payment using the secure UPI payment link below:\n${paymentLinkUrl(l.token)}\n\nThank you!\n- ${shopName}`
    window.open(toWhatsAppUrl(o?.phone || '', msg), '_blank', 'noopener,noreferrer')
  }
  const setReg = async (r: RegRow, status: 'done' | 'dismissed') => {
    const { error: err } = await supabase.from('customer_registration_requests').update({ status }).eq('id', r.id)
    if (err) setError(err.message); else void load()
  }

  const linkState = (l: LinkRow) => (l.revoked_at ? 'Cancelled' : new Date(l.expires_at) < new Date() ? 'Expired' : (l.orders?.credit_status !== 'outstanding' ? 'Paid' : 'Active'))
  const tabs = [
    { id: 'pending' as const, label: `Awaiting verification (${counts.pending})` }, { id: 'verified' as const, label: `Verified (${counts.verified})` },
    { id: 'rejected' as const, label: `Rejected (${counts.rejected})` }, { id: 'links' as const, label: `Payment links (${links.length})` },
    { id: 'registrations' as const, label: `Registration requests (${regs.filter((r) => r.status === 'open').length})` },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3 text-[28px] font-black tracking-tight text-[#000000]"><QrCode className="w-7 h-7 text-[var(--accent)]" /> UPI Payments</h2>
          <p className="mt-1 text-xs font-semibold text-[#000000]">"Customer says paid by UPI" claims. Check your UPI app or bank statement before confirming — a claim, screenshot or QR scan is not proof of payment.</p>
        </div>
        <PeriodBar preset={period} from={range.from} to={range.to} onPreset={setPeriod}
          onFrom={(v) => { setFrom(v); setTo(range.to); setPeriod('custom') }} onTo={(v) => { setTo(v); setFrom(range.from); setPeriod('custom') }}
          onExport={() => downloadCsv(`upi-claims-${new Date().toISOString().slice(0, 10)}`, [
            ['Submitted', 'Invoice', 'Customer', 'Mobile', 'Amount', 'UTR', 'Status', 'Reviewed by', 'Reviewed at', 'Reason'],
            ...claims.filter((c) => inRange(c.created_at.slice(0, 10), range.from, range.to)).map((c) => [csvDate(c.created_at, true), formatInvoiceNo(c.orders?.invoice_no || ''), c.orders?.customer_name || '', c.orders?.phone || '', c.amount, c.utr, c.status, c.reviewed_by || '', c.reviewed_at ? csvDate(c.reviewed_at, true) : '', c.review_reason]),
          ])}>
          <button type="button" onClick={() => void load()} title="Refresh" className="rounded-xl border border-black/10 bg-white p-2.5 cursor-pointer"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </PeriodBar>
      </div>
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}

      <FilterCard tabs={tabs} activeTab={tab} onTab={setTab} onSearch={() => setQ(draft)}>
        <FilterField label="Customer / mobile / invoice / UTR" search><input className={`${filterInput} pl-9`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Priya, 98765, INV10000008" /></FilterField>
      </FilterCard>

      {(tab === 'pending' || tab === 'verified' || tab === 'rejected') && (
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Submitted', 'Customer', 'Invoice', 'Claimed', 'UTR / reference', 'Proof', tab === 'pending' ? 'Bill balance' : 'Checked', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-black/5">
              {shownClaims.length === 0 ? <tr><td colSpan={8} className="p-8 text-center font-semibold text-[#000000]/60">{loading ? 'Loading…' : 'Nothing here.'}</td></tr> : shownClaims.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(c.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{c.paid_at && <span className="block text-[10px] text-[#000000]/60">paid {new Date(c.paid_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}</td>
                  <td className="px-4 py-3"><p className="font-black">{c.orders?.customer_name || '—'}</p><p className="text-[10px]">{formatPhoneDisplay(c.orders?.phone || '')}</p></td>
                  <td className="px-4 py-3 font-bold">{formatInvoiceNo(c.orders?.invoice_no || '')}</td>
                  <td className="px-4 py-3 font-black">{formatCurrency(c.amount)}</td>
                  <td className="px-4 py-3 font-mono">{c.utr || '—'}</td>
                  <td className="px-4 py-3">{c.screenshot_path ? <button type="button" onClick={() => void screenshot(c.screenshot_path)} className="inline-flex items-center gap-1 font-bold text-blue-700 underline cursor-pointer"><ImageIcon className="w-3.5 h-3.5" /> View</button> : '—'}</td>
                  <td className="px-4 py-3">{tab === 'pending'
                    ? formatCurrency(Math.max(0, Number(c.orders?.total || 0) - Number(c.orders?.credit_paid_amount || 0)))
                    : <>{c.reviewed_by} · {c.reviewed_at ? new Date(c.reviewed_at).toLocaleDateString('en-IN') : ''}{c.review_reason && <span className="block text-[10px] text-red-700">{c.review_reason}</span>}</>}</td>
                  <td className="px-4 py-3">{c.status === 'pending' && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => void confirm(c)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-white cursor-pointer"><CheckCircle2 className="w-3.5 h-3.5" /> Confirm Received</button>
                      <button type="button" onClick={() => void reject(c)} className="inline-flex items-center gap-1 rounded-lg bg-[#DC2626]/10 px-3 py-2 text-[10px] font-black uppercase text-[#DC2626] cursor-pointer"><XCircle className="w-3.5 h-3.5" /> Not Received</button>
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'links' && (
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Created', 'Customer', 'Invoice', 'Amount', 'Expires', 'Status', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-black/5">
              {links.filter((l) => match(l.orders) && inRange(l.created_at.slice(0, 10), range.from, range.to)).map((l) => {
                const st = linkState(l)
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(l.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}<span className="block text-[10px]">{l.created_by}</span></td>
                    <td className="px-4 py-3 font-bold">{l.orders?.customer_name || '—'}</td><td className="px-4 py-3">{formatInvoiceNo(l.orders?.invoice_no || '')}</td>
                    <td className="px-4 py-3 font-black">{formatCurrency(l.amount)}</td><td className="px-4 py-3 whitespace-nowrap">{new Date(l.expires_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-3 font-bold">{st}</td>
                    <td className="px-4 py-3"><div className="flex gap-1.5">
                      <button type="button" disabled={st !== 'Active'} title="Send on WhatsApp" onClick={() => shareLink(l)} className={`${actionBtn} bg-[#10B981]/10 text-[#10B981] disabled:opacity-30`}><WhatsAppIcon className="w-4 h-4" /></button>
                      <button type="button" disabled={st !== 'Active'} title="Copy link" onClick={() => { void navigator.clipboard?.writeText(paymentLinkUrl(l.token)); setNotice('Payment link copied.') }} className={`${actionBtn} bg-black/5 disabled:opacity-30`}><Copy className="w-4 h-4" /></button>
                      {isAdmin && st === 'Active' && <button type="button" title="Cancel link" onClick={() => void revoke(l)} className={`${actionBtn} bg-[#DC2626]/10 text-[#DC2626]`}><XCircle className="w-4 h-4" /></button>}
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'registrations' && (
        <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Asked on', 'Mobile', 'Name given', 'Status', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-black/5">
              {regs.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-[#000000]/60">No requests.</td></tr> : regs.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="px-4 py-3 font-bold">+91 {r.phone}</td><td className="px-4 py-3">{r.name || '—'}</td><td className="px-4 py-3">{r.status}</td>
                  <td className="px-4 py-3">{r.status === 'open' && <div className="flex gap-1.5">
                    <button type="button" onClick={() => void setReg(r, 'done')} title="Added in Customers" className="inline-flex items-center gap-1 rounded-lg bg-[#111111] px-3 py-2 text-[10px] font-black uppercase text-white cursor-pointer"><UserPlus className="w-3.5 h-3.5" /> Mark registered</button>
                    <button type="button" onClick={() => void setReg(r, 'dismissed')} className="rounded-lg bg-black/5 px-3 py-2 text-[10px] font-black uppercase cursor-pointer">Dismiss</button>
                  </div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-[11px] text-[#000000]/60">Add the customer in Customers with this mobile number; they can then log in to the portal.</p>
        </div>
      )}
    </div>
  )
}
