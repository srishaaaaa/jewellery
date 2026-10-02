import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'
import { useSettingsStore } from '../store/store'
import { BRAND_EN, BRAND_INSTAGRAM, BRAND_PRIMARY_PHONE_DISPLAY } from './brand'

export type EventKind = 'birthday' | 'anniversary'

export type EventOfferConfig = {
  offers: string[]
  selectedOffer: string
  /** Message template; {name} = customer name, {offer} = selected offer. Empty = default message. */
  message: string
}

type StoredConfigs = Partial<Record<EventKind, EventOfferConfig>>

const DEFAULT_CONFIG: EventOfferConfig = {
  offers: ['20% OFF', 'Buy 1 Get 1', '₹500 OFF', 'Free Gift'],
  selectedOffer: '20% OFF',
  message: '',
}

const LOCAL_KEY = 'mahalashmi-customer-event-messages'
export const SAMPLE_CUSTOMER_NAME = 'Aarav'

const readLocal = (): StoredConfigs => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') as StoredConfigs
  } catch {
    return {}
  }
}

const writeLocal = (all: StoredConfigs) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all))
  } catch { /* storage unavailable */ }
}

const normalizeConfig = (raw: Partial<EventOfferConfig> | undefined): EventOfferConfig => {
  const offers = Array.isArray(raw?.offers) && raw.offers.length > 0
    ? raw.offers.map(String).filter(Boolean)
    : DEFAULT_CONFIG.offers
  const selectedOffer = raw?.selectedOffer && offers.includes(raw.selectedOffer) ? raw.selectedOffer : offers[0]
  return { offers, selectedOffer, message: typeof raw?.message === 'string' ? raw.message : '' }
}

/** Default template, branded from Store Settings. */
export function defaultEventTemplate(kind: EventKind) {
  const settings = useSettingsStore.getState().settings
  const shop = settings?.name || BRAND_EN
  const instagram = settings?.instagramHandle || BRAND_INSTAGRAM
  const phone = settings?.phone || BRAND_PRIMARY_PHONE_DISPLAY
  const greeting = kind === 'birthday' ? '🎂 Happy Birthday!' : '💍 Happy Anniversary!'
  return `Hi {name}! ${greeting}\n\nHere's a special treat from ${shop}:\n🎁 {offer}\n\nVisit us in store or call ${phone}.\nFollow us on Instagram @${instagram}\n\n– ${shop}`
}

export function renderEventMessage(template: string, customerName: string, offer: string) {
  return template.replace(/\{name\}/gi, customerName || 'there').replace(/\{offer\}/gi, offer)
}

/** Offer list, selected offer and message for one event kind, persisted in store_settings. */
export function useEventOfferSettings(kind: EventKind) {
  const [saved, setSaved] = useState<EventOfferConfig>(() => normalizeConfig(readLocal()[kind]))
  const [draft, setDraft] = useState<EventOfferConfig>(saved)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'ok' | 'warn' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.from('store_settings').select('customer_event_messages').eq('id', 1).maybeSingle()
      if (cancelled || error || !data) return
      const remote = (data as { customer_event_messages?: StoredConfigs }).customer_event_messages?.[kind]
      if (remote) {
        const cfg = normalizeConfig(remote)
        setSaved(cfg)
        setDraft(cfg)
      }
    })()
    return () => { cancelled = true }
  }, [kind])

  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const save = useCallback(async (override?: Partial<EventOfferConfig>) => {
    setSaving(true)
    setStatus(null)
    const cfg = normalizeConfig({ ...draft, ...override })
    const allLocal = { ...readLocal(), [kind]: cfg }
    writeLocal(allLocal)
    try {
      if (!isSupabaseConfigured) throw new Error('offline')
      const { data: current, error: readErr } = await supabase.from('store_settings').select('customer_event_messages').eq('id', 1).maybeSingle()
      if (readErr) throw readErr
      const existing = ((current as { customer_event_messages?: StoredConfigs } | null)?.customer_event_messages) || {}
      const { error } = await supabase
        .from('store_settings')
        .update({ customer_event_messages: { ...existing, [kind]: cfg }, updated_at: new Date().toISOString() })
        .eq('id', 1)
      if (error) throw error
      setStatus({ type: 'ok', text: 'Saved' })
    } catch {
      // Column not yet added on the database (or offline): still kept on this device.
      setStatus({ type: 'warn', text: 'Saved on this device only' })
    } finally {
      setSaved(cfg)
      setDraft(cfg)
      setSaving(false)
    }
  }, [draft, kind])

  const template = draft.message.trim() || defaultEventTemplate(kind)
  const buildMessage = (customerName: string) => renderEventMessage(template, customerName, draft.selectedOffer)

  return { draft, setDraft, isDirty, save, saving, status, template, buildMessage }
}
