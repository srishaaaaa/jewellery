import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, KeyRound, Lock, Mail, Phone, User } from 'lucide-react'
import { useSettingsStore } from '../../store/store'
import { BRAND_EN, BRAND_LOGO } from '../../lib/brand'
import { supabase } from '../../lib/supabase'
import { changePasswordWithToken, passwordLogin, readPortalSession, requestEmailOtp, requestOtp, resetPassword, savePortalSession, verifyEmailOtp, verifyOtp, type PortalSession } from '../../lib/customerPortal'

const field = 'w-full rounded-xl border border-black/15 bg-white py-3 pl-11 pr-3 text-base font-semibold outline-none focus:border-[#111111]'
const primary = 'w-full rounded-xl bg-[#111111] py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50 cursor-pointer'
const fieldLabel = 'mb-1.5 block text-[10px] font-black uppercase tracking-wider text-black/60'
const icon = 'absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40'
const PASSWORD_RULE = 'At least 8 characters. Not your mobile number.'

type Step = 'start' | 'otp' | 'register' | 'forgot' | 'forgot_code' | 'set_new'
const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message.replace(/^.*?:\s/, '') : fallback)
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())
const mobile10 = (s: string) => s.replace(/\D/g, '').slice(-10)

function PasswordField({ label, value, onChange, show, onToggle, autoComplete, autoFocus }: { label: string; value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; autoComplete: string; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className={fieldLabel}>{label}</span>
      <span className="relative block"><Lock className={icon} />
        <input type={show ? 'text' : 'password'} autoComplete={autoComplete} autoFocus={autoFocus} className={`${field} pr-11`} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={onToggle} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-black/50 cursor-pointer">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  )
}

/** Customer login: password, or a code by SMS or email. Forgot password: a code, then a new password. Unregistered numbers can ask the shop to register them. */
export default function PortalLogin() {
  const navigate = useNavigate()
  const settings = useSettingsStore((s) => s.settings)
  const [method, setMethod] = useState<'password' | 'mobile' | 'email'>('password')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [step, setStep] = useState<Step>('start')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [regName, setRegName] = useState('')
  // Held here, not saved, until the shop's starting password has been replaced.
  const [pending, setPending] = useState<PortalSession | null>(null)

  useEffect(() => { if (readPortalSession()) navigate('/customer/dashboard', { replace: true }) }, [navigate])
  useEffect(() => {
    if (step !== 'otp' && step !== 'forgot_code') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [step])

  const goTo = (next: Step) => { setStep(next); setError(''); setNotice(''); setCode(''); setNewPassword(''); setConfirm(''); setShow(false) }
  const enter = () => navigate('/customer/dashboard', { replace: true })
  const digits = mobile10(phone)
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const started = (seconds: number) => { setResendAt(Date.now() + seconds * 1000); setNow(Date.now()) }

  const newPasswordProblem = () => {
    if (newPassword.length < 8) return 'The password must have at least 8 characters.'
    if (newPassword !== confirm) return 'The two passwords do not match.'
    return ''
  }

  const signIn = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setNotice('')
    if (!login.trim() || !password) { setError('Enter your mobile number or email, and your password.'); return }
    setBusy(true)
    try {
      const r = await passwordLogin(login.trim(), password)
      if (r.mustChange) { setPending(r.session); goTo('set_new'); setNotice('Welcome! Please choose your own password to continue.'); return }
      savePortalSession(r.session); enter()
    } catch (err) { setError(errText(err, 'Could not log you in.')) } finally { setBusy(false) }
  }

  const replaceStarting = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    const problem = newPasswordProblem()
    if (problem) { setError(problem); return }
    if (!pending) return
    setBusy(true)
    try { await changePasswordWithToken(pending.token, password, newPassword); savePortalSession(pending); enter() }
    catch (err) { setError(errText(err, 'Could not save the password.')) } finally { setBusy(false) }
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    setError(''); setNotice('')
    if (method === 'email') {
      if (!isEmail(email)) { setError('Enter your email address.'); return }
      setBusy(true)
      const r = await requestEmailOtp(email.trim())
      setBusy(false)
      if (!r.ok) { setError(r.message); return }
      setStep('otp'); started(r.resendIn)
      setNotice('If this email is on a customer account, we have sent a login link and a code. Press the link, or enter the code here. Check your spam folder too.')
      return
    }
    if (!/^[6-9]\d{9}$/.test(digits)) { setError('Enter your 10-digit mobile number.'); return }
    setBusy(true)
    const r = await requestOtp(digits)
    setBusy(false)
    if (r.ok) { setStep('otp'); started(r.resendIn); setNotice(`OTP sent to +91 ${digits}. It is valid for ${Math.round(r.expiresIn / 60)} minutes.`); return }
    if (r.code === 'NOT_REGISTERED') { setStep('register'); return }
    setError(r.message)
  }
  const verify = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code.trim())) { setError(method === 'email' ? 'Enter the 6-digit code.' : 'Enter the 6-digit OTP.'); return }
    setBusy(true)
    try { await (method === 'email' ? verifyEmailOtp(email.trim(), code.trim()) : verifyOtp(digits, code.trim())); enter() } catch (err) { setError(errText(err, 'Could not verify the OTP.')) } finally { setBusy(false) }
  }
  const register = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    const { error: err } = await supabase.rpc('request_customer_registration', { p_phone: digits, p_name: regName })
    setBusy(false)
    if (err) { setError(err.message); return }
    goTo('start'); setNotice('Thank you! The shop will register your number. You can log in once that is done.')
  }

  const sendReset = async (e?: FormEvent) => {
    e?.preventDefault()
    setError(''); setNotice('')
    const typed = login.trim()
    const byEmail = typed.includes('@')
    if (byEmail ? !isEmail(typed) : !/^[6-9]\d{9}$/.test(mobile10(typed))) { setError('Enter your mobile number or email.'); return }
    setBusy(true)
    const r = byEmail ? await requestEmailOtp(typed, 'reset') : await requestOtp(mobile10(typed))
    setBusy(false)
    if (r.ok) {
      setStep('forgot_code'); started(r.resendIn)
      setNotice(byEmail ? 'If this email is on a customer account, a code has been sent. Check your spam folder too.' : `Code sent to +91 ${mobile10(typed)}.`)
      return
    }
    if (r.code === 'NOT_REGISTERED') { setError('This mobile number is not registered with the shop.'); return }
    if (r.code === 'NOT_CONFIGURED') { setError('Reset codes are not switched on yet. Please ask the shop to reset your password.'); return }
    setError(r.message)
  }
  const finishReset = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code.'); return }
    const problem = newPasswordProblem()
    if (problem) { setError(problem); return }
    setBusy(true)
    try { await resetPassword(login.trim(), code.trim(), newPassword); enter() }
    catch (err) { setError(errText(err, 'Could not reset the password.')) } finally { setBusy(false) }
  }

  return (
    <div className="min-h-dvh h-dvh overflow-y-auto bg-[#FAFAF7] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-[2rem] border border-black/10 bg-white px-7 py-8 shadow-[0_24px_60px_rgba(0,0,0,0.08)]">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={settings?.logoUrl || BRAND_LOGO} alt="" className="mb-3 h-20 w-20 rounded-2xl border border-black/10 object-contain" />
          <h1 className="text-xl font-black">{settings?.name || BRAND_EN}</h1>
          <p className="text-xs font-semibold text-black/60">Customer portal — your schemes, bills and payments</p>
        </div>
        {notice && <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">{notice}</p>}
        {error && <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}

        {step === 'start' && (
          <>
            <div role="tablist" aria-label="How to log in" className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-black/5 p-1">
              {([['password', 'Password', Lock], ['mobile', 'Mobile OTP', Phone], ['email', 'Email', Mail]] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" role="tab" aria-selected={method === value} onClick={() => { setMethod(value); setError(''); setNotice('') }}
                  className={`flex items-center justify-center gap-1 rounded-lg px-1 py-2 text-[10px] font-black uppercase tracking-wide cursor-pointer ${method === value ? 'bg-white text-black shadow-sm' : 'text-black/60'}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
                </button>
              ))}
            </div>
            {method === 'password' ? (
              <form onSubmit={signIn} className="space-y-4">
                <label className="block">
                  <span className={fieldLabel}>Mobile number or email</span>
                  <span className="relative block"><User className={icon} />
                    <input autoComplete="username" className={field} placeholder="98765 43210" value={login} onChange={(e) => setLogin(e.target.value)} /></span>
                </label>
                <PasswordField label="Password" value={password} onChange={setPassword} show={show} onToggle={() => setShow(!show)} autoComplete="current-password" />
                <button disabled={busy} className={primary}>{busy ? 'Checking…' : 'Login'}</button>
                <button type="button" onClick={() => goTo('forgot')} className="w-full text-center text-[11px] font-bold underline cursor-pointer">Forgot password?</button>
              </form>
            ) : (
              <form onSubmit={send} className="space-y-4">
                {method === 'mobile' ? (
                  <label className="block">
                    <span className={fieldLabel}>Registered mobile number</span>
                    <span className="relative block"><Phone className={icon} />
                      <input inputMode="numeric" autoComplete="tel" className={field} placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} /></span>
                  </label>
                ) : (
                  <label className="block">
                    <span className={fieldLabel}>Email on your account</span>
                    <span className="relative block"><Mail className={icon} />
                      <input type="email" inputMode="email" autoComplete="email" className={field} placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></span>
                  </label>
                )}
                <button disabled={busy} className={primary}>{busy ? 'Sending…' : method === 'email' ? 'Email Me a Login Link' : 'Generate OTP'}</button>
              </form>
            )}
          </>
        )}
        {step === 'otp' && (
          <form onSubmit={verify} className="space-y-4">
            <label className="block">
              <span className={fieldLabel}>{method === 'email' ? `Code for ${email.trim()}` : `OTP sent to +91 ${digits}`}</span>
              <span className="relative block"><KeyRound className={icon} />
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${field} tracking-[0.4em]`} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></span>
            </label>
            <button disabled={busy} className={primary}>{busy ? 'Checking…' : 'Verify & Login'}</button>
            <div className="flex justify-between text-[11px] font-bold">
              <button type="button" onClick={() => goTo('start')} className="text-black/60 underline cursor-pointer">{method === 'email' ? 'Change email' : 'Change number'}</button>
              <button type="button" disabled={wait > 0 || busy} onClick={() => void send()} className="underline disabled:no-underline disabled:text-black/40 cursor-pointer">{wait > 0 ? `Resend in ${wait}s` : method === 'email' ? 'Resend code' : 'Resend OTP'}</button>
            </div>
          </form>
        )}
        {step === 'forgot' && (
          <form onSubmit={sendReset} className="space-y-4">
            <h2 className="text-sm font-black">Reset your password</h2>
            <p className="text-xs font-semibold text-black/60">We will send a code to your mobile or email.</p>
            <label className="block">
              <span className={fieldLabel}>Mobile number or email</span>
              <span className="relative block"><User className={icon} />
                <input autoComplete="username" className={field} placeholder="98765 43210" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus /></span>
            </label>
            <button disabled={busy} className={primary}>{busy ? 'Sending…' : 'Send Code'}</button>
            <button type="button" onClick={() => goTo('start')} className="w-full text-[11px] font-bold text-black/60 underline cursor-pointer">Back to login</button>
          </form>
        )}
        {step === 'forgot_code' && (
          <form onSubmit={finishReset} className="space-y-4">
            <label className="block">
              <span className={fieldLabel}>6-digit code</span>
              <span className="relative block"><KeyRound className={icon} />
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={`${field} tracking-[0.4em]`} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></span>
            </label>
            <PasswordField label="New password" value={newPassword} onChange={setNewPassword} show={show} onToggle={() => setShow(!show)} autoComplete="new-password" />
            <PasswordField label="New password again" value={confirm} onChange={setConfirm} show={show} onToggle={() => setShow(!show)} autoComplete="new-password" />
            <p className="text-[11px] font-semibold text-black/60">{PASSWORD_RULE}</p>
            <button disabled={busy} className={primary}>{busy ? 'Saving…' : 'Save & Login'}</button>
            <div className="flex justify-between text-[11px] font-bold">
              <button type="button" onClick={() => goTo('start')} className="text-black/60 underline cursor-pointer">Back to login</button>
              <button type="button" disabled={wait > 0 || busy} onClick={() => void sendReset()} className="underline disabled:no-underline disabled:text-black/40 cursor-pointer">{wait > 0 ? `Resend in ${wait}s` : 'Resend code'}</button>
            </div>
          </form>
        )}
        {step === 'set_new' && (
          <form onSubmit={replaceStarting} className="space-y-4">
            <PasswordField label="New password" value={newPassword} onChange={setNewPassword} show={show} onToggle={() => setShow(!show)} autoComplete="new-password" autoFocus />
            <PasswordField label="New password again" value={confirm} onChange={setConfirm} show={show} onToggle={() => setShow(!show)} autoComplete="new-password" />
            <p className="text-[11px] font-semibold text-black/60">{PASSWORD_RULE}</p>
            <button disabled={busy} className={primary}>{busy ? 'Saving…' : 'Save & Continue'}</button>
          </form>
        )}
        {step === 'register' && (
          <form onSubmit={register} className="space-y-4">
            <p className="text-xs font-semibold">+91 {digits} is not registered with the shop yet. Leave your name and the shop will add you, or ask at the counter.</p>
            <input className="w-full rounded-xl border border-black/15 px-3 py-3 text-sm font-semibold outline-none focus:border-[#111111]" placeholder="Your name" value={regName} onChange={(e) => setRegName(e.target.value)} />
            <button disabled={busy} className={primary}>Ask the shop to register me</button>
            <button type="button" onClick={() => goTo('start')} className="w-full text-[11px] font-bold text-black/60 underline cursor-pointer">Back</button>
          </form>
        )}
      </div>
    </div>
  )
}
