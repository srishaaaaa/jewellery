// shop-session: checks the admin / staff passcode (same check as the login screen) and, only if it
// is right, signs in the shop's Supabase account and returns its session to the POS.
// The shop account's password never reaches the browser: it lives in this function's secrets.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   SHOP_EMAIL     e.g. pos@yourshop.in   (any address; it is only the shop's database login)
//   SHOP_PASSWORD  a long random password
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { corsHeaders, env, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let login = ''
  let passcode = ''
  try {
    const body = await req.json()
    login = String(body?.login || '').trim()
    passcode = String(body?.passcode || '').trim()
  } catch { return json({ error: 'Bad request' }, 400) }
  if (!login || !passcode) return json({ error: 'Enter your login ID and passcode.' }, 400)

  const url = env('SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = env('SUPABASE_ANON_KEY')
  const email = env('SHOP_EMAIL')
  const password = env('SHOP_PASSWORD')
  if (!email || !password) return json({ error: 'Shop sign-in is not set up yet (SHOP_EMAIL / SHOP_PASSWORD secrets).' }, 500)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: check, error: checkErr } = await admin.rpc('pos_login', { p_login: login, p_pass: passcode })
  if (checkErr) return json({ error: checkErr.message }, 500)
  const result = (check || {}) as { role?: string | null; name?: string; panels?: unknown; use_builtin?: boolean }
  if (!result.role) {
    return json({ error: result.use_builtin
      ? 'Save the admin and staff passcodes in Settings -> Login Passcodes first.'
      : 'Invalid login ID or passcode.' }, 401)
  }

  const pub = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let signed = await pub.auth.signInWithPassword({ email, password })
  if (signed.error) {
    // First use: create the shop account (only this function knows its password).
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'shop' } })
    if (created.error && !/already|registered|exists/i.test(created.error.message)) return json({ error: created.error.message }, 500)
    if (created.error) {
      // The account exists with another password (secret changed): reset it to the secret.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const user = list?.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
      if (!user) return json({ error: 'Shop account could not be found.' }, 500)
      await admin.auth.admin.updateUserById(user.id, { password, app_metadata: { ...(user.app_metadata || {}), role: 'shop' } })
    }
    signed = await pub.auth.signInWithPassword({ email, password })
    if (signed.error) return json({ error: signed.error.message }, 500)
  }
  // Make sure the account carries the shop role (that is what opens the tables after the lock-down).
  if (signed.data.user?.app_metadata?.role !== 'shop') {
    await admin.auth.admin.updateUserById(signed.data.user!.id, { app_metadata: { ...(signed.data.user!.app_metadata || {}), role: 'shop' } })
    signed = await pub.auth.signInWithPassword({ email, password })
    if (signed.error) return json({ error: signed.error.message }, 500)
  }

  return json({
    access_token: signed.data.session?.access_token,
    refresh_token: signed.data.session?.refresh_token,
    role: result.role,
    name: result.name || null,
    panels: Array.isArray(result.panels) ? result.panels : null,
  })
})
