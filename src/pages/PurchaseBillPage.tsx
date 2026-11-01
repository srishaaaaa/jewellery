import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, MessageCircle, Printer } from 'lucide-react'
import { purchaseService, supplierService, type Purchase, type Supplier, type SupplierPayment } from '../services/purchaseService'
import { PurchaseBillSheet } from '../components/invoice/PurchaseBillSheet'
import { PrintSettingsModal } from '../components/invoice/PrintSettingsModal'
import { toolbarBtn, toolbarBtnDark } from '../components/invoice/invoiceStyle'
import { printSheet, thermalWidth } from '../lib/printPrefs'
import { printPurchaseThermal, sharePurchaseWhatsApp } from '../lib/purchaseDocs'
import { getErrorMessage } from '../lib/errorMessage'
import { useSettingsStore } from '../store/store'
import { BRAND_EN } from '../lib/brand'

/** Full-page purchase bill: opened from the purchase preview's "Open Full Page". */
export default function PurchaseBillPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const shopName = useSettingsStore(s => s.settings?.name) || BRAND_EN
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [payments, setPayments] = useState<SupplierPayment[]>([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const autoPrint = new URLSearchParams(window.location.search).get('print')

  useEffect(() => {
    let alive = true
    Promise.all([purchaseService.list(), supplierService.list()])
      .then(async ([rows, sups]) => {
        if (!alive) return
        const key = decodeURIComponent(id || '')
        const found = rows.find(r => r.id === key || r.purchaseNumber === key) || null
        setPurchase(found)
        if (!found) { setError(`Purchase ${key} was not found.`); return }
        setSupplier(sups.find(s => s.id === found.supplierId) || null)
        const pays = await purchaseService.payments(found.id)
        if (alive) setPayments(pays)
      })
      .catch(err => { if (alive) setError(getErrorMessage(err, 'Unable to load the purchase')) })
    return () => { alive = false }
  }, [id])

  useEffect(() => {
    if (!purchase || (autoPrint !== 'a4' && autoPrint !== 'a5')) return
    const t = window.setTimeout(() => printSheet(autoPrint), 600)
    return () => window.clearTimeout(t)
  }, [purchase, autoPrint])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#F7F7F7] py-6 px-3 sm:px-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-[776px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-3 shadow-sm print:hidden">
          <button type="button" onClick={() => navigate('/dashboard?tab=purchases')} className={toolbarBtn}>
            <ArrowLeft className="w-4 h-4" /> Return to Purchases
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!purchase} onClick={() => purchase && sharePurchaseWhatsApp(purchase, supplier, shopName, window.location.href)} className={toolbarBtn}><MessageCircle className="w-4 h-4" /> Share WhatsApp</button>
            <button type="button" onClick={() => void copyLink()} className={toolbarBtn}>
              {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy Link</>}
            </button>
            <button type="button" disabled={!purchase} onClick={() => setPrintOpen(true)} className={toolbarBtnDark}><Printer className="w-4 h-4" /> Print</button>
          </div>
        </div>

        {printOpen && purchase && (
          <PrintSettingsModal
            onClose={() => setPrintOpen(false)}
            onPrint={prefs => prefs.paper === 'thermal' ? printPurchaseThermal(purchase, supplier, thermalWidth(prefs)) : printSheet(prefs.size === 'a5' ? 'a5' : 'a4')}
          />
        )}

        <div className="rounded-xl border border-black/10 bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
          {purchase ? <PurchaseBillSheet purchase={purchase} supplier={supplier} payments={payments} /> : (
            <div className="p-12 text-center text-sm font-semibold text-[#000000]/60">{error || 'Loading purchase…'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
