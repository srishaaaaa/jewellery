import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Mail, Phone } from 'lucide-react'
import { useSettingsStore } from '../../store/store'
import { BRAND_EN, BRAND_LOGO } from '../../lib/brand'
import { supabase } from '../../lib/supabase'
import { readPortalSession, requestEmailOtp, requestOtp, verifyEmailOtp, verifyOtp } from '../../lib/customerPortal'

const field = 'w-full rounded-xl border border-black/15 bg-white py-3 pl-11 pr-3 text-base font-semibold outline-none focus:border-[#111111]'

/** Customer login: a code to the mobile number (SMS) or the email on the account -> dashboard. Unregistered numbers can ask the shop to register them. */
export default function PortalLogin() {
  const navigate = useNavigate()
  const settings = useSettingsStore((s) => s.settings)
  const [method, setMethod] = useState<'mobile' | 'email'>('mobile')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'otp' | 'register'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [regName, setRegName] = useState('')

  useEffect(() => { if (readPortalSession()) navigate('/customer/dashboard', { replace: true }) }, [navigate])
  useEffect(() => {
    if (step !== 'otp') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [step])

  const digits = phone.replace(/\D/g, '').slice(-10)
  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    setError(''); setNotice('')
    if (method === 'email') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError('Enter your email address.'); return }
      setBusy(true)
      const r = await requestEmailOtp(email.trim())
      setBusy(false)
      if (!r.ok) { setError(r.message); return }
      setStep('otp'); setResendAt(Date.now() + r.resendIn * 1000); setNow(Date.now())
      setNotice('If this email is on a customer account, a code has been sent. Check your spam folder too.')
      return
    }
    if (!/^[6-9]\d{9}$/.test(digits)) { setError('Enter your 10-digit mobile number.'); return }
    setBusy(true)
    const r = await requestOtp(digits)
    setBusy(false)
    if (r.ok) { setStep('otp'); setResendAt(Date.now() + r.resendIn * 1000); setNow(Date.now()); setNotice(`OTP sent to +91 ${digits}. It is valid for ${Math.round(r.expiresIn / 60)} minutes.`); return }
    if (r.code === 'NOT_REGISTERED') { setStep('register'); return }
    setError(r.message)
  }
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code.trim())) { setError(method === 'email' ? 'Enter the 6-digit code.' : 'Enter the 6-digit OTP.'); return }
    setBusy(true)
    try { await (method === 'email' ? verifyEmailOtp(email.trim(), code.trim()) : verifyOtp(digits, code.trim())); navigate('/customer/dashboard', { replace: true }) } catch (err) { setError(err instanceof Error ? err.message.replace(/^.*?:\s/, '') : 'Could not verify the OTP.') } finally { setBusy(false) }
  }
  const register = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { error: err } = await supabase.rpc('request_customer_registration', { p_phone: digits, p_name: regName })
    setBusy(false)
    if (err) { setError(err.message); return }
    setStep('phone'); setNotice('Thank you! The shop will register your number. You can log in once that is done.')
  }
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))

  return (
    <div className="min-h-dvh h-dvh overflow-y-auto bg-[#FAFAF7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[2rem] border border-black/10 bg-white px-7 py-8 shadow-[0_24px_60px_rgba(0,0,0,0.08)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={settings?.logoUrl || BRAND_LOGO} alt="" className="mb-3 h-20 w-20 rounded-2xl border border-black/10 object-contain" />
          <h1 className="text-xl font-black">{settings?.name || BRAND_EN}</h1>
          <p className="text-xs font-semibold text-black/60">Customer portal — your schemes, bills and payments</p>
        </div>
        {notice && <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}
        {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

        {step === 'phone' && (
          <form onSubmit={send} className="space-y-4">
            <div role="tablist" aria-label="How to log in" className="grid grid-cols-2 gap-1 rounded-xl bg-black/5 p-1">
              {([['mobile', 'Mobile OTP', Phone], ['email', 'Email', Mail]] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" role="tab" aria-selected={method === value} onClick={() => { setMethod(value); setError(''); setNotice('') }}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-black uppercase tracking-wider cursor-pointer ${method === value ? 'bg-white text-black shadow-sm' : 'text-black/60'}`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            {method === 'mobile' ? (
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-black/60">Registered mobile number</span>
                <span className="relative block"><Phone className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
                  <input inputMode="numeric" autoComplete="tel" className={field} placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} /></span>
              </label>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-black/60">Email on your account</span>
                <span className="relative block"><Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
                  <input type="email" inputMode="email" autoComplete="email" className={field} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></span>
              </label>
            )}
            <button disabled={busy} className="w-full rounded-xl bg-[#111111] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">{busy ? 'Sending…' : method === 'email' ? 'Email Me a Code' : 'Generate OTP'}</button>
          </form>
        )}
        {step === 'otp' && (
          <form onSubmit={verify} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-black/60">{method === 'email' ? `Code for ${email.trim()}` : `OTP sent to +91 ${digits}`}</span>
              <span className="relative block"><KeyRound className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${field} tracking-[0.4em]`} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></span>
            </label>
            <button disabled={busy} className="w-full rounded-xl bg-[#111111] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">{busy ? 'Checking…' : 'Verify & Login'}</button>
            <div className="flex justify-between text-[11px] font-bold">
              <button type="button" onClick={() => { setStep('phone'); setCode(''); setNotice('') }} className="text-black/60 underline cursor-pointer">{method === 'email' ? 'Change email' : 'Change number'}</button>
              <button type="button" disabled={wait > 0 || busy} onClick={() => void send()} className="underline disabled:no-underline disabled:text-black/40 cursor-pointer">{wait > 0 ? `Resend in ${wait}s` : method === 'email' ? 'Resend code' : 'Resend OTP'}</button>
            </div>
          </form>
        )}
        {step === 'register' && (
          <form onSubmit={register} className="space-y-4">
            <p className="text-xs font-semibold">+91 {digits} is not registered with the shop yet. Leave your name and the shop will add you, or ask at the counter.</p>
            <input className="w-full rounded-xl border border-black/15 px-3 py-3 text-sm font-semibold outline-none focus:border-[#111111]" placeholder="Your name" value={regName} onChange={(e) => setRegName(e.target.value)} />
            <button disabled={busy} className="w-full rounded-xl bg-[#111111] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50">Ask the shop to register me</button>
            <button type="button" onClick={() => setStep('phone')} className="w-full text-[11px] font-bold text-black/60 underline cursor-pointer">Back</button>
          </form>
        )}
      </div>
    </div>
  )
}
