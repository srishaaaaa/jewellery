import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Copy, FileDown, MessageCircle, Printer } from 'lucide-react'
import { listAdvanceOrders, type AdvanceOrder } from '../services/advanceOrderService'
import { AdvanceReceiptSheet } from '../components/invoice/AdvanceReceiptSheet'
import { toolbarBtn, toolbarBtnDark } from '../components/invoice/invoiceStyle'
import { advanceReceiptPdf, downloadFile } from '../lib/advanceReceipt'
import { buildAdvanceDepositWhatsAppMessage } from '../lib/whatsappMessage'
import { toWhatsAppUrl } from '../lib/phone'
import { getErrorMessage } from '../lib/errorMessage'

/** Full-page advance receipt: opened from the receipt preview's "Open Full Page". */
export default function AdvanceReceiptPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [order, setOrder] = useState<AdvanceOrder | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    listAdvanceOrders()
      .then(rows => {
        if (!alive) return
        const key = decodeURIComponent(id || '')
        const found = rows.find(r => r.id === key || r.deposit_id === key) || null
        setOrder(found)
        if (!found) setError(`Advance order ${key} was not found.`)
      })
      .catch(err => { if (alive) setError(getErrorMessage(err, 'Unable to load the advance order')) })
    return () => { alive = false }
  }, [id])

  const share = () => {
    if (!order) return
    const message = buildAdvanceDepositWhatsAppMessage({
      customerName: order.customer_name,
      depositId: order.deposit_id,
      productName: order.product_name,
      totalAmount: order.total_amount,
      depositAmount: order.deposit_amount,
      remainingBalance: order.status === 'completed' ? 0 : order.remaining_balance,
      expectedDeliveryDate: order.expected_delivery_date,
    })
    window.open(toWhatsAppUrl(order.phone, message), '_blank', 'noopener,noreferrer')
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked: nothing to do */ }
  }

  return (
    <div className="h-full overflow-y-auto bg-[#F7F7F7] py-6 px-3 sm:px-6 print:bg-white print:p-0">
      <div className="mx-auto max-w-[776px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-3 shadow-sm print:hidden">
          <button type="button" onClick={() => navigate('/dashboard?tab=advance_orders')} className={toolbarBtn}>
            <ArrowLeft className="w-4 h-4" /> Return to POS
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={share} disabled={!order} className={toolbarBtn}><MessageCircle className="w-4 h-4" /> Share WhatsApp</button>
            <button type="button" onClick={() => void copyLink()} className={toolbarBtn}>
              {copied ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy Link</>}
            </button>
            <button type="button" onClick={() => order && downloadFile(advanceReceiptPdf(order))} disabled={!order} className={toolbarBtn}><FileDown className="w-4 h-4" /> PDF</button>
            <button type="button" onClick={() => window.print()} disabled={!order} className={toolbarBtnDark}><Printer className="w-4 h-4" /> Print</button>
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white shadow-sm print:rounded-none print:border-none print:shadow-none">
          {order ? (
            <AdvanceReceiptSheet order={order} />
          ) : (
            <div className="p-12 text-center text-sm font-semibold text-[#000000]/60">{error || 'Loading receipt…'}</div>
          )}
        </div>
      </div>
    </div>
  )
}
