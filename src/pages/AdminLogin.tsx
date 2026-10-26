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

  const inputClass = 'w-full bg-[#FAFAFA] border border-black/10 hover:border-black/30 focus:border-[#111111] focus:bg-white rounded-xl pl-11 pr-11 py-3 text-[#111111] focus:outline-none transition-all placeholder:text-black/20 disabled:opacity-60'

  return (
    <div className="min-h-dvh bg-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Fine accent grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.035)_1px,transparent_1px)] bg-[size:4rem_4rem]" />
      {/* Soft background orbs */}
      <div className="absolute top-[-20%] left-[-20%] w-[600px] h-[600px] bg-black/[0.04] rounded-full blur-[150px] animate-pulse" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[600px] h-[600px] bg-black/[0.04] rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }} />

      {/* Card */}
      <div className="relative z-10 w-full max-w-[360px] bg-white border border-black/10 rounded-[2rem] px-7 py-8 shadow-[0_24px_60px_rgba(0,0,0,0.08)] overflow-hidden group flex flex-col items-center text-center">
        <div className="absolute top-0 left-0 right-0 h-1 bg-[#111111]" />

        {/* Logo with glow */}
        <div className="relative group mb-5">
          <div className="absolute -inset-1 bg-black rounded-2xl blur opacity-15 group-hover:opacity-25 transition duration-1000 group-hover:duration-200" />
          <div className="relative w-20 h-20 bg-white rounded-2xl border border-black/10 shadow-md overflow-hidden flex items-center justify-center">
            <img src={logoUrl} alt={`${shopName} Logo`} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
          </div>
        </div>

        <h1 className="text-2xl font-serif text-[#111111] tracking-tight leading-tight mb-1.5">{shopName}</h1>
        <p className="text-[#111111]/50 text-[11px] font-bold uppercase tracking-[0.2em] mb-7">POS Terminal</p>

        <form onSubmit={handleSubmit} noValidate className="w-full space-y-5 text-left">
          <div className="space-y-2">
            <label htmlFor="login-id" className="block text-[9px] font-bold text-[#111111] uppercase tracking-[0.25em] ml-1">Login ID</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#111111]"><User className="w-4 h-4" /></div>
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

          <div className="space-y-2">
            <label htmlFor="login-passcode" className="block text-[9px] font-bold text-[#111111] uppercase tracking-[0.25em] ml-1">Security Passcode</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#111111]"><Lock className="w-4 h-4" /></div>
              <input
                id="login-passcode"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className={`${inputClass} font-mono tracking-widest text-base`}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-black/40 hover:text-[#111111] transition-colors cursor-pointer"
                aria-label={showPassword ? 'Hide passcode' : 'Show passcode'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-xs text-[#DC2626] font-bold mt-2 ml-1" role="alert">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-[var(--accent)] hover:brightness-105 active:scale-[0.98] text-white rounded-xl font-bold text-xs uppercase tracking-[0.2em] transition-all shadow-[0_10px_24px_var(--accent-a30)] flex items-center justify-center gap-3 mt-2 group cursor-pointer disabled:opacity-70"
          >
            {loading ? (
              <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" /> Authenticating</>
            ) : (
              <>Authenticate <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform text-white" /></>
            )}
          </button>
        </form>

        <div className="mt-7 inline-flex items-center gap-2 px-3 py-1 bg-black/[0.04] border border-black/10 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-[#111111] animate-pulse" />
          <span className="text-[8px] font-bold text-[#111111] tracking-[0.15em] uppercase">System Online • Encrypted</span>
        </div>
      </div>

      <div className="relative z-10 mt-5 text-[#111111]/40 text-[9px] font-bold tracking-widest uppercase">{shopName} Terminal v1.0</div>

      {/* Install banner: login page only */}
      <InstallBanner shopName={shopName} logo={logoUrl} />
    </div>
  )
}
