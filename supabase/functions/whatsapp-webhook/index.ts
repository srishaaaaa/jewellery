// whatsapp-webhook: Meta reports here whether each WhatsApp message was delivered or failed.
// This is the only place a message becomes "delivered". Secrets: WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET.
// Deploy with --no-verify-jwt: Meta cannot send a Supabase key, so its signature is checked instead.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { env } from '../_shared/http.ts'

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function validSignature(raw: string, header: string) {
  const secret = env('WHATSAPP_APP_SECRET')
  if (!secret || !header.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const given = header.slice(7)
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    const token = env('WHATSAPP_VERIFY_TOKEN')
    if (token && q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === token) return new Response(q.get('hub.challenge') || '')
    return new Response('Not allowed', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256') || ''))) return new Response('Not allowed', { status: 401 })

  let body: { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id: string; status: string; errors?: Array<{ title?: string; message?: string }> }> } }> }> }
  try { body = JSON.parse(raw) } catch { return new Response('Bad request', { status: 400 }) }

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } })
  for (const entry of body.entry || []) for (const change of entry.changes || []) for (const s of change.value?.statuses || []) {
    const status = s.status === 'read' || s.status === 'delivered' ? 'delivered' : s.status === 'failed' ? 'failed' : s.status === 'sent' ? 'sent' : ''
    if (!status) continue
    await admin.rpc('record_delivery_report', { p_ref: s.id, p_status: status, p_error: s.errors?.[0]?.message || s.errors?.[0]?.title || '' })
  }
  return new Response('ok')
})
