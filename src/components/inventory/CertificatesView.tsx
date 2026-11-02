import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BadgeCheck, CheckCircle2, Edit2, ExternalLink, Plus, Trash2, X, XCircle } from 'lucide-react'
import { ModalPortal } from '../ModalPortal'
import { EyeIcon, actionBtn } from '../ActionIcons'
import { DetailDrawer, DrawerTable } from '../DetailDrawer'
import { FilterCard, FilterField } from '../filters/PageFilters'
import { filterInput } from '../filters/filterStyles'
import { csvDate, downloadCsv } from '../../lib/csv'
import { getErrorMessage } from '../../lib/errorMessage'
import { useAdminAuthStore, useProductStore } from '../../store/store'
import {
  CERT_STATUS_LABELS, certificateService, looseStoneService,
  type CertStatus, type GemCertificate, type LooseStone,
} from '../../services/stoneRateService'

const field = 'w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-[#000000] outline-none focus:border-[#111111]'
const lbl = 'mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/70'
const TONE: Record<CertStatus, string> = {
  pending: 'bg-black/5 text-[#000000]/70', uploaded: 'bg-blue-50 text-blue-700', verified: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700', expired: 'bg-amber-50 text-amber-800',
}
const LABS = ['GIA', 'IGI', 'HRD', 'SGL', 'GSI', 'GRS', 'Gübelin', 'SSEF', 'AGL', 'GII']

type CertForm = {
  id?: string; certificateNo: string; lab: string; issueDate: string; expiryDate: string; fileUrl: string; labUrl: string
  looseStoneId: string; productId: string; stoneDescription: string; notes: string
}
const emptyForm = (): CertForm => ({ certificateNo: '', lab: 'GIA', issueDate: '', expiryDate: '', fileUrl: '', labUrl: '', looseStoneId: '', productId: '', stoneDescription: '', notes: '' })

