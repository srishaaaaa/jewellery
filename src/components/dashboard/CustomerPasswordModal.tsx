import { useState, type FormEvent } from 'react'
import { Check, Copy, KeyRound, RefreshCw, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatPhoneDisplay } from '../../lib/phone'
import type { CustomerRecord } from '../../services/customerService'

// No look-alike characters (0/O, 1/l/I), since this is read out at the counter.
const CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const generate = () => Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => CHARS[n % CHARS.length]).join('')

/** Shop: gives one customer a starting password, or resets a forgotten one. The customer must replace it at first login. */
export function CustomerPasswordModal({ customer, onClose }: { customer: CustomerRecord; onClose: () => void }) {
  const [password, setPassword] = useState(generate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (password.trim().length < 8) { setError('The password must have at least 8 characters.'); return }
    setBusy(true)
    const { error: err } = await supabase.rpc('shop_set_customer_password', { p_customer_id: customer.id, p_password: password.trim(), p_by: 'Shop' })
    setBusy(false)
    if (err) {
      setError(/permission denied|not find the function|PGRST202/i.test(`${err.message} ${err.code}`)
        ? 'This needs the shop sign-in and the latest database update. See CUSTOMER_PORTAL_SETUP.md.'
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
            <p className="text-[11px] font-semibold text-[#000000]/60">Replaces any password this customer has and logs them out everywhere. Use a different password for each customer.</p>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#000000]/60">Starting password</span>
              <span className="flex gap-2">
                <input aria-label="Starting password" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-black/15 px-3 py-2.5 text-sm font-bold outline-none focus:border-black" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setPassword(generate())} aria-label="Generate a new password" title="Generate" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 hover:bg-black/5 cursor-pointer"><RefreshCw className="h-4 w-4" /></button>
              </span>
            </label>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
            <button disabled={busy} className="w-full rounded-xl bg-[#111111] py-2.5 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer">{busy ? 'Saving…' : 'Save Password'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
