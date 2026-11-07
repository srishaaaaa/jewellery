import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { Bell, BellOff, CreditCard, FileText, Gem, Home, LogOut, PiggyBank, ShoppingBag, User, Volume2, VolumeX } from 'lucide-react'
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
  ['/customer/bills', 'My Bills', FileText], ['/customer/payments', 'Payments', CreditCard], ['/customer/notifications', 'Notifications', Bell],
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

  return (
    <div className="min-h-dvh h-dvh overflow-y-auto bg-[#FAFAF7] text-[#111111]">
      <header className="sticky top-0 z-30 border-b border-black/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src={settings?.logoUrl || BRAND_LOGO} alt="" className="h-10 w-10 rounded-xl border border-black/10 object-contain" />
            <div className="min-w-0">
              <p className="truncate text-sm font-black uppercase tracking-wider">{shopName}</p>
              <p className="truncate text-[11px] font-semibold text-black/60">{data ? `Welcome, ${data.customer.name || 'Customer'}` : 'Customer portal'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={toggleSound} title={sound ? 'Mute notification sound' : 'Turn on notification sound'}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white hover:bg-black/5 cursor-pointer">
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-black/50" />}
            </button>
            <NavLink to="/customer/notifications" className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 bg-white hover:bg-black/5" title="Notifications">
              {unread ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4 text-black/50" />}
              {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-black text-white">{unread}</span>}
            </NavLink>
            <button type="button" onClick={() => void logout()} aria-label="Logout" title="Logout" className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-wider hover:bg-black/5 cursor-pointer">
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 hide-scrollbar">
          {NAV.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} className={({ isActive }) => `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-wider ${isActive ? 'bg-[#111111] text-white' : 'text-black/70 hover:bg-black/5'}`}>
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 pb-16">
        {error && <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
        {loading && !data ? <div className="flex items-center justify-center py-24 text-sm font-semibold text-black/50"><Gem className="mr-2 h-5 w-5 animate-pulse" /> Loading your account…</div>
          : <Outlet context={{ data, notifications, refresh, loading, error } satisfies PortalContext} />}
      </main>
    </div>
  )
}
