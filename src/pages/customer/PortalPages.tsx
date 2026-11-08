import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { ArrowLeft, Bell, BellRing, CheckCheck, CheckCircle2, Download, FileText, Lock, Mail, Phone, PiggyBank, Printer, QrCode, ShoppingBag, Wallet } from 'lucide-react'
import { Invoice } from '../../components/Invoice'
import { SchemeReceiptSheet } from '../../components/invoice/SchemeReceiptSheet'
import { orderToInvoiceProps } from '../../lib/orderInvoiceProps'
import { sheetPdfFile } from '../../lib/sheetPdf'
import { printSheet } from '../../lib/printPrefs'
import { downloadFile } from '../../lib/advanceReceipt'
import { normalizeStructuredOrderItem, formatInvoiceNo } from '../../lib/retail'
import { describeStones, mapSchemeRow, metalLabel, normalizeStoneDetails } from '../../lib/jewellery'
import { totalsAfterInstallment } from '../../lib/schemeReceipt'
import { mapInstallmentRow } from '../../services/schemeService'
import {
  PAY_STATUS_LABELS, PAYMENT_STATUS_LABELS, changePasswordWithToken, confirmChange, inr, portalRpc, requestChangeCode, savePortalSession, readPortalSession, shortDate,
  type PortalAdvance, type PortalBill, type PortalNotification, type PortalScheme,
} from '../../lib/customerPortal'
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '../../lib/portalPush'
import type { PortalContext } from './PortalLayout'

