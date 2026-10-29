import { useState } from 'react'
import { FileText, MessageCircle, X } from 'lucide-react'
import { isValidPhone, toWhatsAppUrl } from '../../lib/phone'
import { buildCouponWhatsAppMessage, createCouponPdf, recordCouponSend, type ShareableCoupon } from '../../lib/couponShare'

type Props = {
  coupon: ShareableCoupon
  onClose: () => void
  /** Called after a send is recorded, with the coupon's new phone list when it changed. */
  onSent: (allowedPhones: string[] | null) => void
}

/** Send a coupon to one customer on WhatsApp, as a link or as a PDF. */
export function SendCouponModal({ coupon, onClose, onSent }: Props) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [onlyForCustomer, setOnlyForCustomer] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const phoneOk = isValidPhone(phone)
  const disabled = !phoneOk || busy

  const record = async (channel: 'whatsapp' | 'pdf') => {
    const allowed = await recordCouponSend(coupon, phone, name, channel, onlyForCustomer)
    onSent(allowed)
    setDone(channel === 'pdf' ? 'Coupon PDF shared and recorded.' : 'WhatsApp opened and the send was recorded.')
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setDone('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Could not send the coupon') } finally { setBusy(false) }
  }

  const sendLink = () => run(async () => {
    const text = buildCouponWhatsAppMessage(coupon, name, onlyForCustomer)
    window.open(toWhatsAppUrl(phone, text), '_blank', 'noopener')
    await record('whatsapp')
  })

  const sharePdf = () => run(async () => {
    const file = createCouponPdf(coupon, name, onlyForCustomer)
    const text = buildCouponWhatsAppMessage(coupon, name, onlyForCustomer)
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `Coupon ${coupon.code}`, text })
      } catch (e) {
        // Closing the share sheet is not a send.
        if (e instanceof DOMException && e.name === 'AbortError') return
        throw e
      }
    } else {
      // Computers: save the PDF and open the chat so it can be attached.
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      window.open(toWhatsAppUrl(phone, text), '_blank', 'noopener')
    }
    await record('pdf')
  })

  const label = 'block text-[11px] font-black uppercase tracking-[0.08em] text-[#000000] mb-1.5'
  const input = 'w-full h-12 rounded-xl border border-black/10 bg-[#F9FAFB] px-4 text-sm font-semibold text-[#000000] outline-none focus:border-[var(--accent)]'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--accent)]/40 bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-black text-[#000000]">
            Send coupon · <span className="font-mono tracking-wider">{coupon.code}</span>
          </h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-xl border border-black/10 p-2 text-[#000000] hover:bg-black/5 cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-xs text-[#000000]/70">
          The coupon goes as a download link in the customer's WhatsApp chat, or as a PDF with "Generate &amp; share PDF".
          It is recorded once the chat or share sheet has been used.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className={label}>Customer phone <span className="text-red-500">*</span></label>
            <input className={input} inputMode="tel" value={phone} placeholder="Enter WhatsApp number"
              onChange={(e) => { setPhone(e.target.value); setDone('') }} />
            {phone.trim() && !phoneOk && <p className="mt-1 text-[11px] font-semibold text-red-600">Enter a 10-digit mobile number</p>}
          </div>
          <div>
            <label className={label}>Customer name</label>
            <input className={input} value={name} placeholder="Optional" onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[#000000]">Only for this customer</span>
            <button type="button" role="switch" aria-checked={onlyForCustomer} onClick={() => setOnlyForCustomer((v) => !v)}
              className={`relative h-7 w-12 rounded-full transition-colors cursor-pointer ${onlyForCustomer ? 'bg-[var(--accent)]' : 'bg-black/15'}`}>
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${onlyForCustomer ? 'left-6' : 'left-1'}`} />
            </button>
          </div>
          {onlyForCustomer && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-800">
              This coupon will only work for the phones it was sent to. Walk-in customers can't use it any more, so use a dedicated coupon for this.
            </p>
          )}

          {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
          {done && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{done}</p>}

          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={onClose}
              className="h-12 rounded-xl border border-black/10 bg-white text-sm font-black text-[#000000] hover:bg-black/5 cursor-pointer">
              {done ? 'Done' : 'Cancel'}
            </button>
            <button type="button" onClick={() => void sendLink()} disabled={disabled}
              className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#25D366] px-2 text-xs font-black text-white hover:bg-[#1EBE5B] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer">
              <MessageCircle size={15} className="shrink-0" /> Send link on WhatsApp
            </button>
            <button type="button" onClick={() => void sharePdf()} disabled={disabled}
              className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-[#25D366] bg-white px-2 text-xs font-black text-[#15803D] hover:bg-emerald-50 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer">
              <FileText size={15} className="shrink-0" /> Generate &amp; share PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
