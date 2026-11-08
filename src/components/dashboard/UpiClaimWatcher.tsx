import { useEffect, useRef, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatCurrency, formatInvoiceNo } from '../../lib/retail'
import { normalizeAlertSettings } from '../../lib/alertSettings'
import { systemNotify } from '../../lib/systemNotify'
import { useSettingsStore } from '../../store/store'

type PendingClaim = { id: string; amount: number; created_at: string; orders: { invoice_no: string; customer_name: string } | null }

function chime() {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctor()
    const now = ctx.currentTime
    ;[[880, 0], [1174.7, 0.18]].forEach(([f, t]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0, now + t); g.gain.linearRampToValueAtTime(0.25, now + t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.5)
      o.connect(g); g.connect(ctx.destination); o.start(now + t); o.stop(now + t + 0.55)
    })
    window.setTimeout(() => void ctx.close(), 1200)
  } catch { /* audio blocked until the page is clicked */ }
}

/** Tells the shop when a customer says they paid by UPI: sidebar count, chime, notification and a toast. */
export function UpiClaimWatcher({ onCount, onOpen }: { onCount: (n: number) => void; onOpen: () => void }) {
  const cfg = normalizeAlertSettings(useSettingsStore((s) => s.settings?.posPermissions?.alerts))
  const [toast, setToast] = useState<PendingClaim | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const cfgRef = useRef(cfg)
  useEffect(() => { cfgRef.current = cfg })

  useEffect(() => {
    let live = true
    const check = async () => {
      const base = 'id, amount, created_at, orders(invoice_no, customer_name), advance_orders(deposit_id, customer_name)'
      const query = (cols: string) => supabase.from('upi_payment_claims').select(cols).eq('status', 'pending').order('created_at', { ascending: false }).limit(100)
      let { data, error } = await query(`${base}, jewellery_schemes(scheme_number, customer_name)`)
      // Before the database update there is no scheme column: watch without it.
      if (error && /scheme/i.test(error.message)) ({ data, error } = await query(base))
      if (!live || error) return
      const rows = ((data || []) as unknown as Array<PendingClaim & { advance_orders?: { deposit_id: string; customer_name: string } | null; jewellery_schemes?: { scheme_number: string; customer_name: string } | null }>).map((r) => ({
        ...r, orders: r.orders || (r.advance_orders ? { invoice_no: r.advance_orders.deposit_id, customer_name: r.advance_orders.customer_name }
          : r.jewellery_schemes ? { invoice_no: r.jewellery_schemes.scheme_number, customer_name: r.jewellery_schemes.customer_name } : null),
      }))
      onCount(rows.length)
      const fresh = seen.current ? rows.filter((r) => !seen.current!.has(r.id)) : []
      seen.current = new Set(rows.map((r) => r.id))
      if (fresh.length && cfgRef.current.notifications) {
        const c = fresh[0]
        setToast(c)
        if (cfgRef.current.sound) chime()
        void systemNotify('Customer says paid by UPI', `${c.orders?.customer_name || 'Customer'} • ${formatInvoiceNo(c.orders?.invoice_no || '')} • ${formatCurrency(c.amount)}`, 'upi-claim')
      }
    }
    void check()
    const t = window.setInterval(() => void check(), 30000)
    const channel = supabase.channel('upi-claims-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'upi_payment_claims' }, () => void check())
      .subscribe()
    return () => { live = false; window.clearInterval(t); void supabase.removeChannel(channel) }
  }, [onCount])

  if (!toast) return null
  return (
    <div className="fixed bottom-4 right-4 z-[90] w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border border-black/10 bg-white p-4 shadow-2xl print:hidden">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111111] text-white"><BellRing className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-wider">Customer says paid by UPI</p>
          <p className="mt-0.5 text-xs font-semibold">{toast.orders?.customer_name || 'Customer'} • {formatInvoiceNo(toast.orders?.invoice_no || '')} • {formatCurrency(toast.amount)}</p>
          <button type="button" onClick={() => { setToast(null); onOpen() }} className="mt-2 rounded-lg bg-[#111111] px-3 py-1.5 text-[10px] font-black uppercase text-white cursor-pointer">Check &amp; confirm</button>
        </div>
        <button type="button" aria-label="Close" onClick={() => setToast(null)} className="cursor-pointer"><X className="h-4 w-4" /></button>
      </div>
    </div>
  )
}
