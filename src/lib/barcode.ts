import JsBarcode from 'jsbarcode'

/** Normalize any scanned or user-entered barcode to a consistent UPPERCASE trimmed string. */
export const normalizeBarcode = (code: string | null | undefined): string => {
  return (code ?? '').trim().toUpperCase()
}

export interface LabelSizeConfig {
  id: string
  name: string
  labelsPerRow: number
  widthMm: number
  heightMm: number
  horizontalGapMm: number
  isCustom?: boolean
  /** Die-cut label sheet printed on a normal printer as whole A4 pages (not a roll) */
  sheet?: 'A4'
}

export const DEFAULT_LABEL_SIZES: LabelSizeConfig[] = [
  { id: '1_35x22', name: '35 × 22 mm (Compact Tag)', labelsPerRow: 1, widthMm: 35, heightMm: 22, horizontalGapMm: 0 },
  { id: '2_38x25', name: '38 × 25 mm (Tag / Jewelry)', labelsPerRow: 1, widthMm: 38, heightMm: 25, horizontalGapMm: 0 },
  { id: '1_50x25', name: '50 × 25 mm (Standard Compact)', labelsPerRow: 1, widthMm: 50, heightMm: 25, horizontalGapMm: 0 },
  { id: '2_50x25', name: '50 × 38 mm (Retail Standard)', labelsPerRow: 1, widthMm: 50, heightMm: 38, horizontalGapMm: 0 },
  { id: '1_60x40', name: '60 × 40 mm (Shipping / Product)', labelsPerRow: 1, widthMm: 60, heightMm: 40, horizontalGapMm: 0 },
  { id: '1_100x50', name: '100 × 50 mm (Large Carton / Box)', labelsPerRow: 1, widthMm: 100, heightMm: 50, horizontalGapMm: 0 },
  // Rolls with 2 or 3 labels side by side (e.g. TVS LP 46 Dlite): the page is the
  // full roll width, one row of stickers per page.
  { id: '2up_35x22', name: '35 × 22 mm × 2-Up (Roll, side-by-side)', labelsPerRow: 2, widthMm: 35, heightMm: 22, horizontalGapMm: 0 },
  { id: '2up_50x25', name: '50 × 25 mm × 2-Up (Roll, side-by-side)', labelsPerRow: 2, widthMm: 50, heightMm: 25, horizontalGapMm: 2 },
  { id: '3up_35x22', name: '35 × 22 mm × 3-Up (Roll, side-by-side)', labelsPerRow: 3, widthMm: 35, heightMm: 22, horizontalGapMm: 0 },
  // A4 sheets of die-cut labels, printed on a normal printer
  { id: 'a4_4x48x25', name: 'A4 Sheet — 4 columns × 48 × 25 mm', labelsPerRow: 4, widthMm: 48, heightMm: 25, horizontalGapMm: 2.5, sheet: 'A4' },
  { id: 'a4_4x48x30', name: 'A4 Sheet — 4 columns × 48 × 30 mm', labelsPerRow: 4, widthMm: 48, heightMm: 30, horizontalGapMm: 2.5, sheet: 'A4' },
  { id: 'a4_3x63x38', name: 'A4 Sheet — 3 columns × 63 × 38 mm', labelsPerRow: 3, widthMm: 63, heightMm: 38, horizontalGapMm: 2.5, sheet: 'A4' },
  { id: 'a4_2x99x34', name: 'A4 Sheet — 2 columns × 99 × 34 mm (Address label)', labelsPerRow: 2, widthMm: 99, heightMm: 34, horizontalGapMm: 2.5, sheet: 'A4' },
]

/**
 * Lays stickers out on whole A4 pages for a label sheet: as many rows as fit,
 * the grid centred on the page. This matches standard sheets closely (e.g. a
 * 3 × 7 sheet of 63.5 × 38.1 mm labels has ~15 mm top and ~7 mm side margins).
 */
