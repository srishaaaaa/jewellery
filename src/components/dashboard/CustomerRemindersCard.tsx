import { useCallback, useEffect, useState } from 'react'
import { BellRing, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

type Status = { whatsapp: boolean; sms: boolean; push: boolean; scheduled: boolean } | null
type Row = { channel: string; status: string; error: string; updated_at: string }

const Pill = ({ on, yes, no }: { on: boolean; yes: string; no: string }) => (
  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{on ? yes : no}</span>
)

/** Settings: automatic customer reminders. Says plainly whether a provider is connected, and shows only what providers reported. */
export function CustomerRemindersCard() {
  const [whatsapp, setWhatsapp] = useState(true)
  const [sms, setSms] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [s, d, f] = await Promise.all([
      supabase.from('store_settings').select('whatsapp_reminders_enabled, sms_reminders_enabled').eq('id', 1).maybeSingle(),
      supabase.from('notification_deliveries').select('channel, status, error, updated_at').gte('updated_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('updated_at', { ascending: false }).limit(1000),
      supabase.functions.invoke('send-reminders', { body: { status: true } }).catch(() => ({ data: null, error: true })),
    ])
    if (s.error) { setError('Reminders need the database update: run supabase/migrations/customer_portal.sql in the Supabase SQL Editor.'); return }
    setError('')
    setWhatsapp(s.data?.whatsapp_reminders_enabled !== false)
    setSms(s.data?.sms_reminders_enabled === true)
    setRows((d.data || []) as Row[])
    setStatus(f.error ? null : (f.data as Status))
    setReady(true)
  }, [])
  useEffect(() => {
    let live = true
    void Promise.resolve().then(() => { if (live) void load() })
    return () => { live = false }
  }, [load])

  const toggle = async (column: 'whatsapp_reminders_enabled' | 'sms_reminders_enabled', next: boolean, set: (v: boolean) => void) => {
    set(next)
    const { error: err } = await supabase.from('store_settings').update({ [column]: next }).eq('id', 1)
    if (err) { set(!next); setError(err.message) }
  }
  const count = (channel: string, st: string) => rows.filter((r) => r.channel === channel && r.status === st).length
  const failures = rows.filter((r) => r.status === 'failed' && r.error).slice(0, 3)

  const channelBox = ({ title, hint, on, connected, onChange, channel }: { title: string; hint: string; on: boolean; connected: boolean; onChange: (v: boolean) => void; channel: string }) => (
    <div className="rounded-xl border border-black/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-black text-[#000000]">
          <input type="checkbox" checked={on} disabled={!ready} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-black" /> {title}
        </label>
        <Pill on={connected} yes="Connected" no="Not connected" />
      </div>
      <p className="mt-1 text-[11px] font-semibold text-[#000000]/60">{connected ? hint : 'Nothing is sent until the provider details are added. See CUSTOMER_PORTAL_SETUP.md.'}</p>
      {connected && <p className="mt-1 text-[11px] font-bold text-[#000000]/70">Last 7 days: {count(channel, 'sent') + count(channel, 'delivered')} handed to provider{channel === 'whatsapp' ? ` • ${count(channel, 'delivered')} confirmed delivered` : ''} • {count(channel, 'failed')} failed</p>}
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-black/10 p-4 sm:p-6 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-[#000000]"><BellRing className="h-4 w-4" /> Automatic Customer Reminders</h3>
        <button type="button" onClick={() => void load()} aria-label="Refresh reminders" title="Refresh" className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 hover:bg-black/5 cursor-pointer"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      <p className="text-[11px] font-semibold text-[#000000]/60">Scheme installments and credit bills, on the days chosen in the reminder schedule, between 9 AM and 8 PM. Customers can switch these off in their portal.</p>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <div key="whatsapp">{channelBox({ title: 'WhatsApp reminders', channel: 'whatsapp', hint: 'Sent with your approved WhatsApp template.', on: whatsapp, connected: Boolean(status?.whatsapp), onChange: (v) => void toggle('whatsapp_reminders_enabled', v, setWhatsapp) })}</div>
        <div key="sms">{channelBox({ title: 'SMS reminders', channel: 'sms', hint: 'Sent through your SMS provider. Each message is charged by them.', on: sms, connected: Boolean(status?.sms), onChange: (v) => void toggle('sms_reminders_enabled', v, setSms) })}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-[#000000]/70">
        <span>Phone alerts for customers</span><Pill on={Boolean(status?.push)} yes="Connected" no="Not connected" />
        <span className="ml-2">Scheduled sending</span><Pill on={Boolean(status?.scheduled)} yes="Set up" no="Not set up" />
      </div>
      {failures.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          <p className="font-black">Recent failures</p>
          {failures.map((f) => <p key={`${f.channel}${f.updated_at}`} className="break-words">{f.channel}: {f.error}</p>)}
        </div>
      )}
    </div>
  )
}
