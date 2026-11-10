import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail } from 'lucide-react'
import { useSettingsStore } from '../../store/store'
import { BRAND_EN, BRAND_LOGO } from '../../lib/brand'
import { magicLinkLogin, readPortalSession } from '../../lib/customerPortal'

/**
 * Where the emailed login link lands (/customer/magic#token). The customer has to press the button:
 * email scanners open links on their own, and that must not use up the one-time link.
 */
export default function PortalMagicLink() {
  const navigate = useNavigate()
  const settings = useSettingsStore((s) => s.settings)
  const [token] = useState(() => window.location.hash.slice(1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(token ? '' : 'This login link is not complete. Please ask for a new one.')

  useEffect(() => {
    if (readPortalSession()) { navigate('/customer/dashboard', { replace: true }); return }
    // Keep the one-time token out of the address bar and browser history.
    window.history.replaceState(null, '', window.location.pathname)
  }, [navigate])

  const logIn = async () => {
    setBusy(true); setError('')
    try { await magicLinkLogin(token); navigate('/customer/dashboard', { replace: true }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not log you in.') } finally { setBusy(false) }
  }

  return (
    <div className="min-h-dvh h-dvh overflow-y-auto bg-[#FAFAF7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[2rem] border border-black/10 bg-white px-7 py-8 text-center shadow-[0_24px_60px_rgba(0,0,0,0.08)]">
        <img src={settings?.logoUrl || BRAND_LOGO} alt="" className="mx-auto mb-3 h-20 w-20 rounded-2xl border border-black/10 object-contain" />
        <h1 className="text-xl font-black">{settings?.name || BRAND_EN}</h1>
        <p className="mb-5 text-xs font-semibold text-black/60">Customer portal — your schemes, bills and payments</p>
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
        {token && !error && (
          <button type="button" disabled={busy} onClick={() => void logIn()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer">
            <Mail className="h-4 w-4" /> {busy ? 'Logging in…' : 'Log Me In'}
          </button>
        )}
        {error && <Link to="/customer/login" className="block rounded-xl bg-[var(--accent)] py-3 text-xs font-black uppercase tracking-wider text-white">Back to Login</Link>}
      </div>
    </div>
  )
}
