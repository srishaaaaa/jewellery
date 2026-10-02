/**
 * Login / Sign-up — Email Magic Link primary, Google OAuth below
 */
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Mail, ArrowLeft, CheckCircle, User, Phone as PhoneIcon } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { BRAND_EN, BRAND_TA, BRAND_LOGO } from '../lib/brand'
import { isValidPhone, getSubscriberDigits } from '../lib/phone'
import { useLangStore } from '../store/langStore'
import { useSettingsStore } from '../store/store'

const SITE_URL =
  (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') ||
  window.location.origin

type EmailStep = 'input' | 'sent'

interface FieldError {
  name?: string
  phone?: string
  email?: string
}

function validate(name: string, phone: string, email: string): FieldError {
  const errs: FieldError = {}
  if (!name.trim() || name.trim().length < 2)
    errs.name = 'Please enter your full name (at least 2 characters).'
  if (!isValidPhone(phone))
    errs.phone = 'Enter a valid Indian mobile number (e.g. 9876543210 or +91 9876543210).'
  if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    errs.email = 'Enter a valid email address.'
  return errs
}

export default function Login() {
  const location   = useLocation()
  const { lang } = useLangStore()
  const l = (en: string, ta: string) => lang === 'ta' ? ta : en
  const redirectPath = new URLSearchParams(location.search).get('redirect') || '/'
  const storeSettings = useSettingsStore(s => s.settings)
  const logoUrl = storeSettings?.logoUrl || BRAND_LOGO
  const shopName = storeSettings?.name || BRAND_EN

  const [loading,   setLoading]   = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error,     setError]     = useState('')
  const [fieldErrs, setFieldErrs] = useState<FieldError>({})
  const [email,     setEmail]     = useState('')
  const [name,      setName]      = useState('')
  const [phone,     setPhone]     = useState('')
  const [emailStep, setEmailStep] = useState<EmailStep>('input')

  /* ── Google ──────────────────────────────────────────────────── */
  const handleGoogle = async () => {
    if (!isSupabaseConfigured) { setError('Authentication not configured.'); return }
    setGoogleLoading(true); setError('')
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: SITE_URL,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (e) { setError(e.message); setGoogleLoading(false) }
  }

  /* ── Email: send magic link ──────────────────────────────────── */
  const handleSendLink = async (e: React.FormEvent) => {
    e.preventDefault()
    const rawErrs = validate(name, phone, email)
    if (Object.keys(rawErrs).length > 0) {
      setFieldErrs({
        name:  rawErrs.name  ? l('Please enter your full name (at least 2 characters).', 'உங்கள் முழு பெயரை உள்ளிடவும் (குறைந்தது 2 எழுத்துக்கள்).') : undefined,
        phone: rawErrs.phone ? l('Enter a valid Indian mobile number (e.g. 9876543210).', 'சரியான இந்திய மொபைல் எண் உள்ளிடவும்.') : undefined,
        email: rawErrs.email ? l('Enter a valid email address.', 'சரியான மின்னஞ்சல் உள்ளிடவும்.') : undefined,
      })
      return
    }
    if (!isSupabaseConfigured) { setError('Authentication not configured.'); return }

    setLoading(true); setError(''); setFieldErrs({})
    const subscriberDigits = getSubscriberDigits(phone) ?? phone.replace(/\D/g, '')
    const { error: e2 } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        shouldCreateUser: true,
        emailRedirectTo: SITE_URL,
        data: { name: name.trim(), full_name: name.trim(), mobile: subscriberDigits },
      },
    })
    setLoading(false)
    if (e2) { setError(e2.message); return }
    setEmailStep('sent')
  }

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="bg-gradient-to-br from-[#eaf2e5] to-[#F9FAFB] h-full overflow-y-auto flex p-4">
      <div className="m-auto bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-sand/40 w-full max-w-md">

        {/* Brand */}
        <div className="flex flex-col items-center mb-6">
          <div className="mb-3 inline-flex items-center justify-center w-12 h-12 rounded-full overflow-hidden border border-[var(--accent-a40)] shadow-md">
            <img src={logoUrl} alt={shopName} className="w-full h-full object-cover" />
          </div>
          <h1 className="text-xl font-bold font-headline text-textMain text-center">{shopName}</h1>
          <p className="text-[12px] text-textMuted mt-0.5 text-center">{BRAND_TA}</p>
          {redirectPath !== '/' && (
            <p className="mt-2.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full">
              Sign in to continue
            </p>
          )}
        </div>

        {/* Server-level error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-[12px] mb-4">
            {error}
          </div>
        )}

        {/* ═══ EMAIL — step 1: form ══════════════════════════════ */}
        {emailStep === 'input' && (
          <form onSubmit={handleSendLink} noValidate className="space-y-4">
            <p className="text-[13px] font-bold text-textMain">{l('Sign in with Email', 'மின்னஞ்சல் மூலம் உள்நுழைவு')}</p>

            {/* Full Name */}
            <FieldGroup label={l('Full Name', 'முழு பெயர்')} icon={<User size={14} />} required error={fieldErrs.name}>
              <input
                type="text" autoComplete="name"
                placeholder="e.g. Priya Krishnamurthy"
                className={inputCls(!!fieldErrs.name)}
                value={name}
                onChange={e => { setName(e.target.value); setFieldErrs(f => ({ ...f, name: '' })) }}
              />
            </FieldGroup>

            {/* Mobile Number */}
            <FieldGroup label={l('Mobile Number', 'மொபைல் எண்')} icon={<PhoneIcon size={14} />} required error={fieldErrs.phone} hint={l('10-digit Indian mobile', '10 இலக்க மொபைல்')}>
              <div className="flex gap-2">
                <span className="flex items-center px-3 py-3.5 bg-[#F9FAFB] border-2 border-sand rounded-xl text-[13px] font-bold text-textMuted shrink-0 select-none">
                  🇮🇳 +60
                </span>
                <input
                  type="tel" autoComplete="tel-national"
                  placeholder="9876543210 or +91 9876543210"
                  className={`flex-1 ${inputCls(!!fieldErrs.phone)}`}
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setFieldErrs(f => ({ ...f, phone: '' })) }}
                />
              </div>
            </FieldGroup>

            {/* Email */}
            <FieldGroup label={l('Email Address', 'மின்னஞ்சல் முகவரி')} icon={<Mail size={14} />} required error={fieldErrs.email}>
              <input
                type="email" autoComplete="email"
                placeholder="you@example.com"
                className={inputCls(!!fieldErrs.email)}
                value={email}
                onChange={e => { setEmail(e.target.value); setFieldErrs(f => ({ ...f, email: '' })) }}
              />
            </FieldGroup>

            <button type="submit" disabled={loading}
              className="w-full bg-sageDark hover:bg-sageDeep text-white font-bold py-4 rounded-xl transition-colors disabled:opacity-60 flex items-center justify-center gap-2 min-h-[48px]">
              {loading
                ? <><Spinner /> {l('Sending link…', 'அனுப்புகிறது...')}</>
                : <><Mail size={15} /> {l('Send Magic Link', 'இணைப்பு அனுப்பு')}</>
              }
            </button>

            <p className="text-center text-[11px] text-gray-400 leading-relaxed">
              We'll send a one-click sign-in link to your inbox.<br />
              No password needed. Works for sign-up and sign-in.
            </p>

            {/* Divider */}
            <div className="relative flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-sand/60" />
              <span className="text-[11px] text-textMuted font-medium shrink-0">{l('or', 'அல்லது')}</span>
              <div className="flex-1 h-px bg-sand/60" />
            </div>

            {/* Google — positioned below email fields */}
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 bg-white border-2 border-[#E5E7EB] hover:border-sageDark text-textMain font-bold py-4 rounded-xl transition-all disabled:opacity-60 shadow-sm hover:shadow-md active:scale-[0.98] min-h-[48px]"
            >
              {googleLoading ? <Spinner /> : <GoogleIcon size={20} />}
              {googleLoading ? l('Redirecting to Google…','Google க்கு செல்கிறது...') : l('Continue with Google','Google மூலம் தொடர')}
            </button>

            <p className="text-center text-[11px] text-gray-400 leading-relaxed">
              Google sign-in creates an account automatically.<br />
              Add your phone number from Profile after signing in.
            </p>
          </form>
        )}

        {/* ═══ EMAIL — step 2: link sent ════════════════════════ */}
        {emailStep === 'sent' && (
          <div className="text-center space-y-5">
            <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle size={32} className="text-green-500" />
            </div>
            <div>
              <h3 className="font-bold text-textMain text-[15px] mb-1">{l('Check your inbox!', 'உங்கள் inbox பாருங்கள்!')}</h3>
              <p className="text-[13px] text-textMuted leading-relaxed">
                A magic sign-in link was sent to<br />
                <strong className="text-sageDark">{email}</strong>
              </p>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Click the link to sign in instantly.<br />
              Valid for 60 minutes. Check spam if not received.
            </p>

            <button type="button"
              onClick={() => { setEmailStep('input'); setError('') }}
              className="flex items-center justify-center gap-1.5 text-[12px] text-textMuted hover:text-textMain mx-auto">
              <ArrowLeft size={13} /> {l('Use a different email', 'வேறு மின்னஞ்சல்')}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-5 border-t border-sand/50 text-center">
          <p className="text-[11px] text-gray-400">
            {l('First time here? Your account is created automatically on sign-in.', 'முதல் முறையா? உள்நுழைவில் கணக்கு தானாக உருவாகும்.')}
          </p>
        </div>
      </div>
    </div>
  )
}

/* ── Module-level helpers ─────────────────────────────────────────── */

const inputCls = (hasError: boolean) =>
  `w-full px-4 py-3.5 rounded-xl border-2 outline-none text-[13px] transition-colors ${
    hasError
      ? 'border-red-400 focus:border-red-500 bg-red-50/30'
      : 'border-sand focus:border-sageDark'
  }`

function FieldGroup({
  label, icon, required, error, hint, children,
}: {
  label: string
  icon: React.ReactNode
  required?: boolean
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[12px] font-bold text-textMuted uppercase tracking-wide mb-1.5">
        {icon}
        {label}
        {required && <span className="text-red-500 font-black">*</span>}
        {hint && <span className="ml-auto font-normal normal-case text-[11px] text-gray-400">{hint}</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-[11px] text-red-500 font-medium flex items-center gap-1">
          <span className="shrink-0">⚠</span> {error}
        </p>
      )}
    </div>
  )
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
}

function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}
