import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Volume2, VolumeX, Package } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSound } from '../../context/SoundContext'
import { useAlarmQueueStore } from '../../store/alarmQueueStore'
import { ModalPortal } from '../ModalPortal'
import { lowStockLimit } from '../../lib/stockLevels'

interface LowStockItem {
  id: string | number
  name: string
  category: string
  stock_quantity: number
  low_stock_alert: number
}

interface ProductStockRow {
  id: string | number
  name: string
  category: string
  category_id: number | null
  stock_quantity: number
  low_stock_alert: number | null
  is_active: boolean
}

/**
 * Fires its low-stock check on mount (i.e. right after login) and again only
 * when `triggerKey` becomes "inventory" — not on every tab switch. Each of
 * those triggers always shows the current low/out-of-stock list, even if the
 * same items were acknowledged on a previous trigger — acknowledging only
 * silences the alarm for the item currently on screen, it does not suppress
 * future logins/Inventory visits.
 */
export default function LowStockAlarmModal({ triggerKey }: { triggerKey?: string | number }) {
  const { soundEnabled } = useSound()
  const [items, setItems] = useState<LowStockItem[] | null>(null)
  const intervalRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const hasCheckedOnMount = useRef(false)
  const queue = useAlarmQueueStore(s => s.queue)
  const enqueueAlarm = useAlarmQueueStore(s => s.enqueue)
  const dequeueAlarm = useAlarmQueueStore(s => s.dequeue)
  const isFront = queue[0] === 'lowStock'

  useEffect(() => {
    const isInitialMount = !hasCheckedOnMount.current
    hasCheckedOnMount.current = true
    if (!isInitialMount && triggerKey !== 'inventory') return

    let cancelled = false
    const check = async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, category, category_id, stock_quantity, low_stock_alert, is_active')
        .eq('is_active', true)
      if (cancelled || !data) return
      // Ad-hoc items quick-added during a POS sale (category "Unregistered")
      // are deliberately excluded from Inventory's own stock tracking — the
      // alarm should respect the same exclusion instead of alerting on them.
      const low = (data as ProductStockRow[])
        .filter(p => !(p.category?.trim().toLowerCase() === 'unregistered'))
        .filter(p => p.stock_quantity <= lowStockLimit(p.low_stock_alert))
        .map(p => ({
          id: p.id, name: p.name, category: p.category,
          stock_quantity: p.stock_quantity, low_stock_alert: lowStockLimit(p.low_stock_alert),
        }))
      if (low.length > 0) {
        setItems(low)
        enqueueAlarm('lowStock')
      }
    }
    void check()
    return () => { cancelled = true }
  }, [triggerKey, enqueueAlarm])

  const beep = () => {
    if (!soundEnabled) return
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof window.AudioContext }).webkitAudioContext
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContextCtor()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') void ctx.resume()
      const now = ctx.currentTime
      // two-tone siren beep
      ;[0, 0.16].forEach((offset, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'square'
        osc.frequency.setValueAtTime(i === 0 ? 880 : 660, now + offset)
        gain.gain.setValueAtTime(0, now + offset)
        gain.gain.linearRampToValueAtTime(0.25, now + offset + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.01, now + offset + 0.15)
        osc.start(now + offset)
        osc.stop(now + offset + 0.16)
      })
    } catch (e) {
      console.warn('Low-stock alarm beep failed', e)
    }
  }

  useEffect(() => {
    if (items && items.length > 0 && isFront) {
      beep()
      intervalRef.current = window.setInterval(beep, 2500)
    }
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isFront])

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
    }
  }, [])

  const acknowledge = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    setItems(null)
    dequeueAlarm('lowStock')
  }

  if (!items || items.length === 0 || !isFront) return null

  const outCount = items.filter(p => p.stock_quantity <= 0).length
  const lowCount = items.length - outCount
  const subtitle = outCount > 0 && lowCount > 0
    ? `${outCount} out of stock, ${lowCount} low stock — restock immediately`
    : outCount > 0
      ? `${outCount} item${outCount > 1 ? 's' : ''} out of stock`
      : `${lowCount} item${lowCount > 1 ? 's' : ''} require${lowCount === 1 ? 's' : ''} immediate restocking`

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border-2 border-red-500">
        <div className="px-5 py-4 flex items-center justify-between gap-3 bg-gradient-to-r from-red-600 to-orange-500">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-white leading-tight">Low Stock Alarm Active</h2>
              <p className="text-xs font-bold text-white/90">{subtitle}</p>
            </div>
          </div>
          {soundEnabled && (
            <span className="hidden sm:flex items-center gap-1 bg-white/20 text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap shrink-0">
              <Volume2 size={12} /> Alarm Sounding
            </span>
          )}
        </div>

        <div className="p-5 space-y-3">
          <p className="text-sm font-bold text-[#374151]">The audible alarm and visual alert will sound until acknowledged.</p>

          <div className="max-h-56 overflow-y-auto space-y-2">
            {items.map(p => {
              const isOut = p.stock_quantity <= 0
              return (
                <div key={String(p.id)} className={`flex items-center justify-between border rounded-xl px-3 py-2.5 gap-2 ${isOut ? 'bg-red-100 border-red-200' : 'bg-amber-50 border-amber-100'}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 ${isOut ? 'text-red-600' : 'text-amber-600'}`}>
                      <Package size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-[#111111] break-words">{p.name}</p>
                      <p className="text-[11px] text-[#6B7280] truncate">{p.category || '—'}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${isOut ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
                      {isOut ? 'OUT OF STOCK' : `${p.stock_quantity} IN STOCK`}
                    </span>
                    <p className="text-[10px] text-[#9CA3AF] mt-0.5">Alert limit: {p.low_stock_alert}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
            <p className="text-[11px] text-[#9CA3AF] font-bold sm:max-w-[140px] shrink-0 order-2 sm:order-1">Will sound again on next login or Inventory visit.</p>
            <button onClick={acknowledge}
              className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-black text-sm py-3 rounded-xl order-1 sm:order-2">
              <VolumeX size={16} /> Silence Alarm &amp; Acknowledge
            </button>
          </div>
        </div>
      </div>
    </div></ModalPortal>
  )
}
