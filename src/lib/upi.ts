/** UPI deep links and the rotating payment reference. */
/** Reference for the current time block: changes every `minutes` minutes (display / matching only). */
export function upiReference(base: string, minutes: number, now = Date.now()) {
  const block = Math.floor(now / (Math.max(1, minutes) * 60000))
  const clean = String(base || 'PAY').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20) || 'PAY'
  return `${clean}${block.toString(36).toUpperCase().slice(-6)}`
}

/** Standard UPI deep link (NPCI format), every value URL-encoded. */
export function upiUri(o: { upiId: string; name: string; amount: number; note: string; ref: string }) {
  const p = new URLSearchParams()
  p.set('pa', o.upiId.trim())
  p.set('pn', o.name.trim())
  p.set('am', (Math.round(o.amount * 100) / 100).toFixed(2))
  p.set('cu', 'INR')
  p.set('tn', o.note.slice(0, 60))
  p.set('tr', o.ref)
  return `upi://pay?${p.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`
}

export const isValidUpiId = (v: string) => /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/.test(v.trim())

export const paymentLinkUrl = (token: string) => `${window.location.origin}/customer/pay/${token}`
