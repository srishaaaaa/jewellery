import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { DeskDocSheet } from '../components/invoice/DeskDocSheet'
import { PrintSettingsModal } from '../components/invoice/PrintSettingsModal'
import { toolbarBtn, toolbarBtnDark } from '../components/invoice/invoiceStyle'
import { printSheet, thermalWidth } from '../lib/printPrefs'
import { printDeskReceipt, readStoredDeskDoc } from '../lib/deskReceipt'

/** Full page for a Sales Desk slip opened from its preview ("Open Full Page"). */
export default function DeskDocPage() {
  const navigate = useNavigate()
  const [doc] = useState(readStoredDeskDoc)
  const [printOpen, setPrintOpen] = useState(false)
  const autoPrint = new URLSearchParams(window.location.search).get('print')

  useEffect(() => {
    if (!doc || (autoPrint !== 'a4' && autoPrint !== 'a5')) return
    const t = window.setTimeout(() => printSheet(autoPrint), 600)
    return () => window.clearTimeout(t)
  }, [doc, autoPrint])

  return (
    <div className="h-full overflow-y-auto bg-[#F7F7F7] py-6 px-3 sm:px-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-[776px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-3 shadow-sm print:hidden">
          <button type="button" onClick={() => navigate('/dashboard?tab=sales_desk')} className={toolbarBtn}><ArrowLeft className="w-4 h-4" /> Return to Sales Desk</button>
          <button type="button" disabled={!doc} onClick={() => setPrintOpen(true)} className={toolbarBtnDark}><Printer className="w-4 h-4" /> Print</button>
        </div>
        {printOpen && doc && (
          <PrintSettingsModal onClose={() => setPrintOpen(false)} onPrint={prefs => prefs.paper === 'thermal' ? printDeskReceipt(doc, thermalWidth(prefs)) : printSheet(prefs.size === 'a5' ? 'a5' : 'a4')} />
        )}
        <div className="rounded-xl border border-black/10 bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
          {doc ? <DeskDocSheet doc={doc} /> : <div className="p-12 text-center text-sm font-semibold text-[#000000]/60">Open a slip from the Sales Desk first.</div>}
        </div>
      </div>
    </div>
  )
}
