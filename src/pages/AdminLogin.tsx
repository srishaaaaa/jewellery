import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight, Eye, EyeOff, Lock, User } from 'lucide-react'
import { useAdminAuthStore, useSettingsStore } from '../store/store'
import { BRAND_EN, BRAND_LOGO } from '../lib/brand'
import { useLangStore } from '../store/langStore'
import { InstallBanner } from '../components/InstallBanner'

/** Admin / staff sign-in, in the IGMOLS terminal design. */
export default function AdminLogin() {
  const navigate = useNavigate()
  const location = useLocation()
  const { lang } = useLangStore()
  const l = (en: string, ta: string) => lang === 'ta' ? ta : en
  const login = useAdminAuthStore((state) => state.login)
  const storeSettings = useSettingsStore(s => s.settings)
  const logoUrl = storeSettings?.logoUrl || BRAND_LOGO
  const shopName = storeSettings?.name || BRAND_EN

  const [portalId, setPortalId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const from = (location.state as { from?: Location })?.from?.pathname || '/dashboard'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!portalId.trim() || !password) { setError(l('Enter your login ID and passcode.', 'உள்நுழைவு ID மற்றும் கடவுச்சொல்லை உள்ளிடவும்.')); return }
    setLoading(true)
    const role = await login(portalId.trim(), password)
    setLoading(false)
    if (role === 'admin') {
      const destination = from === '/pos' ? '/dashboard' : from
      navigate(destination, { replace: true })
    } else if (role === 'staff') {
      navigate('/dashboard', { replace: true })
    } else {
      setError(l('Invalid login ID or passcode.', 'தவறான உள்நுழைவு ID அல்லது கடவுச்சொல்.'))
    }
  }

  const inputClass = 'w-full bg-[#FAFAFA] border border-black/10 hover:border-[var(--accent-a50)] focus:border-[var(--accent)] focus:bg-white rounded-2xl pl-12 pr-12 py-3.5 text-[var(--accent)] focus:outline-none transition-all placeholder:text-black/20 disabled:opacity-60'

  return (
    <div className="min-h-dvh bg-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Fine accent grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--accent-a5)_1px,transparent_1px),linear-gradient(to_bottom,var(--accent-a5)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
      {/* Soft background orbs */}
      <div className="absolute top-[-20%] left-[-20%] w-[600px] h-[600px] bg-[var(--accent-a10)] rounded-full blur-[150px] animate-pulse" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[600px] h-[600px] bg-[var(--accent-a10)] rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }} />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md bg-white border border-[var(--accent-a30)] rounded-[2.5rem] p-8 md:p-10 shadow-[0_30px_70px_rgba(63,63,70,0.1)] overflow-hidden group flex flex-col items-center text-center">
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-[var(--accent)]" />

        {/* Logo with glow */}
        <div className="relative group mb-6">
          <div className="absolute -inset-1.5 bg-[var(--accent)] rounded-2xl blur opacity-30 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
          <div className="relative w-24 h-24 bg-white rounded-2xl border border-[var(--accent-a30)] shadow-lg overflow-hidden flex items-center justify-center">
            <img src={logoUrl} alt={`${shopName} Logo`} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
          </div>
        </div>

        <h1 className="text-3xl font-serif text-[var(--accent)] tracking-tight leading-tight mb-2">{shopName}</h1>
        <p className="text-[#1C1917]/50 text-xs font-bold uppercase tracking-[0.2em] mb-8">POS Terminal</p>

        <form onSubmit={handleSubmit} noValidate className="w-full space-y-6 text-left">
          <div className="space-y-3">
            <label htmlFor="login-id" className="text-[9px] font-bold text-[var(--accent)] uppercase tracking-[0.25em] ml-1">Login ID</label>
            <div className="relative">
              <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--accent)]"><User className="w-4 h-4" /></div>
              <input
                id="login-id"
                type="text"
                autoComplete="username"
                placeholder="admin or staff"
                className={`${inputClass} text-sm font-bold tracking-wide`}
                value={portalId}
                onChange={(e) => { setPortalId(e.target.value); setError('') }}
                disabled={loading}
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="login-passcode" className="text-[9px] font-bold text-[var(--accent)] uppercase tracking-[0.25em] ml-1">Security Passcode</label>
            <div className="relative">
              <div className="absolute left-5 top-1/2 -translate-y-1/2 text-[var(--accent)]"><Lock className="w-4 h-4" /></div>
              <input
                id="login-passcode"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className={`${inputClass} font-mono tracking-widest text-lg`}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-black/30 hover:text-[var(--accent)] transition-colors cursor-pointer"
                aria-label={showPassword ? 'Hide passcode' : 'Show passcode'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-xs text-[#27272A] font-bold mt-2 ml-1" role="alert">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-[var(--accent)] hover:brightness-105 active:scale-[0.98] text-white rounded-2xl font-bold text-xs uppercase tracking-[0.2em] transition-all shadow-[0_10px_30px_rgba(63,63,70,0.2)] flex items-center justify-center gap-3 mt-4 group cursor-pointer border border-[var(--accent-a30)] disabled:opacity-70"
          >
            {loading ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" /> Authenticating</>
            ) : (
              <>Authenticate <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-white" /></>
            )}
          </button>
        </form>

        <div className="mt-8 inline-flex items-center gap-2 px-3 py-1 bg-[var(--accent-a10)] border border-[var(--accent-a30)] rounded-full shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="text-[8px] font-bold text-[var(--accent)] tracking-[0.15em] uppercase">System Online • Encrypted</span>
        </div>
      </div>

      <div className="relative z-10 mt-6 text-[#1C1917]/30 text-[9px] font-bold tracking-widest uppercase">{shopName} Terminal v1.0</div>

      {/* Install banner: login page only */}
      <InstallBanner shopName={shopName} logo={logoUrl} />
    </div>
  )
}
