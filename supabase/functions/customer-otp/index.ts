// customer-otp: makes a one-time code for a registered customer's mobile number and sends it by SMS.
// The code itself is only ever stored as a salted hash in the database; checking it is done by the
// customer_verify_otp database function (5 tries per code, expires after Settings -> otp_minutes).
//
// Choose the provider with the SMS_PROVIDER secret. Until it is set, customers see
// "OTP service not configured" and nothing is sent.
//   SMS_PROVIDER=msg91   MSG91_AUTH_KEY, MSG91_TEMPLATE_ID   (DLT-approved OTP template with ##OTP##)
//   SMS_PROVIDER=twilio  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID)
//   OTP_SHOP_NAME        optional, used in the Twilio message text
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, env, json } from '../_shared/http.ts'

async function sendMsg91(phone91: string, code: string) {
  const res = await fetch(`https://control.msg91.com/api/v5/otp?template_id=${encodeURIComponent(env('MSG91_TEMPLATE_ID'))}&mobile=${phone91}&otp=${code}`, {
    method: 'POST',
    headers: { authkey: env('MSG91_AUTH_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || (body && body.type === 'error')) throw new Error(body?.message || `MSG91 error ${res.status}`)
}

async function sendTwilio(phone91: string, code: string, minutes: number) {
  const sid = env('TWILIO_ACCOUNT_SID')
  const form = new URLSearchParams({
    To: `+${phone91}`,
    Body: `${code} is your ${env('OTP_SHOP_NAME') || 'jewellery shop'} login code. It expires in ${minutes} minutes. Do not share it.`,
  })
  if (env('TWILIO_MESSAGING_SERVICE_SID')) form.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'))
  else form.set('From', env('TWILIO_FROM'))
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${sid}:${env('TWILIO_AUTH_TOKEN')}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.message || `Twilio error ${res.status}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let phone = ''
  try { phone = String((await req.json())?.phone || '') } catch { return json({ error: 'Bad request' }, 400) }
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (!/^[6-9]\d{9}$/.test(digits)) return json({ error: 'Enter a valid 10-digit mobile number.' }, 400)

  const provider = env('SMS_PROVIDER').toLowerCase()
  if (provider !== 'msg91' && provider !== 'twilio') return json({ error: 'OTP_NOT_CONFIGURED' }, 503)

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.rpc('customer_create_otp', { p_phone: digits })
  if (error) {
    if (/NOT_REGISTERED/.test(error.message)) return json({ error: 'NOT_REGISTERED' }, 404)
    return json({ error: error.message }, 429)
  }
  const otp = data as { code: string; expires_in_seconds: number; resend_in_seconds: number }
  try {
    if (provider === 'msg91') await sendMsg91(`91${digits}`, otp.code)
    else await sendTwilio(`91${digits}`, otp.code, Math.round(otp.expires_in_seconds / 60))
  } catch (err) {
    // Not sent: remove the code so the customer can try again straight away.
    await admin.rpc('customer_discard_otp', { p_phone: digits })
    return json({ error: `The OTP could not be sent: ${(err as Error).message}` }, 502)
  }
  return json({ ok: true, expires_in_seconds: otp.expires_in_seconds, resend_in_seconds: otp.resend_in_seconds })
})
