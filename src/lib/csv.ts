import { formatPhoneDisplay } from './phone'

/**
 * Helpers so CSV exports open cleanly in Excel / Google Sheets / iPhone "View".
 * Excel turns long digit strings into 9.18123E+11 and converts dates into real
 * dates that show as ######## in a default-width column; CSV cannot carry column
 * widths or cell types, so these values are written as text instead.
 */

// Invisible WORD JOINER: makes Excel keep the cell as text; nothing shows on screen
const KEEP_AS_TEXT = '⁠'

/** "+91 81229 21906" (text in every spreadsheet app, never scientific notation). */
export const csvPhone = (phone: string | null | undefined): string => {
  const raw = String(phone || '').trim()
  if (!raw) return ''
  const formatted = formatPhoneDisplay(raw)
  // Numbers that are not Indian mobiles: still keep all digits visible
  return /^\d{11,}$/.test(formatted) ? KEEP_AS_TEXT + formatted : formatted
}

/** "27-09-2026", or "27-09-2026 07:13 PM" with time — shown exactly as written. */
export const csvDate = (value: string | Date | null | undefined, withTime = false): string => {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value)
  if (isNaN(d.getTime())) return ''
  const date = `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`
  if (!withTime) return KEEP_AS_TEXT + date
  const h = d.getHours()
  const time = `${String(h % 12 || 12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return `${KEEP_AS_TEXT}${date} ${time}`
}

/** Build CSV text (quoted cells, Windows line endings). */
export const toCsv = (rows: Array<Array<string | number | null | undefined>>): string =>
  rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')

/** Downloads rows as a UTF-8 CSV file (with BOM so Excel reads ₹ and Tamil text correctly). */
export const downloadCsv = (fileName: string, rows: Array<Array<string | number | null | undefined>>) => {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
