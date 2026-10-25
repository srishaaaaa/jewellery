export type PrintPaper = 'thermal' | 'sheet'
export type PrintSize = '58' | '80' | 'a4' | 'a5'
export type PrintPrefs = { paper: PrintPaper; size: PrintSize }

const KEY = 'jewellery_print_prefs'
const DEFAULT: PrintPrefs = { paper: 'thermal', size: '80' }

/** Last printer type / paper size picked in Print Settings (per device). */
export function loadPrintPrefs(): PrintPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as PrintPrefs | null
    if (saved && (saved.paper === 'thermal' || saved.paper === 'sheet') && ['58', '80', 'a4', 'a5'].includes(saved.size)) return saved
  } catch { /* storage blocked or bad value */ }
  return DEFAULT
}

export function savePrintPrefs(prefs: PrintPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* storage blocked */ }
}

export const thermalWidth = (prefs: PrintPrefs): 58 | 80 => (prefs.size === '58' ? 58 : 80)

/** Prints the current page (the on-screen invoice sheet) on A4 or A5. */
export function printSheet(size: 'a4' | 'a5') {
  const style = document.createElement('style')
  style.textContent = `@media print { @page { size: ${size === 'a5' ? 'A5' : 'A4'} portrait; margin: ${size === 'a5' ? '8mm' : '12mm'}; } }`
  document.head.appendChild(style)
  const cleanup = () => { style.remove(); window.removeEventListener('afterprint', cleanup) }
  window.addEventListener('afterprint', cleanup)
  window.print()
}
