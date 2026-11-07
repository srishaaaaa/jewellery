// customer-otp: makes a one-time code and sends it. Codes are stored only as salted hashes; the database functions check them
// (5 tries per code, expires after Settings -> otp_minutes).
//
//   { phone }              login code by SMS
//   { email }              login code by email (same answer whether or not the address is a customer's)
//   { token, new_email }   logged-in customer proving a new or existing email
//   { token, new_phone }   logged-in customer proving a new mobile number
//
// Secrets. Until these are set, customers are told the option is not switched on and nothing is sent.
//   SMS_PROVIDER=msg91   MSG91_AUTH_KEY, MSG91_TEMPLATE_ID   (DLT-approved OTP template with ##OTP##)
//   SMS_PROVIDER=twilio  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID)
//   RESEND_API_KEY, EMAIL_FROM   for email codes
//   OTP_SHOP_NAME        optional, the shop's name in messages
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, env, json } from '../_shared/http.ts'
import { emailReady, sendEmail, sendSmsOtp, shopName, smsProvider } from '../_shared/senders.ts'

type Otp = { code: string; expires_in_seconds: number; resend_in_seconds: number; status?: string; key?: string }
const emailCode = (to: string, otp: Otp, purpose: string) => sendEmail(to, `${otp.code} is your ${shopName()} code`,
  `${otp.code} is your code to ${purpose}. It expires in ${Math.round(otp.expires_in_seconds / 60)} minutes.\n\nDo not share it with anyone. If you did not ask for this, you can ignore this email.\n\n${shopName()}`)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let input: Record<string, unknown>
  try { input = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
  const text = (k: string) => String(input?.[k] || '').trim()
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  const done = (otp: Otp) => json({ ok: true, expires_in_seconds: otp.expires_in_seconds, resend_in_seconds: otp.resend_in_seconds })

  // ── Logged-in customer proving a new address ──
  if (text('token')) {
    const channel = text('new_email') ? 'email_change' : text('new_phone') ? 'phone_change' : ''
    if (!channel) return json({ error: 'Bad request' }, 400)
    if (channel === 'email_change' ? !emailReady() : !smsProvider()) return json({ error: channel === 'email_change' ? 'EMAIL_NOT_CONFIGURED' : 'OTP_NOT_CONFIGURED' }, 503)
    const { data, error } = await admin.rpc('customer_create_change_otp', { p_token: text('token'), p_channel: channel, p_target: text('new_email') || text('new_phone') })
    if (error) return /SESSION_EXPIRED/.test(error.message) ? json({ error: 'SESSION_EXPIRED' }, 401) : json({ error: error.message }, 400)
    const otp = data as Otp
    try {
      if (channel === 'email_change') await emailCode(otp.key as string, otp, 'verify this email for your customer account')
      else await sendSmsOtp(`91${otp.key}`, otp.code, Math.round(otp.expires_in_seconds / 60))
    } catch (err) {
      await admin.rpc('otp_discard', { p_channel: channel, p_key: otp.key })
      return json({ error: `The code could not be sent: ${(err as Error).message}` }, 502)
    }
    return done(otp)
  }

  // ── Email login ──
  if (text('email')) {
    if (!emailReady()) return json({ error: 'EMAIL_NOT_CONFIGURED' }, 503)
    const email = text('email').toLowerCase()
    const generic = json({ ok: true, resend_in_seconds: 60 })
    const { data, error } = await admin.rpc('customer_create_email_otp', { p_email: email })
    // Waiting periods and unknown addresses answer the same, so nobody can test which addresses are customers.
    if (error) return generic
    const otp = data as Otp
    if (otp.status === 'unknown') return generic
    try {
      if (otp.status === 'shared') {
        await sendEmail(email, `Logging in to ${shopName()}`, `This email is used on more than one customer account, so it cannot be used to log in. Please log in with your mobile number, or ask the shop to update it.\n\n${shopName()}`)
      } else {
        await emailCode(email, otp, 'log in to your customer account')
      }
    } catch (err) {
      await admin.rpc('otp_discard', { p_channel: 'email', p_key: email })
      return json({ error: `The code could not be sent: ${(err as Error).message}` }, 502)
    }
    return generic
  }

  // ── Mobile login ──
  const digits = text('phone').replace(/\D/g, '').slice(-10)
  if (!/^[6-9]\d{9}$/.test(digits)) return json({ error: 'Enter a valid 10-digit mobile number.' }, 400)
  if (!smsProvider()) return json({ error: 'OTP_NOT_CONFIGURED' }, 503)
  const { data, error } = await admin.rpc('customer_create_otp', { p_phone: digits })
  if (error) {
    if (/NOT_REGISTERED/.test(error.message)) return json({ error: 'NOT_REGISTERED' }, 404)
    return json({ error: error.message }, 429)
  }
  const otp = data as Otp
  try {
    await sendSmsOtp(`91${digits}`, otp.code, Math.round(otp.expires_in_seconds / 60))
  } catch (err) {
    // Not sent: remove the code so the customer can try again straight away.
    await admin.rpc('customer_discard_otp', { p_phone: digits })
    return json({ error: `The OTP could not be sent: ${(err as Error).message}` }, 502)
  }
  return done(otp)
})
