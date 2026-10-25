const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

const chunk = (n: number): string => {
  let out = ''
  if (n >= 100) { out += `${ONES[Math.floor(n / 100)]} Hundred `; n %= 100 }
  if (n >= 20) out += `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''} `
  else if (n > 0) out += `${ONES[n]} `
  return out.trim()
}

/** Indian-system amount in words, e.g. 125000.5 → "One Lakh Twenty Five Thousand Rupees and Fifty Paise Only". */
export function amountInWords(amount: number): string {
  const value = Math.abs(Number(amount) || 0)
  if (value === 0) return 'Zero Rupees Only'
  let n = Math.floor(value)
  const paise = Math.round((value - n) * 100)
  const crore = Math.floor(n / 10000000); n %= 10000000
  const lakh = Math.floor(n / 100000); n %= 100000
  const thousand = Math.floor(n / 1000); n %= 1000
  const parts = [
    crore ? `${chunk(crore)} Crore` : '',
    lakh ? `${chunk(lakh)} Lakh` : '',
    thousand ? `${chunk(thousand)} Thousand` : '',
    n ? chunk(n) : '',
  ].filter(Boolean)
  const rupees = parts.length ? parts.join(' ') : 'Zero'
  return `${rupees} Rupees${paise ? ` and ${chunk(paise)} Paise` : ''} Only`
}
