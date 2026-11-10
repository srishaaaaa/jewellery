import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, Copy, KeyRound, RefreshCw, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatPhoneDisplay } from '../../lib/phone'
import type { CustomerRecord } from '../../services/customerService'

// No look-alike characters (0/O, 1/l/I), since this is read out at the counter.
const CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
type Status = { has_password: boolean; own_password: boolean; updated_at: string | null; locked: boolean; shop_set_at: string | null }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

const generate = () => Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => CHARS[n % CHARS.length]).join('')

/** Shop: gives one customer a starting password, or resets a forgotten one. The customer must replace it at first login. */
export function CustomerPasswordModal({ customer, onClose }: { customer: CustomerRecord; onClose: () => void }) {
  const [password, setPassword] = useState(generate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  // Whether the customer already has a password, and whose: undefined while loading, null if it cannot be checked.
  const [status, setStatus] = useState<Status | null | undefined>(undefined)
  const [confirmReplace, setConfirmReplace] = useState(false)
  useEffect(() => {
    let live = true
    supabase.rpc('shop_customer_password_status', { p_customer_id: customer.id }).then(({ data, error: err }) => {
      if (live) setStatus(err ? null : (data as Status))
    })
    return () => { live = false }
  }, [customer.id])
  const ownPassword = Boolean(status?.own_password)

  const save = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (password.trim().length < 8) { setError('The password must have at least 8 characters.'); return }
    if (ownPassword && !confirmReplace) { setError('Tick the box first: this replaces the password the customer chose.'); return }
    setBusy(true)
    const { error: err } = await supabase.rpc('shop_set_customer_password', { p_customer_id: customer.id, p_password: password.trim(), p_by: 'Shop' })
    setBusy(false)
    if (err) {
      setError(/permission denied|not find the function|PGRST202/i.test(`${err.message} ${err.code}`)
        ? 'One setup step first: save the admin and staff passcodes in Settings → Login Passcodes, then log out and log in again. After that, this will work.'
        : err.message)
      return
    }
    setSaved(true)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(password.trim()); setCopied(true); window.setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Customer portal password">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#000000]"><KeyRound className="h-4 w-4" /> Portal Password</h3>
            <p className="mt-1 truncate text-xs font-semibold text-[#000000]/70">{customer.name || 'Customer'} • {formatPhoneDisplay(customer.phone) || customer.phone}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-black/10 hover:bg-black/5 cursor-pointer"><X className="h-4 w-4" /></button>
        </div>
        {saved ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Saved. Give this password to the customer now. It will not be shown again, and they must change it at first login.</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-black/10 bg-[#F9FAFB] px-3 py-2.5 text-base font-black text-[#000000]">{password.trim()}</code>
              <button type="button" onClick={() => void copy()} aria-label="Copy password" title="Copy" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black/10 hover:bg-black/5 cursor-pointer">{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}</button>
            </div>
            <button type="button" onClick={onClose} className="w-full rounded-xl bg-[#111111] py-2.5 text-xs font-black uppercase tracking-wider text-white cursor-pointer">Done</button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-3">
            {status === undefined && <p className="text-[11px] font-semibold text-[#000000]/50">Checking this customer's password…</p>}
            {status && ownPassword && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                <p className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> This customer has set their own password{status.updated_at ? ` (on ${when(status.updated_at)})` : ''}. They do not need one from the shop to log in.</p>
                <p className="mt-1 font-semibold">Only give a new one if they forgot it: saving replaces their password and logs them out everywhere.</p>
                <label className="mt-2 flex items-center gap-2 font-black cursor-pointer"><input type="checkbox" checked={confirmReplace} onChange={(e) => { setConfirmReplace(e.target.checked); setError('') }} /> Yes, they forgot it. Replace their password.</label>
              </div>
            )}
            {status && !ownPassword && status.has_password && (
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">A starting password was given{status.shop_set_at ? ` on ${when(status.shop_set_at)}` : ''} and the customer has not logged in to change it yet. Saving gives a new one instead.</p>
            )}
            {status && !status.has_password && <p className="rounded-lg border border-black/10 bg-[#F9FAFB] px-3 py-2 text-xs font-bold text-[#000000]/70">No portal password yet. Give this starting password to the customer; they choose their own at first login.</p>}
            {status?.locked && <p className="text-[11px] font-bold text-red-700">Locked for a few minutes after 5 wrong tries.</p>}
            <p className="text-[11px] font-semibold text-[#000000]/60">Logs the customer out everywhere. Use a different password for each customer.</p>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/60">Starting password</span>
              <span className="flex gap-2">
                <input aria-label="Starting password" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-black/15 px-3 py-2.5 text-sm font-bold outline-none focus:border-black" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setPassword(generate())} aria-label="Generate a new password" title="Generate" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 hover:bg-black/5 cursor-pointer"><RefreshCw className="h-4 w-4" /></button>
              </span>
            </label>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
            <button disabled={busy || (ownPassword && !confirmReplace)} className="w-full rounded-xl bg-[#111111] py-2.5 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer">{busy ? 'Saving…' : ownPassword ? 'Replace Their Password' : 'Save Password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
