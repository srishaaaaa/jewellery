import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { Invoice } from '../components/Invoice'
import { Printer, ArrowLeft, MessageCircle } from 'lucide-react'
import { printThermalReceipt } from '../lib/thermalPrint'
import { invoicePdfFile } from '../lib/invoicePdf'
import { uploadInvoicePdf } from '../lib/storage'
import { isUuid, normalizeStructuredOrderItem, formatInvoiceNo, formatPaymentMode } from '../lib/retail'
import { buildProfessionalWhatsAppMessage } from '../lib/whatsappMessage'
import { toWhatsAppUrl } from '../lib/phone'
import { readJewellerySnapshot } from '../lib/jewellery'

export default function DigitalInvoice() {
  const { id } = useParams()
  const navigate = useNavigate()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [invoice, setInvoice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const invoiceElementRef = useRef<HTMLDivElement>(null)

  // navigate(-1) is unreliable inside in-app browsers (e.g. WhatsApp's),
  // since their own navigation stack doesn't map cleanly onto the SPA's
  // history — always go to a known destination instead.
  const handleBack = () => {
    navigate('/dashboard')
  }

  useEffect(() => {
    async function loadInvoice() {
      if (!isSupabaseConfigured) {
        setError('Database connection not configured')
        setLoading(false)
        return
      }
      try {
        const identifier = decodeURIComponent(id || '').trim()
        const formattedIdentifier = formatInvoiceNo(identifier)
        const strippedIdentifier = identifier.replace(/^INV/i, '').trim()
        const cleanIdentifier = identifier.replace(/^INV0*/i, '').trim()

        const tryRpc = async (invNo: string) => supabase.rpc('get_public_invoice_by_number', { p_invoice_no: invNo })

        let rpcResult = await tryRpc(identifier)
        if (!rpcResult.data || (Array.isArray(rpcResult.data) && rpcResult.data.length === 0)) {
          if (strippedIdentifier && strippedIdentifier !== identifier) {
             rpcResult = await tryRpc(strippedIdentifier)
          }
        }
        if (!rpcResult.data || (Array.isArray(rpcResult.data) && rpcResult.data.length === 0)) {
          if (cleanIdentifier && cleanIdentifier !== identifier && cleanIdentifier !== strippedIdentifier) {
             rpcResult = await tryRpc(cleanIdentifier)
          }
        }
        if (!rpcResult.data || (Array.isArray(rpcResult.data) && rpcResult.data.length === 0)) {
          if (formattedIdentifier && formattedIdentifier !== identifier && formattedIdentifier !== strippedIdentifier) {
             rpcResult = await tryRpc(formattedIdentifier)
          }
        }

        const { data: rpcData, error: rpcError } = rpcResult
        let row = Array.isArray(rpcData) ? rpcData[0] : rpcData

        // Keep existing links working when the public-invoice RPC has not yet
        // been applied to the target project.
        if (!row || rpcError) {
          const tryTable = async (invNo: string) => supabase.from('orders').select('*').eq('invoice_no', invNo).maybeSingle()

          let tableResult = await tryTable(identifier)
          if (!tableResult.data && strippedIdentifier && strippedIdentifier !== identifier) {
            tableResult = await tryTable(strippedIdentifier)
          }
          if (!tableResult.data && cleanIdentifier && cleanIdentifier !== identifier && cleanIdentifier !== strippedIdentifier) {
            tableResult = await tryTable(cleanIdentifier)
          }
          if (!tableResult.data && formattedIdentifier && formattedIdentifier !== identifier && formattedIdentifier !== strippedIdentifier) {
            tableResult = await tryTable(formattedIdentifier)
          }

          row = tableResult.data

          // Fallback: search orders by invoice_no being NULL or matching partial number
          if (!row) {
            const numPart = strippedIdentifier || cleanIdentifier || identifier
            const { data: allOrders } = await supabase
              .from('orders')
              .select('*')
              .or(`invoice_no.ilike.%${numPart}%,id.ilike.%${numPart}%`)
              .limit(1)
            row = Array.isArray(allOrders) && allOrders.length > 0 ? allOrders[0] : null
          }

          if (!row && isUuid(identifier)) {
            const { data: idData } = await supabase
              .from('orders')
              .select('*')
              .eq('id', identifier)
              .maybeSingle()
            row = idData
          }

          // Check advance_orders table for invoices (advance orders create invoices differently)
          if (!row) {
            const tryAdvanceTable = async (invNo: string) => supabase
              .from('advance_orders')
              .select('*')
              .or(`invoice_number.ilike.%${invNo}%,completed_order_id.eq.${invNo}`)
              .maybeSingle()

            let advanceResult = await tryAdvanceTable(identifier)
            if (!advanceResult.data && strippedIdentifier && strippedIdentifier !== identifier) {
              advanceResult = await tryAdvanceTable(strippedIdentifier)
            }
            if (!advanceResult.data && cleanIdentifier && cleanIdentifier !== identifier && cleanIdentifier !== strippedIdentifier) {
              advanceResult = await tryAdvanceTable(cleanIdentifier)
            }
            if (!advanceResult.data && formattedIdentifier && formattedIdentifier !== identifier && formattedIdentifier !== strippedIdentifier) {
              advanceResult = await tryAdvanceTable(formattedIdentifier)
            }

            row = advanceResult.data
          }

          if (!row) throw new Error('Invoice not found')
        }

        setInvoice(row)
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message)
        } else {
          setError('Invoice not found')
        }
      } finally {
        setLoading(false)
      }
    }
    if (id) loadInvoice()
  }, [id])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f9faf6] flex items-center justify-center">
        <span className="w-8 h-8 border-4 border-sand border-t-sageDark rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-[#f9faf6] flex flex-col items-center justify-center text-center p-6">
        <h1 className="text-2xl font-bold text-sageDark mb-2">Invoice Not Found</h1>
        <p className="text-gray-500 mb-6">The requested invoice could not be found.</p>
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 px-6 py-2 bg-sage text-white rounded-full font-bold hover:bg-sageDark transition cursor-pointer"
        >
          <ArrowLeft size={16} /> Back
        </button>
      </div>
    )
  }

  const invoiceItems = (Array.isArray(invoice.items) ? invoice.items : [])
    .map((item: Record<string, unknown>) => normalizeStructuredOrderItem(item))
  const subtotal = invoiceItems.reduce((sum: number, item: ReturnType<typeof normalizeStructuredOrderItem>) => sum + item.line_total, 0)
  // Older versions of the public-invoice RPC don't return `total`; derive it from the items
  // so the page, PDF, receipt and WhatsApp message all show the same amount.
  const invoiceTotal = Number(invoice.total) > 0
    ? Number(invoice.total)
    : subtotal + Number(invoice.delivery_charge || 0) + Number(invoice.total_gst || invoice.gst_amount || 0) - Number(invoice.discount_amount || 0) - Number(invoice.manual_discount_amount || 0)
  // Same RPC gap for credit_status: fall back to is_credit / credit_paid_at.
  const creditStatus: string | null = invoice.credit_status
    || (invoice.is_credit ? (invoice.credit_paid_at ? 'paid' : 'outstanding') : null)
  const isCredit = creditStatus === 'outstanding' || creditStatus === 'paid'
  const creditDueDate: string | null = creditStatus === 'outstanding' ? (invoice.credit_due_date || null) : null
  const creditPaidAt: string | null = creditStatus === 'paid' ? (invoice.credit_paid_at || null) : null
  // Savings scheme redeemed on this bill (columns exist once the jewellery migration is applied)
  const schemeInfo = {
    schemeNumber: invoice.scheme_number ? String(invoice.scheme_number) : null,
    schemeDiscount: Number(invoice.scheme_discount || 0),
    schemeAmountUsed: Number(invoice.scheme_amount_used || 0),
    schemeBalanceAfter: invoice.scheme_balance_after == null ? null : Number(invoice.scheme_balance_after),
  }

  const buildPdfData = () => ({
    invoiceNo: invoice.invoice_no,
    date: invoice.created_at,
    customerName: invoice.customer_name,
    phone: invoice.phone,
    address: invoice.address,
    items: invoiceItems as unknown as Array<Record<string, unknown>>,
    subtotal,
    shipping: Number(invoice.delivery_charge || 0),
    total: invoiceTotal,
    discountAmount: Number(invoice.discount_amount || 0),
    manualDiscountAmount: Number(invoice.manual_discount_amount || 0),
    gstAmount: Number(invoice.total_gst || invoice.gst_amount || 0),
    couponCode: invoice.coupon_code || undefined,
    paymentMode: formatPaymentMode(invoice.payment_mode || invoice.payment_method, invoice.split_details) || undefined,
    isCredit,
    creditDueDate,
    creditPaidAt,
    ...schemeInfo,
  })

  const downloadPdf = async () => {
    const file = invoicePdfFile(buildPdfData())
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const shareViaWhatsApp = async () => {
    // Open the tab synchronously within the click gesture — browsers block window.open()
    // called after an await, so we grab the handle now and navigate it once the PDF is ready.
    const whatsappWindow = window.open('', '_blank')

    const items = invoiceItems.map((item: ReturnType<typeof normalizeStructuredOrderItem>) => ({
      name: item.name,
      qty: item.quantity,
      unit: item.unit,
      unitType: item.unit_type,
      rate: item.base_price,
      lineTotal: item.line_total,
      giftNote: item.special_offer_note,
      giftValue: item.special_offer_cost,
      jewellery: item.jewellery,
    }))
    const message = buildProfessionalWhatsAppMessage({
      customerName: invoice.customer_name,
      phone: invoice.phone,
      invoiceNumber: invoice.invoice_no,
      invoiceDate: invoice.created_at,
      items,
      subtotal,
      couponDiscount: invoice.discount_amount,
      manualDiscountAmount: invoice.manual_discount_amount,
      shipping: invoice.delivery_charge,
      gstAmount: invoice.total_gst || invoice.gst_amount || 0,
      total: invoiceTotal,
      paymentMode: formatPaymentMode(invoice.payment_mode || invoice.payment_method, invoice.split_details),
      isCredit,
      creditDueDate,
      creditPaidAt,
      ...schemeInfo,
    })

    const file = invoicePdfFile(buildPdfData())

    let downloadLink = ''
    try {
      downloadLink = await uploadInvoicePdf(file, invoice.invoice_no)
    } catch (err) {
      console.warn('Failed to upload invoice PDF:', err)
    }

    const whatsappMessage = downloadLink
      ? `${message}\n\n📄 Download Invoice: ${downloadLink}`
      : `${message}\n\nThe PDF was downloaded. Please attach it in this chat before sending.`

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Invoice ${formatInvoiceNo(invoice.invoice_no)}`, text: whatsappMessage })
        whatsappWindow?.close()
        return
      } catch { /* fall through to the pre-opened tab below */ }
    }

    const downloadUrl = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = file.name
    link.click()
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)

    const waUrl = toWhatsAppUrl(invoice.phone, whatsappMessage)
    if (whatsappWindow) whatsappWindow.location.href = waUrl
    else window.open(waUrl, '_blank', 'noopener,noreferrer')
  }

  const printReceipt = () => {
    printThermalReceipt({
      paymentMode: formatPaymentMode(invoice.payment_mode || invoice.payment_method, invoice.split_details) || undefined,
      invoiceNo: invoice.invoice_no,
      date: invoice.created_at,
      customerName: invoice.customer_name,
      phone: invoice.phone,
      items: (invoice.items || []).map((item: Record<string, unknown>) => ({
        name: item.name || item.product_name,
        qty: item.qty || item.quantity,
        unit: item.unit,
        price: item.price || item.base_price || 0,
        line_total: item.line_total,
        jewellery: readJewellerySnapshot(item.jewellery),
      })),
      subtotal,
      shipping: invoice.delivery_charge || 0,
      couponDiscount: invoice.discount_amount || 0,
      totalGst: invoice.total_gst || invoice.gst_amount || 0,
      total: invoiceTotal,
      isCredit,
      creditDueDate,
      creditPaidAt,
      ...schemeInfo,
    })
  }

  return (
    <div className="h-full overflow-y-auto bg-[#f9faf6] font-sans pb-12 print:bg-white print:pb-0">
      {/* Top action bar */}
      <div className="bg-[#f9faf6] p-3 sm:p-4 sticky top-0 z-50 print:hidden flex flex-wrap items-center justify-between gap-2 max-w-4xl mx-auto">
        <button onClick={handleBack} className="flex items-center gap-1.5 sm:gap-2 text-[#0A0A0A] hover:text-[var(--accent)] font-semibold text-xs sm:text-sm transition-colors bg-white border border-[#B7E1BE] px-3 sm:px-4 py-1.5 sm:py-2 rounded-full shadow-sm cursor-pointer shrink-0">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={downloadPdf}
            className="flex items-center gap-1.5 sm:gap-2 bg-[#0A0A0A] text-[var(--accent)] border border-[var(--accent)] px-3 sm:px-5 py-1.5 sm:py-2 rounded-full font-bold text-xs sm:text-sm shadow-md hover:bg-[#1A1A1A] transition-colors cursor-pointer"
          >
            <Printer size={16} /> <span className="hidden sm:inline">PDF Invoice</span>
          </button>
          <button
            onClick={shareViaWhatsApp}
            className="flex items-center gap-1.5 sm:gap-2 bg-emerald-600 text-white px-3 sm:px-5 py-1.5 sm:py-2 rounded-full font-bold text-xs sm:text-sm shadow-md hover:bg-emerald-700 transition-colors cursor-pointer"
          >
            <MessageCircle size={16} /> <span className="hidden sm:inline">WhatsApp</span>
          </button>
        </div>
      </div>

      <div className="max-w-[830px] mx-auto mt-4 print:mt-0 px-2 sm:px-0">
        <div ref={invoiceElementRef} className="overflow-hidden print:shadow-none print:rounded-none print:border-none">
          <Invoice
            invoiceNo={invoice.invoice_no}
            date={invoice.created_at}
            customerName={invoice.customer_name}
            phone={invoice.phone}
            address={invoice.address}
            items={invoice.items || []}
            subtotal={subtotal}
            shipping={invoice.delivery_charge || 0}
            discountAmount={invoice.discount_amount || 0}
            manualDiscountAmount={invoice.manual_discount_amount || 0}
            gstAmount={invoice.total_gst || invoice.gst_amount || 0}
            couponCode={invoice.coupon_code}
            total={invoiceTotal}
            status={invoice.status}
            paymentMode={formatPaymentMode(invoice.payment_mode || invoice.payment_method, invoice.split_details)}
            isCredit={isCredit}
            creditDueDate={creditDueDate}
            creditPaidAt={creditPaidAt}
            schemeNumber={schemeInfo.schemeNumber}
            schemeDiscount={schemeInfo.schemeDiscount}
            schemeAmountUsed={schemeInfo.schemeAmountUsed}
            schemeBalanceAfter={schemeInfo.schemeBalanceAfter}
            onPrintReceipt={printReceipt}
          />
        </div>
      </div>
    </div>
  )
}
