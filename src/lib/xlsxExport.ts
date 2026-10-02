import ExcelJS from 'exceljs'

export interface XlsxColumn {
  header: string
  /** Column width in roughly Excel-character units (~7px each). */
  width: number
}

/**
 * Builds and downloads a real .xlsx workbook with explicit column widths.
 *
 * Plain CSV cannot carry column-width metadata at all — every spreadsheet
 * app just falls back to its own narrow default, which is why exported
 * reports opened in Google Sheets/Excel always showed truncated headers
 * ("Today's Re...", "Product N...") until the viewer manually widened
 * every column. A real workbook fixes that on first open.
 */
export async function downloadXlsx(params: {
  filename: string
  sheetName: string
  columns: XlsxColumn[]
  rows: Array<Array<string | number | null | undefined>>
  /** Optional free-form lines (e.g. report title/metadata) rendered above the header row, one cell each in column A. */
  preambleLines?: string[]
}): Promise<void> {
  const { filename, sheetName, columns, rows, preambleLines } = params

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Sheet1')

  sheet.columns = columns.map((c) => ({ width: c.width }))

  if (preambleLines?.length) {
    preambleLines.forEach((line) => { sheet.addRow([line]) })
    sheet.addRow([])
  }

  const headerRow = sheet.addRow(columns.map((c) => c.header))
  headerRow.font = { bold: true }
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0EEE9' } }
  })

  rows.forEach((row) => { sheet.addRow(row) })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Same inputs as downloadXlsx, but downloads a plain .csv (text/csv). iPhone
 * Safari offers "View" as well as "Download" for CSV, while an .xlsx sent as
 * a binary blob can only be downloaded. CSV carries no column widths.
 */
export function downloadCsv(params: {
  filename: string
  columns: XlsxColumn[]
  rows: Array<Array<string | number | null | undefined>>
}): void {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [params.columns.map((c) => cell(c.header)), ...params.rows.map((r) => r.map(cell))]
    .map((r) => r.join(','))
    .join('\r\n')
  // BOM so Excel reads ₹ and Tamil text as UTF-8
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = params.filename.endsWith('.csv') ? params.filename : `${params.filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Same download mechanics as downloadXlsx, but for reports built from
 * several stacked sections whose column counts differ (a "Metric/Value"
 * pair here, a 5-column ranking table there) — so there's no single
 * header row to derive widths from. Column widths are set directly;
 * section title rows (bold, first cell only) are detected by their
 * "--- LIKE THIS ---" convention already used by the report builders.
 */
export async function downloadXlsxSections(params: {
  filename: string
  sheetName: string
  columnWidths: number[]
  rows: Array<Array<string | number | null | undefined>>
}): Promise<void> {
  const { filename, sheetName, columnWidths, rows } = params

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Sheet1')
  sheet.columns = columnWidths.map((w) => ({ width: w }))

  rows.forEach((row) => {
    const addedRow = sheet.addRow(row)
    const firstCell = String(row[0] ?? '')
    if (firstCell.startsWith('---') || row.length === 1) {
      addedRow.font = { bold: true }
    }
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
