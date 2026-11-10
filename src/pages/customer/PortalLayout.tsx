import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, BellOff, CreditCard, FileText, Gem, Home, LayoutGrid, LogOut, PiggyBank, QrCode, ShoppingBag, User, Volume2, VolumeX, X } from 'lucide-react'
import { useSettingsStore } from '../../store/store'
import { BRAND_EN, BRAND_LOGO } from '../../lib/brand'
import { PortalSessionExpired, portalLogout, portalRpc, readPortalSession, type PortalData, type PortalNotification } from '../../lib/customerPortal'
import { systemNotify } from '../../lib/systemNotify'
import { supabase } from '../../lib/supabase'
import { syncPushOwner } from '../../lib/portalPush'

export type PortalContext = { data: PortalData | null; notifications: PortalNotification[]; refresh: () => Promise<void>; loading: boolean; error: string }

const SOUND_KEY = 'jewellery_portal_sound'
const SEEN_KEY = 'jewellery_portal_seen'

const NAV = [
  ['/customer/dashboard', 'Home', Home], ['/customer/schemes', 'My Schemes', PiggyBank], ['/customer/purchases', 'My Purchases', ShoppingBag],
  ['/customer/bills', 'My Bills', FileText], ['/customer/pay-upi', 'Pay by UPI', QrCode], ['/customer/payments', 'Payments', CreditCard], ['/customer/notifications', 'Notifications', Bell],
  ['/customer/profile', 'Profile', User],
] as const

/** Short, soft two-note chime (only after the customer has turned sound on and clicked the page). */
function chime() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctor()
    const now = ctx.currentTime
    ;[[1046.5, 0], [1318.5, 0.16]].forEach(([f, t]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0, now + t); g.gain.linearRampToValueAtTime(0.18, now + t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.6)
      o.connect(g); g.connect(ctx.destination); o.start(now + t); o.stop(now + t + 0.65)
    })
    window.setTimeout(() => void ctx.close(), 1200)
  } catch { /* audio not allowed */ }
}

