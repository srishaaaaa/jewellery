import { useSettingsStore } from '../store/store'
import { LOGO_BASE64 } from './logoBase64'

const FORMAT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
}

/** Resolves the logo to embed in generated PDFs: the store's uploaded logo when set, else the bundled default. jsPDF needs a matching format string per image type, so this parses it out of the data URI. */
export function getActiveLogo(): { base64: string; format: string } | null {
  const dynamic = useSettingsStore.getState().settings?.logoBase64
  if (dynamic) {
    const mimeMatch = /^data:([^;]+);/.exec(dynamic)
    const format = mimeMatch ? FORMAT_BY_MIME[mimeMatch[1]] : undefined
    if (format) return { base64: dynamic, format }
  }
  if (LOGO_BASE64) return { base64: LOGO_BASE64, format: 'JPEG' }
  return null
}
