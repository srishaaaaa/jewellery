/**
 * GST split for bills: CGST and SGST are each half of the GST.
 * Bills store only the GST amount, so the rate is worked out from the taxable value
 * (subtotal after discounts). It is shown only when it comes to a normal rate such as 3%, 5% or 18%.
 */
export const gstSplit = (gstAmount: number, taxableValue: number) => {
  const gst = Math.max(0, Number(gstAmount) || 0)
  const base = Math.max(0, Number(taxableValue) || 0)
  const cgst = Math.round((gst / 2) * 100) / 100
  const sgst = Math.round((gst - cgst) * 100) / 100
  let rate: number | null = null
  if (gst > 0 && base > 0) {
    const raw = (gst / base) * 100
    // Nearest quarter percent; GST amounts are rounded to paise, so allow a small difference.
    const nice = Math.round(raw * 4) / 4
    if (nice > 0 && Math.abs(raw - nice) <= 0.02) rate = nice
  }
  const pct = (n: number) => `${Number(n.toFixed(3))}%`
  return {
    cgst,
    sgst,
    rate,
    cgstLabel: rate ? `CGST (${pct(rate / 2)})` : 'CGST',
    sgstLabel: rate ? `SGST (${pct(rate / 2)})` : 'SGST',
    totalLabel: rate ? `Total GST (${pct(rate)})` : 'Total GST',
  }
}
