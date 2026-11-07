// Message senders for the Edge Functions. Each throws when the provider refuses, and returns the provider's message id when it gives one.
import { env } from './http.ts'

export const smsProvider = () => {
  const p = env('SMS_PROVIDER').toLowerCase()
  return p === 'msg91' || p === 'twilio' ? p : ''
}
export const emailReady = () => Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM'))
export const whatsappReady = () => Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID') && env('WHATSAPP_TEMPLATE_NAME'))
export const shopName = () => env('OTP_SHOP_NAME') || 'our jewellery shop'

export async function sendEmail(to: string, subject: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM'), to: [to], subject, text }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message || `Email error ${res.status}`)
  return String(body?.id || '')
}

async function twilioText(phone91: string, text: string) {
  const sid = env('TWILIO_ACCOUNT_SID')
  const form = new URLSearchParams({ To: `+${phone91}`, Body: text })
  if (env('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'))
  else form.set('From', env('TWILIO_FROM'))
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.message || `Twilio error ${res.status}`)
  return String(body?.sid || '')
}

export async function sendSmsOtp(phone91: string, code: string, minutes: number) {
  if (smsProvider() === 'twilio') return twilioText(phone91, `${code} is your ${shopName()} login code. It expires in ${minutes} minutes. Do not share it.`)
  const res = await fetch(`https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(env('MSG91_TEMPLATE_ID'))}&mobile=${phone91}&otp=${code}`, {
    method: 'POST',
    headers: { authkey: env('MSG91_AUTH_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.type === 'error') throw new Error(body?.message || `MSG91 error ${res.status}`)
  return ''
}

/** SMS reminder. Twilio takes the full text; an Indian DLT template (MSG91) takes only a short title in its one variable. */
export const smsRemindersReady = () => smsProvider() === 'twilio' || Boolean(smsProvider() === 'msg91' && env('MSG91_REMINDER_TEMPLATE_ID'))

export async function sendSmsReminder(phone91: string, title: string, body: string) {
  if (smsProvider() === 'twilio') return twilioText(phone91, `${body} - ${shopName()}`)
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: env('MSG91_AUTH_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: env('MSG91_REMINDER_TEMPLATE_ID'), short_url: '0', recipients: [{ mobiles: phone91, var1: title.slice(0, 30) }] }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.type === 'error') throw new Error(out?.message || `MSG91 error ${res.status}`)
  return String(out?.message || '')
}

/** WhatsApp template values may not hold line breaks, tabs or long runs of spaces. */
const templateText = (s: string) => s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 1000)

/** WhatsApp Cloud API. The returned id is only "accepted by WhatsApp"; delivery is reported later to whatsapp-webhook. */
export async function sendWhatsAppReminder(phone91: string, title: string, body: string) {
  const version = env('WHATSAPP_API_VERSION') || 'v23.0'
  const res = await fetch(`https://graph.facebook.com/${version}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone91,
      type: 'template',
      template: {
        name: env('WHATSAPP_TEMPLATE_NAME'),
        language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: templateText(title) }, { type: 'text', text: templateText(body) }] }],
      },
    }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out?.error?.message || `WhatsApp error ${res.status}`)
  return String(out?.messages?.[0]?.id || '')
}