/** Customer portal shell: checks the session, loads the customer's data and watches for new notifications. */
export default function PortalLayout() {
  const navigate = useNavigate()
  const settings = useSettingsStore((s) => s.settings)
  const shopName = settings?.name || BRAND_EN
  const [session] = useState(readPortalSession)
  const [data, setData] = useState<PortalData | null>(null)
  const [notifications, setNotifications] = useState<PortalNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  const [sound, setSound] = useState(() => { try { return localStorage.getItem(SOUND_KEY) === 'on' } catch { return false } })
  const soundRef = useRef(sound)
  useEffect(() => { soundRef.current = sound }, [sound])

  const refresh = useCallback(async () => {
    try {
      const [d, n] = await Promise.all([portalRpc<PortalData>('customer_portal_data'), portalRpc<PortalNotification[]>('customer_notifications_list')])
      setData(d); setNotifications(n); setError('')
      // New unread notifications since last check: chime (if turned on) and a phone / desktop notification once
      let seen: string[] = []
      try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]') } catch { /* none */ }
      const fresh = n.filter((x) => !x.read_at && !seen.includes(x.id))
      if (fresh.length) {
        try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((x) => x.id)].slice(-300))) } catch { /* storage blocked */ }
        if (seen.length || sessionStorage.getItem('portal_first_load_done')) {
          if (soundRef.current) chime()
          void systemNotify(fresh[0].title, fresh.length > 1 ? `${fresh[0].body}\n+${fresh.length - 1} more` : fresh[0].body, 'portal-notice')
        }
      }
      try { sessionStorage.setItem('portal_first_load_done', '1') } catch { /* storage blocked */ }
    } catch (err) {
      if (err instanceof PortalSessionExpired) { navigate('/customer/login', { replace: true }); return }
      setError(err instanceof Error ? err.message : 'Could not load your details.')
    } finally { setLoading(false) }
  }, [navigate])

  useEffect(() => {
    if (!session) return
    let live = true
    const run = () => { if (live) void refresh() }
    run()
    const t = window.setInterval(run, 30000)
    const onFocus = () => run()
    window.addEventListener('focus', onFocus)
    void syncPushOwner()
    return () => { live = false; window.clearInterval(t); window.removeEventListener('focus', onFocus) }
  }, [session, refresh])

  // Instant reload when the shop does something for this customer. The signal holds no data; if it
  // cannot connect, the 30-second check above still catches everything.
  const liveTopic = data?.live_topic
  useEffect(() => {
    if (!liveTopic) return
    const channel = supabase.channel(`portal:${liveTopic}`).on('broadcast', { event: 'refresh' }, () => { void refresh() }).subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [liveTopic, refresh])

  if (!session) return <Navigate to="/customer/login" replace />

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off') } catch { /* storage blocked */ }
    if (next) { chime(); void systemNotify('Notifications on', 'You will be told about due dates, bills and payments here.', 'portal-test') }
  }
  const logout = async () => { await portalLogout(); navigate('/customer/login', { replace: true }) }
  const unread = notifications.filter((n) => !n.read_at).length

  const name = data?.customer.name || session.customer.name || 'Customer'
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'C'
  const navItem = ({ isActive }: { isActive: boolean }) =>
    `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-colors ${isActive ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-black/70 hover:bg-black/[0.04] hover:text-black'}`
  const iconBtn = 'relative flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-white hover:bg-black/5 cursor-pointer'
  const Badge = () => unread > 0 ? <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-black leading-none text-white">{unread}</span> : null

  return (
    <div className="min-h-dvh h-dvh overflow-y-auto bg-[#F8F4EE] text-[#111111]">
      <div className="flex w-full gap-6 lg:pr-6">
        {/* ── Desktop side menu ── */}
        <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-black/10 bg-white px-3 py-5 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <img src={settings?.logoUrl || BRAND_LOGO} alt="" className="h-11 w-11 rounded-xl border border-black/10 bg-white object-contain" />
            <div className="min-w-0">
              <p className="truncate text-sm font-black uppercase tracking-wider">{shopName}</p>
              <p className="text-[11px] font-semibold text-black/50">Customer account</p>
            </div>
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-black/10 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--accent)_16%,white),white_75%)] p-3 text-[#111111]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-black text-white">{initials}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-black">{name}</p>
              <p className="truncate text-[11px] font-semibold text-black/60">ID {data?.customer.code.toUpperCase() || '—'}</p>
            </div>
          </div>
          <nav className="mt-5 flex flex-col gap-1">
            {NAV.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} className={navItem}>
                <Icon className="h-[18px] w-[18px] shrink-0" /> {label}
                {to === '/customer/notifications' && <Badge />}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto flex items-center gap-2 px-1 pt-4">
            <button type="button" onClick={toggleSound} title={sound ? 'Mute notification sound' : 'Turn on notification sound'} className={iconBtn}>
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-black/50" />}
            </button>
            <button type="button" onClick={() => void logout()} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-black/10 bg-white py-2 text-[11px] font-black uppercase tracking-wider hover:bg-black/5 cursor-pointer">
              <LogOut className="h-4 w-4" /> Logout
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {/* ── Phone / tablet top bar ── */}
          <header className="sticky top-0 z-30 border-b border-black/10 bg-white/95 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <img src={settings?.logoUrl || BRAND_LOGO} alt="" className="h-9 w-9 rounded-xl border border-black/10 object-contain" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-black uppercase tracking-wider">{shopName}</p>
                  <p className="truncate text-[11px] font-semibold text-black/55">Hi, {name.split(' ')[0]}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={toggleSound} title={sound ? 'Mute notification sound' : 'Turn on notification sound'} className={iconBtn}>
                  {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-black/50" />}
                </button>
                <NavLink to="/customer/notifications" className={iconBtn} title="Notifications">
                  {unread ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4 text-black/50" />}
                  {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-black text-white">{unread}</span>}
                </NavLink>
              </div>
            </div>
          </header>

          <main className="px-3 py-4 pb-28 sm:px-5 lg:px-0 lg:py-5 lg:pb-8">
            {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
            {loading && !data ? <div className="flex items-center justify-center py-24 text-sm font-semibold text-black/50"><Gem className="mr-2 h-5 w-5 animate-pulse" /> Loading your account…</div>
              : <Outlet context={{ data, notifications, refresh, loading, error } satisfies PortalContext} />}
          </main>
        </div>
      </div>

      {/* ── Phone bottom bar ── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2">
          {([['/customer/dashboard', 'Home', Home], ['/customer/bills', 'Bills', FileText], ['/customer/pay-upi', 'Pay', QrCode], ['/customer/schemes', 'Schemes', PiggyBank]] as const).map(([to, label, Icon]) => (
            to === '/customer/pay-upi' ? (
              <NavLink key={to} to={to} className="flex flex-col items-center gap-1 pb-2">
                <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg ring-4 ring-white"><Icon className="h-5 w-5" /></span>
                <span className="text-[10px] font-black uppercase tracking-wider">{label}</span>
              </NavLink>
            ) : (
              <NavLink key={to} to={to} className={({ isActive }) => `flex flex-col items-center gap-1 py-2.5 text-[10px] font-black uppercase tracking-wider ${isActive ? 'text-[var(--accent)]' : 'text-black/45'}`}>
                <Icon className="h-5 w-5" /> {label}
              </NavLink>
            )
          ))}
          <button type="button" onClick={() => setMenuOpen(true)} className="relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-black uppercase tracking-wider text-black/45 cursor-pointer">
            <LayoutGrid className="h-5 w-5" /> More
            {unread > 0 && <span className="absolute right-3 top-1.5 h-2 w-2 rounded-full bg-[var(--accent)]" />}
          </button>
        </div>
      </nav>

      {/* ── Phone "More" sheet ── */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 lg:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) setMenuOpen(false) }}>
          <div className="w-full rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-black text-white">{initials}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{name}</p><p className="text-[11px] font-semibold text-black/55">ID {data?.customer.code.toUpperCase() || '—'}</p></div>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className={iconBtn}><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.map(([to, label, Icon]) => (
                <NavLink key={to} to={to} className={({ isActive }) => `relative flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center text-[11px] font-bold ${isActive ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-black/10 bg-[#FAFAF7]'}`}>
                  <Icon className="h-5 w-5" /> {label}
                  {to === '/customer/notifications' && unread > 0 && <span className="absolute right-2 top-2 rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-black text-white">{unread}</span>}
                </NavLink>
              ))}
            </div>
            <button type="button" onClick={() => void logout()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-black/10 py-3 text-[11px] font-black uppercase tracking-wider cursor-pointer"><LogOut className="h-4 w-4" /> Logout</button>
          </div>
        </div>
      )}
    </div>
  )
}
