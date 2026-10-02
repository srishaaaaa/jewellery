import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Lock, Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react'
import { useAdminAuthStore, useSettingsStore } from '../store/store'
import { BRAND_EN, BRAND_TA, BRAND_SUBTITLE, BRAND_LOGO } from '../lib/brand'
import { useLangStore } from '../store/langStore'

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
    setLoading(true)
    const role = await login(portalId.trim(), password)
    setLoading(false)
    if (role === 'admin') {
      const destination = from === '/pos' ? '/dashboard' : from
      navigate(destination, { replace: true })
    } else if (role === 'staff') {
      navigate('/dashboard', { replace: true })
    } else {
      setError(l('Invalid Admin or Staff credentials', 'தவறான நிர்வாகி அல்லது பணியாளர் விவரங்கள்'))
    }
  }

  return (
    <div className="relative h-dvh max-h-dvh min-h-dvh overflow-y-auto lg:overflow-hidden bg-white p-3 sm:p-5 lg:p-6 font-sans flex items-center justify-center">
      <div className="relative grid w-full max-w-4xl max-h-[92vh] overflow-hidden rounded-3xl border border-gray-200/90 bg-[#141414] shadow-[0_25px_60px_-12px_rgba(0,0,0,0.25),0_12px_28px_-6px_rgba(0,0,0,0.15)] lg:grid-cols-[0.85fr_1.15fr]">
        <div className="hidden flex-col justify-between bg-[#0A0A0A] border-r border-[var(--accent-a20)] p-6 lg:p-8 text-white lg:flex overflow-y-auto hide-scrollbar">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-2xl bg-[#141414] border border-[var(--accent-a40)] px-3.5 py-2 shadow-xl">
              <span className="w-6 h-6 rounded-full overflow-hidden shrink-0"><img src={logoUrl} alt={shopName} className="w-full h-full object-cover" /></span>
              <span className="text-xs font-black tracking-widest text-white uppercase">{shopName}</span>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-[var(--accent)]">{BRAND_SUBTITLE}</p>
            <h2 className="mt-3 max-w-xs text-2xl lg:text-3xl font-black leading-tight tracking-tight text-white">Everything you need to run retail billing clearly.</h2>
            <p className="mt-3.5 max-w-sm text-xs leading-6 text-white/70">Manage barcodes, SKU variants, inventory ledger, POS billing, invoices, and customer communications from one secure portal.</p>
          </div>
          <div className="mt-6 flex items-center gap-2 text-xs font-bold text-[var(--accent)]"><ShieldCheck size={15} /> Secure retail workspace</div>
        </div>
        <div className="p-5 sm:p-7 lg:p-8 bg-white text-[#111111] overflow-y-auto hide-scrollbar flex flex-col justify-center">
          {/* Brand */}
          <div className="mb-4 sm:mb-5 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="mb-3 h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-[var(--accent-a40)] shadow-sm">
              <img src={logoUrl} alt={shopName} className="h-full w-full object-cover" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--accent-dark)]">{BRAND_SUBTITLE}</p>
            <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#0A0A0A]">{shopName}</h1>
            <p className="mt-0.5 text-xs font-semibold text-[#7A786F]">{BRAND_TA}</p>
            <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[#FBFAF6] px-3 py-1 text-[10px] font-black uppercase tracking-wider text-[#0A0A0A]">
              <ShieldCheck size={12} className="text-[var(--accent-dark)]" />
              {l('Admin / Staff Portal', 'நிர்வாக நுழைவு')}
            </p>
          </div>

          {/* Server-level error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-3.5 py-2.5 rounded-xl text-[12px] mb-3.5 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
            <p className="text-xs font-bold text-[#111111]">{l('Enter your portal credentials', 'உங்கள் பயனர் விவரங்களை உள்ளிடவும்')}</p>

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#6B7280]">
                <ShieldCheck size={13} />
                Portal ID
                <span className="font-black text-red-500">*</span>
              </label>
              <input
                type="text"
                autoComplete="username"
                placeholder="Enter portal ID"
                className="w-full rounded-xl border-2 border-[#B7E1BE] bg-[#FBFAF6] px-3.5 py-3.5 sm:py-3.5 text-xs sm:text-sm font-semibold outline-none transition-colors placeholder:text-[#AAA69C] focus:border-[#0A0A0A] focus:bg-white text-[#111111] min-h-[44px]"
                value={portalId}
                onChange={(e) => { setPortalId(e.target.value); setError('') }}
                disabled={loading}
                required
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-[#6B7280] uppercase tracking-wide mb-1.5">
                <Lock size={13} />
                {l('Portal Password', 'நுழைவு கடவுச்சொல்')}
                <span className="text-red-500 font-black">*</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter portal password"
                  className="w-full rounded-xl border-2 border-[#B7E1BE] bg-[#FBFAF6] px-3.5 py-3.5 sm:py-3.5 pr-11 text-xs sm:text-sm font-semibold outline-none transition-colors placeholder:text-[#AAA69C] focus:border-[#0A0A0A] focus:bg-white text-[#111111] min-h-[44px]"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#F9FAFB] hover:text-[#111111] cursor-pointer"
                  aria-label={showPassword ? l('Hide password', 'கடவுச்சொல்லை மறை') : l('Show password', 'கடவுச்சொல்லை காட்டு')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#0A0A0A] border border-[var(--accent)] py-3.5 font-black text-xs sm:text-sm text-[var(--accent)] shadow-lg shadow-black/20 transition-all hover:bg-[#1A1A1A] hover:scale-[1.01] active:scale-[0.99] disabled:opacity-60 cursor-pointer min-h-[48px]"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-[var(--accent-a30)] border-t-[var(--accent)] rounded-full animate-spin inline-block" />
                  {l('Signing in...', 'உள்நுழைகிறது...')}
                </>
              ) : (
                <>
                  <Lock size={14} />
                  {l(`Sign In to ${shopName} Portal`, `${shopName} போர்ட்டலில் உள்நுழை`)}
                </>
              )}
            </button>

            <p className="text-center text-[10px] leading-relaxed text-[#888888]">
              {l('Enter your admin or staff credentials to access billing & inventory.', 'பில்லிங் மற்றும் சரக்கு இருப்பு நிர்வாகத்தை அணுக பயனர் விவரங்களை உள்ளிடவும்.')}
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
