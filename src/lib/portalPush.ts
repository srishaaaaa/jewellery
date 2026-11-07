import { supabase } from './supabase'
import { portalRpc } from './customerPortal'

/** Phone / computer alerts for customers while the portal is closed (Web Push). */
export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

const worker = async () => {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) throw new Error('Alerts are not available in this browser. Please reload the page and try again.')
  return reg
}

export async function currentPushSubscription() {
  if (!pushSupported()) return null
  try { return (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() ?? null } catch { return null }
}

const urlKey = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0))

const save = (sub: PushSubscription) => {
  const k = sub.toJSON().keys || {}
  return portalRpc('customer_push_subscribe', { p_endpoint: sub.endpoint, p_p256dh: k.p256dh, p_auth: k.auth })
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser cannot show alerts. On iPhone, first add this site to your Home Screen.')
  const { data, error } = await supabase.functions.invoke('send-reminders', { body: { status: true } })
  const key = (data as { vapid_public_key?: string } | null)?.vapid_public_key
  if (error || !key) throw new Error('The shop has not switched on phone alerts yet.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Alerts are blocked. Allow notifications for this site in your browser settings.')
  const reg = await worker()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(key) })
  await save(sub)
}

/** Stops alerts on this device. Runs before logout, so the next person on a shared device gets nothing of this customer's. */
export async function disablePush() {
  const sub = await currentPushSubscription()
  if (!sub) return
  await portalRpc('customer_push_unsubscribe', { p_endpoint: sub.endpoint }).catch(() => undefined)
  await sub.unsubscribe().catch(() => undefined)
}

/** A device already switched on follows whoever is logged in now. */
export async function syncPushOwner() {
  const sub = await currentPushSubscription()
  if (sub) await save(sub).catch(() => undefined)
}
