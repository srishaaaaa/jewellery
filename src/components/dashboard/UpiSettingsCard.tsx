import { useEffect, useState } from 'react'
import { Check, QrCode, Save, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { isValidUpiId } from '../../lib/upi'
import { loadUpiConfig } from '../../lib/upiConfig'
import { UpiQr } from '../UpiQr'

const label = 'block text-[10px] font-black uppercase tracking-[0.15em] text-[#000000]/60 mb-2'
const input = 'w-full rounded-xl border border-black/10 bg-white px-3 py-3 text-sm font-semibold text-[#000000] outline-none focus:border-[#111111]'
type SavedUpi = { id: string; name: string }
const DAY_OPTIONS: Array<[number, string]> = [[7, '7 days before'], [3, '3 days before'], [1, '1 day before'], [0, 'On the due date'], [-1, 'When overdue']]

/** Settings: shop UPI for the QR (counter and customer payment pages), customer reminder schedule, link lifetime. */
export function UpiSettingsCard() {
  const [upiId, setUpiId] = useState('')
  const [upiName, setUpiName] = useState('')
  const [minutes, setMinutes] = useState('5')
  const [days, setDays] = useState<number[]>([7, 3, 1, 0, -1])
  const [linkHours, setLinkHours] = useState('6')
  const [otpMinutes, setOtpMinutes] = useState('5')
  const [shopName, setShopName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  // The UPI ID now in the database, and other IDs used before (only after the database update adds upi_saved).
  const [currentId, setCurrentId] = useState('')
  const [currentName, setCurrentName] = useState('')
  const [saved, setSaved] = useState<SavedUpi[] | null>(null)

  useEffect(() => {
    let live = true
    const cols = 'name, upi_id, upi_name, upi_rotate_minutes, reminder_days, payment_link_hours, otp_minutes'
    const query = (c: string) => supabase.from('store_settings').select(c).eq('id', 1).maybeSingle()
    query(`${cols}, upi_saved`).then(async (first) => {
        const { data, error } = first.error && /upi_saved/.test(first.error.message) ? await query(cols) : first
        if (!live) return
        if (error) { setMsg({ ok: false, text: 'UPI settings need the database update: run supabase/migrations/customer_portal.sql in the Supabase SQL Editor.' }); return }
        const r = (data || {}) as Record<string, unknown>
        setShopName(String(r.name || ''))
        setUpiId(String(r.upi_id || '')); setUpiName(String(r.upi_name || ''))
        setCurrentId(String(r.upi_id || '')); setCurrentName(String(r.upi_name || ''))
        if (Array.isArray(r.upi_saved)) setSaved((r.upi_saved as SavedUpi[]).filter((x) => x && typeof x.id === 'string' && x.id))
        setMinutes(String(r.upi_rotate_minutes || 5)); setLinkHours(String(r.payment_link_hours || 6)); setOtpMinutes(String(r.otp_minutes || 5))
        if (Array.isArray(r.reminder_days)) setDays((r.reminder_days as number[]).map(Number))
        setReady(true)
      })
    return () => { live = false }
  }, [])

  const save = async (use?: SavedUpi) => {
    setMsg(null)
    const id = (use ? use.id : upiId).trim()
    const name = (use ? use.name : upiName).trim()
    if (id && !isValidUpiId(id)) { setMsg({ ok: false, text: 'Enter a valid UPI ID, for example yourshop@okicici.' }); return }
    const m = Math.round(Number(minutes))
    if (!(m >= 1 && m <= 60)) { setMsg({ ok: false, text: 'Change the QR every 1 to 60 minutes.' }); return }
    const h = Math.round(Number(linkHours))
    if (!(h >= 1 && h <= 72)) { setMsg({ ok: false, text: 'Payment links can last 1 to 72 hours.' }); return }
    const o = Math.round(Number(otpMinutes))
    if (!(o >= 2 && o <= 15)) { setMsg({ ok: false, text: 'OTP validity must be 2 to 15 minutes.' }); return }
    // The UPI ID being replaced is kept in the saved list, so the shop can switch back with one tap.
    const nextSaved = saved === null ? null : [
      ...(currentId && currentId.toLowerCase() !== id.toLowerCase() ? [{ id: currentId, name: currentName }] : []),
      ...saved.filter((x) => x.id.toLowerCase() !== id.toLowerCase() && x.id.toLowerCase() !== currentId.toLowerCase()),
    ].slice(0, 10)
    setBusy(true)
    const { error } = await supabase.from('store_settings').update({
      upi_id: id, upi_name: name, upi_rotate_minutes: m, reminder_days: [...days].sort((a, b) => b - a),
      payment_link_hours: h, otp_minutes: o, updated_at: new Date().toISOString(),
      ...(nextSaved ? { upi_saved: nextSaved } : {}),
    }).eq('id', 1)
    setBusy(false)
    if (error) { setMsg({ ok: false, text: error.message }); return }
    setUpiId(id); setUpiName(name); setCurrentId(id); setCurrentName(name)
    if (nextSaved) setSaved(nextSaved)
    void loadUpiConfig(true)
    setMsg({ ok: true, text: id ? `Saved. Customers now pay to ${id}, on the counter QR, the customer portal and payment links already sent.` : 'Saved. UPI QR codes are hidden until a UPI ID is entered.' })
  }
  const forget = async (x: SavedUpi) => {
    if (!saved) return
    const next = saved.filter((y) => y.id !== x.id)
    const { error } = await supabase.from('store_settings').update({ upi_saved: next, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) setMsg({ ok: false, text: error.message }); else setSaved(next)
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[var(--accent)]"><QrCode className="w-4 h-4" /> Shop UPI (Customers Scan This)</h3>
      <p className="mt-1 text-[11px] text-[#000000]/70">Customers scan this UPI ID at the counter and in the customer portal (Pay by UPI). Change it here any time: every QR uses the new ID straight away. The shop confirms each payment after seeing it in the bank / UPI app — nothing is marked paid automatically.</p>
      {saved && saved.length > 0 && (
        <div className="mt-4">
          <p className={label}>Switch to a UPI ID used before</p>
          <div className="flex flex-wrap gap-2">
            {saved.map((x) => (
              <span key={x.id} className="inline-flex items-center gap-1 rounded-xl border border-black/15 bg-white py-1 pl-3 pr-1 text-xs font-bold">
                <span className="max-w-[220px] truncate">{x.id}{x.name ? ` (${x.name})` : ''}</span>
                <button type="button" disabled={busy || !ready} onClick={() => { if (window.confirm(`Customers will pay to ${x.id} from now on. Switch?`)) void save(x) }}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#111111] px-2 py-1 text-[10px] font-black uppercase text-white disabled:opacity-50 cursor-pointer"><Check className="h-3 w-3" /> Use</button>
                <button type="button" aria-label={`Remove ${x.id}`} title="Remove from this list" onClick={() => void forget(x)} className="rounded-lg p-1 text-black/50 hover:bg-black/5 cursor-pointer"><X className="h-3.5 w-3.5" /></button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className={label}>Shop UPI ID *</label><input className={input} value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="yourshop@okicici" /></div>
          <div><label className={label}>Name shown in the UPI app</label><input className={input} value={upiName} onChange={(e) => setUpiName(e.target.value)} placeholder={shopName || 'Jewellery Shop'} /></div>
          <div><label className={label}>Change the QR every (minutes)</label><input type="number" min="1" max="60" className={input} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
          <div><label className={label}>Payment links last (hours)</label><input type="number" min="1" max="72" className={input} value={linkHours} onChange={(e) => setLinkHours(e.target.value)} /></div>
          <div><label className={label}>Customer OTP valid for (minutes)</label><input type="number" min="2" max="15" className={input} value={otpMinutes} onChange={(e) => setOtpMinutes(e.target.value)} /></div>
          <div className="sm:col-span-2">
            <label className={label}>Scheme installment reminders to customers</label>
            <div className="flex flex-wrap gap-2">
              {DAY_OPTIONS.map(([d, t]) => {
                const on = days.includes(d)
                return <button key={d} type="button" onClick={() => setDays((cur) => on ? cur.filter((x) => x !== d) : [...cur, d])}
                  className={`rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-wider cursor-pointer ${on ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-black/15 bg-white text-[#000000]/70'}`}>{t}</button>
              })}
            </div>
            <p className="mt-1 text-[10px] text-[#000000]/60">Sent daily at 9 AM to the customer portal (each reminder once). Needs pg_cron — see the setup guide.</p>
          </div>
        </div>
        {upiId.trim() && isValidUpiId(upiId) && (
          <div className="rounded-xl border border-black/10 p-3"><p className="mb-2 text-center text-[10px] font-black uppercase text-[#000000]/60">Preview (₹1.00)</p>
            <UpiQr upiId={upiId.trim()} name={upiName.trim() || shopName} amount={1} invoiceNo="TEST" rotateMinutes={Number(minutes) || 5} size={150} showOpenButton={false} />
          </div>
        )}
      </div>
      {msg && <p className={`mt-4 rounded-xl px-3 py-2 text-xs font-bold ${msg.ok ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</p>}
      <button type="button" disabled={busy || !ready} onClick={() => void save()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#111111] px-5 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer"><Save className="w-4 h-4" /> Save Shop Details</button>
    </div>
  )
}
