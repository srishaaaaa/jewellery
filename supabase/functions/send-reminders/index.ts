// send-reminders: run every 5 minutes by pg_cron with the x-cron-secret header.
// Sends due-date reminders by WhatsApp / SMS (9 AM to 8 PM India time) and every customer notification as a push alert.
// A channel whose secrets are missing is left alone: nothing is queued, marked sent or lost.
//
//   POST { status: true }  (no secret) says only which channels are connected, and gives the public push key.
//
// Secrets:
//   REMINDER_CRON_SECRET   long random text; also goes in the pg_cron job
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG (default en), WHATSAPP_API_VERSION (optional)
//   SMS_PROVIDER + its keys (see customer-otp); MSG91 also needs MSG91_REMINDER_TEMPLATE_ID
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: address)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, env, json } from '../_shared/http.ts'
import { sendSmsReminder, sendWhatsAppReminder, smsRemindersReady, whatsappReady } from '../_shared/senders.ts'
import { sendPush, type PushTarget } from '../_shared/webpush.ts'

type Item = { delivery_id: string; title: string; body: string; phone: string; targets: PushTarget[] | null }
type Admin = ReturnType<typeof createClient>

const pushReady = () => Boolean(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY') && env('VAPID_SUBJECT'))
const BATCH = 100
const MAX_BATCHES = 5

/** WhatsApp and SMS wait for 9 AM to 8 PM India time. */
const inSendingHours = (now = new Date()) => {
  const hour = new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours()
  return hour >= 9 && hour < 20
}

async function drain(admin: Admin, channel: string, send: (item: Item) => Promise<{ ref?: string }>) {
  const count = { sent: 0, failed: 0 }
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await admin.rpc('claim_outbound_notifications', { p_channel: channel, p_limit: BATCH })
    if (error) throw new Error(`${channel}: ${error.message}`)
    const items = (data || []) as Item[]
    for (const item of items) {
      try {
        const r = await send(item)
        await admin.rpc('record_delivery', { p_id: item.delivery_id, p_status: 'sent', p_ref: r.ref || '', p_error: '' })
        count.sent++
      } catch (err) {
        await admin.rpc('record_delivery', { p_id: item.delivery_id, p_status: 'failed', p_ref: '', p_error: (err as Error).message })
        count.failed++
      }
    }
    if (items.length < BATCH) break
  }
  return count
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const input = await req.json().catch(() => ({}))

  if (input?.status === true) {
    return json({ whatsapp: whatsappReady(), sms: smsRemindersReady(), push: pushReady(), scheduled: Boolean(env('REMINDER_CRON_SECRET')), vapid_public_key: env('VAPID_PUBLIC_KEY') })
  }

  // No secret configured means nobody can trigger a send.
  const secret = env('REMINDER_CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Not allowed' }, 401)

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const result: Record<string, unknown> = {}
  try {
    if (inSendingHours()) {
      if (whatsappReady()) result.whatsapp = await drain(admin, 'whatsapp', async (m) => ({ ref: await sendWhatsAppReminder(`91${m.phone}`, m.title, m.body) }))
      if (smsRemindersReady()) result.sms = await drain(admin, 'sms', async (m) => ({ ref: await sendSmsReminder(`91${m.phone}`, m.title, m.body) }))
    }
    if (pushReady()) {
      const vapid = { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') }
      result.push = await drain(admin, 'push', async (m) => {
        const payload = JSON.stringify({ title: m.title, body: m.body, url: '/customer/notifications' })
        let accepted = 0
        let lastError = 'No device took it'
        for (const target of m.targets || []) {
          const status = await sendPush(target, payload, vapid).catch((err) => { lastError = (err as Error).message; return 0 })
          if (status >= 200 && status < 300) accepted++
          else if (status === 404 || status === 410) await admin.rpc('delete_push_subscription', { p_endpoint: target.endpoint })
          else if (status) lastError = `Push service answered ${status}`
        }
        if (!accepted) throw new Error(lastError)
        return {}
      })
    }
  } catch (err) {
    return json({ error: (err as Error).message, result }, 500)
  }
  return json({ ok: true, result })
})