/** Stone certificates. Uploading a file never verifies it: only the admin's Verify / Reject does. */
export default function CertificatesView() {
  const isAdmin = useAdminAuthStore((s) => s.role) === 'admin'
  const products = useProductStore((s) => s.products)
  const [certs, setCerts] = useState<GemCertificate[]>([])
  const [stones, setStones] = useState<LooseStone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'all' | CertStatus>('all')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [form, setForm] = useState<CertForm | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')
  const [view, setView] = useState<GemCertificate | null>(null)

  useEffect(() => {
    let live = true
    Promise.all([certificateService.list(), looseStoneService.list().catch(() => [] as LooseStone[])])
      .then(([c, s]) => { if (live) { setCerts(c); setStones(s) } })
      .catch((err) => { if (live) setError(getErrorMessage(err, 'Unable to load certificates')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  // A certificate past its expiry date shows as expired even before anyone marks it
  const statusOf = (c: GemCertificate): CertStatus => (c.expiryDate && c.expiryDate < today && c.status !== 'rejected' ? 'expired' : c.status)
  const stoneLabel = (c: GemCertificate) => {
    const s = c.looseStoneId ? stones.find((x) => x.id === c.looseStoneId) : null
    const p = c.productId != null ? products.find((x) => Number(x.id) === c.productId) : null
    return [s ? `${s.stoneCode} ${s.name}` : '', p ? p.name : '', c.stoneDescription].filter(Boolean).join(' · ') || '—'
  }
  const visible = useMemo(() => certs.filter((c) => (tab === 'all' || statusOf(c) === tab)
    && (!query || `${c.lab} ${c.certificateNo} ${c.stoneDescription} ${stoneLabel(c)}`.toLowerCase().includes(query.toLowerCase()))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [certs, tab, query, stones, products])

  const replace = (c: GemCertificate) => { setCerts((rows) => rows.map((r) => (r.id === c.id ? c : r))); if (view?.id === c.id) setView(c) }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!form) return
    setSaving(true); setModalError('')
    try {
      const fileUrl = file ? await certificateService.uploadFile(file) : form.fileUrl
      const saved = await certificateService.save({
        id: form.id, certificateNo: form.certificateNo, lab: form.lab, issueDate: form.issueDate || null, expiryDate: form.expiryDate || null,
        fileUrl, labUrl: form.labUrl, looseStoneId: form.looseStoneId || null, productId: form.productId ? Number(form.productId) : null,
        stoneDescription: form.stoneDescription, notes: form.notes,
      })
      if (form.id) replace(saved); else setCerts((rows) => [saved, ...rows])
      setForm(null); setFile(null)
    } catch (err) { setModalError(getErrorMessage(err, 'Unable to save the certificate')) } finally { setSaving(false) }
  }
  const setStatus = async (c: GemCertificate, status: CertStatus) => {
    const note = status === 'rejected' ? window.prompt('Reason for rejecting this certificate:') : ''
    if (status === 'rejected' && !note) return
    if (status === 'verified' && !window.confirm(`Mark ${c.lab} ${c.certificateNo} as verified? Do this only after checking it on the lab's website.`)) return
    try { replace(await certificateService.setStatus(c.id, status, note || '')) } catch (err) { setError(getErrorMessage(err, 'Unable to change the status')) }
  }

  const removeCert = async (c: GemCertificate) => {
    if (!window.confirm(`Delete certificate ${c.lab} ${c.certificateNo}? This cannot be undone.`)) return
    try {
      await certificateService.remove(c.id)
      setCerts((rows) => rows.filter((r) => r.id !== c.id))
      if (view?.id === c.id) setView(null)
    } catch (err) { setError(getErrorMessage(err, 'Unable to delete the certificate')) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-3 text-[28px] font-black tracking-tight text-[#000000]"><BadgeCheck className="w-7 h-7 text-[var(--accent)]" /> Certificates</h2>
          <p className="mt-1 text-xs font-semibold text-[#000000]">Lab certificates for loose stones and jewellery. Uploading a file never marks it verified — the admin verifies after checking with the lab.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadCsv(`certificates-${today}`, [
            ['Lab', 'Certificate no.', 'Stone / item', 'Issued', 'Expires', 'Status', 'Verified by', 'Verified at', 'File', 'Lab link'],
            ...visible.map((c) => [c.lab, c.certificateNo, stoneLabel(c), c.issueDate || '', c.expiryDate || '', CERT_STATUS_LABELS[statusOf(c)], c.verifiedBy || '', c.verifiedAt ? csvDate(c.verifiedAt, true) : '', c.fileUrl, c.labUrl]),
          ])} className="rounded-xl border-2 border-[var(--accent)] px-4 py-2 text-xs font-black uppercase tracking-wider text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white cursor-pointer">Export CSV</button>
          <button type="button" onClick={() => { setModalError(''); setFile(null); setForm(emptyForm()) }} className="flex items-center gap-2 rounded-xl bg-[#111111] px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white cursor-pointer"><Plus className="w-4 h-4" /> Add Certificate</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {(['pending', 'uploaded', 'verified', 'rejected', 'expired'] as CertStatus[]).map((s) => (
          <div key={s} className="rounded-xl border border-black/10 bg-white p-4 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[0.15em]">{CERT_STATUS_LABELS[s]}</p><p className="mt-2 text-2xl font-black">{certs.filter((c) => statusOf(c) === s).length}</p></div>
        ))}
      </div>

      <FilterCard tabs={[{ id: 'all' as const, label: 'All' }, ...(['pending', 'uploaded', 'verified', 'rejected', 'expired'] as CertStatus[]).map((s) => ({ id: s, label: CERT_STATUS_LABELS[s] }))]}
        activeTab={tab} onTab={setTab} onSearch={() => setQuery(draft)}>
        <FilterField label="Search lab / number / stone" search><input className={`${filterInput} pl-9`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. GIA 2141438171" /></FilterField>
      </FilterCard>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white shadow-sm">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-[#F9FAFB] text-[10px] font-bold uppercase tracking-widest"><tr>{['Certificate', 'Stone / item', 'Issued', 'File', 'Status', 'Actions'].map((h) => <th key={h} className="p-4">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-black/5">
            {loading ? <tr><td colSpan={6} className="p-8 text-center">Loading…</td></tr>
              : visible.length === 0 ? <tr><td colSpan={6} className="p-8 text-center font-semibold text-[#000000]/60">No certificates here.</td></tr>
                : visible.map((c) => {
                  const st = statusOf(c)
                  return (
                    <tr key={c.id} className="hover:bg-black/[0.02]">
                      <td className="px-4 py-3 font-black">{c.lab} {c.certificateNo}</td>
                      <td className="px-4 py-3 max-w-[260px] whitespace-normal">{stoneLabel(c)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{c.issueDate || '—'}{c.expiryDate && <span className="block text-[10px] text-[#000000]/60">expires {c.expiryDate}</span>}</td>
                      <td className="px-4 py-3">{c.fileUrl ? <a href={c.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-blue-700 hover:underline">Open <ExternalLink className="w-3 h-3" /></a> : '—'}</td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${TONE[st]}`}>{CERT_STATUS_LABELS[st].toUpperCase()}</span>{c.verifiedBy && <p className="mt-1 text-[10px]">by {c.verifiedBy}</p>}</td>
                      <td className="px-4 py-3"><div className="flex items-center gap-1.5">
                        <button type="button" title="View" onClick={() => setView(c)} className={`${actionBtn} bg-black/5 hover:bg-black/10`}><EyeIcon className="w-4 h-4" /></button>
                        <button type="button" title="Edit / upload file" onClick={() => { setModalError(''); setFile(null); setForm({ id: c.id, certificateNo: c.certificateNo, lab: c.lab, issueDate: c.issueDate || '', expiryDate: c.expiryDate || '', fileUrl: c.fileUrl, labUrl: c.labUrl, looseStoneId: c.looseStoneId || '', productId: c.productId == null ? '' : String(c.productId), stoneDescription: c.stoneDescription, notes: c.notes }) }} className={`${actionBtn} bg-[#2563EB]/10 text-[#2563EB] hover:bg-[#2563EB]/20`}><Edit2 className="w-4 h-4" /></button>
                        {isAdmin && st !== 'verified' && <button type="button" title="Verify (after checking with the lab)" onClick={() => void setStatus(c, 'verified')} className={`${actionBtn} bg-[#10B981]/10 text-[#10B981] hover:bg-[#10B981]/20`}><CheckCircle2 className="w-4 h-4" /></button>}
                        {isAdmin && st !== 'rejected' && <button type="button" title="Reject" onClick={() => void setStatus(c, 'rejected')} className={`${actionBtn} bg-[#F59E0B]/10 text-[#D97706] hover:bg-[#F59E0B]/20`}><XCircle className="w-4 h-4" /></button>}
                        {isAdmin && <button type="button" title="Delete certificate" onClick={() => void removeCert(c)} className={`${actionBtn} bg-[#DC2626]/10 hover:bg-[#DC2626]/20 text-[#DC2626]`}><Trash2 className="w-4 h-4" /></button>}
                      </div></td>
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      {view && (
        <DetailDrawer kicker="Certificate" title={`${view.lab} ${view.certificateNo}`} subtitle={stoneLabel(view)} onClose={() => setView(null)}
          onView={view.fileUrl ? () => window.open(view.fileUrl, '_blank', 'noopener,noreferrer') : undefined} viewLabel="Open File"
          stats={[{ label: 'Status', value: CERT_STATUS_LABELS[statusOf(view)], tone: statusOf(view) === 'verified' ? 'green' : statusOf(view) === 'rejected' ? 'red' : undefined }, { label: 'Issued', value: view.issueDate || '—' }, { label: 'Expires', value: view.expiryDate || '—' }]}>
          <DrawerTable rows={[
            ['Lab', view.lab || '—'], ['Certificate no.', view.certificateNo], ['Stone / item', stoneLabel(view)],
            ['Lab check link', view.labUrl ? <a href={view.labUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">Open</a> : '—'],
            ['Verified / rejected by', view.verifiedBy ? `${view.verifiedBy} • ${view.verifiedAt ? new Date(view.verifiedAt).toLocaleString('en-IN') : ''}` : '—'],
            ['Notes', view.notes || '—'],
          ]} />
        </DetailDrawer>
      )}

      {form && (
        <ModalPortal><div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/60 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) setForm(null) }}>
          <form onSubmit={save} className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-[#1C1C1C] px-5 py-4"><h3 className="text-sm font-black uppercase tracking-wider text-white">{form.id ? 'Edit Certificate' : 'Add Certificate'}</h3><button type="button" onClick={() => setForm(null)} className="text-white"><X className="w-4 h-4" /></button></div>
            <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
              {modalError && <p className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{modalError}</p>}
              <div><label className={lbl}>Lab</label><input list="cert-labs" className={field} value={form.lab} onChange={(e) => setForm({ ...form, lab: e.target.value })} /><datalist id="cert-labs">{LABS.map((l) => <option key={l} value={l} />)}</datalist></div>
              <div><label className={lbl}>Certificate no. *</label><input required className={field} value={form.certificateNo} onChange={(e) => setForm({ ...form, certificateNo: e.target.value })} /></div>
              <div><label className={lbl}>Issue date</label><input type="date" className={field} value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} /></div>
              <div><label className={lbl}>Expiry date (if any)</label><input type="date" className={field} value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} /></div>
              <div><label className={lbl}>Loose stone</label>
                <select className={field} value={form.looseStoneId} onChange={(e) => setForm({ ...form, looseStoneId: e.target.value })}>
                  <option value="">None</option>{stones.map((s) => <option key={s.id} value={s.id}>{s.stoneCode} · {s.name}</option>)}
                </select></div>
              <div><label className={lbl}>Jewellery item</label>
                <select className={field} value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
                  <option value="">None</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></div>
              <div className="sm:col-span-2"><label className={lbl}>Stone description</label><input className={field} placeholder="e.g. 1.02 ct Round F VS1 natural diamond" value={form.stoneDescription} onChange={(e) => setForm({ ...form, stoneDescription: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={lbl}>Certificate file (PDF or image, up to 10 MB)</label>
                <input type="file" accept="application/pdf,image/*" className="block w-full text-xs" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                {form.fileUrl && !file && <a href={form.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-bold text-blue-700 hover:underline">Current file</a>}
              </div>
              <div className="sm:col-span-2"><label className={lbl}>Lab check link (report URL)</label><input className={field} placeholder="https://…" value={form.labUrl} onChange={(e) => setForm({ ...form, labUrl: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={lbl}>Notes</label><input className={field} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <div className="flex justify-end gap-3 border-t border-black/10 bg-[#FAFAFA] px-5 py-4">
              <button type="button" onClick={() => setForm(null)} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase text-black/60">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-[#111111] px-6 py-2.5 text-xs font-black uppercase text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div></ModalPortal>
      )}
    </div>
  )
}
