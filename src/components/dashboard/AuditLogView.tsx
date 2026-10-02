import { useCallback, useEffect, useState } from 'react'
import { Download, History, RefreshCw } from 'lucide-react'
import { auditService, AUDIT_ACTION_LABELS, type AuditEntry } from '../../services/auditService'
import { csvDate, downloadCsv } from '../../lib/csv'
import { formatCurrency } from '../../lib/retail'

const inputCls = 'w-full px-3.5 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB]/60 rounded-xl text-[13px] font-bold text-[#111111] focus:outline-none focus:border-[var(--accent)] transition-colors'

/** Short readable form of an old/new value ("₹6,550/g", "Qty 3", JSON otherwise). */
const describeValue = (v: unknown): string => {
  if (v == null) return '—'
  if (typeof v !== 'object') return String(v)
  const r = v as Record<string, unknown>
  if (typeof r.rate_per_gram === 'number' || typeof r.rate_per_gram === 'string') return `${formatCurrency(Number(r.rate_per_gram))}/g`
  const parts = Object.entries(r)
    .filter(([, val]) => val !== null && val !== '' && typeof val !== 'object')
    .slice(0, 6)
    .map(([k, val]) => `${k.replace(/_/g, ' ')}: ${val}`)
  return parts.join(' · ') || '—'
}

/** Admin-only, read-only list of sensitive changes (entries cannot be edited or deleted). */
export default function AuditLogView() {
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await auditService.list({ action, from, to }))
      setError('')
    } catch (err) {
      setError((err as Error).message.includes('audit_logs')
        ? 'The audit log needs the database update: run supabase/migrations/jewellery_pos.sql again.'
        : (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [action, from, to])

  useEffect(() => { void load() }, [load])

  const exportCsv = () => downloadCsv(`audit_log_${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Date & Time', 'Action', 'Record', 'Old Value', 'New Value', 'User', 'Note'],
    ...rows.map((r) => [csvDate(r.createdAt, true), AUDIT_ACTION_LABELS[r.action] || r.action, r.entityId, describeValue(r.oldValue), describeValue(r.newValue), r.userName, r.note]),
  ])

  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB]/60 p-4 sm:p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <History size={16} className="text-[var(--accent)] shrink-0" />
          <div>
            <p className="text-[13px] font-black uppercase tracking-wider text-[var(--accent)]">Audit Log</p>
            <p className="text-[12px] text-[#6B7280]">Metal rate, item, price, stock, discount, return and Schema changes. Entries cannot be edited or deleted.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={exportCsv} disabled={!rows.length} className="flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-200 disabled:opacity-40">
            <Download size={13} /> Export CSV
          </button>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-[#E5E7EB] bg-white p-2 text-[#647064]" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All actions</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{error}</div>}
      <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]/60 max-h-[480px] overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F9FAFB] sticky top-0 text-[10px] font-black uppercase tracking-wider text-[#6B7280]">
            <tr>{['Date & Time', 'Action', 'Record', 'Old', 'New', 'By'].map((h) => <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]/60">
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-[#6B7280]">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-[#6B7280]">No changes recorded for these filters.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2.5 whitespace-nowrap">{new Date(r.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="px-3 py-2.5 font-bold text-[#111111] whitespace-nowrap">{AUDIT_ACTION_LABELS[r.action] || r.action}</td>
                <td className="px-3 py-2.5 text-[#374151] max-w-[160px] break-words">{r.entityId || '—'}{r.note ? <span className="block text-[10px] text-[#6B7280]">{r.note}</span> : null}</td>
                <td className="px-3 py-2.5 text-[#6B7280] max-w-[220px] break-words">{describeValue(r.oldValue)}</td>
                <td className="px-3 py-2.5 text-[#111111] max-w-[220px] break-words">{describeValue(r.newValue)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-[#374151]">{r.userName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
