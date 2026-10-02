/**
 * Standardized date formatting utility for DD-MM-YYYY format (Indian locale)
 * Ensures consistent date display across the entire application
 */

export const formatDateDDMMYYYY = (date: string | Date | null | undefined): string => {
  if (!date) return ''

  try {
    // A bare YYYY-MM-DD is read as local midnight; full timestamps (created_at,
    // credit_paid_at, ...) are parsed as-is and shown in local time.
    const d = typeof date === 'string'
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? `${date.trim()}T00:00:00` : date)
      : date
    if (isNaN(d.getTime())) return ''

    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()

    return `${day}-${month}-${year}`
  } catch {
    return ''
  }
}

/**
 * Parse DD-MM-YYYY input (from form fields) back to ISO string (YYYY-MM-DD)
 * for storage in database
 */
export const parseDDMMYYYY = (dateString: string): string => {
  if (!dateString) return ''

  try {
    const [day, month, year] = dateString.split('-').map(Number)
    if (!day || !month || !year) return ''

    const d = new Date(year, month - 1, day)
    if (isNaN(d.getTime())) return ''

    // Local date (toISOString would shift it to the previous day in IST)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return ''
  }
}

/**
 * Convert ISO date (YYYY-MM-DD) to DD-MM-YYYY for display
 */
export const isoToDisplayDate = (isoDate: string | null | undefined): string => {
  if (!isoDate) return ''
  return formatDateDDMMYYYY(isoDate)
}

/**
 * Convert display date (DD-MM-YYYY) to ISO date (YYYY-MM-DD) for database
 */
export const displayToIsoDate = (displayDate: string): string => {
  if (!displayDate) return ''
  return parseDDMMYYYY(displayDate)
}
