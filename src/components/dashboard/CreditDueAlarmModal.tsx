import React, { useEffect, useRef, useState } from 'react'
import { Wallet, Volume2, VolumeX, CheckCircle2 } from 'lucide-react'
import { creditService, type OutstandingCreditOrder } from '../../services/creditService'
import { formatCurrency, formatInvoiceNo } from '../../lib/retail'
import { useSound } from '../../context/SoundContext'
import { useAlarmQueueStore } from '../../store/alarmQueueStore'
import { ModalPortal } from '../ModalPortal'

/**
 * Checks only when the Outstanding Credits section is opened (triggerKey ===
 * "outstanding_credits") - not on login and not on other pages. Flags any
 * outstanding credit sale whose due date has arrived or already passed.
 */
export default function CreditDueAlarmModal({ triggerKey }: { triggerKey?: string | number }) {
  const { soundEnabled } = useSound()
  const [items, setItems] = useState<OutstandingCreditOrder[] | null>(null)
  const [settlingId, setSettlingId] = useState<string | null>(null)
  const intervalRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const queue = useAlarmQueueStore(s => s.queue)
  const enqueueAlarm = useAlarmQueueStore(s => s.enqueue)
  const dequeueAlarm = useAlarmQueueStore(s => s.dequeue)
  const isFront = queue[0] === 'creditDue'

  useEffect(() => {
    if (triggerKey !== 'outstanding_credits') return

    let cancelled = false
    const check = async () => {
      try {
        const outstanding = await creditService.fetchOutstandingCredits()
        if (cancelled) return
        // Only bills that have a due date, and it has arrived (today) or passed
        const due = outstanding.filter(o => Boolean(o.credit_due_date) && o.daysOverdue >= 0)
        if (due.length > 0) {
          setItems(due)
          enqueueAlarm('creditDue')
        }
      } catch (err) {
        console.error('Failed to check credit due dates', err)
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
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(440, now)
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2)
      osc.start(now)
      osc.stop(now + 0.2)
    } catch (e) {
      console.warn('Credit due alarm beep failed', e)
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
    dequeueAlarm('creditDue')
  }

  const settleNow = async (orderId: string) => {
    setSettlingId(orderId)
    try {
      await creditService.markAsPaid(orderId)
      setItems(prev => {
        const next = (prev || []).filter(o => o.id !== orderId)
        if (next.length === 0) {
          if (intervalRef.current) window.clearInterval(intervalRef.current)
          dequeueAlarm('creditDue')
          return null
        }
        return next
      })
    } catch (err) {
      console.error('Failed to mark credit as paid', err)
    } finally {
      setSettlingId(null)
    }
  }

  if (!items || items.length === 0 || !isFront) return null

  const overdueCount = items.filter(o => o.daysOverdue > 0).length
  const dueTodayCount = items.length - overdueCount
  const totalDue = items.reduce((sum, o) => sum + Number(o.total || 0), 0)
  const subtitle = overdueCount > 0 && dueTodayCount > 0
    ? `${overdueCount} overdue, ${dueTodayCount} due today — ${formatCurrency(totalDue)} total`
    : overdueCount > 0
      ? `${overdueCount} credit sale${overdueCount > 1 ? 's' : ''} overdue — ${formatCurrency(totalDue)} total`
      : `${dueTodayCount} credit sale${dueTodayCount > 1 ? 's' : ''} due today — ${formatCurrency(totalDue)} total`

  return (
    <ModalPortal><div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border-2 border-amber-500">
        <div className="px-5 py-4 flex items-center justify-between gap-3 bg-gradient-to-r from-amber-600 to-red-500">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <Wallet size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-black text-white leading-tight">Credit Payment Due</h2>
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
            {items.map(o => {
              const isOverdue = o.daysOverdue > 0
              return (
                <div key={o.id} className={`flex items-center justify-between border rounded-xl px-3 py-2.5 gap-2 ${isOverdue ? 'bg-red-100 border-red-200' : 'bg-amber-50 border-amber-100'}`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                      <Wallet size={15} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm text-[#111111] break-words">{o.customer_name}</p>
                      <p className="text-[11px] text-[#6B7280] truncate">{formatInvoiceNo(o.invoice_no)} • {formatCurrency(o.total)}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <span className={`inline-block text-[10px] font-black px-2 py-0.5 rounded-full whitespace-nowrap ${isOverdue ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
                      {isOverdue ? `OVERDUE ${o.daysOverdue}D` : 'DUE TODAY'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void settleNow(o.id)}
                      disabled={settlingId === o.id}
                      className="flex items-center gap-1 text-[10px] font-black text-emerald-700 hover:text-emerald-900 disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 size={11} /> {settlingId === o.id ? 'Saving...' : 'Mark Paid'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 pt-1">
            <p className="text-[11px] text-[#9CA3AF] font-bold sm:max-w-[140px] shrink-0 order-2 sm:order-1">Will sound again on next login or Order History visit.</p>
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