export function buildA4SheetPages(
  stickers: string[],
  size: Pick<LabelSizeConfig, 'labelsPerRow' | 'widthMm' | 'heightMm' | 'horizontalGapMm'>
): { html: string; css: string } {
  const cols = Math.max(1, size.labelsPerRow)
  const gap = size.horizontalGapMm || 0
  const rows = Math.max(1, Math.floor((297 - 10) / size.heightMm))
  const perPage = cols * rows
  const sideMm = Math.max(0, (210 - cols * size.widthMm - (cols - 1) * gap) / 2)
  const topMm = Math.max(0, (297 - rows * size.heightMm) / 2)
  const pages: string[] = []
  for (let i = 0; i < stickers.length; i += perPage) {
    pages.push(`<div class="a4-sheet-page">${stickers.slice(i, i + perPage).join('')}</div>`)
  }
  const css = `
    .a4-sheet-page {
      width: 210mm;
      height: 297mm;
      padding: ${topMm.toFixed(2)}mm ${sideMm.toFixed(2)}mm 0 ${sideMm.toFixed(2)}mm;
      display: grid;
      grid-template-columns: repeat(${cols}, ${size.widthMm}mm);
      grid-auto-rows: ${size.heightMm}mm;
      column-gap: ${gap}mm;
      row-gap: 0;
      align-content: start;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
    }
    .a4-sheet-page:last-child { break-after: auto; page-break-after: auto; }
  `
  return { html: pages.join(''), css }
}

export interface BarcodeSettings {
  printerType: 'label' | 'regular'
  selectedSizeId: string
  showSalePrice: boolean
  showCompanyName: boolean
  showItemName: boolean
  showDiscount: boolean
}

export const DEFAULT_BARCODE_SETTINGS: BarcodeSettings = {
  printerType: 'label',
  selectedSizeId: '2_38x25',
  showSalePrice: true,
  showCompanyName: true,
  showItemName: true,
  showDiscount: false,
}

const SETTINGS_KEY = 'mahalashmi_stores_barcode_settings'
const LEGACY_SETTINGS_KEY = 'chaji_barcode_settings'
const CUSTOM_SIZES_KEY = 'mahalashmi_stores_custom_label_sizes'
const LEGACY_CUSTOM_SIZES_KEY = 'chaji_custom_label_sizes'

export function getStoredBarcodeSettings(): BarcodeSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (raw) return { ...DEFAULT_BARCODE_SETTINGS, ...JSON.parse(raw) }
  } catch (e) {
    console.error('Failed to parse barcode settings:', e)
  }
  return DEFAULT_BARCODE_SETTINGS
}

export function saveStoredBarcodeSettings(settings: BarcodeSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save barcode settings:', e)
  }
}

export function getStoredCustomSizes(): LabelSizeConfig[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SIZES_KEY) || localStorage.getItem(LEGACY_CUSTOM_SIZES_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.error('Failed to parse custom label sizes:', e)
  }
  return []
}

export function saveStoredCustomSize(size: LabelSizeConfig): LabelSizeConfig[] {
  const existing = getStoredCustomSizes().filter((s) => s.id !== size.id)
  const updated = [...existing, { ...size, isCustom: true }]
  try {
    localStorage.setItem(CUSTOM_SIZES_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Failed to save custom label size:', e)
  }
  return updated
}

export function getAllLabelSizes(): LabelSizeConfig[] {
  return [...DEFAULT_LABEL_SIZES, ...getStoredCustomSizes()]
}

export interface BarcodeQueueItem {
  id: string
  productId: number
  productName: string
  variantId?: string | null
  variantName?: string
  barcodeValue: string
  price: number
  costPrice?: number
  noOfLabels: number
  header: string
  line1: string
  line2: string
  line3: string
  line4: string
  selected: boolean
}

export interface BarcodeRenderOptions {
  width?: number
  height?: number
  displayValue?: boolean
  fontSize?: number
  font?: string
  textMargin?: number
  margin?: number
  lineColor?: string
  background?: string
}

/**
 * Render a CODE128 barcode directly into an SVG element.
 */
export function renderBarcodeSvg(
  svgElement: SVGSVGElement,
  value: string,
  options?: BarcodeRenderOptions
) {
  if (!svgElement || !value) return

  try {
    JsBarcode(svgElement, value.trim(), {
      format: 'CODE128',
      width: options?.width ?? 1.5,
      height: options?.height ?? 36,
      displayValue: options?.displayValue ?? true,
      fontSize: options?.fontSize ?? 11,
      font: options?.font ?? 'monospace',
      textMargin: options?.textMargin ?? 1,
      margin: options?.margin ?? 4,
      lineColor: options?.lineColor ?? '#000000',
      background: options?.background ?? '#ffffff',
    })
  } catch (err) {
    console.error('[renderBarcodeSvg] Failed to generate barcode:', err)
  }
}

/**
 * Generate a standalone SVG string for a CODE128 barcode.
 * Executes synchronously in the browser without requiring external CDN scripts.
 */
export function generateBarcodeSvgString(
  value: string,
  options?: BarcodeRenderOptions
): string {
  if (typeof document === 'undefined' || !value) return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    renderBarcodeSvg(svg, value, options)
    return svg.outerHTML || new XMLSerializer().serializeToString(svg)
  } catch (err) {
    console.error('[generateBarcodeSvgString] Failed to generate barcode SVG string:', err)
    return ''
  }
}

