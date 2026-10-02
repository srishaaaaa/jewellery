import React, { useEffect, useRef, useState } from 'react'
import { CalendarClock, Volume2, VolumeX, Package } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSound } from '../../context/SoundContext'
import { useSettingsStore } from '../../store/store'
import { useAlarmQueueStore } from '../../store/alarmQueueStore'
import { formatDateDDMMYYYY } from '../../lib/dateFormat'
import { ModalPortal } from '../ModalPortal'

interface ExpiringItem {
  id: string | number
  name: string
  category: string
  expiry_date: string
  daysLeft: number
}

interface ProductExpiryRow {
  id: string | number
  name: string
  category: string
  category_id: number | null
  expiry_date: string | null
  is_active: boolean
}

/**
 * Mirrors LowStockAlarmModal: fires its check on mount (i.e. right after
 * login) and again only when `triggerKey` becomes "inventory" or
 * "expiry_alerts". Flags anything already expired, plus anything expiring
 * within the store's customizable expiry_alert_days window (Store Settings).
 */
export default function ExpiryAlarmModal({ triggerKey }: { triggerKey?: string | number }) {
  const { soundEnabled } = useSound()
  const alertDays = useSettingsStore(s => s.settings?.expiryAlertDays ?? 30)
  const [items, setItems] = useState<ExpiringItem[] | null>(null)
  const intervalRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const hasCheckedOnMount = useRef(false)
  const prevAlertDays = useRef(alertDays)
  const queue = useAlarmQueueStore(s => s.queue)
  const enqueueAlarm = useAlarmQueueStore(s => s.enqueue)
  const dequeueAlarm = useAlarmQueueStore(s => s.dequeue)
  const isFront = queue[0] === 'expiry'

  useEffect(() => {
    const isInitialMount = !hasCheckedOnMount.current
    // Store Settings loads asynchronously — the very first run may use the
    // 30-day fallback before the store's real expiry_alert_days arrives.
    // Once it does, alertDays changes and that alone should trigger a
    // recheck, even if the user isn't currently on Inventory/Expiry Alerts.
    const alertDaysJustLoaded = prevAlertDays.current !== alertDays
    hasCheckedOnMount.current = true
    prevAlertDays.current = alertDays
    if (!isInitialMount && !alertDaysJustLoaded && triggerKey !== 'expiry_alerts') return

    let cancelled = false
    const check = async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, category, category_id, expiry_date, is_active')
        .eq('is_active', true)
        .not('expiry_date', 'is', null)
      if (cancelled || !data) return

      const today = new Date(); today.setHours(0, 0, 0, 0)
      const msPerDay = 24 * 60 * 60 * 1000

      const expiring = (data as ProductExpiryRow[])
        .filter(p => !(p.category?.trim().toLowerCase() === 'unregistered'))
        .map(p => {
          const expiry = new Date(`${p.expiry_date}T00:00:00`)
          const daysLeft = Math.round((expiry.getTime() - today.getTime()) / msPerDay)
          return { id: p.id, name: p.name, category: p.category, expiry_date: p.expiry_date as string, daysLeft }
        })
        .filter(p => p.daysLeft <= alertDays)
        .sort((a, b) => a.daysLeft - b.daysLeft)

      if (expiring.length > 0) {
        setItems(expiring)
        enqueueAlarm('expiry')
      }
    }
    void check()
    return () => { cancelled = true }
  }, [triggerKey, alertDays, enqueueAlarm])

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
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(520, now)
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2)
      osc.start(now)
      osc.stop(now + 0.2)
    } catch (e) {
      console.warn('Expiry alarm beep failed', e)
    }
  }

  useEffect(() => {
    if (items && items.length > 0 && isFront) {
      beep()
      intervalRef.current = window.setInterval(beep, 3500)
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
    dequeueAlarm('expiry')
  }

  if (!items || items.length === 0 || !isFront) return null

  const expiredCount = items.filter(p => p.daysLeft < 0).length
  const soonCount = items.length - expiredCount
  const subtitle = expiredCount > 0 && soonCount > 0
    ? `${expiredCount} already expired, ${soonCount} expiring within ${alertDays} days`
    : expiredCount > 0
      ? `${expiredCount} item${expiredCount > 1 ? 's' : ''} already expired — remove from sale`
      : `${soonCount} item${soonCount > 1 ? 's' : ''} expiring within ${alertDays} days`

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border-2 border-red-500">
        <div className="px-5 py-4 flex items-center justify-between gap-3 bg-gradient-to-r from-red-600 to-amber-500">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <CalendarClock size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-white leading-tight">Expiry Alert Active</h2>
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
              const isExpired = p.daysLeft < 0
              return (
                <div key={String(p.id)} className={`flex items-center justify-between border rounded-xl px-3 py-2.5 gap-2 ${isExpired ? 'bg-red-100 border-red-200' : 'bg-amber-50 border-amber-100'}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 ${isExpired ? 'text-red-600' : 'text-amber-600'}`}>
                      <Package size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-[#111111] break-words">{p.name}</p>
                      <p className="text-[11px] text-[#6B7280] truncate">{p.category || '—'}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${isExpired ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
                      {isExpired ? `EXPIRED ${Math.abs(p.daysLeft)}D AGO` : `EXPIRES IN ${p.daysLeft}D`}
                    </span>
                    <p className="text-[10px] text-[#9CA3AF] mt-0.5">{formatDateDDMMYYYY(p.expiry_date)}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
            <p className="text-[11px] text-[#9CA3AF] font-bold sm:max-w-[140px] shrink-0 order-2 sm:order-1">Will sound again on next login or Expiry Alerts visit.</p>
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
