import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, Printer } from 'lucide-react'
import { schemeService, type SchemeInstallment } from '../services/schemeService'
import type { JewelleryScheme } from '../lib/jewellery'
import { SchemeReceiptSheet } from '../components/invoice/SchemeReceiptSheet'
import { PrintSettingsModal } from '../components/invoice/PrintSettingsModal'
import { toolbarBtn, toolbarBtnDark } from '../components/invoice/invoiceStyle'
import { printSheet, thermalWidth } from '../lib/printPrefs'
import { printSchemeReceipt, totalsAfterInstallment, type ReceiptTotals } from '../lib/schemeReceipt'
import { getErrorMessage } from '../lib/errorMessage'

/** Full-page scheme receipt: /scheme-receipt/:schemeId/:installmentId (latest paid when omitted). */
export default function SchemeReceiptPage() {
  const { schemeId, installmentId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<{ scheme: JewelleryScheme; installment: SchemeInstallment; totals: ReceiptTotals } | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const autoPrint = new URLSearchParams(window.location.search).get('print')

  useEffect(() => {
    let alive = true
    Promise.all([schemeService.list(), schemeService.fetchInstallments(schemeId || '')])
      .then(([schemes, inst]) => {
        if (!alive) return
        const scheme = schemes.find(s => s.id === schemeId)
        const paid = inst.filter(i => i.status === 'paid')
        const installment = (installmentId ? paid.find(i => i.id === installmentId) : null) || paid[paid.length - 1]
        if (!scheme || !installment) { setError('This receipt was not found.'); return }
        setData({ scheme, installment, totals: totalsAfterInstallment(scheme, inst, installment) })
      })
      .catch(err => { if (alive) setError(getErrorMessage(err, 'Unable to load the receipt')) })
    return () => { alive = false }
  }, [schemeId, installmentId])

  useEffect(() => {
    if (!data || (autoPrint !== 'a4' && autoPrint !== 'a5')) return
    const t = window.setTimeout(() => printSheet(autoPrint), 600)
    return () => window.clearTimeout(t)
  }, [data, autoPrint])

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#F7F7F7] py-6 px-3 sm:px-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-[776px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-3 shadow-sm print:hidden">
          <button type="button" onClick={() => navigate('/dashboard?tab=schemes')} className={toolbarBtn}><ArrowLeft className="w-4 h-4" /> Return to Schema</button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void copyLink()} className={toolbarBtn}>{copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy Link</>}</button>
            <button type="button" disabled={!data} onClick={() => setPrintOpen(true)} className={toolbarBtnDark}><Printer className="w-4 h-4" /> Print</button>
          </div>
        </div>
        {printOpen && data && (
          <PrintSettingsModal
            onClose={() => setPrintOpen(false)}
            onPrint={prefs => prefs.paper === 'thermal' ? printSchemeReceipt(data.scheme, data.installment, data.totals, thermalWidth(prefs)) : printSheet(prefs.size === 'a5' ? 'a5' : 'a4')}
          />
        )}
        <div className="rounded-xl border border-black/10 bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
          {data ? <SchemeReceiptSheet scheme={data.scheme} installment={data.installment} totals={data.totals} /> : (
            <div className="p-12 text-center text-sm font-semibold text-[#000000]/60">{error || 'Loading receipt…'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