const card = 'rounded-2xl border border-black/10 bg-white p-4 sm:p-5 shadow-sm'
const STATUS_TONE: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700', verified: 'bg-emerald-50 text-emerald-700', partially_paid: 'bg-amber-50 text-amber-800',
  pending: 'bg-red-50 text-red-700', awaiting_verification: 'bg-blue-50 text-blue-700', cancelled: 'bg-black/5 text-black/60',
  refunded: 'bg-purple-50 text-purple-700', rejected: 'bg-red-50 text-red-700', active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-blue-50 text-blue-700', matured: 'bg-amber-50 text-amber-800', redeemed: 'bg-black/5 text-black/60',
}
const Chip = ({ s, label }: { s: string; label?: string }) => <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${STATUS_TONE[s] || 'bg-black/5'}`}>{label || s.replace(/_/g, ' ')}</span>
const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className={card}><p className="text-[10px] font-black uppercase tracking-wider text-black/60">{label}</p><p className="mt-2 text-xl font-black">{value}</p>{hint && <p className="mt-1 text-[11px] font-semibold text-black/50">{hint}</p>}</div>
)
const Title = ({ children, back }: { children: ReactNode; back?: string }) => (
  <div className="mb-4 flex items-center gap-2">
    {back && <Link to={back} className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white"><ArrowLeft className="h-4 w-4" /></Link>}
    <h1 className="text-2xl font-black tracking-tight">{children}</h1>
  </div>
)
const usePortal = () => useOutletContext<PortalContext>()
const FREQ: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', one_time: 'One-time deposit' }
const remaining = (s: PortalScheme) => Math.max(0, s.total_installments - s.installments_paid)

// ── Home ──
export function PortalHome() {
  const { data, notifications } = usePortal()
  if (!data) return null
  const active = data.schemes.filter((s) => s.status === 'active')
  const nextDue = active.map((s) => s.next_due_date).filter(Boolean).sort()[0] as string | undefined
  const pending = data.bills.reduce((a, b) => a + Number(b.balance || 0), 0) + (data.advances || []).reduce((a, b) => a + Number(b.balance || 0), 0)
  const purchases = data.bills.filter((b) => b.pay_status !== 'cancelled')
  return (
    <div className="space-y-5">
      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div><p className="text-xs font-semibold text-black/60">Customer ID {data.customer.code.toUpperCase()}</p><h1 className="text-2xl font-black">{data.customer.name || 'Customer'}</h1><p className="text-sm font-semibold">+{data.customer.phone}</p></div>
        <Link to="/customer/pay-upi" className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-3 text-xs font-black uppercase tracking-wider text-white"><QrCode className="h-4 w-4" /> {pending > 0 ? `Pay ${inr(pending)} by UPI` : 'Pay by UPI'}</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total purchases" value={inr(purchases.reduce((a, b) => a + Number(b.total || 0), 0))} hint={`${purchases.length} bill${purchases.length === 1 ? '' : 's'}`} />
        <Stat label="Active schemes" value={active.length} hint={`${inr(data.schemes.reduce((a, s) => a + Number(s.total_paid || 0), 0))} saved in all`} />
        <Stat label="Next installment" value={nextDue ? shortDate(nextDue) : '—'} hint={nextDue ? active.find((s) => s.next_due_date === nextDue)?.scheme_name : 'Nothing due'} />
        <Stat label="Pending to pay" value={inr(pending)} hint={pending ? 'On credit bills' : 'All bills paid'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-wider">Recent bills</h2><Link to="/customer/bills" className="text-[11px] font-bold underline">All bills</Link></div>
          {data.bills.length === 0 ? <p className="text-xs text-black/60">No bills yet.</p> : data.bills.slice(0, 5).map((b) => (
            <Link key={b.id} to={`/customer/bills/${b.id}`} className="flex items-center justify-between gap-2 border-b border-black/5 py-2.5 last:border-0">
              <span><span className="block text-sm font-black">{formatInvoiceNo(b.invoice_no)}</span><span className="text-[11px] text-black/60">{shortDate(b.created_at)}</span></span>
              <span className="text-right"><span className="block text-sm font-black">{inr(b.total)}</span><Chip s={b.pay_status} label={PAY_STATUS_LABELS[b.pay_status]} /></span>
            </Link>
          ))}
        </div>
        <div className={card}>
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-wider">Notifications</h2><Link to="/customer/notifications" className="text-[11px] font-bold underline">All</Link></div>
          {notifications.length === 0 ? <p className="text-xs text-black/60">No notifications yet.</p> : notifications.slice(0, 5).map((n) => (
            <div key={n.id} className="border-b border-black/5 py-2.5 last:border-0"><p className={`text-sm ${n.read_at ? 'font-semibold' : 'font-black'}`}>{n.title}</p><p className="text-[11px] text-black/60">{n.body}</p></div>
          ))}
        </div>
        <div className={`${card} lg:col-span-2`}>
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-wider">Recent payments</h2><Link to="/customer/payments" className="text-[11px] font-bold underline">All payments</Link></div>
          {data.payments.length === 0 ? <p className="text-xs text-black/60">No payments yet.</p> : data.payments.slice(0, 5).map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-2 border-b border-black/5 py-2.5 last:border-0">
              <span className="text-sm font-bold">{p.kind === 'scheme' ? `Scheme ${p.invoice_no}` : formatInvoiceNo(p.invoice_no)}<span className="block text-[11px] font-semibold text-black/60">{shortDate(p.date)} · {(p.method || '').toUpperCase()}</span></span>
              <span className="text-right"><span className="block text-sm font-black">{inr(p.amount)}</span><Chip s={p.status} label={PAYMENT_STATUS_LABELS[p.status]} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Schemes ──
export function PortalSchemes() {
  const { data } = usePortal()
  if (!data) return null
  return (
    <div>
      <Title>My Schemes</Title>
      {data.schemes.length === 0 ? <div className={card}><p className="text-sm text-black/60">You have no savings schemes yet.</p></div> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.schemes.map((s) => {
            const pct = s.total_installments ? Math.round((s.installments_paid / s.total_installments) * 100) : 0
            return (
              <Link key={s.id} to={`/customer/schemes/${s.id}`} className={`${card} block hover:border-black/30`}>
                <div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-black text-black/50">{s.scheme_number}</p><h2 className="text-lg font-black">{s.scheme_name}</h2></div><Chip s={s.status} /></div>
                <p className="mt-1 text-xs font-semibold">{inr(s.monthly_amount)} · {FREQ[s.frequency] || s.frequency}</p>
                <div className="mt-3 h-2.5 rounded-full bg-black/5"><div className="h-2.5 rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} /></div>
                <div className="mt-2 flex justify-between text-[11px] font-bold"><span>{s.installments_paid}/{s.total_installments} paid · {remaining(s)} left</span><span>{inr(s.total_paid)} saved</span></div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]"><span>Next due: <b>{s.status === 'active' ? shortDate(s.next_due_date) : '—'}</b></span><span>Matures: <b>{shortDate(s.maturity_date)}</b></span></div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

type SchemeDetail = { scheme: Record<string, unknown>; installments: Array<Record<string, unknown>>; redemptions: Array<Record<string, unknown>>; terms: Record<string, unknown> | null }
export function PortalSchemeDetail() {
  const { id = '' } = useParams()
  const { data } = usePortal()
  const [d, setD] = useState<SchemeDetail | null>(null)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    portalRpc<SchemeDetail>('customer_scheme_detail', { p_scheme_id: id }).then((r) => { if (live) setD(r) }).catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [id])
  const s = data?.schemes.find((x) => x.id === id)
  if (error) return <p className="text-sm font-bold text-red-700">{error}</p>
  if (!d || !s) return <p className="text-sm text-black/60">Loading…</p>
  const scheme = mapSchemeRow(d.scheme)
  const insts = d.installments.map((r) => mapInstallmentRow({ ...r, scheme_id: id }))
  const pct = s.total_installments ? Math.round((s.installments_paid / s.total_installments) * 100) : 0
  const benefit = [s.benefit_type !== 'wastage' && s.making_benefit_value ? `Making ${s.making_benefit_unit === 'percent' ? `${s.making_benefit_value}%` : inr(s.making_benefit_value)} off` : '',
    s.benefit_type !== 'making' && s.wastage_benefit_value ? `Wastage ${s.wastage_benefit_unit === 'percent' ? `${s.wastage_benefit_value}%` : inr(s.wastage_benefit_value)} off` : ''].filter(Boolean).join(' + ')
  const open = receipt ? insts.find((i) => i.id === receipt) : null
  return (
    <div className="space-y-4">
      <Title back="/customer/schemes">{s.scheme_name}</Title>
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-black">{s.scheme_number}</p>
          <span className="flex flex-wrap items-center gap-2"><Chip s={s.status} /><SchemePayButton s={s} /></span>
        </div>
        <div className="mt-3 h-3 rounded-full bg-black/5"><div className="h-3 rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} /></div>
        <p className="mt-2 text-xs font-bold">{s.installments_paid}/{s.total_installments} installments paid ({pct}%) · {remaining(s)} remaining</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          {[['Installment', inr(s.monthly_amount)], ['Plan', FREQ[s.frequency] || s.frequency], ['Started', shortDate(s.start_date)], ['Matures', shortDate(s.maturity_date)],
            ['Contributed', inr(s.total_paid)], ['Still to pay', inr(remaining(s) * s.monthly_amount)], ['Next due', s.status === 'active' ? shortDate(s.next_due_date) : '—'], ['Gold saved', `${Number(s.total_grams || 0).toFixed(3)} g ${s.gold_purity}`],
          ].map(([k, v]) => <div key={k}><p className="text-[10px] font-black uppercase text-black/50">{k}</p><p className="font-black">{v}</p></div>)}
        </div>
        <p className="mt-4 text-xs"><b>Benefit:</b> {s.benefit_forfeited ? 'Not applicable (closed early)' : benefit || 'As per scheme terms'}{s.benefit_used ? ' — already used' : ''}</p>
        <p className="mt-1 text-xs"><b>Redemption:</b> {s.status === 'matured' || s.status === 'completed' ? 'Eligible — redeem at the shop against jewellery.' : s.status === 'redeemed' ? 'Already redeemed.' : `After the last installment / maturity on ${shortDate(s.maturity_date)}.`}</p>
      </div>
      <div className={card}>
        <h2 className="mb-2 text-sm font-black uppercase tracking-wider">Installments</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-[10px] font-black uppercase tracking-wider text-black/50"><tr>{['#', 'Due date', 'Amount', 'Paid on', 'Method', 'Receipt', 'Status', ''].map((h) => <th key={h} className="py-2 pr-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-black/5">
              {insts.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-3 font-black">{i.installmentNumber}</td><td className="py-2 pr-3">{shortDate(i.dueDate)}</td>
                  <td className="py-2 pr-3 font-bold">{inr(i.status === 'paid' ? i.amountPaid : i.amountDue)}</td><td className="py-2 pr-3">{i.paymentDate ? shortDate(i.paymentDate) : '—'}</td>
                  <td className="py-2 pr-3">{(i.paymentMethod || '—').toUpperCase()}</td><td className="py-2 pr-3">{i.receiptNumber || '—'}</td>
                  <td className="py-2 pr-3"><Chip s={i.status === 'paid' ? 'verified' : i.dueDate < new Date().toISOString().slice(0, 10) && i.status === 'pending' ? 'pending' : 'active'} label={i.status === 'paid' ? 'Paid' : i.status === 'closed' ? 'Closed' : i.dueDate < new Date().toISOString().slice(0, 10) ? 'Overdue' : 'Upcoming'} /></td>
                  <td className="py-2">{i.status === 'paid' && <button type="button" onClick={() => setReceipt(i.id)} className="rounded-lg border border-black/15 px-2 py-1 text-[10px] font-black uppercase cursor-pointer">Receipt</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {d.redemptions.length > 0 && (
        <div className={card}><h2 className="mb-2 text-sm font-black uppercase tracking-wider">Used on bills</h2>
          {d.redemptions.map((r, k) => <p key={k} className="text-xs">{shortDate(String(r.redeemed_at))} · {formatInvoiceNo(String(r.invoice_no || ''))} · {inr(Number(r.amount_used))}{Number(r.benefit_applied) ? ` + benefit ${inr(Number(r.benefit_applied))}` : ''}</p>)}
        </div>
      )}
      <div className={card}><h2 className="mb-2 text-sm font-black uppercase tracking-wider">Terms</h2>
        <ul className="list-disc space-y-1 pl-5 text-xs text-black/80">
          <li>Installments are paid at the shop or by UPI here; amounts, dates and benefits are set by the shop and cannot be changed here.</li>
          <li>The savings are redeemed against jewellery at the shop, not paid out in cash.</li>
          {benefit && <li>Benefit: {benefit}, applied once on the redemption bill.</li>}
          {Boolean(d.terms && (d.terms as { requireMaturityForRedemption?: boolean }).requireMaturityForRedemption) && <li>Redemption is allowed on or after the maturity date.</li>}
        </ul>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setReceipt(null) }}>
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white">
            <div className="flex items-center justify-between bg-[#1C1C1C] px-4 py-3"><p className="text-xs font-black uppercase text-white">Receipt {open.receiptNumber}</p>
              <span className="flex gap-2"><button type="button" onClick={() => printSheet('a4')} className="rounded-lg bg-white/15 px-3 py-1.5 text-[11px] font-black text-white">Print</button><button type="button" onClick={() => setReceipt(null)} className="rounded-lg bg-white/15 px-3 py-1.5 text-[11px] font-black text-white">Close</button></span></div>
            <SchemeReceiptSheet scheme={scheme} installment={open} totals={totalsAfterInstallment(scheme, insts, open)} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Purchases (items on the bills, as billed) ──
export function PortalPurchases() {
  const { data } = usePortal()
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const rows = useMemo(() => (data?.bills || []).flatMap((b) => (b.items || []).map((raw, k) => ({ b, k, it: normalizeStructuredOrderItem(raw) }))), [data])
  const visible = rows.filter(({ b, it }) => {
    const day = b.created_at.slice(0, 10)
    return (!from || day >= from) && (!to || day <= to) && (!status || b.pay_status === status)
      && (!q || `${b.invoice_no} ${it.name} ${it.category || ''}`.toLowerCase().includes(q.toLowerCase()))
  })
  return (
    <div>
      <Title>My Purchases</Title>
      <div className={`${card} mb-4 grid gap-3 sm:grid-cols-4`}>
        <input className="rounded-xl border border-black/15 px-3 py-2.5 text-sm" placeholder="Invoice / item / category" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" className="rounded-xl border border-black/15 px-3 py-2.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="rounded-xl border border-black/15 px-3 py-2.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="rounded-xl border border-black/15 px-3 py-2.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All payment statuses</option>{Object.entries(PAY_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      {visible.length === 0 ? <div className={card}><p className="text-sm text-black/60">No purchases match.</p></div> : (
        <div className="space-y-3">
          {visible.map(({ b, k, it }) => {
            const j = it.jewellery
            const stones = j ? describeStones(normalizeStoneDetails(j.stones)) || j.stone_summary : ''
            return (
              <Link key={`${b.id}-${k}`} to={`/customer/bills/${b.id}`} className={`${card} block`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-base font-black">{it.name}</p><p className="text-[11px] font-semibold text-black/60">{shortDate(b.created_at)} · {formatInvoiceNo(b.invoice_no)}{it.category ? ` · ${it.category}` : ''}</p></div>
                  <div className="text-right"><p className="text-base font-black">{inr(it.line_total)}</p><Chip s={b.pay_status} label={PAY_STATUS_LABELS[b.pay_status]} /></div>
                </div>
                {j && (
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
                    <span>Metal: <b>{metalLabel(j.metal_type, j.purity)}</b></span><span>Gross / Net: <b>{j.gross_weight.toFixed(3)} / {j.net_weight.toFixed(3)} g</b></span>
                    <span>Rate: <b>{inr(j.rate_per_gram)}/g</b></span><span>Qty: <b>{it.quantity}</b></span>
                    {j.making_amount > 0 && <span>Making: <b>{inr(j.making_amount)}</b></span>}{j.wastage_amount > 0 && <span>Wastage: <b>{inr(j.wastage_amount)}</b></span>}
                    {(j.diamond_value || 0) > 0 && <span>Diamonds: <b>{inr(j.diamond_value || 0)}</b></span>}{(j.pearl_value || 0) > 0 && <span>Pearls: <b>{inr(j.pearl_value || 0)}</b></span>}
                  </div>
                )}
                {stones && <p className="mt-1 text-[11px] text-black/70">Stones: {stones}</p>}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Bills ──
export function PortalBills() {
  const { data } = usePortal()
  if (!data) return null
  return (
    <div>
      <Title>My Bills</Title>
      {data.bills.length === 0 ? <div className={card}><p className="text-sm text-black/60">No bills yet.</p></div> : (
        <div className={`${card} overflow-x-auto p-0 sm:p-0`}>
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-[#F9FAFB] text-[10px] font-black uppercase tracking-wider text-black/60"><tr>{['Invoice', 'Date', 'Total', 'Paid', 'Advance / scheme', 'Balance', 'Status', 'Method', ''].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-black/5">
              {data.bills.map((b) => (
                <tr key={b.id}>
                  <td className="p-3 font-black">{formatInvoiceNo(b.invoice_no)}</td><td className="p-3">{shortDate(b.created_at)}</td>
                  <td className="p-3 font-bold">{inr(b.total)}</td><td className="p-3">{inr(b.paid)}</td>
                  <td className="p-3">{inr(Number(b.advance_amount_used) + Number(b.scheme_amount_used))}</td>
                  <td className={`p-3 font-black ${b.balance > 0 ? 'text-red-600' : ''}`}>{inr(b.balance)}</td>
                  <td className="p-3"><Chip s={b.pay_status} label={PAY_STATUS_LABELS[b.pay_status]} /></td>
                  <td className="p-3">{(b.payment_mode || '—').toUpperCase()}</td>
                  <td className="p-3"><Link to={`/customer/bills/${b.id}`} className="rounded-lg bg-[#111111] px-3 py-1.5 text-[10px] font-black uppercase text-white">{b.balance > 0 ? 'View / Pay' : 'View'}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type BillDetail = { order: Record<string, unknown>; summary: PortalBill; payments: Array<{ amount: number; method: string; utr: string; at: string }> }
export function PortalBillDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [d, setD] = useState<BillDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    portalRpc<BillDetail>('customer_bill', { p_order_id: id }).then((r) => { if (live) setD(r) }).catch((e) => { if (live) setError(e.message) })
    return () => { live = false }
  }, [id])
  if (error) return <p className="text-sm font-bold text-red-700">{error}</p>
  if (!d) return <p className="text-sm text-black/60">Loading…</p>
  const props = orderToInvoiceProps(d.order)
  const pay = async () => {
    setBusy(true); setError('')
    try { const r = await portalRpc<{ token: string }>('customer_payment_link', { p_order_id: id }); navigate(`/customer/pay/${r.token}`) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open the payment page.') } finally { setBusy(false) }
  }
  const pdf = async () => { setBusy(true); try { downloadFile(await sheetPdfFile(<Invoice {...props} />, `Invoice-${props.invoiceNo}`)) } finally { setBusy(false) } }
  const s = d.summary
  return (
    <div className="space-y-4">
      <Title back="/customer/bills">{props.invoiceNo}</Title>
      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex flex-wrap gap-5 text-xs">
          <span>Total <b className="block text-base">{inr(s.total)}</b></span><span>Paid <b className="block text-base">{inr(s.paid)}</b></span>
          <span>Balance <b className={`block text-base ${s.balance > 0 ? 'text-red-600' : ''}`}>{inr(s.balance)}</b></span>
          <span>Status <span className="block"><Chip s={s.pay_status} label={PAY_STATUS_LABELS[s.pay_status]} /></span></span>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.balance > 0 && s.pay_status !== 'cancelled' && <button type="button" disabled={busy} onClick={() => void pay()} className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-2.5 text-xs font-black uppercase text-white disabled:opacity-50 cursor-pointer"><QrCode className="h-4 w-4" /> Pay Now</button>}
          <button type="button" disabled={busy} onClick={() => void pdf()} className="flex items-center gap-2 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-xs font-black uppercase cursor-pointer"><Download className="h-4 w-4" /> PDF</button>
          <button type="button" onClick={() => printSheet('a4')} className="flex items-center gap-2 rounded-xl border border-black/15 bg-white px-4 py-2.5 text-xs font-black uppercase cursor-pointer"><Printer className="h-4 w-4" /> Print</button>
        </div>
      </div>
      {d.payments.length > 0 && (
        <div className={card}><h2 className="mb-2 text-sm font-black uppercase tracking-wider">Payments on this bill</h2>
          {d.payments.map((p, k) => <p key={k} className="text-xs">{shortDate(p.at)} · {inr(p.amount)} · {p.method.toUpperCase()}{p.utr ? ` · UTR ${p.utr}` : ''}</p>)}
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white"><Invoice {...props} /></div>
    </div>
  )
}

// ── Pay by UPI ──
/** Opens the shop's UPI QR for one thing the customer owes. Nothing is marked paid until the shop sees the money. */
function usePayLink() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const open = async (key: string, fn: string, args: Record<string, unknown>) => {
    setBusy(key); setError('')
    try { const r = await portalRpc<{ token: string }>(fn, args); navigate(`/customer/pay/${r.token}`) }
    catch (e) {
      const m = e instanceof Error ? e.message : ''
      setError(/customer_scheme_payment_link|not find the function|PGRST202/i.test(m) ? 'Paying installments by UPI is not switched on at the shop yet. Please pay at the counter.' : m || 'Could not open the payment.')
    } finally { setBusy('') }
  }
  return { busy, error, open }
}

function SchemePayButton({ s }: { s: PortalScheme }) {
  const { busy, error, open } = usePayLink()
  if (s.status !== 'active' || !(Number(s.next_amount ?? s.monthly_amount) > 0)) return null
  if (s.pending_claim) return <Chip s="awaiting_verification" label="Awaiting UPI Verification" />
  return (
    <>
      <button type="button" disabled={busy === s.id} onClick={() => void open(s.id, 'customer_scheme_payment_link', { p_scheme_id: s.id })}
        className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer">
        <QrCode className="h-4 w-4" /> Pay {inr(Number(s.next_amount ?? s.monthly_amount))} by UPI
      </button>
      {error && <span className="basis-full text-right text-[11px] font-bold text-red-700">{error}</span>}
    </>
  )
}

export function PortalPayUpi() {
  const { data } = usePortal()
  const { busy, error, open } = usePayLink()
  if (!data) return null
  const bills = data.bills.filter((b) => b.balance > 0 && b.pay_status !== 'cancelled')
  const advances = (data.advances || []).filter((a) => a.balance > 0 && a.status !== 'cancelled')
  const schemes = data.schemes.filter((s) => s.status === 'active' && Number(s.next_amount ?? s.monthly_amount) > 0)
  const rows: Array<{ key: string; title: string; sub: string; amount: number; waiting: boolean; go: () => void }> = [
    ...schemes.map((s) => ({ key: s.id, title: `${s.scheme_name} — next installment`, sub: `${s.scheme_number}${s.next_due_date ? ` • Due ${shortDate(s.next_due_date)}` : ''}`,
      amount: Number(s.next_amount ?? s.monthly_amount), waiting: Boolean(s.pending_claim), go: () => void open(s.id, 'customer_scheme_payment_link', { p_scheme_id: s.id }) })),
    ...bills.map((b) => ({ key: b.id, title: `Bill ${formatInvoiceNo(b.invoice_no)} — balance`, sub: `Bill total ${inr(b.total)} • Paid ${inr(b.paid)}`,
      amount: b.balance, waiting: b.pay_status === 'awaiting_verification', go: () => void open(b.id, 'customer_payment_link', { p_order_id: b.id }) })),
    ...advances.map((a) => ({ key: a.id, title: `Order ${a.product_name} — balance`, sub: `${a.deposit_id} • Paid ${inr(a.paid)} of ${inr(a.total_amount)}`,
      amount: a.balance, waiting: Boolean(a.pending_claim), go: () => void open(a.id, 'customer_advance_payment_link', { p_advance_id: a.id }) })),
  ]
  return (
    <div className="space-y-4">
      <Title>Pay by UPI</Title>
      <div className={`${card} text-xs`}>
        <p className="font-black uppercase tracking-wider">How it works</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Tap <b>Scan &amp; Pay</b> next to what you want to pay.</li>
          <li>Scan the shop's QR with Google Pay, PhonePe, Paytm or any UPI app (or tap Open My UPI App on your phone) and pay.</li>
          <li>Tap <b>I've Paid</b> and add the UPI transaction ID. The shop confirms it after seeing the money in its account.</li>
        </ol>
      </div>
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
      {rows.length === 0 ? <div className={card}><p className="text-sm font-semibold text-black/60">Nothing to pay right now. Thank you!</p></div> : (
        <div className={`${card} divide-y divide-black/5 !py-1`}>
          {rows.map((x) => (
            <div key={x.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="text-sm font-black">{x.title}</p><p className="text-[11px] font-semibold text-black/60">{x.sub}</p></div>
              <div className="flex items-center gap-3">
                <span className="text-base font-black">{inr(x.amount)}</span>
                {x.waiting ? <Chip s="awaiting_verification" label="Awaiting Verification" />
                  : <button type="button" disabled={busy === x.key} onClick={x.go} className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer"><QrCode className="h-4 w-4" /> {busy === x.key ? 'Opening…' : 'Scan & Pay'}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Payments ──
function AdvanceOrdersCard({ orders }: { orders: PortalAdvance[] }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const pay = async (id: string) => {
    setBusy(id); setError('')
    try { const r = await portalRpc<{ token: string }>('customer_advance_payment_link', { p_advance_id: id }); navigate(`/customer/pay/${r.token}`) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not open the payment.') } finally { setBusy('') }
  }
  return (
    <div className={`${card} mb-4`}>
      <h2 className="text-sm font-black">Advance Orders</h2>
      {error && <p className="mt-2 text-xs font-bold text-red-700">{error}</p>}
      <div className="mt-2 divide-y divide-black/5">
        {orders.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
            <div className="min-w-0">
              <p className="font-black">{a.product_name}</p>
              <p className="text-[11px] font-semibold text-black/60">{a.deposit_id}{a.expected_delivery_date ? ` • Expected ${shortDate(a.expected_delivery_date)}` : ''}</p>
              <p className="mt-1">Total <b>{inr(a.total_amount)}</b> • Paid <b>{inr(a.paid)}</b> • Balance <b className={a.balance > 0 ? 'text-red-600' : ''}>{inr(a.balance)}</b></p>
            </div>
            {a.pending_claim ? <Chip s="awaiting_verification" label="Awaiting UPI Verification" />
              : a.balance > 0 ? <button type="button" disabled={busy === a.id} onClick={() => void pay(a.id)} className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer"><QrCode className="h-4 w-4" /> Pay Balance</button>
              : <Chip s={a.status === 'cancelled' ? 'cancelled' : 'paid'} label={a.status === 'cancelled' ? 'Cancelled' : a.status === 'completed' ? 'Completed' : 'Paid'} />}
          </div>
        ))}
      </div>
    </div>
  )
}

export function PortalPayments() {
  const { data } = usePortal()
  if (!data) return null
  return (
    <div>
      <Title>Payments</Title>
      {(data.advances || []).length > 0 && <AdvanceOrdersCard orders={data.advances} />}
      {data.payments.length === 0 ? <div className={card}><p className="text-sm text-black/60">No payments yet.</p></div> : (
        <div className={`${card} overflow-x-auto p-0 sm:p-0`}>
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-[#F9FAFB] text-[10px] font-black uppercase tracking-wider text-black/60"><tr>{['Date', 'For', 'Amount', 'Method', 'Reference', 'Status', 'Verified'].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-black/5">
              {data.payments.map((p, i) => (
                <tr key={i}>
                  <td className="p-3">{shortDate(p.date)}</td>
                  <td className="p-3 font-bold">{p.kind === 'scheme' ? <Link className="underline" to={`/customer/schemes/${p.scheme_id}`}>Scheme {p.invoice_no}</Link> : formatInvoiceNo(p.invoice_no)}</td>
                  <td className="p-3 font-black">{inr(p.amount)}</td><td className="p-3">{(p.method || '—').toUpperCase()}</td><td className="p-3">{p.reference || '—'}</td>
                  <td className="p-3"><Chip s={p.status} label={PAYMENT_STATUS_LABELS[p.status] || p.status} />{p.reason && <span className="block text-[10px] text-red-700">{p.reason}</span>}</td>
                  <td className="p-3">{p.verified_at ? shortDate(p.verified_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Notifications ──
const NOTICE_ICON: Record<string, typeof Bell> = { bill: FileText, payment_verified: Wallet, payment_rejected: Wallet, scheme_paid: PiggyBank, scheme_due: PiggyBank, scheme_due_today: PiggyBank, scheme_overdue: PiggyBank, purchase: ShoppingBag }
export function PortalNotifications() {
  const { notifications, refresh } = usePortal()
  const [tab, setTab] = useState<'all' | 'upcoming' | 'today' | 'overdue' | 'payments' | 'bills'>('all')
  const match = (n: PortalNotification) => tab === 'all' || (tab === 'upcoming' && n.kind === 'scheme_due') || (tab === 'today' && n.kind === 'scheme_due_today')
    || (tab === 'overdue' && n.kind === 'scheme_overdue') || (tab === 'payments' && /payment|scheme_paid/.test(n.kind)) || (tab === 'bills' && n.kind === 'bill')
  const markAll = async () => { await portalRpc('customer_mark_read'); await refresh() }
  const markOne = async (id: string) => { await portalRpc('customer_mark_read', { p_id: id }); await refresh() }
  const link = (n: PortalNotification) => (n.ref_type === 'bill' ? `/customer/bills/${n.ref_id}` : n.ref_type === 'scheme' ? `/customer/schemes/${n.ref_id}` : '')
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-black tracking-tight">Notifications</h1>
        <button type="button" onClick={() => void markAll()} className="flex items-center gap-1.5 rounded-xl border border-black/15 bg-white px-3 py-2 text-[11px] font-black uppercase cursor-pointer"><CheckCheck className="h-4 w-4" /> Mark all read</button>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {([['all', 'All'], ['upcoming', 'Upcoming payments'], ['today', 'Due today'], ['overdue', 'Overdue'], ['payments', 'Payments'], ['bills', 'Bills']] as const).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg px-3 py-2 text-[11px] font-black uppercase cursor-pointer ${tab === k ? 'bg-[#111111] text-white' : 'border border-black/10 bg-white'}`}>{v}</button>
        ))}
      </div>
      <div className="space-y-2">
        {notifications.filter(match).length === 0 ? <div className={card}><p className="text-sm text-black/60">Nothing here.</p></div> : notifications.filter(match).map((n) => {
          const Icon = NOTICE_ICON[n.kind] || Bell
          const href = link(n)
          return (
            <div key={n.id} className={`${card} flex items-start gap-3 ${n.read_at ? 'opacity-70' : 'border-[var(--accent)]/40'}`}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/5"><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.read_at ? 'font-semibold' : 'font-black'}`}>{n.title}</p><p className="text-xs text-black/70">{n.body}</p>
                <p className="mt-1 text-[10px] font-semibold text-black/50">{new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {href && <Link to={href} onClick={() => void markOne(n.id)} className="text-[11px] font-black underline">Open</Link>}
                {!n.read_at && <button type="button" onClick={() => void markOne(n.id)} className="text-[11px] font-bold text-black/60 underline cursor-pointer">Mark read</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Profile ──
const inputCls = 'w-full rounded-xl border border-black/15 px-3 py-2.5 text-sm'
const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message.replace(/^.*?:\s/, '') : fallback)

/** Enter a new email or mobile, get a code there, type it in. Nothing changes until the code is right. */
function VerifyWithCode({ kind, initial, onDone, onCancel }: { kind: 'email' | 'phone'; initial: string; onDone: (text: string) => void; onCancel: () => void }) {
  const [target, setTarget] = useState(initial)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clean = kind === 'email' ? target.trim().toLowerCase() : target.replace(/\D/g, '').slice(-10)
  const send = async () => {
    setBusy(true); setError('')
    const r = await requestChangeCode(kind === 'email' ? { new_email: clean } : { new_phone: clean })
    setBusy(false)
    if (r.ok) setSent(true); else setError(r.message)
  }
  const confirm = async () => {
    setBusy(true); setError('')
    try {
      if (kind === 'email') await confirmChange('customer_confirm_email_change', { p_email: clean, p_code: code.trim() })
      else {
        await confirmChange('customer_confirm_phone_change', { p_phone: clean, p_code: code.trim() })
        const s = readPortalSession()
        if (s) savePortalSession({ ...s, customer: { ...s.customer, phone: clean } })
      }
      onDone(kind === 'email' ? 'Email verified.' : 'Mobile number changed. Log in with the new number from now on.')
    } catch (err) { setError(errText(err, 'Could not verify the code.')) } finally { setBusy(false) }
  }
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-black/10 bg-[#FAFAF7] p-3">
      {!sent ? (
        <input aria-label={kind === 'email' ? 'Email address' : 'New mobile number'} type={kind === 'email' ? 'email' : 'tel'} inputMode={kind === 'email' ? 'email' : 'numeric'} placeholder={kind === 'email' ? 'you@example.com' : 'New 10-digit mobile number'} className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} />
      ) : (
        <>
          <p className="text-[11px] font-semibold text-black/70">Enter the 6-digit code sent to {kind === 'email' ? clean : `+91 ${clean}`}.</p>
          <input aria-label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${inputCls} tracking-[0.3em]`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
        </>
      )}
      {error && <p className="text-xs font-bold text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || (sent ? code.length !== 6 : !clean)} onClick={() => void (sent ? confirm() : send())} className="rounded-lg bg-[#111111] px-4 py-2 text-[11px] font-black uppercase text-white disabled:opacity-50 cursor-pointer">{busy ? 'Please wait…' : sent ? 'Confirm' : 'Send Code'}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-black/15 px-4 py-2 text-[11px] font-black uppercase cursor-pointer">Cancel</button>
      </div>
    </div>
  )
}

/** Set a first password (customers who came in by code) or change the current one. */
function ChangePassword({ hasPassword, onDone, onCancel }: { hasPassword: boolean; onDone: (text: string) => void; onCancel: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (next.length < 8) { setError('The password must have at least 8 characters.'); return }
    if (next !== again) { setError('The two passwords do not match.'); return }
    const token = readPortalSession()?.token
    if (!token) { setError('Your session has ended. Please log in again.'); return }
    setBusy(true)
    try { await changePasswordWithToken(token, current, next); onDone(hasPassword ? 'Password changed. Other devices have been logged out.' : 'Password set. You can now log in with it.') }
    catch (err) { setError(errText(err, 'Could not save the password.')) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} className="mt-2 space-y-2 rounded-xl border border-black/10 bg-[#FAFAF7] p-3">
      {hasPassword && <input aria-label="Current password" type="password" autoComplete="current-password" placeholder="Current password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} />}
      <input aria-label="New password" type="password" autoComplete="new-password" placeholder="New password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} />
      <input aria-label="New password again" type="password" autoComplete="new-password" placeholder="New password again" className={inputCls} value={again} onChange={(e) => setAgain(e.target.value)} />
      <p className="text-[11px] text-black/60">At least 8 characters. Not your mobile number.</p>
      {error && <p className="text-xs font-bold text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-lg bg-[#111111] px-4 py-2 text-[11px] font-black uppercase text-white disabled:opacity-50 cursor-pointer">{busy ? 'Please wait…' : 'Save Password'}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-black/15 px-4 py-2 text-[11px] font-black uppercase cursor-pointer">Cancel</button>
      </div>
    </form>
  )
}

function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 cursor-pointer ${on ? 'bg-[#111111]' : 'bg-black/20'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

export function PortalProfile() {
  const { data, refresh } = usePortal()
  const [address, setAddress] = useState(data?.customer.address || '')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState<'' | 'email' | 'phone' | 'password'>('')
  const [push, setPush] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  useEffect(() => {
    let live = true
    void currentPushSubscription().then((s) => { if (live) setPush(Boolean(s)) })
    return () => { live = false }
  }, [])
  if (!data) return null
  const c = data.customer
  const fail = (err: unknown, fallback: string) => setMsg({ ok: false, text: errText(err, fallback) })
  const save = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null)
    try { await portalRpc('customer_update_profile', { p_email: c.email, p_address: address }); await refresh(); setMsg({ ok: true, text: 'Saved.' }) }
    catch (err) { fail(err, 'Could not save.') }
  }
  const done = async (text: string) => { setEditing(''); setMsg({ ok: true, text }); await refresh() }
  const setReminders = async (on: boolean) => {
    setMsg(null)
    try { await portalRpc('customer_set_reminders', { p_on: on }); await refresh() } catch (err) { fail(err, 'Could not save.') }
  }
  const setAlerts = async (on: boolean) => {
    setMsg(null); setPushBusy(true)
    try {
      if (on) await enablePush(); else await disablePush()
      setPush(on)
      if (on) setMsg({ ok: true, text: 'Alerts are on for this device.' })
    } catch (err) { fail(err, 'Could not change alerts.') } finally { setPushBusy(false) }
  }
  const link = 'text-[11px] font-black underline cursor-pointer'
  return (
    <div className="max-w-xl space-y-4">
      <Title>Profile</Title>
      {msg && <p role="status" className={`rounded-xl border px-3 py-2 text-xs font-bold ${msg.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <div className={`${card} space-y-4`}>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <span>Name <b className="block text-sm">{c.name || '—'}</b></span><span>Customer ID <b className="block text-sm">{c.code.toUpperCase()}</b></span>
          <span className="col-span-2">Customer since <b className="block text-sm">{shortDate(c.created_at)}</b></span>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2"><Phone className="h-4 w-4 shrink-0 text-black/50" /><span>Mobile (login) <b className="block text-sm">+{c.phone}</b></span></span>
            {editing !== 'phone' && <button type="button" onClick={() => setEditing('phone')} className={link}>Change</button>}
          </div>
          {editing === 'phone' && <VerifyWithCode kind="phone" initial="" onDone={(t) => void done(t)} onCancel={() => setEditing('')} />}
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-black/50" /><span className="min-w-0">Email <b className="block break-all text-sm">{c.email || 'Not added'}</b></span>
              {c.email && (c.email_verified
                ? <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Verified</span>
                : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-800">Not verified</span>)}
            </span>
            {editing !== 'email' && <span className="flex gap-3">
              {c.email && !c.email_verified && <button type="button" onClick={() => setEditing('email')} className={link}>Verify</button>}
              <button type="button" onClick={() => setEditing('email')} className={link}>{c.email ? 'Change' : 'Add'}</button>
            </span>}
          </div>
          {editing === 'email' && <VerifyWithCode kind="email" initial={c.email_verified ? '' : c.email} onDone={(t) => void done(t)} onCancel={() => setEditing('')} />}
          <p className="mt-1 text-[11px] text-black/60">Magic Link login sends its link to this email.</p>
        </div>
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2"><Lock className="h-4 w-4 shrink-0 text-black/50" /><span>Password <b className="block text-sm">{c.has_password ? 'Set' : 'Not set'}</b></span></span>
            {editing !== 'password' && <button type="button" onClick={() => setEditing('password')} className={link}>{c.has_password ? 'Change Password' : 'Set Password'}</button>}
          </div>
          {editing === 'password' && <ChangePassword hasPassword={c.has_password} onDone={(t) => void done(t)} onCancel={() => setEditing('')} />}
        </div>
      </div>
      <form onSubmit={save} className={`${card} space-y-3`}>
        <label className="block"><span className="mb-1 block text-[10px] font-black uppercase text-black/60">Address</span><textarea rows={3} className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <p className="text-[11px] text-black/60">To change your name, please ask the shop.</p>
        <button className="rounded-xl bg-[#111111] px-5 py-2.5 text-xs font-black uppercase text-white cursor-pointer">Save</button>
      </form>
      <div className={`${card} space-y-4`}>
        <h2 className="flex items-center gap-2 text-sm font-black"><BellRing className="h-4 w-4" /> Reminders and Alerts</h2>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span><b className="block text-sm">WhatsApp / SMS reminders</b>Due dates for your schemes and bills.</span>
          <Switch label="WhatsApp and SMS reminders" on={c.reminders_on} onChange={(v) => void setReminders(v)} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span><b className="block text-sm">Alerts on this device</b>{pushSupported() ? 'Bills, payments and due dates, even when this page is closed.' : 'Not available in this browser. On iPhone, add this site to your Home Screen first.'}</span>
          <Switch label="Alerts on this device" on={push} disabled={pushBusy || !pushSupported()} onChange={(v) => void setAlerts(v)} />
        </div>
      </div>
    </div>
  )
}