/** One printer dot at 203 dpi (TVS LP 46 and most thermal label printers). */
const THERMAL_DOT_MM = 25.4 / 203

/**
 * Barcode markup for a printed label: bars drawn at an exact size in mm, with
 * every bar a whole number of 203-dpi printer dots. A barcode that is drawn at
 * one size and then shrunk by CSS lands its bars between printer dots, so bars
 * come out uneven and scanners misread or refuse them. The number is printed
 * as text underneath instead of inside the SVG, so it stays sharp.
 */
export function labelBarcodeHtml(
  value: string,
  opts: { labelWidthMm: number; barHeightMm: number; sidePaddingMm?: number; fontSizePt?: number }
): string {
  if (typeof document === 'undefined' || !value) return ''
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  // 1 unit per module; the real size is set in mm below
  renderBarcodeSvg(svg, value, { width: 1, height: 100, margin: 0, displayValue: false })
  // JsBarcode writes the size as e.g. "123px"
  const modules = parseFloat(svg.getAttribute('width') || '') || 0
  if (!modules) return ''
  // The label's white side padding doubles as the scanner's quiet zone (at least 1.5 mm each side).
  // On a 35 mm label this leaves room for 2-dot bars, which read far more reliably than 1-dot bars.
  const availableMm = Math.max(8, opts.labelWidthMm - 2 * Math.max(opts.sidePaddingMm ?? 1.5, 1.5) - 0.2)
  const dotsPerModule = Math.max(1, Math.min(3, Math.floor(availableMm / (modules * THERMAL_DOT_MM))))
  const widthMm = modules * dotsPerModule * THERMAL_DOT_MM
  svg.setAttribute('viewBox', `0 0 ${modules} 100`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  // flex: none + min-width so no parent flex/max-width rule can squeeze the bars
  svg.setAttribute('style', `display:block;flex:none;margin:0 auto;width:${widthMm.toFixed(3)}mm;min-width:${widthMm.toFixed(3)}mm;height:${opts.barHeightMm.toFixed(2)}mm;max-width:none;max-height:none;`)
  const text = value.trim().replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  return `<div style="display:flex;flex-direction:column;align-items:center;flex:none;">${svg.outerHTML}<div style="font-family:Arial,sans-serif;font-size:${opts.fontSizePt ?? 6.5}pt;font-weight:700;letter-spacing:0.4px;line-height:1;margin-top:0.3mm;color:#000;text-align:center;white-space:nowrap;">${text}</div></div>`
}

/**
 * Format barcode for UI display.
 */
export function formatBarcodeDisplay(value?: string | null): string {
  if (!value) return '—'
  return String(value).trim()
}

/**
 * Validate barcode format (alphanumeric, 4 to 32 chars).
 */
export function isValidBarcodeValue(value: string): boolean {
  return /^[A-Z0-9_-]{4,32}$/i.test(value.trim())
}
