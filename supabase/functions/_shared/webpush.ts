// Web Push with only the standard Web Crypto API: message encryption (RFC 8291, aes128gcm) and server identity (VAPID, RFC 8292).
export type PushTarget = { endpoint: string; p256dh: string; auth: string }

const enc = new TextEncoder()

export const fromB64u = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}
export const toB64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

/** Encrypts a message so only the browser that made the subscription can read it. */
export async function encryptPayload(payload: string, p256dh: string, authSecret: string) {
  const uaPublic = fromB64u(p256dh)
  const auth = fromB64u(authSecret)
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256))
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(enc.encode(payload), new Uint8Array([2]))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain))
  const recordSize = new Uint8Array([0, 0, 16, 0]) // 4096
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, cipher)
}

/** Signed token telling the push service which server is sending. */
export async function vapidToken(audience: string, subject: string, publicKey: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const pub = fromB64u(publicKey)
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: toB64u(pub.slice(1, 33)), y: toB64u(pub.slice(33, 65)), d: privateKey, ext: true,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const part = (o: unknown) => toB64u(enc.encode(JSON.stringify(o)))
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: audience, exp: nowSeconds + 12 * 3600, sub: subject })}`
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)))
  return `${unsigned}.${toB64u(sig)}`
}

/** Sends one push. Returns the push service's HTTP status (404 / 410 mean the device has gone away). */
export async function sendPush(target: PushTarget, payload: string, vapid: { publicKey: string; privateKey: string; subject: string }) {
  const body = await encryptPayload(payload, target.p256dh, target.auth)
  const token = await vapidToken(new URL(target.endpoint).origin, vapid.subject, vapid.publicKey, vapid.privateKey)
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${token}, k=${vapid.publicKey}`, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    body,
  })
  return res.status
}
