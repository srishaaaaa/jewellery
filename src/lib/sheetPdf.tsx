import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

/** Turns a rendered sheet into a one-page PDF sized to its content (no split totals / footer). */
export async function elementToPdfFile(element: HTMLElement, fileName: string): Promise<File> {
  await document.fonts?.ready
  const canvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  })
  const pageWidth = 210
  const imageHeight = (canvas.height * pageWidth) / canvas.width
  const doc = new jsPDF({ unit: 'mm', format: [pageWidth, imageHeight], orientation: 'portrait' })
  doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, imageHeight, undefined, 'FAST')
  return new File([doc.output('blob')], fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`, { type: 'application/pdf' })
}

/**
 * Renders a sheet component (Invoice, DeskDocSheet, AdvanceReceiptSheet, …) off screen and
 * returns it as a PDF, so downloaded and WhatsApp-shared files look exactly like the on-screen bill.
 */
export async function sheetPdfFile(sheet: ReactElement, fileName: string, settleMs = 400): Promise<File> {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;pointer-events:none;z-index:-1'
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    flushSync(() => root.render(sheet))
    // Let effects load their data (e.g. advance payments) and images (logo) finish loading.
    await new Promise(resolve => setTimeout(resolve, settleMs))
    await Promise.all(Array.from(host.querySelectorAll('img')).map(img => img.complete ? null : img.decode().catch(() => null)))
    const target = (host.firstElementChild as HTMLElement | null) || host
    return await elementToPdfFile(target, fileName)
  } finally {
    root.unmount()
    host.remove()
  }
}
