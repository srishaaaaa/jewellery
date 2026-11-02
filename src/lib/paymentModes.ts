/** Payment modes offered everywhere a payment is taken; "mixed" splits one payment across several modes. */
export const PAYMENT_MODES = ['cash', 'upi', 'card', 'bank', 'cheque', 'mixed'] as const
export type PaymentMode = typeof PAYMENT_MODES[number]
export const SPLIT_MODES = ['cash', 'upi', 'card', 'bank', 'cheque'] as const
export type SplitMode = typeof SPLIT_MODES[number]
export type SplitAmounts = Partial<Record<SplitMode, string>>

const LABELS: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', qr: 'UPI', gpay: 'UPI', card: 'Card', bank: 'Bank', bank_transfer: 'Bank', cheque: 'Cheque', mixed: 'Mixed', split: 'Mixed',
}

export const paymentModeLabel = (mode: string | null | undefined) => {
  const key = String(mode || '').toLowerCase()
  return LABELS[key] || (key ? key.toUpperCase() : '—')
}

export const splitTotal = (split: SplitAmounts) =>
  SPLIT_MODES.reduce((sum, m) => sum + (Number(split[m]) || 0), 0)

/** "Cash ₹2,000 + UPI ₹3,000" for notes and receipts. */
export const splitSummary = (split: SplitAmounts) =>
  SPLIT_MODES.filter(m => (Number(split[m]) || 0) > 0)
    .map(m => `${LABELS[m]} ₹${(Number(split[m]) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)
    .join(' + ')

/** Checks a mixed payment adds up to the amount due; returns an error message or ''. */
export function splitError(mode: PaymentMode, split: SplitAmounts, total: number) {
  if (mode !== 'mixed') return ''
  const sum = Math.round(splitTotal(split) * 100) / 100
  const due = Math.round(total * 100) / 100
  if (SPLIT_MODES.filter(m => (Number(split[m]) || 0) > 0).length < 2) return 'For Mixed, enter amounts for at least two payment modes.'
  if (sum !== due) return `Mixed amounts add up to ₹${sum.toLocaleString('en-IN')} but ₹${due.toLocaleString('en-IN')} is due.`
  return ''
}

/** Reads "Split: Cash ₹2,000 + UPI ₹3,000" back out of a note: [["Cash", 2000], ["UPI", 3000]]. */
export function parseSplitNote(text: string | null | undefined): Array<[string, number]> {
  const m = /Split:\s*([^•\n]+)/i.exec(String(text || ''))
  if (!m) return []
  return m[1].split('+').map(part => {
    const p = /([A-Za-z]+)\s*₹\s*([\d,.]+)/.exec(part.trim())
    return p ? [p[1], Number(p[2].replace(/,/g, '')) || 0] as [string, number] : null
  }).filter((x): x is [string, number] => !!x && x[1] > 0)
}

/** A note without its "Split: …" part (the split is shown separately). */
export const stripSplitNote = (text: string | null | undefined) =>
  String(text || '').replace(/\s*(•\s*)?Split:\s*[^•\n]+/i, '').replace(/^\s*•\s*|\s*•\s*$/g, '').trim()
