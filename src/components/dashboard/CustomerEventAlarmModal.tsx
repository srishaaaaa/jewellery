import React, { useEffect, useRef, useState } from 'react'
import { Check, Gift, Heart, Volume2, VolumeX, MessageCircle } from 'lucide-react'
import { customerService, type CustomerEvent } from '../../services/customerService'
import { toWhatsAppUrl } from '../../lib/phone'
import { BRAND_EN } from '../../lib/brand'
import { useSound } from '../../context/SoundContext'
import { useAlarmQueueStore } from '../../store/alarmQueueStore'
import { ModalPortal } from '../ModalPortal'

/**
 * Mirrors ExpiryAlarmModal: fires its check on mount (i.e. right after
 * login) and again only when `triggerKey` becomes "overview" or "history".
 * Flags any customer whose birthday or anniversary falls on today's date.
 */
export default function CustomerEventAlarmModal({ triggerKey }: { triggerKey?: string | number }) {
  const { soundEnabled } = useSound()
  const [events, setEvents] = useState<CustomerEvent[] | null>(null)
  const [ackingId, setAckingId] = useState<string | null>(null)
  const intervalRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const hasCheckedOnMount = useRef(false)
  const queue = useAlarmQueueStore(s => s.queue)
  const enqueueAlarm = useAlarmQueueStore(s => s.enqueue)
  const dequeueAlarm = useAlarmQueueStore(s => s.dequeue)
  const isFront = queue[0] === 'customerEvent'

  useEffect(() => {
    const isInitialMount = !hasCheckedOnMount.current
    hasCheckedOnMount.current = true
    if (!isInitialMount && triggerKey !== 'overview' && triggerKey !== 'history') return

    let cancelled = false
    const check = async () => {
      try {
        const today = await customerService.fetchTodaysEvents()
        if (cancelled) return
        if (today.length > 0) {
          setEvents(today)
          enqueueAlarm('customerEvent')
        }
      } catch (err) {
        console.error('Failed to check customer birthdays/anniversaries', err)
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
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(660, now)
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.15, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2)
      osc.start(now)
      osc.stop(now + 0.2)
    } catch (e) {
      console.warn('Customer event alarm beep failed', e)
    }
  }

  useEffect(() => {
    if (events && events.length > 0 && isFront) {
      beep()
      intervalRef.current = window.setInterval(beep, 5000)
    }
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, isFront])

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {})
      }
    }
  }, [])

  const acknowledge = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    setEvents(null)
    dequeueAlarm('customerEvent')
  }

  // Removes one event from the popup, persisting the dismissal so it won't
  // re-fire again today. Closes the popup once nothing is left.
  const clearEvent = async (event: CustomerEvent) => {
    setAckingId(event.id)
    try {
      await customerService.acknowledgeEvent(event.customerId, event.type)
      setEvents(prev => {
        const next = (prev || []).filter(e => e.id !== event.id)
        if (next.length === 0) {
          if (intervalRef.current) window.clearInterval(intervalRef.current)
          dequeueAlarm('customerEvent')
          return null
        }
        return next
      })
    } catch (err) {
      console.error('Failed to acknowledge customer event', err)
    } finally {
      setAckingId(null)
    }
  }

  const sendWishes = (event: CustomerEvent) => {
    const occasion = event.type === 'birthday' ? 'Happy Birthday' : 'Happy Anniversary'
    const message = `${occasion}, ${event.name}! 🎉 Wishing you a wonderful day from all of us at ${BRAND_EN}. Thank you for being our valued customer!`
    window.open(toWhatsAppUrl(event.phone, message), '_blank', 'noopener,noreferrer')
    void clearEvent(event)
  }

  const acknowledgeAll = async () => {
    if (!events) return
    const toClear = events
    acknowledge()
    try {
      await Promise.all(toClear.map(e => customerService.acknowledgeEvent(e.customerId, e.type)))
    } catch (err) {
      console.error('Failed to acknowledge all customer events', err)
    }
  }

  if (!events || events.length === 0 || !isFront) return null

  const birthdayCount = events.filter(e => e.type === 'birthday').length
  const anniversaryCount = events.length - birthdayCount
  const subtitle = birthdayCount > 0 && anniversaryCount > 0
    ? `${birthdayCount} birthday${birthdayCount > 1 ? 's' : ''}, ${anniversaryCount} anniversary${anniversaryCount > 1 ? 'ies' : ''} today`
    : birthdayCount > 0
      ? `${birthdayCount} customer birthday${birthdayCount > 1 ? 's' : ''} today`
      : `${anniversaryCount} customer anniversary${anniversaryCount > 1 ? 'ies' : ''} today`

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border-2 border-pink-400">
        <div className="px-5 py-4 flex items-center justify-between gap-3 bg-gradient-to-r from-pink-500 to-violet-500">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <Gift size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-white leading-tight">Today's Celebrations</h2>
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
          <p className="text-sm font-bold text-[#374151]">A great chance to send a wish and build customer loyalty.</p>

          <div className="max-h-56 overflow-y-auto space-y-2">
            {events.map(e => (
              <div key={e.id} className="flex items-center justify-between border rounded-xl px-3 py-2.5 gap-2 bg-pink-50 border-pink-100">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 text-pink-600">
                    {e.type === 'birthday' ? <Gift size={15} /> : <Heart size={15} />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-black text-sm text-[#111111] break-words">{e.name}</p>
                    <p className="text-[11px] text-[#6B7280] truncate">{e.phone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex flex-col items-end gap-1">
                    <span className="inline-block text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap bg-pink-100 text-pink-700">
                      {e.type === 'birthday' ? 'BIRTHDAY' : 'ANNIVERSARY'}
                    </span>
                    <button
                      type="button"
                      onClick={() => sendWishes(e)}
                      disabled={ackingId === e.id}
                      className="flex items-center gap-1 text-[10px] font-black text-emerald-700 hover:text-emerald-900 cursor-pointer disabled:opacity-50"
                    >
                      <MessageCircle size={11} /> Send Wishes
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void clearEvent(e)}
                    disabled={ackingId === e.id}
                    title="Mark as done — won't show again today"
                    className="w-7 h-7 rounded-full bg-white border border-pink-200 text-pink-600 hover:bg-pink-600 hover:text-white hover:border-pink-600 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    <Check size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
            <p className="text-[11px] text-[#9CA3AF] font-bold sm:max-w-[150px] shrink-0 order-2 sm:order-1">Tick ✓ or send a wish to clear just one — this clears all for today.</p>
            <button onClick={() => void acknowledgeAll()}
              className="flex-1 flex items-center justify-center gap-2 bg-pink-600 hover:bg-pink-700 text-white font-black text-sm py-3 rounded-xl order-1 sm:order-2 cursor-pointer">
              <VolumeX size={16} /> Silence &amp; Acknowledge All
            </button>
          </div>
        </div>
      </div>
    </div></ModalPortal>
  )
}
