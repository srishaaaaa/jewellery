export function normalizePhone(input: string): string | null {
  if (!input) return null

  // Strip everything except digits
  const raw = input.replace(/\D/g, '')
  if (!raw) return null

  let digits = raw

  if (digits.startsWith('91') && digits.length === 12) {
    // Already 91XXXXXXXXXX
  } else if (digits.length === 10 && /^[6-9]/.test(digits)) {
    digits = '91' + digits
  } else if (digits.startsWith('0') && (digits.length === 11)) {
    digits = '91' + digits.slice(1)
  } else {
    return null
  }

  // Indian mobile starts with 6-9
  if (!/^91[6-9]\d{9}$/.test(digits)) return null

  return digits
}

export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null
}

export function getSubscriberDigits(input: string): string | null {
  const normalized = normalizePhone(input)
  return normalized ? normalized.slice(2) : null
}

export function normalizePhoneForWhatsApp(input: string): string {
  if (!input) return ''
  const digits = input.replace(/\D/g, '')
  if (!digits) return ''

  if (digits.length >= 12 && digits.startsWith('91')) {
    return digits
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return '91' + digits.slice(1)
  }
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return '91' + digits
  }
  return digits
}

/** Formats a phone number for display with the country code separated, e.g. "+91 81229 21906". */
export function formatPhoneDisplay(input: string): string {
  if (!input) return ''
  const normalized = normalizePhone(input)
  if (!normalized) return input
  const subscriber = normalized.slice(2)
  return `+91 ${subscriber.slice(0, 5)} ${subscriber.slice(5)}`
}

export function toWhatsAppUrl(phone: string, text?: string): string {
  const normalized = normalizePhoneForWhatsApp(phone) || normalizePhone(phone)
  const queryParams: string[] = []

  if (normalized) {
    queryParams.push(`phone=${normalized}`)
  }
  if (text) {
    queryParams.push(`text=${encodeURIComponent(text)}`)
  }

  // Phones: api.whatsapp.com opens the WhatsApp app. Computers: go straight to
  // WhatsApp Web - the desktop-app hand-off (and wa.me redirects) turn emojis
  // like 🔔 🧾 📞 into "�", while WhatsApp Web keeps them intact.
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const base = isMobile ? 'https://api.whatsapp.com/send' : 'https://web.whatsapp.com/send'
  return `${base}${queryParams.length > 0 ? `?${queryParams.join('&')}` : ''}`
}
